import { NAIParams } from '../types';
import { DEFAULT_NAI_MODEL, findNaiModelInfo } from './naiModels';
import { NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';

export interface NaiPayloadOptions {
  stream?: boolean;
  runtimeStreamSupported?: boolean;
}

const TRANSPARENT_PROMPT_TAGS = 'transparent background, has alpha';

/** 只改实际请求，不污染用户在编辑器中保存的原始提示词。 */
export const withTransparentPromptTags = (prompt: string): string => {
  const hasTransparentBackground = /(?:^|,)\s*(?:[\d.]+::)?transparent background(?:::)?\s*(?:,|$)/i.test(prompt);
  const hasAlpha = /(?:^|,)\s*has alpha\s*(?:,|$)/i.test(prompt);
  if (hasTransparentBackground && hasAlpha) return prompt;
  const missing = [!hasTransparentBackground ? 'transparent background' : '', !hasAlpha ? 'has alpha' : ''].filter(Boolean).join(', ');
  return prompt.trim() ? `${prompt.trimEnd()}, ${missing}` : missing || TRANSPARENT_PROMPT_TAGS;
};

export const buildNaiGenerationPayload = (
  prompt: string,
  negative: string,
  params: NAIParams,
  options: NaiPayloadOptions = {},
) => {
  const seed = params.seed !== undefined && params.seed !== null && params.seed !== -1
    ? params.seed
    : undefined;
  const modelId = params.model?.trim() || DEFAULT_NAI_MODEL;
  const modelInfo = findNaiModelInfo(modelId);
  const useTransparent = params.transparent === true && modelInfo?.supportsTransparentBackground === true;

  let finalPrompt = useTransparent ? withTransparentPromptTags(prompt) : prompt;
  if (params.qualityToggle ?? true) finalPrompt += NAI_QUALITY_TAGS;

  let finalNegative = negative;
  const presetId = params.ucPreset ?? 0;
  if (presetId !== 4) {
    const presetString = NAI_UC_PRESETS[presetId as keyof typeof NAI_UC_PRESETS];
    if (presetString) finalNegative = presetString + finalNegative;
  }

  const characters = params.characters ?? [];
  const hasCharacters = characters.length > 0;
  const charCaptions = characters.map(character => ({
    char_caption: character.prompt,
    centers: [{ x: character.x, y: character.y }],
  }));
  const charNegativeCaptions = characters.map(character => ({
    char_caption: character.negativePrompt || '',
    centers: [{ x: character.x, y: character.y }],
  }));

  const parameters: Record<string, unknown> = {
    params_version: 3,
    width: params.width,
    height: params.height,
    scale: params.scale,
    sampler: params.sampler,
    steps: params.steps,
    n_samples: 1,
    skip_cfg_above_sigma: params.variety ? 58 : null,
    cfg_rescale: params.cfgRescale ?? 0,
    qualityToggle: params.qualityToggle ?? true,
    ucPreset: params.ucPreset ?? 0,
    sm: false,
    sm_dyn: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    uncond_scale: 1,
    noise_schedule: 'karras',
    negative_prompt: finalNegative,
    v4_prompt: {
      caption: { base_caption: finalPrompt, char_captions: charCaptions },
      use_coords: params.useCoords ?? hasCharacters,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: finalNegative, char_captions: charNegativeCaptions },
      legacy_uc: false,
    },
    _local_vibes: params.vibes?.enabled && params.vibes.slots.length > 0 ? params.vibes : undefined,
    _local_character_references: params.characterReferences?.enabled && params.characterReferences.slots.length > 0
      ? params.characterReferences
      : undefined,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
  };

  if (seed !== undefined) parameters.seed = seed;
  if (options.stream && (modelInfo?.supportsStreamedResponses || options.runtimeStreamSupported)) parameters.stream = 'sse';
  if (useTransparent) {
    parameters.tag_hint_transparent_background = true;
    parameters.straight_alpha = params.alphaMode !== 'premultiplied';
  }

  return { input: finalPrompt, model: modelId, action: 'generate' as const, parameters };
};
