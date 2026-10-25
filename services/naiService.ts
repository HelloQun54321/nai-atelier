import { ChainType, ImageEditCanvasExpansion, ImageEditMetadata, ImageEditOperation, NAIParams, PromptModule } from '../types';
import { applyNaiModelSettings, getNaiModelFixedSettings, getRuntimeNaiModelInfo } from './naiModels';
import { hashNaiApiKey } from './anlasBudget';
import { buildNaiGenerationPayload, buildNaiImageEditPayload } from './naiPayload';
import { resolveTransparentWeight } from './transparentBackground.mjs';
import { getNaiRuntimeConfig, type NaiRuntimeConfig } from './naiRuntime';
import { prepareImageEdit, transformCharacterCoordinatesForFocused, transformCharacterCoordinatesForOutpaint, type PreparedImageEdit } from './imageEdit';
import { getActiveCharacters, withGenerationCharacters } from './characterPrompts';
import type { GenerationJobDescriptor } from './generationJob';

/** 草稿坐标基于底图；只为实际请求转换，不能把 Focused 裁剪坐标写回整图历史。 */
const buildImageEditRequestParams = (params: NAIParams, prepared: PreparedImageEdit, operation: ImageEditOperation, expansion?: ImageEditCanvasExpansion): NAIParams => {
  params = withGenerationCharacters(params, true);
  return {
    ...params,
    width: prepared.requestWidth,
    height: prepared.requestHeight,
    characters: prepared.focusedGeometry
      ? transformCharacterCoordinatesForFocused(params.characters, prepared.focusedGeometry, prepared.sourceWidth, prepared.sourceHeight)
      : operation === 'outpaint' && expansion
        ? transformCharacterCoordinatesForOutpaint(params.characters,
          prepared.sourceWidth - expansion.left - expansion.right,
          prepared.sourceHeight - expansion.top - expansion.bottom, expansion)
        : params.characters,
  };
};

const buildImageEditResultParams = (params: NAIParams, requestParams: NAIParams, prepared: PreparedImageEdit, freeform: boolean): NAIParams => prepared.focusedGeometry
  // Focused 历史保留整图坐标，回放时再次裁剪、吸附；不能把裁剪区坐标当成整图坐标。
  ? { ...withGenerationCharacters(requestParams, freeform), width: prepared.sourceWidth, height: prepared.sourceHeight, characters: withGenerationCharacters(params, true).characters }
  : withGenerationCharacters(requestParams, freeform);

const validateGenerationCapabilities = (params: NAIParams, runtime: NaiRuntimeConfig, operation: 'text-to-image' | ImageEditOperation = 'text-to-image') => {
  const modelInfo = getRuntimeNaiModelInfo(params.model, runtime);
  const canSendVibes = operation === 'text-to-image' || operation === 'image-to-image';
  if (canSendVibes && params.vibes?.enabled && params.vibes.slots.length > 0 && !modelInfo.supportsVibes) {
    throw new Error(`NovelAI ${modelInfo.label} 暂不支持 Vibe Transfer，请先移除 Vibe 或切换模型`);
  }
  if (canSendVibes && params.vibes?.enabled && params.vibes.slots.length > 16) {
    throw new Error('一次最多使用 16 个 Vibe');
  }
  const canSendCharacterReferences = operation === 'inpaint' || operation === 'outpaint'
    ? modelInfo.supportsCharacterReferenceInpainting
    : modelInfo.supportsCharacterReferences;
  if (params.characterReferences?.enabled && params.characterReferences.slots.length > 0 && !canSendCharacterReferences) {
    throw new Error(`NovelAI ${modelInfo.label} 暂不支持角色参考，请先移除角色参考或切换模型`);
  }
  if (params.characterReferences?.enabled && params.characterReferences.slots.length > 4) {
    throw new Error('一次最多使用 4 个角色参考');
  }
  if (getActiveCharacters(params.characters).length > modelInfo.maxCharacters) {
    throw new Error(`NovelAI ${modelInfo.label} 最多支持 ${modelInfo.maxCharacters} 个角色提示词，请先停用或删除多余角色，或切换模型`);
  }
  return modelInfo;
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取图片编辑原料失败'));
  reader.readAsDataURL(blob);
});

/**
 * 后台任务的编辑输入：只描述本次模式与画布几何，预处理与请求参数由本模块统一推导。
 * 蒙版与底图是提交给后端的原始像素，回贴由后端用同一份预处理结果完成。
 */
export interface GenerationJobEditInput {
  image: string;
  mask?: string;
  strength: number;
  noise: number;
  focused?: boolean;
  focusedRect?: { x: number; y: number; width: number; height: number };
  minimumContextArea?: number;
  expansion?: ImageEditCanvasExpansion;
}

/** 本轮历史模板中除本轮提示词与参数之外的结构化来源信息。 */
export interface GenerationJobHistoryInput {
  basePrompt?: string;
  subjectPrompt?: string;
  modules?: PromptModule[];
  sourceChainId?: string;
  sourceChainName?: string;
  sourceChainType?: ChainType | 'playground';
  /** 编辑模式的部分 metadata；请求宽度、蒙版可用性与 Key 指纹由本模块补齐。 */
  edit?: Partial<ImageEditMetadata>;
}

export interface GenerationJobDescriptorInput {
  operation: 'text-to-image' | ImageEditOperation;
  prompt: string;
  negative: string;
  params: NAIParams;
  /** 用户本轮确认的每张授权费用；后端据此判断费用上涨。 */
  approvedCost: number;
  /** 是否调用流式网关，把最新中间结果放进后台任务状态供界面预览。 */
  stream?: boolean;
  /** 强制随机种子（覆盖草稿里残留的固定 seed）。 */
  forceEmptySeed?: boolean;
  /** 用于写入历史编辑 metadata 的 Key 指纹；不参与请求。 */
  apiKey?: string;
  estimatedCost?: number;
  history: GenerationJobHistoryInput;
  edit?: GenerationJobEditInput;
}

/**
 * 一次性构建后台任务描述：复用现有 payload 与编辑预处理代码，只做一次。
 * 随机种子交给后端每张重新抽取；固定种子原样保留。
 */
export const buildGenerationJobDescriptor = async (input: GenerationJobDescriptorInput, preparedEdit?: PreparedImageEdit): Promise<GenerationJobDescriptor> => {
  const runtime = await getNaiRuntimeConfig();
  let params = applyNaiModelSettings(input.params, runtime);
  if (params.transparent) params = { ...params, transparentWeight: resolveTransparentWeight(params.transparentWeight, input.prompt) };
  const stream = Boolean(input.stream);
  const { edit: _unusedHistoryEdit, ...historyBase } = input.history;

  if (input.operation === 'text-to-image') {
    const draftParams: NAIParams = input.forceEmptySeed ? { ...params, seed: undefined } : params;
    const payload = buildNaiGenerationPayload(input.prompt, input.negative, draftParams, { runtime, stream });
    const modelInfo = validateGenerationCapabilities(draftParams, runtime);
    // 历史记录实际生效的负面词（固定档位模型请求时用空负面）与整图复现参数。
    const historyNegative = getNaiModelFixedSettings(draftParams.model, runtime) ? '' : input.negative;
    return {
      payload, stream, approvedCost: input.approvedCost,
      randomSeed: typeof payload.parameters.seed !== 'number',
      history: { ...historyBase, prompt: input.prompt, negativePrompt: historyNegative, params: withGenerationCharacters(draftParams, modelInfo.freeformCharacterPosition) },
    };
  }

  const edit = input.edit;
  if (!edit) throw new Error('缺少图片编辑参数');
  const focused = Boolean(edit.focused && input.operation === 'inpaint');
  const randomSeed = Boolean(input.forceEmptySeed) || params.seed === undefined || params.seed === null || params.seed === -1;
  const prepared = preparedEdit ?? await prepareImageEdit({
    operation: input.operation, image: edit.image, mask: edit.mask,
    focused, focusedRect: edit.focusedRect, minimumContextArea: edit.minimumContextArea,
  });
  const requestParams = buildImageEditRequestParams(params, prepared, input.operation, edit.expansion);
  const payload = buildNaiImageEditPayload(input.prompt, input.negative, randomSeed ? { ...requestParams, seed: -1 } : requestParams, {
    operation: input.operation, image: prepared.image, mask: prepared.mask,
    strength: edit.strength, noise: edit.noise, focused,
    minimumContextArea: edit.minimumContextArea,
    runtimeModels: runtime.models, runtime, stream,
  });
  const modelInfo = validateGenerationCapabilities(requestParams, runtime, input.operation);
  const keyHash = input.apiKey ? await hashNaiApiKey(input.apiKey) : undefined;
  const historyEdit: ImageEditMetadata = {
    ...input.history.edit,
    operation: input.operation,
    requestWidth: prepared.requestWidth,
    requestHeight: prepared.requestHeight,
    fullSizeMask: Boolean(prepared.focusedGeometry?.fullSizeMask || (edit.mask && !focused)),
    maskAvailable: Boolean(edit.mask),
    estimatedCost: input.estimatedCost,
    settlementStatus: 'estimated',
    ...(keyHash ? { keyHash } : {}),
  };
  return {
    payload, stream, randomSeed, approvedCost: input.approvedCost,
    // 没有回贴蒙版的编辑（图生图整图）直接把结果作为成图，不提交回贴原料。
    ...(prepared.compositeMask
      ? { composition: { originalImage: await blobToDataUrl(prepared.originalImage), compositeMask: await blobToDataUrl(prepared.compositeMask), ...(prepared.focusedGeometry ? { focusedGeometry: prepared.focusedGeometry } : {}) } }
      : {}),
    ...(edit.mask ? { editMask: edit.mask } : {}),
    history: {
      ...historyBase, prompt: input.prompt,
      negativePrompt: getNaiModelFixedSettings(requestParams.model, runtime) ? '' : input.negative,
      params: buildImageEditResultParams(params, requestParams, prepared, modelInfo.freeformCharacterPosition),
      edit: historyEdit,
    },
  };
};
