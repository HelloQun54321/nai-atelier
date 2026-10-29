import { rollSectionKey } from './contentRoll';
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
import { mergePromptSections, normalizeParams, resolvePromptSections } from './labWorkspace';
import { isCreativeSectionKey } from './promptPurposes.mjs';
import { createUuid } from './id';
import type { NAIParams, PromptChain } from '../types';

export const ROLL_TO_CHAIN_ROLE_KINDS = ['appearance', 'wardrobe', 'pose', 'expression'] as const;
export const ROLL_TO_CHAIN_GLOBAL_KINDS = ['scene', 'camera', 'presentation'] as const;

/** Roll 结果的一栏：正负词与条目名一起写入。 */
export interface RollToChainSourceRow {
  kind: string;
  name?: string;
  text: string;
  negative?: string;
  scope?: 'global' | 'character';
  directoryName?: string; directoryPath?: string[];
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
  targetRoleId?: string;
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
  // 未分栏或与旧分栏不一致的主体，沿用编辑器规则保留在补充栏。
  const sections: Record<string, unknown> = { ...resolvePromptSections(params._promptSections,
    String(chain?.variableValues?.subject ?? mergePromptSections(params._promptSections))) };
  const sectionNegatives = { ...(plainObject(sections.sectionNegatives) || {}) };
  const sourceMeta = plainObject(sections.sectionMeta);
  const sectionMeta: Record<string, unknown> = sourceMeta ? { ...sourceMeta } : {};
  const characters: any[] = Array.isArray(params.characters)
    ? params.characters.map((item: any) => ({
      ...item,
      sections: plainObject(item?.sections) ? { ...item.sections } : item?.sections,
      sectionNegatives: { ...(plainObject(item?.sectionNegatives) || {}) },
      sectionMeta: plainObject(item?.sectionMeta) ? { ...item.sectionMeta } : item?.sectionMeta,
    }))
    : [];
  const roleIndex = options.targetRoleId === 'new' ? characters.length : options.targetRoleId
    ? characters.findIndex(item => String(item.id) === options.targetRoleId) : 0;
  if (roleIndex < 0) throw new Error('目标角色已不存在，请重新选择');

  const usable = rows.map(row => ({ ...row, itemId: row.kind, kind: rollSectionKey(row.kind) })).filter(row => trimmed(row.text) && (!include || include.has(row.itemId)));
  const writes: RollToChainWrite[] = [];
  const skipped: string[] = [];

  if (scope === 'extra') {
    const previous = trimmed(sections.extra);
    const merged = [...(previous ? [previous] : []), ...usable.map(row => trimmed(row.text))].join(', ');
    sections.extra = merged;
    const negative = [trimmed(sectionNegatives.extra), ...usable.map(row => trimmed(row.negative))].filter(Boolean).join(', ');
    if (negative) sectionNegatives.extra = negative;
    sectionMeta.extra = mergeMeta(sectionMeta.extra, '一键 Roll 合并');
    writes.push({ kind: 'extra', target: 'extra', text: merged, previous });
    for (const row of usable) writes.push({ kind: row.itemId, target: 'extra', text: trimmed(row.text), previous: '' });
  } else {
    for (const row of usable) {
      const value = trimmed(row.text);
      if (isRoleKind(row.kind) || isCreativeSectionKey(row.kind) && row.scope === 'character') {
        const character = characters[roleIndex] || (characters[roleIndex] = {
          id: options.characterId || createUuid(), x: 0.5, y: 0.5, prompt: '', sections: {}, sectionNegatives: {}, sectionMeta: {},
        });
        const characterSections = plainObject(character.sections) || {};
        const previous = trimmed(characterSections[row.kind]);
        character.sections = { ...characterSections, [row.kind]: value };
        if (trimmed(row.negative)) character.sectionNegatives[row.kind] = trimmed(row.negative);
        else delete character.sectionNegatives[row.kind];
        character.sectionMeta = { ...(plainObject(character.sectionMeta) || {}), [row.kind]: { ...mergeMeta(plainObject(character.sectionMeta)?.[row.kind], row.name || ''), ...(isCreativeSectionKey(row.kind) ? { directoryName: row.directoryName, directoryPath: row.directoryPath } : {}) } };
        // 这几栏在风格串里只属于角色：全局栏里的同名遗留值一并移走，避免正文出现两份。
        if (isRoleKind(row.kind)) {
          delete sections[row.kind];
          delete sectionMeta[row.kind];
          delete sectionNegatives[row.kind];
        }
        writes.push({ kind: row.itemId, target: 'character', text: value, previous });
      } else if (isGlobalKind(row.kind) || isCreativeSectionKey(row.kind)) {
        const previous = trimmed(sections[row.kind]);
        sections[row.kind] = value;
        if (trimmed(row.negative)) sectionNegatives[row.kind] = trimmed(row.negative);
        else delete sectionNegatives[row.kind];
        sectionMeta[row.kind] = { ...mergeMeta(sectionMeta[row.kind], row.name || ''), ...(isCreativeSectionKey(row.kind) ? { directoryName: row.directoryName, directoryPath: row.directoryPath } : {}) };
        writes.push({ kind: row.itemId, target: 'global', text: value, previous });
      } else {
        skipped.push(row.kind);
      }
    }
  }

  if (Object.keys(sectionNegatives).length) sections.sectionNegatives = sectionNegatives;
  else delete sections.sectionNegatives;
  params._promptSections = (Object.keys(sectionMeta).length ? { ...sections, sectionMeta } : sections) as NAIParams['_promptSections'];
  if (characters.length) params.characters = characters;
  const variableValues = {
    ...(plainObject(chain?.variableValues) || {}),
    subject: mergePromptSections(params._promptSections),
  };
  return { params, variableValues, writes, skipped };
};
