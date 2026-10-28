import { describe, expect, it } from 'vitest';
import { applyAgentPromptChange, createAgentPromptChange, diffPromptText, validateAgentPromptChanges } from '../../services/agentPromptChanges.mjs';
import type { PromptAgentDraft } from '../../types';

const draft = () => ({ target: { chainId: 'lab', mode: 'text-to-image', fingerprint: 'before' }, basePrompt: '1.2::artist:test::, blue sky', subjectPrompt: 'standing', negativePrompt: 'blur', modules: [], params: { model: 'nai-diffusion-4-5-full', steps: 28, width: 832, height: 1216, scale: 5, sampler: 'k_euler', characters: [{ id: 'alice', prompt: 'white shirt', negativePrompt: 'hat', x: 0.5, y: 0.5 }, { id: 'bob', prompt: 'coat', x: 0.2, y: 0.2 }] } }) as PromptAgentDraft;

describe('助手提示词差异与恢复', () => {
  it('只记录提示词，撤回和重做保留后来修改的参数、其他角色与坐标', () => {
    const before = draft(), after = structuredClone(before);
    after.basePrompt = '1.4::artist:test::, blue sky';
    after.params.characters![0].prompt = 'black jacket';
    after.params.steps = 35;
    const change = createAgentPromptChange(before, after, 'run');
    expect(change.changes).toHaveLength(2);
    const current = structuredClone(after);
    current.params.steps = 50;
    current.params.characters![0].x = 0.9;
    current.params.characters![1].prompt = 'red coat';
    current.params.characters!.reverse();
    const restored = applyAgentPromptChange(current, change, 'undo');
    expect(restored.basePrompt).toBe(before.basePrompt);
    expect(restored.params.steps).toBe(50);
    expect(restored.params.characters!.map(item => [item.id, item.prompt, item.x])).toEqual([['bob', 'red coat', 0.2], ['alice', 'white shirt', 0.9]]);
    expect(applyAgentPromptChange(restored, change, 'redo')).toEqual(current);
    expect(current.params.characters![1].prompt).toBe('black jacket');
  });

  it('任一相关字段被手改就整体拒绝，不留下部分撤回；不同目标与模式同样拒绝', () => {
    const before = draft(), after = structuredClone(before);
    after.basePrompt = 'new style'; after.negativePrompt = 'new negative';
    const change = createAgentPromptChange(before, after);
    const current = structuredClone(after); current.negativePrompt = 'manual';
    expect(() => applyAgentPromptChange(current, change, 'undo')).toThrow('未覆盖');
    expect(current.basePrompt).toBe('new style');
    expect(() => applyAgentPromptChange({ ...after, target: { ...after.target!, mode: 'inpaint' } }, change, 'undo')).toThrow('作品与模式');
    expect(() => applyAgentPromptChange({ ...after, target: { ...after.target!, chainId: 'other' } }, change, 'undo')).toThrow('作品与模式');
  });

  it('固定用途、旧目录、分类负面和来源一起恢复，合并正文不重复展示', () => {
    const before = draft(); before.subjectPrompt = 'white shirt';
    before.params._promptSections = { 'purpose:clothing': 'white shirt', sectionNegatives: { 'purpose:clothing': 'coat' }, sectionMeta: { 'purpose:clothing': { source: 'library', entryId: 'old' } } };
    const after = structuredClone(before); after.subjectPrompt = 'black jacket';
    after.params._promptSections = { 'purpose:clothing': 'black jacket', sectionNegatives: { 'purpose:clothing': 'shirt' }, sectionMeta: { 'purpose:clothing': { source: 'manual' } } };
    const change = createAgentPromptChange(before, after);
    expect(change.changes.find(item => item.path[0] === 'subjectPrompt')?.hidden).toBe(true);
    expect(applyAgentPromptChange(after, change, 'undo')).toEqual(before);
    expect(applyAgentPromptChange(before, change, 'redo')).toEqual(after);
  });

  it('新增与删除角色恢复原位置，新增角色后来有修改时不直接删除', () => {
    const before = draft(), after = structuredClone(before);
    after.params.characters!.splice(0, 1, { id: 'new', prompt: 'new girl', x: 0.1, y: 0.1 });
    const change = createAgentPromptChange(before, after);
    expect(applyAgentPromptChange(after, change, 'undo')).toEqual(before);
    expect(applyAgentPromptChange(before, change, 'redo')).toEqual(after);
    after.params.characters![0].x = 0.8;
    expect(() => applyAgentPromptChange(after, change, 'undo')).toThrow('未覆盖');
  });

  it('部分应用只撤回实际应用的字段，来源记录经 JSON 往返仍可重做', () => {
    const before = draft(), after = structuredClone(before);
    after.basePrompt = 'new'; after.negativePrompt = 'new negative';
    const change = createAgentPromptChange(before, after);
    change.appliedChanges = change.changes.filter(item => item.path[0] === 'basePrompt');
    const actual = { ...before, basePrompt: after.basePrompt };
    expect(applyAgentPromptChange(actual, JSON.parse(JSON.stringify(change)), 'undo')).toEqual(before);
    expect(applyAgentPromptChange(before, change, 'redo')).toEqual(actual);
  });

  it('拒绝恢复非提示词字段或原型链路径', () => {
    expect(() => validateAgentPromptChanges([{ path: ['params', 'steps'], after: 99 }])).toThrow();
    expect(() => validateAgentPromptChanges([{ path: ['params', '_promptSections', '__proto__'], after: 'x' }])).toThrow();
  });

  it.each(['\n', ', '])('长文首尾小改时保留中间完整未变内容（分隔符 %j）', separator => {
    const unchanged = Array.from({ length: 100 }, (_, index) => `1.9::unchanged scenery ${index}::`).join(separator);
    const before = `old opening${separator}${unchanged}${separator}old ending`;
    const after = `new opening${separator}${unchanged}${separator}new ending`;
    expect(before.length * after.length).toBeGreaterThan(1_000_000);
    const parts = diffPromptText(before, after);
    expect(parts.some(part => part.kind === 'equal' && part.text.includes(unchanged))).toBe(true);
    expect(parts.filter(part => part.kind === 'delete').map(part => part.text).join('')).toBe('oldold');
    expect(parts.filter(part => part.kind === 'insert').map(part => part.text).join('')).toBe('newnew');
    expect(parts.filter(part => part.kind !== 'insert').map(part => part.text).join('')).toBe(before);
    expect(parts.filter(part => part.kind !== 'delete').map(part => part.text).join('')).toBe(after);
  });

  it('长文多处修改保留完整未变行和重复 Tag，不把称呼拆成碎片', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `1.9::same camera angle ${index}::, repeated tag, repeated tag`);
    const before = [...lines.slice(0, 20), '1.2::white shirt::', ...lines.slice(20, 40), 'beside the commander', ...lines.slice(40)].join('\n');
    const after = [...lines.slice(0, 20), '1.4::black jacket::', ...lines.slice(20, 40), 'beside Qun', ...lines.slice(40)].join('\n');
    const parts = diffPromptText(before, after);
    const equal = parts.filter(part => part.kind === 'equal').map(part => part.text).join('');
    for (const line of lines) expect(equal).toContain(line);
    expect(parts.filter(part => part.kind === 'delete').map(part => part.text).join('')).toContain('the commander');
    expect(parts.filter(part => part.kind === 'insert').map(part => part.text).join('')).toContain('Qun');
    expect(parts.filter(part => part.kind !== 'insert').map(part => part.text).join('')).toBe(before);
    expect(parts.filter(part => part.kind !== 'delete').map(part => part.text).join('')).toBe(after);
  });

  it.each([
    ['1.2::artist:test::, (blue sky), blue sky', '1.4::artist:test::, (red sky), blue sky'],
    ['女孩 😀\nwhite shirt, standing', '女孩 🎨\nblack jacket, sitting'],
    ['', 'new prompt'], ['old prompt', ''],
    ['prefix '.repeat(100) + 'old' + ' suffix'.repeat(100), 'prefix '.repeat(100) + 'new' + ' suffix'.repeat(100)],
    ['x'.repeat(1500), 'y'.repeat(1500)],
    ['旧开头\r\n' + '未变的景物和人物😀'.repeat(100) + '\r\n旧结尾', '新开头\r\n' + '未变的景物和人物😀'.repeat(100) + '\r\n新结尾'],
  ])('文本差异逐字还原原文，不改写权重、重复词或换行', (before, after) => {
    const parts = diffPromptText(before, after);
    expect(parts.filter(part => part.kind !== 'insert').map(part => part.text).join('')).toBe(before);
    expect(parts.filter(part => part.kind !== 'delete').map(part => part.text).join('')).toBe(after);
  });
});
