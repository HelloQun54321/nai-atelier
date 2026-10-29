import { describe, expect, it } from 'vitest';
import type { NAIParams } from '../../types';
import type { RollRow } from '../../services/contentRoll';
import {
  applyContentRollToParams,
  filterPicksByScope,
  pickByParticipation,
  planContentRollApply,
  undoContentRollApply,
} from '../../services/contentRollApply';

const row = (kind: string, text: string, filled = true, negative = ''): RollRow => ({
  kind, filled, name: `${kind} 条目`, text, negative, reason: filled ? 'ok' : 'empty',
  constraints: { facets: {}, absent: [], auto: [], values: [], unknown: [], notes: '', needsReview: false },
} as unknown as RollRow);

const picks = {
  appearance: row('appearance', 'blonde_hair, blue_eyes'),
  wardrobe: row('wardrobe', 'white_dress', true, 'coat'),
  pose: row('pose', '', false),
  expression: row('expression', 'smile'),
  scene: row('scene', 'rain, night'),
  camera: row('camera', 'close_up'),
};

const baseParams = (): NAIParams => ({
  width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
  seed: 12345,
  characters: [{ id: 'c1', prompt: 'old_role_text', x: 0.5, y: 0.5, sections: { appearance: 'old_hair' } }],
  _promptSections: { appearance: 'keep_me', wardrobe: '', pose: '', scene: 'old_scene', camera: 'old_camera', extra: 'old_extra' },
} as unknown as NAIParams);

describe('一键 Roll → 实验室：组计划', () => {
  it('全局入口把参与的五类写回全局，不创建角色，也不把表情塞进补充', () => {
    const params = baseParams();
    const original = structuredClone(params);
    const plan = planContentRollApply(picks, params, { mode: 'global' });
    expect(plan.roleWrites).toEqual([]);
    expect(plan.rows.map(item => item.kind)).toEqual(['appearance', 'wardrobe', 'pose', 'scene', 'camera']);
    expect(plan.rows.find(item => item.kind === 'appearance')?.current).toBe('keep_me');
    const result = applyContentRollToParams(params, plan, () => { throw new Error('不得新建角色'); });
    expect(result.params._promptSections).toMatchObject({ appearance: 'blonde_hair, blue_eyes', wardrobe: 'white_dress', pose: '', scene: 'rain, night', camera: 'close_up', extra: 'old_extra' });
    expect(result.params._promptSections?.sectionMeta?.wardrobe).toMatchObject({ source: 'roll', entryName: 'wardrobe 条目' });
    expect(result.params.characters).toBe(params.characters);
    expect(result.params.seed).toBe(params.seed);
    expect(params).toEqual(original);
  });

  it('全局只选服饰时仅替换该栏及负面来源，未选内容与补充原样保留', () => {
    const params = baseParams();
    params._promptSections = { ...params._promptSections, extra: '  keep extra\n', sectionNegatives: { wardrobe: 'old_negative', scene: 'keep_negative' }, sectionMeta: { wardrobe: { source: 'library', entryId: 'old' }, scene: { source: 'manual' } } };
    const selected = pickByParticipation(picks, Object.fromEntries(Object.keys(picks).map(kind => [kind, kind === 'wardrobe'])));
    selected.wardrobe = { ...selected.wardrobe, negative: '' };
    const next = applyContentRollToParams(params, planContentRollApply(selected, params, { mode: 'global' }), () => 'unused').params;
    expect(next._promptSections).toEqual({ ...params._promptSections, wardrobe: 'white_dress', sectionNegatives: { scene: 'keep_negative' }, sectionMeta: { ...params._promptSections.sectionMeta, wardrobe: { source: 'roll', entryId: undefined, entryName: 'wardrobe 条目' } } });
    expect(next.characters).toBe(params.characters);
    expect(applyContentRollToParams(params, planContentRollApply({}, params, { mode: 'global' }), () => 'unused').params).toEqual(params);
  });

  it('角色入口按 ID 写入，重排不串角色，目标删除后拒绝写入', () => {
    const params = baseParams();
    const other = { id: 'c2', prompt: 'other', x: .2, y: .8 };
    params.characters = [other, ...params.characters!];
    const plan = planContentRollApply({ wardrobe: picks.wardrobe }, params, { mode: 'existing', id: 'c1' });
    const next = applyContentRollToParams(params, plan, () => 'unused').params;
    expect(next.characters?.[0]).toEqual(other);
    expect(next.characters?.[1].sections?.wardrobe).toBe('white_dress');
    expect(next._promptSections).toBe(params._promptSections);
    expect(() => applyContentRollToParams({ ...params, characters: [other] }, plan, () => 'unused')).toThrow('目标角色已不存在');
  });
  it('只把「有内容」的栏位标为替换，未提供的保持原值并出现在 kept 里', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    const byKind = Object.fromEntries(plan.rows.map(item => [item.kind, item]));
    expect(byKind.appearance.action).toBe('replace');
    expect(byKind.pose.action).toBe('keep');
    expect(plan.written).toEqual(['appearance', 'wardrobe', 'expression', 'scene', 'camera']);
    expect(plan.kept).toEqual(['pose']);
  });

  it('角色四类进 roleWrites（按栏），场景与镜头进各自的全局栏位', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    expect(plan.roleWrites.map(item => item.kind)).toEqual(['appearance', 'wardrobe', 'expression']);
    expect(plan.roleWrites.find(item => item.kind === 'wardrobe')?.negative).toBe('coat');
    expect(plan.globalSections).toEqual({ scene: 'rain, night', camera: 'close_up' });
  });

  it('计划里带出每一栏的当前值，界面可直接显示「当前 → 将填入」', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    expect(plan.rows.find(item => item.kind === 'appearance')?.current).toBe('old_hair');
    expect(plan.rows.find(item => item.kind === 'scene')?.current).toBe('old_scene');
    expect(plan.rows.find(item => item.kind === 'camera')?.current).toBe('old_camera');
  });

  it('没有目标角色时按「新建角色」规划', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'new' });
    expect(plan.target.mode).toBe('new');
    expect(plan.roleId).toBe('');
    expect(plan.roleName).toBe('角色 1');
  });
});

describe('一键 Roll → 实验室：写值与撤销', () => {
  const createId = () => 'new-id';

  it('只换服饰时，角色正文与其它分栏都不动（不再整段替换）', () => {
    const params = baseParams();
    const plan = planContentRollApply({ wardrobe: picks.wardrobe }, params, { mode: 'existing', id: 'c1' });
    const { params: next } = applyContentRollToParams(params, plan, createId);
    const character = next.characters?.[0];
    expect(character?.prompt).toBe('old_role_text');
    expect(character?.sections?.appearance).toBe('old_hair');
    expect(character?.sections?.wardrobe).toBe('white_dress');
    expect(character?.sections?.pose).toBeUndefined();
    /* 分类负面单独落在 sectionNegatives，不混进角色负面 */
    expect(character?.sectionNegatives?.wardrobe).toBe('coat');
    expect(character?.negativePrompt).toBeUndefined();
  });

  it('四类齐全时逐栏写入，正文仍保持原样', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'existing', id: 'c1' });
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    const character = next.characters?.[0];
    expect(character?.prompt).toBe('old_role_text');
    expect(character?.sections).toMatchObject({ appearance: 'blonde_hair, blue_eyes', wardrobe: 'white_dress', expression: 'smile' });
    expect(written).toContain('character:c1:wardrobe');
  });

  it('场景与镜头各写自己的全局栏位，补充栏与其它参数不动', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'existing', id: 'c1' });
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    expect(next._promptSections?.scene).toBe('rain, night');
    expect(next._promptSections?.camera).toBe('close_up');
    expect(next._promptSections?.extra).toBe('old_extra');
    expect(next._promptSections?.appearance).toBe('keep_me');
    expect(next.width).toBe(832);
    expect(next.steps).toBe(28);
    expect(next.seed).toBe(12345);
    expect(written).toContain('scene');
    expect(written).toContain('camera');
  });

  it('新建角色时正文留空、内容进分栏，不影响已有角色', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'new' });
    const { params: next, createdRoleId } = applyContentRollToParams(params, plan, createId);
    expect(createdRoleId).toBe('new-id');
    expect(next.characters).toHaveLength(2);
    expect(next.characters?.[0].prompt).toBe('old_role_text');
    expect(next.characters?.[1].prompt).toBe('');
    expect(next.characters?.[1].sections?.wardrobe).toBe('white_dress');
  });

  it('撤销恢复改动前的 params，并移除本次新建的角色', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'new' });
    const applied = applyContentRollToParams(params, plan, createId);
    const restored = undoContentRollApply(applied.params, applied.undoParams, applied.createdRoleId);
    expect(restored.characters).toHaveLength(1);
    expect(restored.characters?.[0].prompt).toBe('old_role_text');
    expect(restored.characters?.[0].sections?.appearance).toBe('old_hair');
    expect(restored._promptSections?.scene).toBe('old_scene');
  });

  it('没有任何内容可写时计划为空，写值不产生改动', () => {
    const empty: Record<string, RollRow> = {};
    for (const kind of Object.keys(picks)) empty[kind] = row(kind, '', false);
    const params = baseParams();
    const plan = planContentRollApply(empty, params, { mode: 'existing', id: 'c1' });
    expect(plan.written).toEqual([]);
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    expect(written).toEqual([]);
    expect(next.characters?.[0].sections?.appearance).toBe('old_hair');
    expect(next._promptSections?.scene).toBe('old_scene');
  });
});

describe('参与范围：取消勾选的栏位一律不参与', () => {
  it('即使这一栏还留着上次抽到的内容，也不进计划、不入库', () => {
    const checked = pickByParticipation(picks, { wardrobe: false });
    expect(checked.wardrobe).toBeUndefined();
    const plan = planContentRollApply(checked, baseParams(), { mode: 'existing', id: 'c1' });
    expect(plan.rows.find(item => item.kind === 'wardrobe')?.action).toBe('keep');
    expect(plan.roleWrites.map(item => item.kind)).not.toContain('wardrobe');
    const { params: next } = applyContentRollToParams(baseParams(), plan, () => 'x');
    expect(next.characters?.[0].sections?.wardrobe).toBeUndefined();
  });

  it('没有勾选信息时按「全部参与」处理', () => {
    expect(Object.keys(pickByParticipation(picks))).toHaveLength(6);
    expect(Object.keys(pickByParticipation(picks, {}))).toHaveLength(6);
  });
});


describe('抽取范围：角色四类 / 场景镜头 / 全部', () => {
  it('范围过滤只保留对应分类，多余分类不参与', () => {
    expect(Object.keys(filterPicksByScope(picks, 'character')).sort()).toEqual(['appearance', 'expression', 'pose', 'wardrobe']);
    expect(Object.keys(filterPicksByScope(picks, 'global')).sort()).toEqual(['camera', 'scene']);
    expect(Object.keys(filterPicksByScope(picks, 'all')).sort()).toEqual(['appearance', 'camera', 'expression', 'pose', 'scene', 'wardrobe']);
  });

  it('仅角色范围下，场景与镜头不会被写入', () => {
    const params = baseParams();
    const plan = planContentRollApply(filterPicksByScope(picks, 'character'), params, { mode: 'existing', id: 'c1' });
    expect(plan.globalSections).toEqual({});
    const { params: next } = applyContentRollToParams(params, plan, () => 'x');
    expect(next._promptSections?.scene).toBe('old_scene');
    expect(next.characters?.[0].sections?.wardrobe).toBe('white_dress');
  });
});

describe('多角色应用：所有启用角色写同一套搭配', () => {
  const multiParams = (): NAIParams => ({
    width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
    characters: [
      { id: 'a', prompt: 'a_body', x: 0.3, y: 0.5 },
      { id: 'b', prompt: 'b_body', x: 0.7, y: 0.5, enabled: false },
      { id: 'c', prompt: 'c_body', x: 0.5, y: 0.5, enabled: true },
    ],
  } as unknown as NAIParams);

  it('启用角色都拿到同一套分栏，停用角色被跳过，正文与角色数量不变', () => {
    const params = multiParams();
    const plan = planContentRollApply({ wardrobe: picks.wardrobe, appearance: picks.appearance }, params, { mode: 'all-enabled' });
    expect(plan.roleName).toContain('所有启用角色');
    const { params: next, written } = applyContentRollToParams(params, plan, () => 'x');
    expect(next.characters).toHaveLength(3);
    expect(next.characters?.[0].sections?.wardrobe).toBe('white_dress');
    expect(next.characters?.[1].sections?.wardrobe).toBeUndefined();
    expect(next.characters?.[2].sections?.wardrobe).toBe('white_dress');
    expect(next.characters?.[0].prompt).toBe('a_body');
    expect(next.characters?.[2].prompt).toBe('c_body');
    expect(written).toContain('character:a:wardrobe');
    expect(written).toContain('character:c:wardrobe');
    expect(written).not.toContain('character:b:wardrobe');
  });
});


describe('分类负面：替换分类时清掉旧值', () => {
  it('新内容没有负面 → 旧分类负面不再参与编译', () => {
    const params = {
      width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
      characters: [{ id: 'c1', prompt: '', x: 0.5, y: 0.5, sections: { wardrobe: 'old_dress' }, sectionNegatives: { wardrobe: 'old_coat_negative' } }],
    } as unknown as NAIParams;
    const plan = planContentRollApply({ wardrobe: { kind: 'wardrobe', filled: true, text: 'new_dress', negative: '' } as unknown as RollRow }, params, { mode: 'existing', id: 'c1' });
    const { params: next } = applyContentRollToParams(params, plan, () => 'x');
    expect(next.characters?.[0].sections?.wardrobe).toBe('new_dress');
    expect(next.characters?.[0].sectionNegatives?.wardrobe).toBeUndefined();
  });
});

describe('场景 / 镜头的内容负面', () => {
  it('写入对应栏位并跟着栏位生命周期，不进风格负面', () => {
    const params = baseParams();
    const plan = planContentRollApply({ scene: row('scene', 'rain', true, 'forbidden_scene') }, params, { mode: 'existing', id: 'c1' });
    expect(plan.globalNegatives).toEqual({ scene: 'forbidden_scene' });
    const { params: next } = applyContentRollToParams(params, plan, () => 'x');
    expect(next._promptSections?.sectionNegatives?.scene).toBe('forbidden_scene');
    expect(next._promptSections?.scene).toBe('rain');
    /* 没有负面的镜头栏不留下旧值 */
    expect(next._promptSections?.sectionNegatives?.camera).toBeUndefined();
  });
});

describe('多人应用：旧分类负面同样清掉', () => {
  it('新搭配没有负面时，启用角色的旧负面被删除，停用角色不动', () => {
    const params = {
      width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
      characters: [
        { id: 'a', prompt: '', x: 0.3, y: 0.5, sections: { wardrobe: 'old' }, sectionNegatives: { wardrobe: 'old_coat' } },
        { id: 'b', prompt: '', x: 0.7, y: 0.5, enabled: false, sections: { wardrobe: 'keep' }, sectionNegatives: { wardrobe: 'keep_neg' } },
      ],
    } as unknown as NAIParams;
    const plan = planContentRollApply({ wardrobe: row('wardrobe', 'new_dress', true, '') }, params, { mode: 'all-enabled' });
    const { params: next } = applyContentRollToParams(params, plan, () => 'x');
    expect(next.characters?.[0].sections?.wardrobe).toBe('new_dress');
    expect(next.characters?.[0].sectionNegatives?.wardrobe).toBeUndefined();
    expect(next.characters?.[1].sectionNegatives?.wardrobe).toBe('keep_neg');
  });
});


describe('动态目录写入', () => {
  it('按明确scope写入角色与全局，保留手写、其它目录、参数及负面', () => {
    const params = baseParams();
    const dynamic = { 'directory:eye': { ...row('directory:eye', 'blue eyes', true, 'closed eyes'), scope: 'character' as const, directoryName: '眼睛' }, 'directory:light': { ...row('directory:light', 'backlight'), scope: 'global' as const, directoryName: '光照' } };
    const plan = planContentRollApply(dynamic, params, { mode: 'existing', id: 'c1' });
    const after = applyContentRollToParams(params, plan, () => 'new').params;
    expect(after.characters?.[0].sections?.['directory:eye']).toBe('blue eyes');
    expect(after.characters?.[0].sectionNegatives?.['directory:eye']).toBe('closed eyes');
    expect(after.characters?.[0].prompt).toBe('old_role_text');
    expect(after._promptSections?.['directory:light']).toBe('backlight');
    expect(after._promptSections?.extra).toBe('old_extra');
    expect(after.seed).toBe(params.seed);
    expect(filterPicksByScope(dynamic, 'global')).toEqual({ 'directory:light': dynamic['directory:light'] });
  });
  it('全局入口把全部动态目录写入全局，不靠旧角色类别过滤', () => {
    const picks = { 'directory:any': { ...row('directory:any', 'custom'), scope: 'character' as const } };
    const plan = planContentRollApply(picks, baseParams(), { mode: 'global' });
    expect(plan.globalSections['directory:any']).toBe('custom');
    expect(plan.roleWrites).toHaveLength(0);
  });
});

it('scoped目录预览从项目身份读取标题与作用范围，不回退为内部目录ID', () => {
  const scoped = {
    'global:directory:shared': { ...row('directory:shared', 'global prop'), scope: 'global' as const, directoryName: '全局道具' },
    'character:directory:shared': { ...row('directory:shared', 'character prop'), scope: 'character' as const, title: '角色道具' },
  };
  const params = { characters: [{ id: 'selected', prompt: 'keep', x: 0.5, y: 0.5 }] } as NAIParams;
  const plan = planContentRollApply(scoped, params, { mode: 'existing', id: 'selected' });
  expect(plan.rows.map(item => ({ itemId: item.itemId, kind: item.kind, title: item.title, scope: item.targetScope }))).toEqual([
    { itemId: 'global:directory:shared', kind: 'directory:shared', title: '全局道具', scope: 'global' },
    { itemId: 'character:directory:shared', kind: 'directory:shared', title: '角色道具', scope: 'character' },
  ]);
  expect(plan.globalSections['directory:shared']).toBe('global prop');
  expect(plan.roleWrites).toEqual([expect.objectContaining({ kind: 'directory:shared', text: 'character prop' })]);
});
