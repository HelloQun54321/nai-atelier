import { describe, expect, it } from 'vitest';
import type { PromptAgentDraft } from '../../types';
import { normalizeAgentLabDraft, restoreUnchangedAgentLabFields } from '../../services/agentLabSync.mjs';
import { applyAgentPromptChange, canonicalPromptVersionContent, createAgentPromptChange, createAppliedAgentPromptChange, pickPromptVersionContent, restorePromptVersion } from '../../services/agentPromptChanges.mjs';

const draft = () => ({
  target: { chainId: 'synthetic', mode: 'text-to-image', fingerprint: 'before' },
  basePrompt: '1.2::artist:test::', subjectPrompt: 'city', negativePrompt: 'blur',
  modules: [{ id: 'post', name: '后置', content: 'soft light', isActive: true }, { id: 'pre', name: '前置', content: 'high quality', isActive: false, position: 'pre' }],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler',
    _promptSections: { scene: 'city', sectionNegatives: { scene: 'old city negative' }, sectionMeta: { scene: { source: 'library', entryId: 'city-source' } } },
    _styleBundleSources: [{ author: 'artist', sourceUrl: 'https://example.com/source', note: 'original' }],
    characters: [{ id: 'alice', name: 'Alice', enabled: false, prompt: 'standing', negativePrompt: 'hat', x: 0.2, y: 0.8, sections: { 'purpose:clothing': '1.3::white dress::' }, sectionNegatives: { 'purpose:clothing': 'coat' }, sectionMeta: { 'purpose:clothing': { source: 'library', entryId: 'dress-source' } } }, { id: 'bob', prompt: 'coat', x: 0.8, y: 0.2 }],
  }, editContext: { baseImageAvailable: true, maskAvailable: true, strength: 0.7, noise: 0, focused: false },
}) as PromptAgentDraft;

describe('完整提示词版本的投影、核验与恢复', () => {
  it('保存完整raw正文、角色与模块顺序及来源，排除参数、坐标和图片', () => {
    const current = draft(), before = structuredClone(current), content = pickPromptVersionContent(current);
    expect(content.modules.map(item => item.id)).toEqual(['post', 'pre']);
    expect(content.params.characters.map(item => item.id)).toEqual(['alice', 'bob']);
    expect(content.params._promptSections?.sectionNegatives?.scene).toBe('old city negative');
    expect(content.params.characters[0]).toMatchObject({ name: 'Alice', enabled: false, sections: { 'purpose:clothing': '1.3::white dress::' } });
    expect(content.params).not.toHaveProperty('steps'); expect(content.params.characters[0]).not.toHaveProperty('x');
    expect(content).not.toHaveProperty('editContext'); expect(content).not.toHaveProperty('target');
    expect(current).toEqual(before);
  });

  it('raw旧分栏与normalized模型稿的fingerprint依据相同，对象key顺序不制造冲突', () => {
    const current = draft(), visible = normalizeAgentLabDraft(current);
    expect(canonicalPromptVersionContent(current)).toEqual(canonicalPromptVersionContent(visible));
    const reordered = { ...current, params: { ...current.params, _promptSections: { sectionMeta: current.params._promptSections?.sectionMeta, sectionNegatives: current.params._promptSections?.sectionNegatives, scene: 'city' } } };
    expect(canonicalPromptVersionContent(reordered)).toEqual(canonicalPromptVersionContent(current));
  });

  it('恢复旧全局和角色正负、模块顺序与来源，保留当前坐标、模型参数和编辑现场', () => {
    const old = draft(), current = normalizeAgentLabDraft(old);
    current.basePrompt = 'new global'; current.negativePrompt = 'new negative';
    current.modules.reverse(); current.modules[0].isActive = true;
    current.params.characters!.reverse(); current.params.characters![1].prompt = 'new character';
    current.params.characters![1].x = 0.95; current.params.steps = 40;
    const result = restorePromptVersion(current, pickPromptVersionContent(old), normalizeAgentLabDraft(current));
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(pickPromptVersionContent(result.draft)).toEqual(pickPromptVersionContent(old));
    expect(result.draft.params.characters![0].x).toBe(0.95);
    expect(result.draft.params.steps).toBe(40); expect(result.draft.editContext).toEqual(current.editContext);
    expect(current.basePrompt).toBe('new global');
  });

  it('已删除角色恢复默认坐标，已有角色坐标不随旧版本回滚', () => {
    const old = draft(), current = draft(); current.params.characters = [current.params.characters![1]];
    const result = restorePromptVersion(current, old, current);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.draft.params.characters!.map(item => [item.id, item.x, item.y])).toEqual([['alice', 0.5, 0.5], ['bob', 0.8, 0.2]]);
  });

  it('期望版本与当前手改不同则只报告冲突，无force或部分写入', () => {
    const old = draft(), expected = draft(), current = draft();
    old.basePrompt = 'old'; current.negativePrompt = 'manual negative';
    const copy = structuredClone(current), result = restorePromptVersion(current, old, expected);
    expect(result).toEqual({ ok: false, conflicts: ['negativePrompt'] });
    expect(current).toEqual(copy);
  });

  it('资产版本保留全部变量与正文，恢复不改变图片或资料归属', () => {
    const old = { ...draft(), variableValues: { subject: 'city', custom: 'old custom' }, previewImage: '/old.png', tags: ['old'] };
    delete (old as Partial<PromptAgentDraft>).subjectPrompt;
    const current = { ...old, variableValues: { subject: 'forest', custom: 'new custom' }, previewImage: '/current.png', tags: ['current'] };
    const result = restorePromptVersion(current, old, current);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.draft.variableValues).toEqual(old.variableValues);
    expect(result.draft.previewImage).toBe('/current.png'); expect(result.draft.tags).toEqual(['current']);
  });

  it('正常整段应用的raw回执包含旧分类负面清理，撤回完整恢复', () => {
    const before = draft(), modelBefore = normalizeAgentLabDraft(before), modelAfter = { ...modelBefore, negativePrompt: 'new negative' };
    const declared = createAgentPromptChange(modelBefore, modelAfter, 'run'), after = restoreUnchangedAgentLabFields(before, modelAfter);
    const receipt = createAppliedAgentPromptChange(declared, before, after);
    expect(receipt.appliedChanges?.some(item => item.path.join('.') === 'params._promptSections.sectionNegatives')).toBe(true);
    expect(applyAgentPromptChange(after, receipt, 'undo')).toEqual(before);
    expect(applyAgentPromptChange(before, receipt, 'redo')).toEqual(after);
  });

  it('raw角色应用的关联负面与来源完整恢复，伪造来源/越界正文/目标拒绝', () => {
    const before = draft(), proposed = normalizeAgentLabDraft(before);
    proposed.params.characters![0].prompt = 'new character';
    const declared = createAgentPromptChange(normalizeAgentLabDraft(before), proposed, 'run'), after = restoreUnchangedAgentLabFields(before, proposed);
    const receipt = createAppliedAgentPromptChange(declared, before, after);
    expect(applyAgentPromptChange(after, receipt, 'undo')).toEqual(before);
    const extra = structuredClone(after); extra.basePrompt = 'undeclared';
    expect(() => createAppliedAgentPromptChange(declared, before, extra)).toThrow('声明范围');
    const badSource = structuredClone(after); badSource.params._promptSections!.sectionMeta!.scene = { source: 'manual' };
    expect(() => createAppliedAgentPromptChange(declared, before, badSource)).toThrow('来源或分栏');
    expect(() => createAppliedAgentPromptChange(declared, before, { ...after, target: { ...after.target!, chainId: 'other' } })).toThrow('作品与模式');
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 应用回执核验实际整段编译，不丢前后置模块顺序', mode => {
    const before = draft(); before.target!.mode = mode; before.subjectPrompt = ''; before.modules = [];
    const modelBefore = normalizeAgentLabDraft(before), selected = structuredClone(modelBefore);
    selected.basePrompt = 'base'; selected.subjectPrompt = 'subject';
    selected.modules = [{ id: 'post', name: 'post', content: 'post', isActive: true }, { id: 'pre', name: 'pre', content: 'pre', isActive: true, position: 'pre' }];
    const declared = createAgentPromptChange(modelBefore, selected, 'run');
    const after = restoreUnchangedAgentLabFields(before, selected);
    after.basePrompt = 'base, pre, subject, post'; after.subjectPrompt = ''; after.modules = [];
    const receipt = createAppliedAgentPromptChange(declared, before, after, selected);
    expect(applyAgentPromptChange(after, receipt, 'undo')).toEqual(before);
    expect(applyAgentPromptChange(before, receipt, 'redo')).toEqual(after);
    expect(() => createAppliedAgentPromptChange(declared, before, { ...after, basePrompt: 'base, subject, pre, post' }, selected)).toThrow('来源或分栏');
  });

  it('应用回执不携带伪装成角色或模块附加数据的无关字段', () => {
    const before = draft(), selected = normalizeAgentLabDraft(before);
    selected.params.characters!.push({ id: 'new', prompt: 'new role', x: 0.3, y: 0.7 });
    const after = restoreUnchangedAgentLabFields(before, selected);
    Object.assign(after.params.characters!.at(-1)!, { irrelevant: 'do not persist' });
    const receipt = createAppliedAgentPromptChange(createAgentPromptChange(normalizeAgentLabDraft(before), selected, 'run'), before, after);
    const added = receipt.appliedChanges?.find(change => change.path.at(-1) === 'id:new');
    expect(added?.after).toMatchObject({ prompt: 'new role', x: 0.3, y: 0.7 });
    expect(added?.after).not.toHaveProperty('irrelevant');
  });

  it('拒绝版本原型链键及超大正文', () => {
    expect(() => pickPromptVersionContent({ ...draft(), variableValues: JSON.parse('{"__proto__":{"polluted":true}}') })).toThrow('无效');
    expect(() => pickPromptVersionContent({ ...draft(), basePrompt: 'x'.repeat(500_001) })).toThrow('过大');
  });
});
