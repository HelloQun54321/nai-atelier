import { describe, expect, it } from 'vitest';
import { planRollToChain, ROLL_TO_CHAIN_GLOBAL_KINDS, ROLL_TO_CHAIN_ROLE_KINDS, type RollToChainSourceRow } from '../../services/contentRollToChain';
import type { PromptChain } from '../../types';
import { compileCharacterContent } from '../../services/characterPrompts';

const rows: RollToChainSourceRow[] = [
  { kind: 'appearance', name: '黑发短发少女', text: 'black hair, short hair, blue eyes' },
  { kind: 'wardrobe', name: '苗族服饰', text: 'miao traditional clothes, ethnic clothes, cross-collar top' },
  { kind: 'pose', name: '侧躺抬腿', text: 'lying, on side, one leg raised' },
  { kind: 'expression', name: '撩人表情', text: 'seductive smile, half closed eyes' },
  { kind: 'scene', name: '废弃游乐园', text: 'abandoned amusement park, overcast' },
  { kind: 'camera', name: '侧面全身', text: 'full body, from side, telephoto' },
];

const chain = (params: Record<string, unknown> = {}, variableValues: Record<string, unknown> = {}): PromptChain => ({
  id: 'chain-1',
  userId: 'owner',
  username: 'owner',
  name: '路西法5串1',
  description: '',
  type: 'style',
  tags: [],
  basePrompt: 'masterpiece, best quality',
  negativePrompt: '',
  modules: [],
  params: { model: 'nai-diffusion-4-5-full', ...params },
  variableValues: { subject: '旧主体', ...variableValues },
  createdAt: 1,
  updatedAt: 1,
} as unknown as PromptChain);

describe('planRollToChain', () => {
  it('按栏写入：角色四栏进角色 1，场景/镜头进全局栏，主体只合并全局栏', () => {
    const plan = planRollToChain(chain(), rows, { characterId: 'char-1' });
    const sections: any = plan.params._promptSections;
    expect(sections.scene).toBe('abandoned amusement park, overcast');
    expect(sections.camera).toBe('full body, from side, telephoto');
    // 角色栏不写进全局栏
    for (const kind of ROLL_TO_CHAIN_ROLE_KINDS) expect(sections[kind]).toBeUndefined();
    const character: any = (plan.params.characters as any[])[0];
    expect(character.id).toBe('char-1');
    expect(character.sections).toMatchObject({
      appearance: 'black hair, short hair, blue eyes',
      wardrobe: 'miao traditional clothes, ethnic clothes, cross-collar top',
      pose: 'lying, on side, one leg raised',
      expression: 'seductive smile, half closed eyes',
    });
    expect(character.sectionMeta.wardrobe).toMatchObject({ source: 'roll', entryName: '苗族服饰' });
    expect(plan.variableValues.subject).toBe('abandoned amusement park, overcast, full body, from side, telephoto, 旧主体');
    expect(plan.skipped).toEqual([]);
    expect(plan.writes.filter(write => write.target === 'character')).toHaveLength(4);
    expect(plan.writes.filter(write => write.target === 'global')).toHaveLength(2);
  });

  it('全局栏里的同名遗留值会被移走，避免正文出现两份', () => {
    const legacy = chain({
      _promptSections: { appearance: 'old appearance text', scene: 'old scene', extra: '' },
    }, { subject: 'old appearance text, old scene' });
    const plan = planRollToChain(legacy, rows, { characterId: 'char-1' });
    const sections: any = plan.params._promptSections;
    expect(sections.appearance).toBeUndefined();
    expect(sections.scene).toBe('abandoned amusement park, overcast');
    expect(plan.variableValues.subject).toBe('abandoned amusement park, overcast, full body, from side, telephoto');
  });

  it('已有角色保留坐标、手动补充与其它分栏，只覆盖本次写入的栏', () => {
    const existing = chain({
      characters: [{
        id: 'existing-char', x: 0.3, y: 0.7, prompt: '手动补充', negativePrompt: 'bad hands',
        sections: { appearance: 'silver hair', wardrobe: 'old outfit' },
      }],
    });
    const plan = planRollToChain(existing, rows, { include: ['wardrobe'] });
    const character: any = (plan.params.characters as any[])[0];
    expect(character.id).toBe('existing-char');
    expect(character).toMatchObject({ x: 0.3, y: 0.7, prompt: '手动补充', negativePrompt: 'bad hands' });
    expect(character.sections).toEqual({ appearance: 'silver hair', wardrobe: 'miao traditional clothes, ethnic clothes, cross-collar top' });
    // 只写服饰：场景/镜头不动，原主体保留在补充栏。
    expect(plan.writes.map(write => write.kind)).toEqual(['wardrobe']);
    expect(plan.params._promptSections?.scene).toBe('');
    expect(plan.variableValues.subject).toBe('旧主体');
  });

  it('合并成一段：六类按顺序写进补充栏，并保留原有补充内容', () => {
    const withExtra = chain({ _promptSections: { extra: 'existing extra' } }, { subject: 'existing extra' });
    const plan = planRollToChain(withExtra, rows, { scope: 'extra' });
    const sections: any = plan.params._promptSections;
    expect(sections.extra).toBe(['existing extra', ...rows.map(row => row.text)].join(', '));
    // 合并模式不动场景/镜头栏（normalizeParams 会把未使用的栏补成空串）
    expect(String(sections.scene ?? '')).toBe('');
    expect(String(sections.camera ?? '')).toBe('');
    expect((plan.params.characters as any[] | undefined) || []).toHaveLength(0);
    expect(plan.variableValues.subject).toBe(sections.extra);
    expect(plan.writes[0]).toMatchObject({ kind: 'extra', target: 'extra', previous: 'existing extra' });
  });

  it('没有角色时新建角色 1；未知分类只记在 skipped 里', () => {
    const plan = planRollToChain(null, [...rows, { kind: 'unknown', text: 'whatever' }], { characterId: 'new-char' });
    expect((plan.params.characters as any[])[0].id).toBe('new-char');
    expect(plan.skipped).toEqual(['unknown']);
    // 空串不参与
    const empty = planRollToChain(chain(), [{ kind: 'scene', text: '   ' }]);
    expect(empty.writes).toHaveLength(0);
    expect(empty.variableValues.subject).toBe('旧主体');
  });

  it('写入全局栏时记录来源快照（source=roll + 条目名）', () => {
    const plan = planRollToChain(chain(), rows, { include: [...ROLL_TO_CHAIN_GLOBAL_KINDS] });
    const sections: any = plan.params._promptSections;
    expect(sections.sectionMeta.scene).toMatchObject({ source: 'roll', entryName: '废弃游乐园' });
    expect(sections.sectionMeta.camera).toMatchObject({ source: 'roll', entryName: '侧面全身' });
    expect(plan.writes.every(write => write.target === 'global')).toBe(true);
  });

  it.each(['split', 'extra'] as const)('%s 写入保留未分栏或与旧分栏不一致的主体，不复活旧词', scope => {
    for (const params of [{}, { _promptSections: { extra: '过期草稿' } }]) {
      const original = chain(params, { subject: 'standing beside a red car', other: 'untouched' });
      const before = JSON.stringify(original);
      const plan = planRollToChain(original, [{ kind: 'wardrobe', text: 'white dress' }], { scope, characterId: 'c1' });
      expect(plan.variableValues.subject).toBe(scope === 'split'
        ? 'standing beside a red car' : 'standing beside a red car, white dress');
      expect(plan.variableValues.other).toBe('untouched');
      expect(JSON.stringify(plan)).not.toContain('过期草稿');
      expect(JSON.stringify(original)).toBe(before);
    }
  });

  it.each([...ROLL_TO_CHAIN_ROLE_KINDS, ...ROLL_TO_CHAIN_GLOBAL_KINDS])('%s 替换正负词，无新负面时清旧值且不影响其他分类', kind => {
    const role = (ROLL_TO_CHAIN_ROLE_KINDS as readonly string[]).includes(kind);
    const original = chain({
      _promptSections: { [kind]: 'old text', extra: 'keep extra', sectionNegatives: { [kind]: 'new text', extra: 'keep negative' } },
      characters: [{ id: 'c1', prompt: 'handwritten', negativePrompt: 'manual negative', x: 0.3, y: 0.7,
        sections: { [kind]: 'old text' }, sectionNegatives: { [kind]: 'new text' } }],
    }, { subject: kind === 'expression' ? 'keep extra' : 'old text, keep extra' });
    const before = JSON.stringify(original);
    for (const negative of ['', 'new negative']) {
      const plan = planRollToChain(original, [{ kind, text: 'new text', negative }]);
      const target = role ? plan.params.characters![0] : plan.params._promptSections!;
      const negatives: Record<string, string | undefined> = target.sectionNegatives || {};
      expect(negatives[kind]).toBe(negative || undefined);
      expect(plan.params._promptSections?.sectionNegatives?.extra).toBe('keep negative');
      if (role) {
        expect(plan.params._promptSections?.sectionNegatives?.[kind]).toBeUndefined();
        const compiled = compileCharacterContent(plan.params.characters![0]);
        expect(compiled.prompt).toContain('new text');
        expect(compiled.negativePrompt).not.toContain('new text');
        expect(compiled.negativePrompt).toContain('manual negative');
      }
    }
    expect(JSON.stringify(original)).toBe(before);
  });

  it('合并到补充时一并追加所选分类负面，保留原补充负面与未选分类', () => {
    const original = chain({ _promptSections: { extra: 'old extra', scene: 'old scene',
      sectionNegatives: { extra: 'old negative', scene: 'day' } } }, { subject: 'old scene, old extra' });
    const plan = planRollToChain(original, [
      { kind: 'wardrobe', text: 'white dress', negative: 'black dress' },
      { kind: 'scene', text: 'sunlight', negative: 'night' },
    ], { scope: 'extra', include: ['wardrobe'] });
    expect(plan.params._promptSections).toMatchObject({ extra: 'old extra, white dress', scene: 'old scene',
      sectionNegatives: { extra: 'old negative, black dress', scene: 'day' } });
  });
});


it('动态目录依scope写入风格串，未知目录不丢失且不覆盖画风正文', () => {
  const result = planRollToChain(chain(), [{ kind: 'directory:eye', scope: 'character', text: 'blue eyes', negative: 'closed eyes', directoryName: '眼睛' }, { kind: 'directory:light', scope: 'global', text: 'backlight' }], { characterId: 'dynamic' });
  expect(result.params.characters?.[0].sections?.['directory:eye']).toBe('blue eyes');
  expect(result.params.characters?.[0].sectionNegatives?.['directory:eye']).toBe('closed eyes');
  expect(result.params._promptSections?.['directory:light']).toBe('backlight');
  expect(result.variableValues.subject).toContain('backlight');
  expect(result.skipped).toEqual([]);
});

it('同用途scoped项目编译写canonical栏位，保留选中身份与角色目标', () => {
  const result = planRollToChain(chain({ characters: [{ id: 'one', prompt: 'keep one' }, { id: 'two', prompt: 'keep two' }] }), [
    { kind: 'global:purpose:clothing', scope: 'global', text: '{global, cape}', negative: 'global negative' },
    { kind: 'character:purpose:clothing', scope: 'character', text: 'role dress', negative: 'role negative' },
  ], { targetRoleId: 'two' });
  expect((result.params._promptSections as any)['purpose:clothing']).toBe('{global, cape}');
  expect((result.params.characters![1].sections as any)['purpose:clothing']).toBe('role dress');
  expect(result.params.characters![0].prompt).toBe('keep one');
  expect(result.writes.map(write => write.kind)).toEqual(['global:purpose:clothing', 'character:purpose:clothing']);
  expect(result.params._promptSections).not.toHaveProperty('global:purpose:clothing');
});
