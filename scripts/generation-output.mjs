import JSZip from 'jszip';
import sharp from 'sharp';
import { parseHttpError } from '../services/httpErrors.mjs';

const IMAGE_LIMIT = 20 * 1024 * 1024;
const imageError = message => Object.assign(new Error(message), { code: 'generation_output_invalid' });

/** 后台任务只接受已上传的图片原料，不在保存阶段访问任意外部地址。 */
export const generationImageBytes = value => {
  const match = typeof value === 'string' && value.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match || match[2].length > Math.ceil(IMAGE_LIMIT / 3) * 4 + 1024) throw imageError('后台任务图片原料无效或过大');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > IMAGE_LIMIT) throw imageError('后台任务图片原料无效或过大');
  return { bytes, mime: match[1] };
};

/** 只认最终成图；SSE 已收齐 final 后连接/记账异常不能诱发再次生成。 */
export async function readGenerationResponse(response, onPreview) {
  if (!response.ok) {
    const error = parseHttpError(await response.text(), response.status, `生图请求失败 (${response.status})`);
    throw Object.assign(new Error(error.message), { code: error.code || 'generation_failed', status: response.status });
  }
  const estimated = response.headers.get('X-Nai-Anlas-Estimated-Spent');
  const result = {
    estimatedCost: estimated !== null && Number.isFinite(Number(estimated)) ? Number(estimated) : undefined,
    accountingFailed: response.headers.get('X-Nai-Anlas-Accounting-Failed') === '1',
    cleanupError: response.headers.get('X-Nai-Queue-Cleanup-Failed') === '1' ? '公共队列退出或释放失败，请检查队列状态' : undefined,
  };
  const accountingDetail = response.headers.get('X-Nai-Anlas-Accounting-Error');
  if (result.accountingFailed && accountingDetail) {
    try { result.accountingError = decodeURIComponent(accountingDetail).slice(0, 240); } catch { /* 旧端或损坏详情仍保留异常标记。 */ }
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const filename = Object.keys(zip.files).find(name => !zip.files[name].dir && /\.(?:png|jpe?g|webp)$/i.test(name));
    if (!filename) throw imageError('生图响应没有最终图片');
    const entry = zip.files[filename];
    if (entry._data?.uncompressedSize > IMAGE_LIMIT) throw imageError('生图响应图片过大');
    const bytes = await entry.async('uint8array');
    result.bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (result.bytes.length > IMAGE_LIMIT) throw imageError('生图响应图片过大');
    result.mime = /\.jpe?g$/i.test(filename) ? 'image/jpeg' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/png';
    const metadataName = Object.keys(zip.files).find(name => !zip.files[name].dir && /\.json$/i.test(name));
    if (metadataName) {
      try {
        const metadata = JSON.parse(await zip.files[metadataName].async('string'));
        const seed = metadata.seed ?? metadata.parameters?.seed ?? metadata.metadata?.seed;
        if (Number.isFinite(seed)) result.seed = seed;
      } catch { /* 请求种子仍可复现，损坏的附属 JSON 不丢弃成图。 */ }
    }
    return result;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', finalImage = '', finalSeed, streamError, usageReceived = false;
  const frame = text => {
    const lines = text.split(/\r?\n/), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const encoded = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!encoded) return;
    if (!['intermediate', 'final', 'error', 'nai_usage', 'nai_usage_error', 'nai_queue_cleanup_error'].includes(event)) return;
    let data;
    try { data = JSON.parse(encoded); } catch { throw imageError('流式生图响应数据损坏'); }
    if (event === 'error') { const error = parseHttpError(encoded, undefined, '流式生图失败'); streamError = Object.assign(new Error(error.message), { code: error.code || 'generation_failed' }); }
    if (event === 'nai_usage' && data && typeof data === 'object') {
      // 状态与费用放在同一回执，避免断流恰好截掉后续错误帧时误认成功。
      usageReceived = typeof data.accountingFailed === 'boolean';
      if (data.accountingFailed === true) {
        result.accountingFailed = true;
        result.accountingError = typeof data.accountingError === 'string' ? data.accountingError.slice(0, 240) : '本地用量记录未完整保存';
      }
      result.estimatedCost = Number.isFinite(data.estimatedSpent) && data.estimatedSpent >= 0 ? data.estimatedSpent : result.estimatedCost;
    }
    if (event === 'nai_usage_error') {
      result.accountingFailed = true;
      result.accountingError = typeof data?.message === 'string' ? data.message.slice(0, 240) : '本地用量记录未完整保存';
    }
    if (event === 'nai_queue_cleanup_error') result.cleanupError = data.message || '公共队列退出或释放失败，请检查队列状态';
    if ((event === 'intermediate' || event === 'final') && typeof data.image === 'string' && data.image) {
      const image = data.image.startsWith('data:image/') ? data.image : `data:${data.image.replace(/\s/g, '').startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${data.image}`;
      onPreview?.({ image, ...(Number.isFinite(data.step_ix) ? { step: data.step_ix + 1 } : {}) });
      if (event === 'final') { finalImage = image; finalSeed = data.seed; }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > IMAGE_LIMIT * 2) throw imageError('流式生图响应过大');
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
        frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + separator.length);
      }
      if (done) { if (buffer.trim()) frame(buffer); break; }
    }
  } catch (error) {
    if (!finalImage) throw error;
    // 成功回执之后的收尾断流不推翻记账；未拿到回执才保持未知告警。
    if (!usageReceived && !result.accountingFailed) {
      result.accountingFailed = true;
      result.accountingError = '图片已收齐，但连接中断，未收到本地记账回执';
    }
  } finally { reader.releaseLock(); }
  if (!finalImage) throw streamError || imageError('流式响应没有最终图片');
  const { bytes, mime } = generationImageBytes(finalImage);
  return { ...result, bytes, mime, ...(Number.isFinite(finalSeed) ? { seed: finalSeed } : {}) };
}

/** 按前端已经生成的羽化蒙版回贴，保留选区之外像素及透明度。 */
export async function composeGenerationOutput(bytes, composition) {
  if (!composition) return { bytes, mime: undefined };
  const base = await sharp(generationImageBytes(composition.originalImage).bytes, { limitInputPixels: 16_777_216 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = base.info;
  if (channels !== 4) throw imageError('后台回贴底图通道无效');
  const crop = composition.focusedGeometry?.crop || { x: 0, y: 0, width, height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width || crop.y + crop.height > height) throw imageError('后台回贴选区超出原图');
  const resize = { width: crop.width, height: crop.height, fit: 'fill', kernel: 'lanczos3' };
  const generated = await sharp(bytes, { limitInputPixels: 16_777_216 }).ensureAlpha().resize(resize).raw().toBuffer();
  const mask = await sharp(generationImageBytes(composition.compositeMask).bytes, { limitInputPixels: 16_777_216 }).ensureAlpha().resize(resize).raw().toBuffer();
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const input = (y * crop.width + x) * 4, output = ((crop.y + y) * width + crop.x + x) * 4;
    const weight = mask[input + 3] / 255;
    if (!weight) continue;
    const baseAlpha = base.data[output + 3] / 255 * (1 - weight), generatedAlpha = generated[input + 3] / 255 * weight;
    const alpha = baseAlpha + generatedAlpha;
    for (let channel = 0; channel < 3; channel++) base.data[output + channel] = alpha ? Math.round((base.data[output + channel] * baseAlpha + generated[input + channel] * generatedAlpha) / alpha) : 0;
    base.data[output + 3] = Math.round(alpha * 255);
  }
  return { bytes: await sharp(base.data, { raw: { width, height, channels: 4 } }).png().toBuffer(), mime: 'image/png' };
}

export function generationHistoryForm(output, metadata, editMask) {
  const form = new FormData();
  form.append('image', new Blob([output.bytes], { type: output.mime || 'image/png' }), 'generation.' + (output.mime === 'image/jpeg' ? 'jpg' : output.mime === 'image/webp' ? 'webp' : 'png'));
  if (editMask) {
    const mask = generationImageBytes(editMask);
    form.append('editMask', new Blob([mask.bytes], { type: mask.mime }), 'edit-mask.png');
  }
  form.append('metadata', JSON.stringify(metadata));
  return form;
}
