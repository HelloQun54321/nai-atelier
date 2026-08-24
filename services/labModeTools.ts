import { GenerationMode, LabImageEditDraft, NAIParams, PromptChain } from '../types';
import { compilePrompt, mergePromptFields } from './promptUtils';

export interface LabPresetImportOptions {
  importBasePrompt: boolean;
  importSubject: boolean;
  importNegative: boolean;
  importModules: boolean;
  appendModules: boolean;
  importCharacters: boolean;
  appendCharacters: boolean;
  importSettings: boolean;
  importSeed: boolean;
}

export const canSaveLabModeToLibrary = (mode: GenerationMode): boolean => mode === 'text-to-image';

export const appendTagsToImageEditDraft = (
  current: LabImageEditDraft,
  tags: string,
): Partial<LabImageEditDraft> => ({
  prompt: mergePromptFields(current.prompt, tags),
  promptSource: 'custom',
});

export const buildImageEditMetadataPatch = (
  prompt: string,
  negativePrompt: string,
  params: NAIParams,
): Partial<LabImageEditDraft> => ({
  prompt,
  negativePrompt,
  params,
  promptSource: 'custom',
});

const mergePresetSettings = (current: NAIParams, imported?: NAIParams): NAIParams => ({
  ...current,
  steps: imported?.steps ?? current.steps,
  scale: imported?.scale ?? current.scale,
  sampler: imported?.sampler ?? current.sampler,
  width: imported?.width ?? current.width,
  height: imported?.height ?? current.height,
  qualityToggle: imported?.qualityToggle ?? current.qualityToggle,
  ucPreset: imported?.ucPreset ?? current.ucPreset,
  cfgRescale: imported?.cfgRescale ?? current.cfgRescale,
  variety: imported?.variety ?? current.variety,
  useCoords: imported?.useCoords ?? current.useCoords,
});

/**
 * 编辑页使用单一完整提示词，因此引用预设时把用户勾选的结构化字段编译成完整 Prompt。
 * “追加模块”在这里仅追加选中的模块串，避免把旧提示词中无法再拆分的内容误判为结构化字段。
 */
export const buildImageEditPresetPatch = (
  current: LabImageEditDraft,
  target: PromptChain,
  options: LabPresetImportOptions,
  moduleIds: Set<string>,
  createId: () => string,
): Partial<LabImageEditDraft> => {
  const patch: Partial<LabImageEditDraft> = {};
  const selectedModules = options.importModules
    ? (target.modules || []).filter(module => moduleIds.has(module.id))
    : [];
  const importsStructuredPrompt = options.importBasePrompt || options.importSubject || selectedModules.length > 0;

  if (importsStructuredPrompt) {
    const baseAndSubject = compilePrompt(
      { basePrompt: options.importBasePrompt ? target.basePrompt || '' : '', modules: options.appendModules ? [] : selectedModules },
      options.importSubject ? target.variableValues?.subject || '' : '',
    );
    const appendedModules = options.appendModules
      ? compilePrompt({ basePrompt: '', modules: selectedModules })
      : '';
    patch.prompt = options.appendModules
      ? mergePromptFields(baseAndSubject || current.prompt, appendedModules)
      : baseAndSubject;
    patch.promptSource = 'custom';
  }

  if (options.importNegative) patch.negativePrompt = target.negativePrompt || '';

  let nextParams = current.params;
  if (options.importSettings) nextParams = mergePresetSettings(nextParams, target.params);
  if (options.importCharacters && target.params?.characters) {
    const characters = target.params.characters.map(character => ({ ...character, id: createId() }));
    nextParams = {
      ...nextParams,
      characters: options.appendCharacters
        ? [...(nextParams.characters || []), ...characters]
        : characters,
    };
  }
  if (options.importSeed && target.params?.seed !== undefined) {
    nextParams = { ...nextParams, seed: target.params.seed };
  }
  if (nextParams !== current.params) patch.params = nextParams;

  return patch;
};
