import { buildMediaUrl } from './mobileImageCache';

/**
 * Danbooru 固定封面导入：通过本机 /api/media 链路读取原图，转成 data URL 交给 Worker 上传。
 *
 * 不再让 Cloudflare Worker 直接抓取 cdn.donmai.us（上游会对 Worker 出口返回 403）；
 * 本机媒体网关已被验证可以正常下载同一 URL。
 */

const ALLOWED_HOSTNAME = 'cdn.donmai.us';
/** 与 Worker 的 MAX_MANAGED_IMAGE_BYTES 保持一致 */
const MAX_COVER_BYTES = 12 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
};
const FETCH_TIMEOUT_MS = 20_000;

/**
 * 读取 Danbooru sample 原图（variant=original），返回 data:image/...;base64,...。
 * 不做 canvas 重绘、不转码、不压缩；仅校验来源、响应类型与大小。
 */
export const importDanbooruCoverAsDataUrl = async (sampleUrl: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(sampleUrl);
  } catch {
    throw new Error('封面图片地址无效');
  }
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOSTNAME || url.username || url.password) {
    throw new Error('封面图片地址不是受信任的 Danbooru 来源');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildMediaUrl(url.toString(), 'original'), { signal: controller.signal });
  } catch {
    throw new Error('无法通过本机图片服务读取这张 Danbooru 图片（网络错误或请求超时）');
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`无法通过本机图片服务读取这张 Danbooru 图片（HTTP ${response.status}）`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES[contentType]) {
    throw new Error('图片响应格式不是 PNG、JPEG 或 WebP');
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_COVER_BYTES) {
    throw new Error('封面图片超过 12MB');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('封面图片内容为空');
  if (blob.size > MAX_COVER_BYTES) throw new Error('封面图片超过 12MB');

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取封面图片失败'));
    reader.readAsDataURL(blob);
  });
};
