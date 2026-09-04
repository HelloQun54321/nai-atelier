
import JSZip from 'jszip';
import { ImageEditOperation, NAIParams } from '../types';
import { api, isQueueCancelledError } from './api';
import { getRuntimeNaiModelInfo } from './naiModels';
import { NOVELAI_USAGE_REFRESH_EVENT } from './naiUsage';
import { hashNaiApiKey } from './anlasBudget';
import { emitCloudQueueStatus, getCachedCloudQueuePreferences, getCloudQueuePreferences, scheduleCloudQueueStatusClear, watchCloudQueueTask } from './cloudQueue';
import { buildNaiGenerationPayload } from './naiPayload';
import { buildNaiImageEditPayload } from './naiPayload';
import { getNaiRuntimeConfig } from './naiRuntime';
import { composeImageEditResult, prepareImageEdit } from './imageEdit';

export interface NaiStreamPreview {
  image: string;
  step?: number;
}

const validateGenerationCapabilities = (params: NAIParams, runtime: Awaited<ReturnType<typeof getNaiRuntimeConfig>>, operation: 'text-to-image' | ImageEditOperation = 'text-to-image') => {
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
  if ((params.characters?.length || 0) > modelInfo.maxCharacters) {
    throw new Error(`NovelAI ${modelInfo.label} 最多支持 ${modelInfo.maxCharacters} 个角色提示词，请先删除多余角色或切换模型`);
  }
  return modelInfo;
};

const imageDataUri = (value: string) => {
  if (value.startsWith('data:image/')) return value;
  return `${value.replace(/\s/g, '').startsWith('/9j/') ? 'data:image/jpeg;base64,' : 'data:image/png;base64,'}${value}`;
};

const blobFromDataUri = (uri: string): Blob => {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('流式生成返回了无效图片');
  const mime = uri.slice(5, uri.indexOf(';', 5)) || 'image/png';
  const binary = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
};

export const generateImage = async (apiKey: string, prompt: string, negative: string, params: NAIParams) => {
  const runtime = await getNaiRuntimeConfig();
  const payload = buildNaiGenerationPayload(prompt, negative, params, { runtime });
  const seed = typeof payload.parameters.seed === 'number' ? payload.parameters.seed : undefined;
  validateGenerationCapabilities(params, runtime);

  // 调用 Worker Proxy, 传递 API Key Header
  // Queue status is auxiliary.  A temporary failure to read its preference
  // must not prevent a direct NovelAI generation from being submitted.
  let queue = getCachedCloudQueuePreferences();
  try {
    queue = await getCloudQueuePreferences();
  } catch {
    // The request below remains authoritative and also triggers the common
    // LAN unlock flow when the session has expired.
  }
  const queueTaskId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const queueApiKey = apiKey.trim();
  let requestFinished = false;
  if (queue.enabled) emitCloudQueueStatus({ taskId: queueTaskId, phase: 'preparing', cancelable: true }, queueApiKey);
  const statusWatcher = queue.enabled ? watchCloudQueueTask(queueTaskId, () => requestFinished, queueApiKey) : Promise.resolve();
  let blob: Blob;
  let terminalPhase: 'completed' | 'cancelled' | 'error' = 'completed';
  let terminalError: string | undefined;
  try {
    const budgetKeyHash = await hashNaiApiKey(apiKey);
    blob = await api.postBinary('/generate', payload, {
      'Authorization': `Bearer ${apiKey}`,
      ...(queue.enabled ? {
        'X-Nai-Queue-Task-Id': queueTaskId,
      } : {}),
    }, { budgetKeyHash });
  } catch (error) {
    terminalPhase = isQueueCancelledError(error) ? 'cancelled' : 'error';
    terminalError = error instanceof Error ? error.message : '生成失败';
    if (queue.enabled) {
      emitCloudQueueStatus({
        taskId: queueTaskId,
        phase: terminalPhase,
        error: terminalError,
        cancelable: false,
      }, queueApiKey);
    }
    throw error;
  } finally {
    requestFinished = true;
    // 生图会消耗 Opus 免费限额（V5），通知限额组件刷新。
    if (terminalPhase === 'completed' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    }
    await statusWatcher;
    if (queue.enabled) {
      emitCloudQueueStatus({
        taskId: queueTaskId,
        phase: terminalPhase,
        error: terminalError,
        cancelable: false,
      }, queueApiKey);
      scheduleCloudQueueStatusClear(queueTaskId, terminalPhase === 'error' ? 8000 : 5000, queueApiKey);
    }
  }

  // 解析 Zip (逻辑保持不变)
  const zip = await JSZip.loadAsync(blob);
  const filename = Object.keys(zip.files).find(name =>
    !zip.files[name].dir && /\.(?:png|jpe?g|webp)$/i.test(name)
  );
  if (!filename) throw new Error("No image found in response");

  const imageBytes = await zip.files[filename].async('uint8array');
  const imageType = /\.jpe?g$/i.test(filename) ? 'image/jpeg' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/png';
  const imageBuffer = imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) as ArrayBuffer;
  const fileData = new Blob([imageBuffer], { type: imageType });

  // Extract seed from payload if available, or finding it in metadata would be ideal but for now we rely on what we sent
  // Actually, NAI returns the seed in the response JSON if we used the proper endpoint or read the png info.
  // The current implementation reads the ZIP. 
  // IMPORTANT: The backend usually returns a JSON with the seed if not successful, but for Zip response, the seed is often in the filename or we must trust what we sent.
  // HOWEVER, if we sent -1 (or undefined), the server picked one. The server response headers or a specific JSON file in the ZIP might have it.
  // NAI Zip often contains the image and sometimes a JSON metadata file.

  // Let's try to find a .json file in the zip
  let actualSeed: number | undefined = seed;
  const jsonFile = Object.keys(zip.files).find(f => f.endsWith('.json'));
  if (jsonFile) {
    const jsonText = await zip.files[jsonFile].async('text');
    try {
      const json = JSON.parse(jsonText);
      /* 
         NAI JSON format usually usually has:
         { ... "seed": 123456 ... }
      */
      const reportedSeed = json.seed ?? json.parameters?.seed ?? json.metadata?.seed;
      if (typeof reportedSeed === 'number' && Number.isFinite(reportedSeed)) actualSeed = reportedSeed;
    } catch (e) { console.error('Failed to parse metadata json', e); }
  } else {
    // Fallback: If we didn't send a seed, and can't find it, we might be out of luck without reading PNG chunks.
    // But typically NAI returns a JSON alongside the image in the zip.
  }

  return { image: URL.createObjectURL(fileData), blob: fileData, seed: actualSeed };
};

export const generateImageEdit = async (
  apiKey: string,
  prompt: string,
  negative: string,
  params: NAIParams,
  edit: {
    operation: ImageEditOperation;
    image: string;
    mask?: string;
    strength: number;
    noise: number;
    focused?: boolean;
    focusedRect?: { x: number; y: number; width: number; height: number };
    minimumContextArea?: number;
  },
) => {
  const runtime = await getNaiRuntimeConfig();
  const prepared = await prepareImageEdit(edit);
  const requestParams: NAIParams = { ...params, width: prepared.requestWidth, height: prepared.requestHeight };
  const payload = buildNaiImageEditPayload(prompt, negative, requestParams, {
    ...edit,
    image: prepared.image,
    mask: prepared.mask,
    focused: edit.focused && edit.operation === 'inpaint',
    runtimeModels: runtime.models,
    runtime,
  });
  validateGenerationCapabilities(requestParams, runtime, edit.operation);
  const queue = await (async () => {
    try { return await getCloudQueuePreferences(); } catch { return getCachedCloudQueuePreferences(); }
  })();
  const queueTaskId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const queueApiKey = apiKey.trim();
  let requestFinished = false;
  let terminalPhase: 'completed' | 'cancelled' | 'error' = 'completed';
  let terminalError: string | undefined;
  if (queue.enabled) emitCloudQueueStatus({ taskId: queueTaskId, phase: 'preparing', cancelable: true }, queueApiKey);
  const statusWatcher = queue.enabled ? watchCloudQueueTask(queueTaskId, () => requestFinished, queueApiKey) : Promise.resolve();
  try {
    const budgetKeyHash = await hashNaiApiKey(apiKey);
    const binaryResult = await api.postBinaryDetailed('/generate', payload, {
      Authorization: `Bearer ${apiKey}`,
      ...(queue.enabled ? { 'X-Nai-Queue-Task-Id': queueTaskId } : {}),
    }, { budgetKeyHash });
    const blob = binaryResult.blob;
    const zip = await JSZip.loadAsync(blob);
    const filename = Object.keys(zip.files).find(name => !zip.files[name].dir && /\.(?:png|jpe?g|webp)$/i.test(name));
    if (!filename) throw new Error('NovelAI 编辑接口没有返回图片');
    const imageBytes = await zip.files[filename].async('uint8array');
    const imageType = /\.jpe?g$/i.test(filename) ? 'image/jpeg' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/png';
    const imageBuffer = imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) as ArrayBuffer;
    const fileData = new Blob([imageBuffer], { type: imageType });
    const payloadParameters = payload.parameters as Record<string, unknown>;
    let actualSeed = typeof payloadParameters.seed === 'number' ? payloadParameters.seed : undefined;
    const jsonFile = Object.keys(zip.files).find(file => file.endsWith('.json'));
    if (jsonFile) {
      try {
        const json = JSON.parse(await zip.files[jsonFile].async('text'));
        const reportedSeed = json.seed ?? json.parameters?.seed ?? json.metadata?.seed;
        if (typeof reportedSeed === 'number' && Number.isFinite(reportedSeed)) actualSeed = reportedSeed;
      } catch { /* 固定响应中可能不带 JSON 元数据。 */ }
    }
    const composed = await composeImageEditResult(fileData, prepared);
    return { image: URL.createObjectURL(composed), blob: composed, seed: actualSeed, estimatedCost: binaryResult.estimatedCost, requestWidth: prepared.requestWidth, requestHeight: prepared.requestHeight, focusedGeometry: prepared.focusedGeometry };
  } catch (error) {
    terminalPhase = isQueueCancelledError(error) ? 'cancelled' : 'error';
    terminalError = error instanceof Error ? error.message : '图片编辑失败';
    throw error;
  } finally {
    requestFinished = true;
    if (terminalPhase === 'completed' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    await statusWatcher;
    if (queue.enabled) {
      emitCloudQueueStatus({ taskId: queueTaskId, phase: terminalPhase, error: terminalError, cancelable: false }, queueApiKey);
      scheduleCloudQueueStatusClear(queueTaskId, terminalPhase === 'error' ? 8000 : 5000, queueApiKey);
    }
  }
};

/** 使用 NovelAI SSE 中间帧；只有 final 事件才会作为可保存的生成结果返回。 */
export const generateImageStream = async (
  apiKey: string,
  prompt: string,
  negative: string,
  params: NAIParams,
  onPreview?: (preview: NaiStreamPreview) => void,
  runtimeStreamSupported = false,
) => {
  const runtime = await getNaiRuntimeConfig();
  const modelInfo = validateGenerationCapabilities(params, runtime);
  if (!modelInfo.supportsStreamedResponses && !runtimeStreamSupported) throw new Error(`NovelAI ${modelInfo.label} 暂不支持生成过程预览`);
  const payload = buildNaiGenerationPayload(prompt, negative, params, { stream: true, runtimeStreamSupported, runtime });
  const fallbackSeed = typeof payload.parameters.seed === 'number' ? payload.parameters.seed : undefined;
  let queue = getCachedCloudQueuePreferences();
  try { queue = await getCloudQueuePreferences(); } catch { /* 由真实生成请求触发统一解锁和错误处理。 */ }
  const taskId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const queueApiKey = apiKey.trim();
  let requestFinished = false;
  let terminalPhase: 'completed' | 'cancelled' | 'error' = 'error';
  let terminalError: string | undefined;
  let finalImage = '';
  let finalSeed = fallbackSeed;
  if (queue.enabled) emitCloudQueueStatus({ taskId, phase: 'preparing', cancelable: true }, queueApiKey);
  const statusWatcher = queue.enabled ? watchCloudQueueTask(taskId, () => requestFinished, queueApiKey) : Promise.resolve();
  try {
    const budgetKeyHash = await hashNaiApiKey(apiKey);
    let sseEstimatedCost: number | undefined;
    try {
      const sseResult = await api.postSse('/generate-stream', payload, {
        Authorization: `Bearer ${apiKey}`,
        ...(queue.enabled ? { 'X-Nai-Queue-Task-Id': taskId } : {}),
      }, ({ event, data }) => {
        if (!data || typeof data !== 'object') return;
        const eventData = data as { image?: unknown; step_ix?: unknown; seed?: unknown; message?: unknown };
        if (event === 'error') throw new Error(typeof eventData.message === 'string' ? eventData.message : '流式生成失败');
        if (typeof eventData.image !== 'string' || !eventData.image) return;
        const image = imageDataUri(eventData.image);
        if (event === 'intermediate') {
          onPreview?.({ image, step: typeof eventData.step_ix === 'number' ? eventData.step_ix + 1 : undefined });
        } else if (event === 'final') {
          finalImage = image;
          if (typeof eventData.seed === 'number' && Number.isFinite(eventData.seed)) finalSeed = eventData.seed;
          onPreview?.({ image, step: params.steps });
        }
      }, { budgetKeyHash });
      sseEstimatedCost = sseResult.estimatedCost;
    } catch (error) {
      // final 图片已经完整到达时，不得回退后再生成一次；保留成品并让额度刷新自行校准。
      if (!finalImage) throw error;
    }
    if (!finalImage) throw new Error('流式生成没有返回最终图片');
    terminalPhase = 'completed';
    const blob = blobFromDataUri(finalImage);
    return { image: URL.createObjectURL(blob), blob, seed: finalSeed, estimatedCost: sseEstimatedCost };
  } catch (error) {
    terminalPhase = isQueueCancelledError(error) ? 'cancelled' : 'error';
    terminalError = error instanceof Error ? error.message : '流式生成失败';
    if (queue.enabled) emitCloudQueueStatus({ taskId, phase: terminalPhase, error: terminalError, cancelable: false }, queueApiKey);
    throw error;
  } finally {
    requestFinished = true;
    if (terminalPhase === 'completed' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    }
    await statusWatcher;
    if (queue.enabled) {
      emitCloudQueueStatus({ taskId, phase: terminalPhase, error: terminalError, cancelable: false }, queueApiKey);
      scheduleCloudQueueStatusClear(taskId, terminalPhase === 'error' ? 8000 : 5000, queueApiKey);
    }
  }
};

/** 使用 NovelAI SSE 中间帧进行图片编辑（图生图 / 局部重绘 / 扩图）；成图后由 composeImageEditResult 合成回原图。 */
export const generateImageEditStream = async (
  apiKey: string,
  prompt: string,
  negative: string,
  params: NAIParams,
  edit: {
    operation: ImageEditOperation;
    image: string;
    mask?: string;
    strength: number;
    noise: number;
    focused?: boolean;
    focusedRect?: { x: number; y: number; width: number; height: number };
    minimumContextArea?: number;
  },
  onPreview?: (preview: NaiStreamPreview) => void,
  runtimeStreamSupported = false,
) => {
  const runtime = await getNaiRuntimeConfig();
  const prepared = await prepareImageEdit(edit);
  const requestParams: NAIParams = { ...params, width: prepared.requestWidth, height: prepared.requestHeight };
  const modelInfo = validateGenerationCapabilities(requestParams, runtime, edit.operation);
  if (!modelInfo.supportsStreamedResponses && !runtimeStreamSupported) {
    throw new Error(`NovelAI ${modelInfo.label} 暂不支持生成过程预览`);
  }
  const payload = buildNaiImageEditPayload(prompt, negative, requestParams, {
    ...edit,
    image: prepared.image,
    mask: prepared.mask,
    focused: edit.focused && edit.operation === 'inpaint',
    runtimeModels: runtime.models,
    runtime,
    stream: true,
    runtimeStreamSupported,
  });
  const payloadParameters = payload.parameters as Record<string, unknown>;
  const fallbackSeed = typeof payloadParameters.seed === 'number' ? payloadParameters.seed : undefined;
  let queue = getCachedCloudQueuePreferences();
  try { queue = await getCloudQueuePreferences(); } catch { /* 由真实生成请求触发统一解锁和错误处理。 */ }
  const taskId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const queueApiKey = apiKey.trim();
  let requestFinished = false;
  let terminalPhase: 'completed' | 'cancelled' | 'error' = 'error';
  let terminalError: string | undefined;
  let finalImage = '';
  let finalSeed = fallbackSeed;
  if (queue.enabled) emitCloudQueueStatus({ taskId, phase: 'preparing', cancelable: true }, queueApiKey);
  const statusWatcher = queue.enabled ? watchCloudQueueTask(taskId, () => requestFinished, queueApiKey) : Promise.resolve();
  try {
    const budgetKeyHash = await hashNaiApiKey(apiKey);
    let sseEstimatedCost: number | undefined;
    try {
      const sseResult = await api.postSse('/generate-stream', payload, {
        Authorization: `Bearer ${apiKey}`,
        ...(queue.enabled ? { 'X-Nai-Queue-Task-Id': taskId } : {}),
      }, ({ event, data }) => {
        if (!data || typeof data !== 'object') return;
        const eventData = data as { image?: unknown; step_ix?: unknown; seed?: unknown; message?: unknown };
        if (event === 'error') throw new Error(typeof eventData.message === 'string' ? eventData.message : '流式图片编辑失败');
        if (typeof eventData.image !== 'string' || !eventData.image) return;
        const image = imageDataUri(eventData.image);
        if (event === 'intermediate') {
          onPreview?.({ image, step: typeof eventData.step_ix === 'number' ? eventData.step_ix + 1 : undefined });
        } else if (event === 'final') {
          finalImage = image;
          if (typeof eventData.seed === 'number' && Number.isFinite(eventData.seed)) finalSeed = eventData.seed;
          onPreview?.({ image, step: params.steps });
        }
      }, { budgetKeyHash });
      sseEstimatedCost = sseResult.estimatedCost;
    } catch (error) {
      if (!finalImage) throw error;
    }
    if (!finalImage) throw new Error('流式图片编辑没有返回最终图片');
    terminalPhase = 'completed';
    const rawBlob = blobFromDataUri(finalImage);
    const composed = await composeImageEditResult(rawBlob, prepared);
    return {
      image: URL.createObjectURL(composed),
      blob: composed,
      seed: finalSeed,
      estimatedCost: sseEstimatedCost,
      requestWidth: prepared.requestWidth,
      requestHeight: prepared.requestHeight,
      focusedGeometry: prepared.focusedGeometry,
    };
  } catch (error) {
    terminalPhase = isQueueCancelledError(error) ? 'cancelled' : 'error';
    terminalError = error instanceof Error ? error.message : '流式图片编辑失败';
    if (queue.enabled) emitCloudQueueStatus({ taskId, phase: terminalPhase, error: terminalError, cancelable: false }, queueApiKey);
    throw error;
  } finally {
    requestFinished = true;
    if (terminalPhase === 'completed' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NOVELAI_USAGE_REFRESH_EVENT));
    }
    await statusWatcher;
    if (queue.enabled) {
      emitCloudQueueStatus({ taskId, phase: terminalPhase, error: terminalError, cancelable: false }, queueApiKey);
      scheduleCloudQueueStatusClear(taskId, terminalPhase === 'error' ? 8000 : 5000, queueApiKey);
    }
  }
};
