import { ImageEditOperation, NAIParams } from '../types';
import { DEFAULT_NAI_MODEL, getRuntimeNaiModelInfo } from './naiModels';
import { buildImageEditParameters, resolveImageEditModel, validateImageEditSampler } from './imageEdit';
import { DEFAULT_NAI_RUNTIME, getNaiRuntimeModelCapability, NaiRuntimeConfig } from './naiRuntime';

export interface NaiPayloadOptions {
  stream?: boolean;
  runtimeStreamSupported?: boolean;
  runtime?: NaiRuntimeConfig;
  /** 图片编辑的 Inpainting／Outpainting 不发送 Vibe，即使草稿中仍保留旧选择。 */
  allowVibes?: boolean;
}

export interface NaiImageEditPayloadOptions {
  operation: ImageEditOperation;
  image: string;
  mask?: string;
  strength: number;
  noise: number;
  focused?: boolean;
  minimumContextArea?: number;
  runtimeModels?: string[];
  runtime?: NaiRuntimeConfig;
  stream?: boolean;
  runtimeStreamSupported?: boolean;
}

const TRANSPARENT_PROMPT_TAGS = 'transparent background, has alpha';

const LEGACY_QUALITY_DEFAULT = 'standard';
const LEGACY_UC_IDS = ['heavy', 'light', 'furryFocus', 'humanFocus', 'none'];

const appendPromptPart = (prompt: string, part: string | undefined, position: 'prefix' | 'suffix') => {
  const value = String(part || '').trim();
  if (!value) return prompt;
  const source = String(prompt || '').trim();
  if (!source) return value;
  return position === 'prefix' ? `${value}, ${source}` : `${source}, ${value}`;
};

const resolvePresetId = (params: NAIParams, field: 'quality' | 'uc') => {
  if (field === 'quality') {
    if (typeof params.qualityPresetId === 'string' && params.qualityPresetId.trim()) return params.qualityPresetId.trim();
    return params.qualityToggle === false ? 'none' : LEGACY_QUALITY_DEFAULT;
  }
  if (typeof params.ucPresetId === 'string' && params.ucPresetId.trim()) return params.ucPresetId.trim();
  const legacyId = Number.isInteger(params.ucPreset) ? LEGACY_UC_IDS[Math.max(0, Math.min(4, params.ucPreset as number))] : undefined;
  return legacyId || 'heavy';
};

export const resolveNaiPromptPresets = (params: NAIParams, runtime: NaiRuntimeConfig = DEFAULT_NAI_RUNTIME) => {
  const modelId = params.model?.trim() || DEFAULT_NAI_MODEL;
  const capability = getNaiRuntimeModelCapability(runtime, modelId);
  const requestedQualityId = resolvePresetId(params, 'quality');
  const requestedUcId = resolvePresetId(params, 'uc');
  const qualityId = requestedQualityId === 'none'
    ? 'none'
    : capability?.qualityPresets.length
      ? capability.qualityPresets.some(item => item.id === requestedQualityId) ? requestedQualityId : capability.qualityPresets[0].id
      : 'none';
  const ucId = capability?.ucPresets.length
    ? capability.ucPresets.some(item => item.id === requestedUcId) ? requestedUcId : capability.ucPresets[0].id
    : 'none';
  const qualityPreset = qualityId === 'none' ? undefined : capability?.qualityPresets.find(item => item.id === qualityId);
  const ucPreset = capability?.ucPresets.find(item => item.id === ucId);
  return { modelId, capability, qualityId, ucId, qualityPreset, ucPreset };
};

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
  const runtime = options.runtime || DEFAULT_NAI_RUNTIME;
  const modelInfo = getRuntimeNaiModelInfo(modelId, runtime);
  const presetState = resolveNaiPromptPresets(params, runtime);
  const useTransparent = params.transparent === true && modelInfo.supportsTransparentBackground === true;

  let finalPrompt = useTransparent ? withTransparentPromptTags(prompt) : prompt;
  if (presetState.qualityPreset) {
    finalPrompt = appendPromptPart(finalPrompt, presetState.qualityPreset.prefix, 'prefix');
    finalPrompt = appendPromptPart(finalPrompt, presetState.qualityPreset.suffix, 'suffix');
  }

  let finalNegative = negative;
  if (presetState.ucPreset?.prefix) finalNegative = appendPromptPart(finalNegative, presetState.ucPreset.prefix, 'prefix');

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
    params_version: 4,
    width: params.width,
    height: params.height,
    scale: params.scale,
    sampler: params.sampler,
    steps: params.steps,
    n_samples: 1,
    skip_cfg_above_sigma: params.variety ? 58 : null,
    cfg_rescale: params.cfgRescale ?? 0,
    qualityPresetId: presetState.qualityId,
    ucPresetId: presetState.ucId,
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
    _local_vibes: options.allowVibes !== false && params.vibes?.enabled && params.vibes.slots.length > 0 ? params.vibes : undefined,
    _local_character_references: params.characterReferences?.enabled && params.characterReferences.slots.length > 0
      ? params.characterReferences
      : undefined,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
  };

  if (seed !== undefined) parameters.seed = seed;
  if (options.stream && (modelInfo.supportsStreamedResponses || options.runtimeStreamSupported)) parameters.stream = 'sse';
  if (useTransparent) {
    parameters.tag_hint_transparent_background = true;
    parameters.straight_alpha = params.alphaMode !== 'premultiplied';
  }

  return { input: finalPrompt, model: modelId, action: 'generate' as const, parameters };
};

export const buildNaiImageEditPayload = (
  prompt: string,
  negative: string,
  params: NAIParams,
  options: NaiImageEditPayloadOptions,
) => {
  validateImageEditSampler(params.sampler);
  // 编辑模式与文生图一致：seed=-1（固定 seed）由服务端随机，不强制本地随机化，
  // 否则用户复制固定 seed 的编辑结果无法复现同一张图。
  const seed = params.seed !== undefined && params.seed !== null && params.seed !== -1
    ? params.seed
    : params.seed === -1
      ? -1
      : Math.floor(0x100000000 * Math.random() - 1);
  // 编辑模式只使用整图提示词；文生图草稿中保留的多角色提示词与坐标不得泄漏到请求。
  const requestParams: NAIParams = { ...params, seed, characters: [], useCoords: false };
  const base = buildNaiGenerationPayload(prompt, negative, requestParams, {
    runtime: options.runtime,
    allowVibes: options.operation === 'image-to-image',
    stream: options.stream,
    runtimeStreamSupported: options.runtimeStreamSupported,
  });
  const isInpaintOperation = options.operation === 'inpaint' || options.operation === 'outpaint';
  const model = isInpaintOperation
    ? resolveImageEditModel(base.model, options.runtimeModels || [])
    : base.model;
  const parameters = {
    ...base.parameters,
    ...buildImageEditParameters(
      options.operation,
      options.image,
      options.mask,
      options.strength,
      options.noise,
      options.focused === true,
      options.minimumContextArea,
    ),
    // extra_noise_seed 与主 seed 同源；固定 seed（-1 由服务端随机）时无从派生，不发送
    ...(seed >= 0 ? { extra_noise_seed: seed - 1 } : {}),
    _local_edit_operation: options.operation,
  };
  return {
    ...base,
    model,
    action: isInpaintOperation ? 'infill' as const : 'img2img' as const,
    parameters,
  };
};
