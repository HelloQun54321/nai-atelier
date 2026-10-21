/**
 * 一键 Roll 的内容 → 风格串。
 *
 * 风格串的结构与实验室不同：全局只有三块栏位（场景 / 镜头 / 补充），
 * 人物形象 / 服饰穿搭 / 动作互动 / 表情状态只存在于角色上。
 * 所以六类内容必须分头写——角色类进角色 1，场景与镜头进全局栏，
 * 否则编辑器里只能显示在「补充」，其余栏位看不到。
 *
 * 本模块只做纯计算：给出新的 params / variableValues 与逐栏差异，写库交给调用方（App）。
 */
import { mergePromptSections, normalizeParams } from './labWorkspace';
import { createUuid } from './id';
import type { NAIParams, PromptChain } from '../types';

export const ROLL_TO_CHAIN_ROLE_KINDS = ['appearance', 'wardrobe', 'pose', 'expression'] as const;
export const ROLL_TO_CHAIN_GLOBAL_KINDS = ['scene', 'camera'] as const;

/** Roll 结果的一栏：只有正文与条目名参与写入。 */
export interface RollToChainSourceRow {
  kind: string;
  name?: string;
  text: string;
}

/** split = 按栏写入（角色四栏 + 全局场景/镜头）；extra = 六类合并成一段写进补充。 */
export type RollToChainScope = 'split' | 'extra';
export type RollToChainTarget = 'character' | 'global' | 'extra';

export interface RollToChainWrite {
  kind: string;
  target: RollToChainTarget;
  text: string;
  /** 写入前的原值，界面用来显示「当前 → 将写入」。 */
  previous: string;
}

export interface RollToChainPlan {
  params: NAIParams;
  variableValues: Record<string, unknown>;
  writes: RollToChainWrite[];
  /** 在该范围下没有对应栏位、因此没有写入的分类。 */
  skipped: string[];
}

export interface RollToChainOptions {
  scope?: RollToChainScope;
  /** 只写这些分类；省略表示全部。 */
  include?: string[];
  /** 新建角色时使用的 id（测试注入用，默认随机）。 */
  characterId?: string;
}

const trimmed = (value: unknown) => String(value ?? '').trim();

const plainObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const isRoleKind = (kind: string) => (ROLL_TO_CHAIN_ROLE_KINDS as readonly string[]).includes(kind);
const isGlobalKind = (kind: string) => (ROLL_TO_CHAIN_GLOBAL_KINDS as readonly string[]).includes(kind);

/** 合并栏来源快照：保留该栏原有字段，只覆盖来源类型与条目名。 */
const mergeMeta = (existing: unknown, entryName: string) => ({
  ...(plainObject(existing) || {}),
  source: 'roll',
  entryName,
});

/**
 * 算出写入某条风格串（或用它作为新建模板，chain=null）之后的分栏与主体提示词。
 * 不做任何 I/O，同参数重复调用结果一致。
 */
export const planRollToChain = (
  chain: PromptChain | null | undefined,
  rows: RollToChainSourceRow[],
  options: RollToChainOptions = {},
): RollToChainPlan => {
  const scope: RollToChainScope = options.scope === 'extra' ? 'extra' : 'split';
  const include = Array.isArray(options.include) ? new Set(options.include) : null;
  const params = normalizeParams((chain?.params || null) as NAIParams | null) as NAIParams & Record<string, unknown>;
  const sourceSections = plainObject(params._promptSections);
  const sections: Record<string, unknown> = sourceSections ? { ...sourceSections } : {};
  const sourceMeta = plainObject(sections.sectionMeta);
  const sectionMeta: Record<string, unknown> = sourceMeta ? { ...sourceMeta } : {};
  const characters: any[] = Array.isArray(params.characters)
    ? params.characters.map((item: any) => ({
      ...item,
      sections: plainObject(item?.sections) ? { ...item.sections } : item?.sections,
      sectionMeta: plainObject(item?.sectionMeta) ? { ...item.sectionMeta } : item?.sectionMeta,
    }))
    : [];

  const usable = rows.filter(row => trimmed(row.text) && (!include || include.has(row.kind)));
  const writes: RollToChainWrite[] = [];
  const skipped: string[] = [];

  if (scope === 'extra') {
    const previous = trimmed(sections.extra);
    const merged = [...(previous ? [previous] : []), ...usable.map(row => trimmed(row.text))].join(', ');
    sections.extra = merged;
    sectionMeta.extra = mergeMeta(sectionMeta.extra, '一键 Roll 合并');
    writes.push({ kind: 'extra', target: 'extra', text: merged, previous });
    for (const row of usable) writes.push({ kind: row.kind, target: 'extra', text: trimmed(row.text), previous: '' });
  } else {
    for (const row of usable) {
      const value = trimmed(row.text);
      if (isRoleKind(row.kind)) {
        const character = characters[0] || (characters[0] = {
          id: options.characterId || createUuid(), x: 0.5, y: 0.5, prompt: '', sections: {}, sectionMeta: {},
        });
        const characterSections = plainObject(character.sections) || {};
        const previous = trimmed(characterSections[row.kind]);
        character.sections = { ...characterSections, [row.kind]: value };
        character.sectionMeta = { ...(plainObject(character.sectionMeta) || {}), [row.kind]: mergeMeta(plainObject(character.sectionMeta)?.[row.kind], row.name || '') };
        // 这几栏在风格串里只属于角色：全局栏里的同名遗留值一并移走，避免正文出现两份。
        delete sections[row.kind];
        delete sectionMeta[row.kind];
        writes.push({ kind: row.kind, target: 'character', text: value, previous });
      } else if (isGlobalKind(row.kind)) {
        const previous = trimmed(sections[row.kind]);
        sections[row.kind] = value;
        sectionMeta[row.kind] = mergeMeta(sectionMeta[row.kind], row.name || '');
        writes.push({ kind: row.kind, target: 'global', text: value, previous });
      } else {
        skipped.push(row.kind);
      }
    }
  }

  params._promptSections = (Object.keys(sectionMeta).length ? { ...sections, sectionMeta } : sections) as NAIParams['_promptSections'];
  if (characters.length) params.characters = characters;
  const variableValues = {
    ...(plainObject(chain?.variableValues) || {}),
    subject: mergePromptSections(params._promptSections),
  };
  return { params, variableValues, writes, skipped };
};
