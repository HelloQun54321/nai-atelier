import { describe, expect, it } from 'vitest';
import { PromptChain } from '../types';
import { createLabImageEditDraft } from './labWorkspace';
import { appendTagsToImageEditDraft, buildImageEditMetadataPatch, buildImageEditPresetPatch, canSaveLabModeToLibrary, LabPresetImportOptions } from './labModeTools';

const params = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  qualityToggle: true,
  ucPreset: 4,
};

const preset: PromptChain = {
  id: 'preset-1',
  userId: 'user-1',
  name: '测试预设',
  description: '',
  type: 'style',
  tags: [],
  basePrompt: 'oil painting',
  negativePrompt: 'low quality',
  variableValues: { subject: '1girl' },
  modules: [
    { id: 'pre', name: '前置', content: 'dramatic light', position: 'pre', isActive: true },
    { id: 'post', name: '后置', content: 'blue eyes', position: 'post', isActive: true },
  ],
  params: { ...params, steps: 20, scale: 6, seed: 123 },
  createdAt: 1,
  updatedAt: 1,
};

const allOptions: LabPresetImportOptions = {
  importBasePrompt: true,
  importSubject: true,
  importNegative: true,
  importModules: true,
  appendModules: false,
  importCharacters: false,
  appendCharacters: false,
  importSettings: true,
  importSeed: true,
};

describe('buildImageEditPresetPatch', () => {
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('为 %s 编译完整提示词并恢复参数', operation => {
    const current = createLabImageEditDraft(operation, 'old prompt', 'old negative', params);
    const patch = buildImageEditPresetPatch(current, preset, allOptions, new Set(['pre', 'post']), () => 'new-id');

    expect(patch.prompt).toBe('oil painting, dramatic light, 1girl, blue eyes');
    expect(patch.negativePrompt).toBe('low quality');
    expect(patch.promptSource).toBe('custom');
    expect(patch.params).toMatchObject({ steps: 20, scale: 6, seed: 123 });
  });

  it('追加模块时保留编辑页现有完整提示词', () => {
    const current = createLabImageEditDraft('image-to-image', 'old prompt', 'old negative', params);
    const patch = buildImageEditPresetPatch(
      current,
      preset,
      { ...allOptions, importBasePrompt: false, importSubject: false, importNegative: false, importSettings: false, importSeed: false, appendModules: true },
      new Set(['post']),
      () => 'new-id',
    );

    expect(patch.prompt).toBe('old prompt, blue eyes');
    expect(patch.negativePrompt).toBeUndefined();
    expect(patch.params).toBeUndefined();
  });

  it('没有选中任何结构化提示词字段时保留现有编辑提示词', () => {
    const current = createLabImageEditDraft('inpaint', 'old prompt', 'old negative', params);
    const patch = buildImageEditPresetPatch(
      current,
      preset,
      { ...allOptions, importBasePrompt: false, importSubject: false, importNegative: false, importSettings: false, importSeed: false },
      new Set(),
      () => 'new-id',
    );

    expect(patch.prompt).toBeUndefined();
  });
});

describe('编辑页顶部工具路由', () => {
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('为 %s 追加反推 Tag 并导入元数据', operation => {
    const current = createLabImageEditDraft(operation, 'old prompt', 'old negative', params);

    expect(appendTagsToImageEditDraft(current, '1girl, blue eyes')).toMatchObject({
      prompt: 'old prompt, 1girl, blue eyes',
      promptSource: 'custom',
    });
    expect(buildImageEditMetadataPatch('new prompt', 'new negative', { ...params, seed: 9 })).toMatchObject({
      prompt: 'new prompt',
      negativePrompt: 'new negative',
      params: { seed: 9 },
      promptSource: 'custom',
    });
  });

  it('只有文生图支持保存到现有预设库', () => {
    expect(canSaveLabModeToLibrary('text-to-image')).toBe(true);
    expect(canSaveLabModeToLibrary('image-to-image')).toBe(false);
    expect(canSaveLabModeToLibrary('inpaint')).toBe(false);
    expect(canSaveLabModeToLibrary('outpaint')).toBe(false);
  });
});
