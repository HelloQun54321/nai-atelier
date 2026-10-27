// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createLabWorkspaceSession, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, mergePromptSections,
  normalizeParams, resolvePromptSections, saveLabWorkspaceSession, serializeLabWorkspaceMemory, normalizePromptSections } from '../../services/labWorkspace';
import { DEFAULT_GENERATION_MEMORY_PREFERENCES } from '../../services/appearancePreferences';
import { getEditableGlobalNegative } from '../../services/promptUtils';

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });
const sections = { appearance: 'silver_hair', wardrobe: 'blue_dress', pose: 'sitting', scene: 'rainy_street', camera: 'close_up', extra: 'none' };

it('动态目录正文、负面与来源可规范化往返，元数据不能被拼成正文', () => {
  const dynamic = { ...sections, 'directory:eyes': '1.2::blue eyes, blue eyes::', 'directory:empty': '',
    sectionNegatives: { 'directory:eyes': 'red eyes', 'directory:empty': 'stale' },
    sectionMeta: { 'directory:eyes': { directoryId: 'eyes', directoryName: '眼睛', directoryPath: ['人物', '眼睛'] }, 'directory:empty': { directoryName: '清空' } } };
  const normalized = normalizePromptSections(dynamic)!;
  expect(normalized['directory:eyes']).toBe(dynamic['directory:eyes']);
  expect(normalized.sectionNegatives).toEqual({ 'directory:eyes': 'red eyes' });
  expect(normalized.sectionMeta).toEqual({ 'directory:eyes': dynamic.sectionMeta['directory:eyes'] });
  const subject = mergePromptSections(normalized);
  expect(subject).toBe(`${mergePromptSections(sections)}, 1.2::blue eyes, blue eyes::`);
  expect(resolvePromptSections(normalized, subject)).toEqual(normalized);
  expect(getEditableGlobalNegative('bad hands', normalized)).toBe('bad hands, red eyes');
  expect(normalizePromptSections({ 'directory:invalid': { secret: 'not text' } } as never)).toBeUndefined();
});

it.each([false, true])('动态目录四模式记忆保留正负词和来源，参数开关=%s', parameters => {
  const dynamic = { 'directory:one': 'weighted content', sectionNegatives: { 'directory:one': 'section negative' },
    sectionMeta: { 'directory:one': { directoryName: '自定义', directoryPath: ['自定义'] } } };
  const session = createLabWorkspaceSession('artist', mergePromptSections(dynamic), 'bad', { ...LAB_DEFAULT_PARAMS, _promptSections: dynamic,
    characters: [{ id: 'role', prompt: 'manual', x: 0.5, y: 0.5, sections: { 'directory:role': 'role content' }, sectionNegatives: { 'directory:role': 'role negative' } }] }, {});
  const memory = { ...DEFAULT_GENERATION_MEMORY_PREFERENCES, parameters };
  saveLabWorkspaceSession('playground', session, true, memory);
  sessionStorage.clear();
  const restored = loadLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}), true, memory);
  for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
    expect(draft.params._promptSections).toMatchObject(dynamic);
    expect(draft.params.characters?.[0]).toMatchObject(session.textToImage.params.characters![0]);
  }
});

it.each([false, true])('只记负词会合入动态分类负面，不保存正词或来源；读取旧副本=%s', legacy => {
  const dynamic = { 'directory:one': 'private positive', sectionNegatives: { 'directory:one': 'section negative' },
    sectionMeta: { 'directory:one': { directoryName: 'private source' } } };
  const session = createLabWorkspaceSession('artist', 'private positive', 'bad', { ...LAB_DEFAULT_PARAMS, _promptSections: dynamic,
    characters: [{ id: 'role', prompt: 'private manual', negativePrompt: 'role bad', x: 0.5, y: 0.5,
      sections: { 'directory:role': 'private role' }, sectionNegatives: { 'directory:role': 'role negative' } }] }, {});
  const memory = { parameters: true, globalPrompt: false, negativePrompt: true, characterPrompt: false, characterNegativePrompt: true };
  const serialized = serializeLabWorkspaceMemory(session, memory);
  expect(serialized).not.toContain('private');
  localStorage.setItem('nai-lab-workspace-v1:playground', legacy ? JSON.stringify(session) : serialized);
  const restored = loadLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}), true, memory);
  for (const draft of [restored.textToImage, ...Object.values(restored.edits)]) {
    expect(draft.negativePrompt).toBe('bad, section negative');
    expect(draft.params._promptSections).toBeUndefined();
    expect(draft.params.characters?.[0]).toMatchObject({ prompt: '', negativePrompt: 'role negative, role bad' });
    expect(draft.params.characters?.[0].sections).toBeUndefined();
    expect(draft.params.characters?.[0].sectionNegatives).toBeUndefined();
  }
});

it('分栏往返保留原文和合并顺序，旧数据与过期分栏不猜词', () => {
  const normalized = normalizeParams({ _promptSections: sections });
  const subject = mergePromptSections(sections);
  expect(resolvePromptSections(normalized._promptSections, subject)).toEqual(sections);
  expect(resolvePromptSections(sections, 'assistant changed everything')).toEqual({ appearance: '', wardrobe: '', pose: '', scene: '', camera: '', extra: 'assistant changed everything' });
  expect(resolvePromptSections(undefined, 'legacy prompt')).toHaveProperty('extra', 'legacy prompt');
  expect(resolvePromptSections(sections, '')).toHaveProperty('extra', '');
});

it.each([false, true])('分栏随全局提示词记忆保存和恢复，独立于参数开关 %s', parameters => {
  const session = createLabWorkspaceSession('artist', mergePromptSections(sections), '', { ...LAB_DEFAULT_PARAMS, _promptSections: sections }, {});
  const memory = { ...DEFAULT_GENERATION_MEMORY_PREFERENCES, parameters, globalPrompt: true };
  saveLabWorkspaceSession('playground', session, true, memory);
  sessionStorage.clear();
  const restored = loadLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}), true, memory);
  expect(restored.textToImage.params._promptSections).toEqual(sections);
  expect(restored.textToImage.subjectPrompt).toBe(mergePromptSections(sections));
});

it('关闭全局词记忆时，参数副本不夹带分栏；旧全量副本也按当前偏好过滤', () => {
  const session = createLabWorkspaceSession('private artist', mergePromptSections(sections), '', { ...LAB_DEFAULT_PARAMS, _promptSections: sections }, {});
  const memory = { ...DEFAULT_GENERATION_MEMORY_PREFERENCES, parameters: true, globalPrompt: false };
  const serialized = serializeLabWorkspaceMemory(session, memory);
  expect(serialized).not.toContain('silver_hair'); expect(serialized).not.toContain('_promptSections');
  localStorage.setItem('nai-lab-workspace-v1:playground', JSON.stringify(session));
  const restored = loadLabWorkspaceSession('playground', createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}), true, memory);
  expect(restored.textToImage.params._promptSections).toBeUndefined();
  expect(restored.textToImage.subjectPrompt).toBe('');
});

describe('分区来源快照', () => {
  it('来源跟着栏位走：清空内容后对应来源一并丢弃，其余保持不变', () => {
    const sections = {
      appearance: 'silver_hair', wardrobe: '', pose: '', scene: '', camera: '', extra: '',
      sectionMeta: {
        appearance: { entryId: 'a-1', entryName: '银发少女', source: 'library' as const, mode: 'append' as const },
        wardrobe: { entryId: 'w-1', entryName: '白裙', source: 'library' as const },
      },
    };
    const normalized = normalizePromptSections(sections);
    expect(normalized?.sectionMeta).toEqual({ appearance: sections.sectionMeta.appearance });
    expect(normalized?.sectionMeta?.wardrobe).toBeUndefined();
  });
});
