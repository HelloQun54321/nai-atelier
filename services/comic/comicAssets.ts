import type { ComicBubbleItem } from './comicTypes';

export type ComicCustomAssetKind = 'bubble' | 'image';

export interface ComicCustomAssetPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ComicCustomAsset {
  id: string;
  kind: ComicCustomAssetKind;
  name: string;
  url: string;
  r2Key?: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  textPadding?: ComicCustomAssetPadding;
  createdAt: number;
  updatedAt?: number;
  /** 后端不可达时的当前会话临时兜底标记 */
  localOnly?: boolean;
}

export const COMIC_CUSTOM_ASSET_ACCEPT = 'image/png,image/webp,image/gif,image/jpeg,image/svg+xml,.png,.webp,.gif,.jpg,.jpeg,.svg';

// 当后端路由暂不可达时，暂存在当前浏览器会话中立即可用
const sessionCustomAssets: ComicCustomAsset[] = [];

const mergeAssetsWithSession = (remote: ComicCustomAsset[]): ComicCustomAsset[] => {
  if (sessionCustomAssets.length === 0) return remote;
  const ids = new Set(remote.map(a => a.id));
  return [...sessionCustomAssets.filter(a => !ids.has(a.id)), ...remote];
};

/** 从 SVG 文本中解析 width/height 或 viewBox 宽高。 */
export const parseSvgViewBoxSize = (svgText: string): { width: number; height: number } | null => {
  if (!svgText) return null;
  const openTagMatch = svgText.match(/<svg\b([^>]*)>/i);
  if (!openTagMatch) return null;
  const attrs = openTagMatch[1] || '';

  const parsePx = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const match = raw.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const wAttr = attrs.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1];
  const hAttr = attrs.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1];
  const wPx = parsePx(wAttr);
  const hPx = parsePx(hAttr);
  if (wPx && hPx) {
    return { width: Math.round(wPx), height: Math.round(hPx) };
  }

  const vbMatch = attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  return null;
};

export const readImageFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('读取图片文件失败'));
  reader.readAsDataURL(file);
});

export const readImageDimensionsFromUrl = (url: string): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  if (typeof Image === 'undefined') {
    reject(new Error('无图像解码环境'));
    return;
  }
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (w > 0 && h > 0) resolve({ width: w, height: h });
    else reject(new Error('图片尺寸无效'));
  };
  img.onerror = () => reject(new Error('图片解码失败'));
  img.src = url;
});

/** 读取图片文件的真实宽高（SVG 先读 viewBox/属性，光栅图用 Image 解码，保留透明底图原始比例）。 */
export const readImageFileDimensions = async (
  file: File,
  preloadedDataUrl?: string,
): Promise<{ width: number; height: number }> => {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    try {
      const text = await file.text();
      const parsed = parseSvgViewBoxSize(text);
      if (parsed) return parsed;
    } catch {
      // 忽略继续尝试 Image 解码
    }
  }

  try {
    const src = preloadedDataUrl || (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(file)
      : await readImageFileAsDataUrl(file));
    try {
      return await readImageDimensionsFromUrl(src);
    } finally {
      if (!preloadedDataUrl && src.startsWith('blob:') && typeof URL !== 'undefined') {
        URL.revokeObjectURL(src);
      }
    }
  } catch {
    return { width: 512, height: 512 };
  }
};

/**
 * 根据原图宽高与漫画纸张尺寸计算画布归一化宽高（保持原图真实长宽比，不拉扁）。
 */
export const computeNormalizedAssetBox = (
  naturalW: number,
  naturalH: number,
  pageW: number,
  pageH: number,
  maxSpan = 0.45,
): { width: number; height: number } => {
  const safeW = Math.max(1, naturalW || 1);
  const safeH = Math.max(1, naturalH || 1);
  const safePageW = Math.max(1, pageW || 1);
  const safePageH = Math.max(1, pageH || 1);
  const imgAspect = safeW / safeH;
  const pageAspect = safePageW / safePageH;
  const normAspect = imgAspect / pageAspect;

  let width: number;
  let height: number;
  if (normAspect >= 1) {
    width = maxSpan;
    height = width / normAspect;
  } else {
    height = maxSpan;
    width = height * normAspect;
  }

  return {
    width: Math.min(0.85, Math.max(0.08, Number(width.toFixed(3)))),
    height: Math.min(0.85, Math.max(0.08, Number(height.toFixed(3)))),
  };
};

/**
 * 统一计算气泡内嵌字安全区矩形（Canvas 2D 导出与画布 SVG 预览共用同一套算法）。
 * - 内置矢量气泡保持原 `rx * 1.54 / ry * 1.54` 安全区行为不变；
 * - 自定义图片气泡支持可调 `textInsetX/Y`（默认 0.14）与 `textOffsetX/Y`（默认 0）。
 */
export const resolveBubbleTextBox = (
  bubble: Pick<ComicBubbleItem, 'customImageUrl' | 'textInsetX' | 'textInsetY' | 'textOffsetX' | 'textOffsetY'>,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): { x: number; y: number; width: number; height: number; cx: number; cy: number } => {
  if (!bubble.customImageUrl) {
    const width = Math.max(12, rx * 1.54);
    const height = Math.max(12, ry * 1.54);
    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      cx,
      cy,
    };
  }

  const fullW = Math.max(16, rx * 2);
  const fullH = Math.max(16, ry * 2);
  const insetX = Math.max(0.04, Math.min(0.4, Number.isFinite(bubble.textInsetX) ? Number(bubble.textInsetX) : 0.14));
  const insetY = Math.max(0.04, Math.min(0.4, Number.isFinite(bubble.textInsetY) ? Number(bubble.textInsetY) : 0.14));
  const offsetX = Math.max(-0.3, Math.min(0.3, Number.isFinite(bubble.textOffsetX) ? Number(bubble.textOffsetX) : 0));
  const offsetY = Math.max(-0.3, Math.min(0.3, Number.isFinite(bubble.textOffsetY) ? Number(bubble.textOffsetY) : 0));

  const width = Math.max(16, fullW * (1 - insetX * 2));
  const height = Math.max(16, fullH * (1 - insetY * 2));
  const boxCx = cx + fullW * offsetX;
  const boxCy = cy + fullH * offsetY;
  return {
    x: boxCx - width / 2,
    y: boxCy - height / 2,
    width,
    height,
    cx: boxCx,
    cy: boxCy,
  };
};

export const fetchComicAssets = async (): Promise<ComicCustomAsset[]> => {
  try {
    const res = await fetch('/api/comic-assets', { credentials: 'include' });
    if (!res.ok) return [...sessionCustomAssets];
    const data = await res.json() as { assets?: ComicCustomAsset[] };
    const remote = Array.isArray(data.assets) ? data.assets : [];
    return mergeAssetsWithSession(remote);
  } catch {
    return [...sessionCustomAssets];
  }
};

export const uploadComicAsset = async (
  file: File,
  kind: ComicCustomAssetKind,
  options: { name?: string } = {},
): Promise<{ asset: ComicCustomAsset; assets: ComicCustomAsset[] }> => {
  const [arrayBuffer, dims] = await Promise.all([
    file.arrayBuffer(),
    readImageFileDimensions(file),
  ]);

  const cleanName = (options.name || file.name)
    .replace(/\.(png|webp|gif|jpe?g|svg)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48) || (kind === 'bubble' ? '自定义气泡' : '自定义图片');

  try {
    const res = await fetch('/api/comic-assets', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Asset-Kind': kind,
        'X-Asset-Filename': encodeURIComponent(file.name),
        'X-Asset-Name': encodeURIComponent(cleanName),
        'X-Asset-Width': String(dims.width),
        'X-Asset-Height': String(dims.height),
      },
      body: arrayBuffer,
    });
    if (res.ok) {
      const data = await res.json() as { asset: ComicCustomAsset; assets: ComicCustomAsset[] };
      return {
        asset: data.asset,
        assets: mergeAssetsWithSession(Array.isArray(data.assets) ? data.assets : [data.asset]),
      };
    }
    if (res.status !== 404 && res.status !== 502 && res.status !== 503) {
      const errData = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error || `上传素材失败（HTTP ${res.status}）`);
    }
  } catch (error) {
    if (error instanceof Error && /仅支持|上限|为空|访客/.test(error.message)) {
      throw error;
    }
  }

  // 后端未联通时的离线会话兜底（保持当次浏览可用）
  const dataUrl = await readImageFileAsDataUrl(file);
  const localAsset: ComicCustomAsset = {
    id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    name: cleanName,
    url: dataUrl,
    mimeType: file.type || 'image/png',
    width: dims.width,
    height: dims.height,
    sizeBytes: file.size,
    createdAt: Date.now(),
    localOnly: true,
  };
  sessionCustomAssets.unshift(localAsset);
  return { asset: localAsset, assets: [...sessionCustomAssets] };
};

export const uploadComicAssetsBatch = async (
  files: File[],
  kind: ComicCustomAssetKind,
): Promise<{ imported: ComicCustomAsset[]; failed: Array<{ filename: string; error: string }>; assets: ComicCustomAsset[] }> => {
  const imported: ComicCustomAsset[] = [];
  const failed: Array<{ filename: string; error: string }> = [];
  let latestAssets: ComicCustomAsset[] | null = null;

  for (const file of files) {
    try {
      const res = await uploadComicAsset(file, kind);
      imported.push(res.asset);
      latestAssets = res.assets;
    } catch (error) {
      failed.push({
        filename: file.name,
        error: error instanceof Error ? error.message : '导入失败',
      });
    }
  }

  return {
    imported,
    failed,
    assets: latestAssets || await fetchComicAssets(),
  };
};

export const renameComicAsset = async (id: string, name: string): Promise<ComicCustomAsset[]> => {
  const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, 48);
  if (!cleanName) throw new Error('素材名称不能为空');

  const localTarget = sessionCustomAssets.find(a => a.id === id);
  if (localTarget) {
    localTarget.name = cleanName;
    localTarget.updatedAt = Date.now();
    return fetchComicAssets();
  }

  const res = await fetch(`/api/comic-assets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: cleanName }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; assets?: ComicCustomAsset[] };
  if (!res.ok) throw new Error(data.error || `重命名素材失败（HTTP ${res.status}）`);
  return mergeAssetsWithSession(Array.isArray(data.assets) ? data.assets : []);
};

export const deleteComicAsset = async (id: string): Promise<ComicCustomAsset[]> => {
  const localIdx = sessionCustomAssets.findIndex(a => a.id === id);
  if (localIdx >= 0) {
    sessionCustomAssets.splice(localIdx, 1);
    return fetchComicAssets();
  }

  const res = await fetch(`/api/comic-assets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({})) as { error?: string; assets?: ComicCustomAsset[] };
  if (!res.ok) throw new Error(data.error || `删除素材失败（HTTP ${res.status}）`);
  return mergeAssetsWithSession(Array.isArray(data.assets) ? data.assets : []);
};
