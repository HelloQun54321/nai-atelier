import { GenerationMode, LabImageEditDraft, NAIParams, CharacterParams } from '../types';
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

/**
 * 把外部反推的 Tag 放进角色槽：空白槽就够了，不碰已写好的角色；
 * 没有空白槽就在模型允许范围内新建一个；槽位已满时追加到最后一位，
 * 仍然只追加、不清空任何已有角色提示词。
 */
export const placeTagsInCharacterSlot = (
  characters: CharacterParams[],
  tags: string,
  maxCharacters: number,
  createBlank: () => CharacterParams,
): { characters: CharacterParams[]; slot: number; created: boolean } => {
  const trimmed = tags.trim();
  const blank = characters.findIndex(character => !(character.prompt || '').trim());
  if (blank >= 0) {
    const next = [...characters];
    next[blank] = { ...next[blank], prompt: mergePromptFields(next[blank].prompt, trimmed) };
    return { characters: next, slot: blank, created: false };
  }
  if (characters.length < maxCharacters) {
    const next = [...characters, { ...createBlank(), prompt: trimmed }];
    return { characters: next, slot: next.length - 1, created: true };
  }
  const last = characters.length - 1;
  if (last < 0) return { characters, slot: -1, created: false };
  const next = [...characters];
  next[last] = { ...next[last], prompt: mergePromptFields(next[last].prompt, trimmed) };
  return { characters: next, slot: last, created: false };
};

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
