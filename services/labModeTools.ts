import { GenerationMode, LabImageEditDraft, NAIParams } from '../types';
import { mergePromptFields } from './promptUtils';
import { resolveTransparentWeight } from './transparentBackground.mjs';
import type { PromptFragmentImport } from './metadataService';
import { normalizeParams } from './labWorkspace';

export function buildPromptFragmentPatch(current: { prompt: string; negativePrompt: string; params: NAIParams }, data: PromptFragmentImport) {
  if (data.fullMetadata) {
    const params = data.partialMetadata ? { ...current.params, ...data.params } : { ...data.params };
    if (data.params?.qualityToggle !== undefined) delete params.qualityPresetId;
    if (data.params?.ucPreset !== undefined) delete params.ucPresetId;
    return { prompt: data.prompt ?? current.prompt, negativePrompt: data.negativePrompt ?? current.negativePrompt, params: normalizeParams(params) };
  }
  const patch: Partial<typeof current> = {};
  const join = (before: string, value: string) => data.replace ? value : [before.trim(), value.trim()].filter(Boolean).join(', ');
  if (data.prompt !== undefined) patch.prompt = join(current.prompt, data.prompt);
  if (data.negativePrompt !== undefined) patch.negativePrompt = join(current.negativePrompt, data.negativePrompt);
  let params = current.params;
  if (data.characters !== undefined) params = { ...params, characters: data.replace ? data.characters : [...(params.characters || []), ...data.characters] };
  if (data.importSettings && data.params) params = mergePresetSettings(params, data.params, data.prompt);
  if (data.importSeed && data.params?.seed !== undefined) params = { ...params, seed: data.params.seed };
  if (data.importModel && data.params?.model) params = { ...params, model: data.params.model };
  if (params !== current.params) patch.params = params;
  return patch;
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

export const mergePresetSettings = (current: NAIParams, imported?: Partial<NAIParams>, importedPrompt = ''): NAIParams => ({
  ...current,
  steps: imported?.steps ?? current.steps,
  scale: imported?.scale ?? current.scale,
  sampler: imported?.sampler ?? current.sampler,
  noiseSchedule: imported?.noiseSchedule ?? current.noiseSchedule,
  width: imported?.width ?? current.width,
  height: imported?.height ?? current.height,
  qualityToggle: imported?.qualityToggle ?? current.qualityToggle,
  ucPreset: imported?.ucPreset ?? current.ucPreset,
  cfgRescale: imported?.cfgRescale ?? current.cfgRescale,
  variety: imported?.variety ?? current.variety,
  useCoords: imported?.useCoords ?? current.useCoords,
  transparent: imported?.transparent ?? current.transparent,
  transparentWeight: imported?.transparentWeight !== undefined || imported?.transparent === true
    ? resolveTransparentWeight(imported?.transparentWeight, importedPrompt)
    : current.transparentWeight,
  alphaMode: imported?.alphaMode ?? current.alphaMode,
});
