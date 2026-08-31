import { CharacterParams, ImageEditCanvasExpansion, ImageEditOperation } from '../types';

export const IMAGE_EDIT_MODEL_SUFFIX = '-inpainting';
export const IMAGE_EDIT_MIN_DIMENSION = 64;
export const IMAGE_EDIT_MAX_DIMENSION = 4096;
export const IMAGE_EDIT_MAX_AREA = 4_194_304;
export const IMAGE_EDIT_SUPPORTED_SAMPLERS = new Set([
  'k_euler_ancestral', 'k_euler',
  'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde',
]);
export const IMAGE_EDIT_FOCUSED_MIN_CONTEXT = 32;
export const IMAGE_EDIT_FOCUSED_MAX_CONTEXT = 96;
export const IMAGE_EDIT_FOCUSED_CONTEXT_STEP = 8;

/** 兼容旧版 0–1 百分比设置，并统一到官方 32–96 像素步进。 */
export const normalizeMinimumContextArea = (value: number | undefined) => {
  const numeric = Number(value);
  const pixels = Number.isFinite(numeric) && numeric >= 0 && numeric <= 1
    ? IMAGE_EDIT_FOCUSED_MIN_CONTEXT + numeric * (IMAGE_EDIT_FOCUSED_MAX_CONTEXT - IMAGE_EDIT_FOCUSED_MIN_CONTEXT)
    : numeric;
  if (!Number.isFinite(pixels)) return 64;
  const stepped = Math.round((pixels - IMAGE_EDIT_FOCUSED_MIN_CONTEXT) / IMAGE_EDIT_FOCUSED_CONTEXT_STEP) * IMAGE_EDIT_FOCUSED_CONTEXT_STEP + IMAGE_EDIT_FOCUSED_MIN_CONTEXT;
  return Math.max(IMAGE_EDIT_FOCUSED_MIN_CONTEXT, Math.min(IMAGE_EDIT_FOCUSED_MAX_CONTEXT, stepped));
};

export const IMAGE_EDIT_FOCUSED_MAX_SELECTION_AREA = 589_824;
export const IMAGE_EDIT_TARGET_AREA = 1_048_576;

export interface ImageEditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEditFocusedGeometry {
  crop: ImageEditRect;
  inner: ImageEditRect;
  requestWidth: number;
  requestHeight: number;
  fullSizeMask: boolean;
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

/** 将整张底图上的角色中心换算为 Focused 局部请求画布中的 0–1 坐标。 */
export const transformCharacterCoordinatesForFocused = (
  characters: CharacterParams[] | undefined,
  geometry: ImageEditFocusedGeometry,
  sourceWidth: number,
  sourceHeight: number,
): CharacterParams[] | undefined => {
  if (!characters) return undefined;
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  return characters.map(character => ({
    ...character,
    x: clampUnit((Number(character.x) * width - geometry.crop.x) / Math.max(1, geometry.crop.width)),
    y: clampUnit((Number(character.y) * height - geometry.crop.y) / Math.max(1, geometry.crop.height)),
  }));
};

/** 扩图后把角色中心从旧画布坐标换算到新画布坐标。 */
export const transformCharacterCoordinatesForOutpaint = (
  characters: CharacterParams[] | undefined,
  sourceWidth: number,
  sourceHeight: number,
  expansion: ImageEditCanvasExpansion,
): CharacterParams[] | undefined => {
  if (!characters) return undefined;
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const top = Math.max(0, Math.floor(Number(expansion.top) || 0));
  const left = Math.max(0, Math.floor(Number(expansion.left) || 0));
  const nextWidth = width + left + Math.max(0, Math.floor(Number(expansion.right) || 0));
  const nextHeight = height + top + Math.max(0, Math.floor(Number(expansion.bottom) || 0));
  return characters.map(character => ({
    ...character,
    x: clampUnit((Number(character.x) * width + left) / Math.max(1, nextWidth)),
    y: clampUnit((Number(character.y) * height + top) / Math.max(1, nextHeight)),
  }));
};

const clampRect = (width: number, height: number, rect: ImageEditRect): ImageEditRect => {
  const x = Math.max(0, Math.min(Math.floor(width - 1), Math.floor(rect.x)));
  const y = Math.max(0, Math.min(Math.floor(height - 1), Math.floor(rect.y)));
  const right = Math.max(x + 1, Math.min(width, Math.ceil(rect.x + rect.width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(rect.y + rect.height)));
  return { x, y, width: right - x, height: bottom - y };
};

export type ImageEditNormalizationMode = 'crop' | 'contain' | 'stretch';

export interface ImageEditNormalizationTarget {
  width: number;
  height: number;
}

/**
 * 返回编辑接口可接受的最近画布尺寸。
 * 不会无故放大合法图片；超出单边或总面积上限时先按比例缩小，再向下对齐到 64。
 */
export const getImageEditNormalizationTarget = (width: number, height: number): ImageEditNormalizationTarget => {
  const sourceWidth = Math.max(1, Math.floor(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.floor(Number(height) || 1));
  if (!validateImageEditDimensions(sourceWidth, sourceHeight)) return { width: sourceWidth, height: sourceHeight };

  const scale = Math.min(
    1,
    IMAGE_EDIT_MAX_DIMENSION / sourceWidth,
    IMAGE_EDIT_MAX_DIMENSION / sourceHeight,
    Math.sqrt(IMAGE_EDIT_MAX_AREA / (sourceWidth * sourceHeight)),
  );
  let targetWidth = Math.max(IMAGE_EDIT_MIN_DIMENSION, Math.floor(sourceWidth * scale / IMAGE_EDIT_MIN_DIMENSION) * IMAGE_EDIT_MIN_DIMENSION);
  let targetHeight = Math.max(IMAGE_EDIT_MIN_DIMENSION, Math.floor(sourceHeight * scale / IMAGE_EDIT_MIN_DIMENSION) * IMAGE_EDIT_MIN_DIMENSION);
  targetWidth = Math.min(IMAGE_EDIT_MAX_DIMENSION, targetWidth);
  targetHeight = Math.min(IMAGE_EDIT_MAX_DIMENSION, targetHeight);
  while (targetWidth * targetHeight > IMAGE_EDIT_MAX_AREA) {
    if (targetWidth >= targetHeight && targetWidth > IMAGE_EDIT_MIN_DIMENSION) targetWidth -= IMAGE_EDIT_MIN_DIMENSION;
    else if (targetHeight > IMAGE_EDIT_MIN_DIMENSION) targetHeight -= IMAGE_EDIT_MIN_DIMENSION;
    else break;
  }
  return { width: targetWidth, height: targetHeight };
};

/** 保持比例居中裁剪时，源图中真正会被使用的矩形。 */
export const getCenteredImageEditCrop = (sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): ImageEditRect => {
  const sourceRatio = sourceWidth / Math.max(1, sourceHeight);
  const targetRatio = targetWidth / Math.max(1, targetHeight);
  if (sourceRatio > targetRatio) {
    const cropWidth = sourceHeight * targetRatio;
    return { x: (sourceWidth - cropWidth) / 2, y: 0, width: cropWidth, height: sourceHeight };
  }
  const cropHeight = sourceWidth / Math.max(0.0001, targetRatio);
  return { x: 0, y: (sourceHeight - cropHeight) / 2, width: sourceWidth, height: cropHeight };
};

/** 完整适配时，源图在目标画布中的等比放置矩形。 */
export const getContainedImageEditRect = (sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): ImageEditRect => {
  const scale = Math.min(targetWidth / Math.max(1, sourceWidth), targetHeight / Math.max(1, sourceHeight));
  const fitWidth = sourceWidth * scale;
  const fitHeight = sourceHeight * scale;
  return { x: (targetWidth - fitWidth) / 2, y: (targetHeight - fitHeight) / 2, width: fitWidth, height: fitHeight };
};

/** 将 Focused 选区限制在官方当前的原始面积上限内。 */
export const limitFocusedImageEditRect = (width: number, height: number, rect: ImageEditRect): ImageEditRect => {
  const limited = clampRect(width, height, rect);
  if (limited.width * limited.height <= IMAGE_EDIT_FOCUSED_MAX_SELECTION_AREA) return limited;
  const scale = Math.sqrt(IMAGE_EDIT_FOCUSED_MAX_SELECTION_AREA / (limited.width * limited.height));
  return {
    ...limited,
    width: Math.min(Math.max(1, Math.floor(limited.width * scale)), width - limited.x),
    height: Math.min(Math.max(1, Math.floor(limited.height * scale)), height - limited.y),
  };
};

/**
 * 复刻 NovelAI Web 的 Focused 选区尺寸策略：选区最多约 768²，
 * 生成画布按 64 倍数放大到尽量接近 1MP。上下文只作为选区内部的安全边界，
 * 不会把边界外区域误标为需要重绘的内容。
 */
export const getFocusedImageEditGeometry = (
  width: number,
  height: number,
  focusedRect: ImageEditRect,
  minimumContextArea: number | undefined,
): ImageEditFocusedGeometry => {
  const crop = limitFocusedImageEditRect(width, height, focusedRect);
  const context = normalizeMinimumContextArea(minimumContextArea);
  const inset = Math.min(context, Math.floor((Math.min(crop.width, crop.height) - 2) / 2));
  const inner = {
    x: crop.x + Math.max(0, inset),
    y: crop.y + Math.max(0, inset),
    width: Math.max(1, crop.width - Math.max(0, inset) * 2),
    height: Math.max(1, crop.height - Math.max(0, inset) * 2),
  };
  const scale = Math.sqrt(IMAGE_EDIT_TARGET_AREA / Math.max(1, crop.width * crop.height));
  let requestWidth = Math.max(64, Math.floor(crop.width * scale / 64) * 64);
  let requestHeight = Math.max(64, Math.floor(crop.height * scale / 64) * 64);
  while (requestWidth * requestHeight > IMAGE_EDIT_TARGET_AREA) {
    if (requestWidth >= requestHeight && requestWidth > 64) requestWidth -= 64;
    else if (requestHeight > 64) requestHeight -= 64;
    else break;
  }
  return { crop, inner, requestWidth, requestHeight, fullSizeMask: false };
};

export const imageEditRequestDimensions = (
  width: number,
  height: number,
  operation: ImageEditOperation,
  focused: boolean,
  focusedRect?: ImageEditRect | null,
  minimumContextArea?: number,
) => {
  if (operation === 'inpaint' && focused && focusedRect) {
    const geometry = getFocusedImageEditGeometry(width, height, focusedRect, minimumContextArea);
    return { width: geometry.requestWidth, height: geometry.requestHeight };
  }
  return { width, height };
};

export interface ImageEditCanvasResult {
  image: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  width: number;
  height: number;
}

export const clampImageEditValue = (value: number, fallback: number, minimum: number, maximum: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
};

export const validateImageEditDimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return '图片尺寸必须是整数';
  if (width < IMAGE_EDIT_MIN_DIMENSION || height < IMAGE_EDIT_MIN_DIMENSION) return '图片尺寸不能小于 64 像素';
  if (width > IMAGE_EDIT_MAX_DIMENSION || height > IMAGE_EDIT_MAX_DIMENSION) return '单边尺寸不能超过 4096 像素';
  if (width % IMAGE_EDIT_MIN_DIMENSION !== 0 || height % IMAGE_EDIT_MIN_DIMENSION !== 0) return '图片宽高必须是 64 的倍数';
  if (width * height > IMAGE_EDIT_MAX_AREA) return '图片总像素不能超过 4,194,304';
  return null;
};

export const resolveImageEditModel = (model: string | undefined, runtimeModels: string[]) => {
  const baseModel = String(model || '').trim() || 'nai-diffusion-4-5-full';
  const candidate = baseModel.endsWith(IMAGE_EDIT_MODEL_SUFFIX) ? baseModel : `${baseModel}${IMAGE_EDIT_MODEL_SUFFIX}`;
  if (runtimeModels.includes(candidate)) return candidate;
  throw new Error(`当前模型不支持图像编辑：${baseModel}`);
};

export const validateImageEditSampler = (sampler: string) => {
  const normalized = String(sampler || '').trim();
  if (!IMAGE_EDIT_SUPPORTED_SAMPLERS.has(normalized) && !normalized.startsWith('k_')) throw new Error(`当前采样器不支持图像编辑：${sampler || '未设置'}`);
};

export const stripDataUrl = (value: string) => String(value || '').replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i, '').replace(/\s+/g, '');

export const dataUrlToBlob = async (value: string) => {
  const response = await fetch(value);
  if (!response.ok) throw new Error('读取底图失败');
  return response.blob();
};

export const canvasToDataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png');

export const createOutpaintCanvas = async (source: Blob, expansion: ImageEditCanvasExpansion): Promise<ImageEditCanvasResult> => {
  const bitmap = await createImageBitmap(source);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const top = Math.max(0, Math.floor(expansion.top));
  const right = Math.max(0, Math.floor(expansion.right));
  const bottom = Math.max(0, Math.floor(expansion.bottom));
  const left = Math.max(0, Math.floor(expansion.left));
  const width = sourceWidth + left + right;
  const height = sourceHeight + top + bottom;
  const dimensionError = validateImageEditDimensions(width, height);
  if (dimensionError) {
    bitmap.close();
    throw new Error(dimensionError);
  }
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  const imageContext = image.getContext('2d');
  if (!imageContext) {
    bitmap.close();
    throw new Error('无法创建扩图画布');
  }

  // 边缘像元夹取延伸（Clamp-to-edge Replication）：使扩图区域的 VAE 初值与原图边缘色调自然接续，消除纯白底色导致的潜空间高频断崖与条纹
  if (top > 0) imageContext.drawImage(bitmap, 0, 0, sourceWidth, 1, left, 0, sourceWidth, top);
  if (bottom > 0) imageContext.drawImage(bitmap, 0, sourceHeight - 1, sourceWidth, 1, left, top + sourceHeight, sourceWidth, bottom);
  if (left > 0) imageContext.drawImage(bitmap, 0, 0, 1, sourceHeight, 0, top, left, sourceHeight);
  if (right > 0) imageContext.drawImage(bitmap, sourceWidth - 1, 0, 1, sourceHeight, left + sourceWidth, top, right, sourceHeight);
  if (top > 0 && left > 0) imageContext.drawImage(bitmap, 0, 0, 1, 1, 0, 0, left, top);
  if (top > 0 && right > 0) imageContext.drawImage(bitmap, sourceWidth - 1, 0, 1, 1, left + sourceWidth, 0, right, top);
  if (bottom > 0 && left > 0) imageContext.drawImage(bitmap, 0, sourceHeight - 1, 1, 1, 0, top + sourceHeight, left, bottom);
  if (bottom > 0 && right > 0) imageContext.drawImage(bitmap, sourceWidth - 1, sourceHeight - 1, 1, 1, left + sourceWidth, top + sourceHeight, right, bottom);

  imageContext.drawImage(bitmap, left, top);
  bitmap.close();

  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext('2d');
  if (!maskContext) throw new Error('无法创建扩图蒙版');
  maskContext.fillStyle = '#ffffff';
  maskContext.fillRect(0, 0, width, height);
  maskContext.clearRect(left, top, sourceWidth, sourceHeight);
  return { image, mask, width, height };
};

export const buildImageEditParameters = (operation: ImageEditOperation, image: string, mask: string | undefined, strength: number, noise: number, focused: boolean, minimumContextArea?: number) => ({
  image: stripDataUrl(image),
  ...(mask ? { mask: stripDataUrl(mask) } : {}),
  ...(operation === 'image-to-image' ? { strength } : { img2img: { strength }, inpaintImg2ImgStrength: strength }),
  noise,
  // 严格对齐 NovelAI 官方 Web 端 generateInfill 规范：Infill/Outpaint 模式必须为 false，避免服务端基于 1/8 粗糙二值蒙版硬回贴产生切块伪影；图生图则保持 true
  add_original_image: operation === 'image-to-image',
  ...(focused && operation === 'inpaint' ? { _local_focused_inpainting: true, _local_minimum_context_area: normalizeMinimumContextArea(minimumContextArea) } : {}),
});

const createCanvas = (width: number, height: number) => {
  if (typeof document === 'undefined') throw new Error('当前环境不支持图片编辑画布');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/png') => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败')), type);
});

const loadBitmap = async (value: Blob | string): Promise<ImageBitmap> => {
  const blob = typeof value === 'string' ? await dataUrlToBlob(value) : value;
  return createImageBitmap(blob);
};

const buildThresholdMask = (source: CanvasImageSource, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => {
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建蒙版画布');
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
  const image = context.getImageData(0, 0, targetWidth, targetHeight);
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    const red = image.data[index];
    const active = alpha > 155 || (alpha > 0 && red >= 155);
    const value = active ? 255 : 0;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

/** 官方 1/8 潜空间蒙版膨胀算法（半径 4 像素，对应原图 32 像素重叠带） */
const dilateBinaryMask = (source: Uint8ClampedArray, width: number, height: number, radius = 4) => {
  const output = new Uint8ClampedArray(source.length);
  for (let i = 0; i < output.length; i += 4) output[i + 3] = 255;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (source[(y * width + x) * 4] === 255) {
        const minY = Math.max(0, y - radius);
        const maxY = Math.min(height - 1, y + radius);
        const minX = Math.max(0, x - radius);
        const maxX = Math.min(width - 1, x + radius);
        for (let ny = minY; ny <= maxY; ny += 1) {
          for (let nx = minX; nx <= maxX; nx += 1) {
            const idx = (ny * width + nx) * 4;
            output[idx] = 255;
            output[idx + 1] = 255;
            output[idx + 2] = 255;
          }
        }
      }
    }
  }
  return output;
};

/** 8 倍最近邻放大至原图分辨率 */
const scaleUpMask8x = (source: Uint8ClampedArray, srcWidth: number, srcHeight: number, targetWidth: number, targetHeight: number) => {
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.floor(y / 8));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x / 8));
      const srcIdx = (srcY * srcWidth + srcX) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      output[dstIdx] = source[srcIdx];
      output[dstIdx + 1] = source[srcIdx + 1];
      output[dstIdx + 2] = source[srcIdx + 2];
      output[dstIdx + 3] = source[srcIdx + 3];
    }
  }
  return output;
};

/** 双重盒状模糊（半径 20px，2 次迭代），严格对齐官方 Web 端羽化参数 */
const boxBlurMask = (source: Uint8ClampedArray, width: number, height: number, radius = 20, iterations = 2) => {
  if (radius <= 0) return source;
  const current = new Uint8ClampedArray(source);
  const windowSize = radius * 2 + 1;
  for (let iter = 0; iter < iterations; iter += 1) {
    const horizontal = new Uint8ClampedArray(current.length);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      const rowOffset = y * width;
      for (let offset = -radius; offset <= radius; offset += 1) sum += current[(rowOffset + Math.max(0, Math.min(width - 1, offset))) * 4];
      for (let x = 0; x < width; x += 1) {
        const idx = (rowOffset + x) * 4;
        const avg = Math.round(sum / windowSize);
        horizontal[idx] = avg;
        horizontal[idx + 1] = avg;
        horizontal[idx + 2] = avg;
        horizontal[idx + 3] = avg;
        const removeX = Math.max(0, Math.min(width - 1, x - radius));
        const addX = Math.max(0, Math.min(width - 1, x + radius + 1));
        sum += current[(rowOffset + addX) * 4] - current[(rowOffset + removeX) * 4];
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) sum += horizontal[(Math.max(0, Math.min(height - 1, offset)) * width + x) * 4];
      for (let y = 0; y < height; y += 1) {
        const idx = (y * width + x) * 4;
        const avg = Math.round(sum / windowSize);
        current[idx] = avg;
        current[idx + 1] = avg;
        current[idx + 2] = avg;
        current[idx + 3] = avg;
        const removeY = Math.max(0, Math.min(height - 1, y - radius));
        const addY = Math.max(0, Math.min(height - 1, y + radius + 1));
        sum += horizontal[(addY * width + x) * 4] - horizontal[(removeY * width + x) * 4];
      }
    }
  }
  return current;
};

/** 从 1/8 API 二值蒙版构建官方标准的无缝合成羽化回贴蒙版 */
const buildCompositeMaskFromApiMask = (apiMaskCanvas: HTMLCanvasElement, targetWidth: number, targetHeight: number) => {
  const apiContext = apiMaskCanvas.getContext('2d');
  if (!apiContext) throw new Error('无法读取 API 蒙版数据');
  const apiData = apiContext.getImageData(0, 0, apiMaskCanvas.width, apiMaskCanvas.height).data;
  const dilated = dilateBinaryMask(apiData, apiMaskCanvas.width, apiMaskCanvas.height, 4);
  const scaled = scaleUpMask8x(dilated, apiMaskCanvas.width, apiMaskCanvas.height, targetWidth, targetHeight);
  const blurred = boxBlurMask(scaled, targetWidth, targetHeight, 20, 2);

  const compositeCanvas = createCanvas(targetWidth, targetHeight);
  const compositeContext = compositeCanvas.getContext('2d');
  if (!compositeContext) throw new Error('无法创建合成蒙版画布');
  const compositeImage = compositeContext.createImageData(targetWidth, targetHeight);
  for (let i = 0; i < blurred.length; i += 4) {
    const val = blurred[i];
    compositeImage.data[i] = 255;
    compositeImage.data[i + 1] = 255;
    compositeImage.data[i + 2] = 255;
    compositeImage.data[i + 3] = val; // Alpha 通道为羽化透明度
  }
  compositeContext.putImageData(compositeImage, 0, 0);
  return compositeCanvas;
};

const hasMaskInRect = (context: CanvasRenderingContext2D, rect: ImageEditRect) => {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(context.canvas.width - x, Math.ceil(rect.width)));
  const height = Math.max(1, Math.min(context.canvas.height - y, Math.ceil(rect.height)));
  const pixels = context.getImageData(x, y, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] >= 155) return true;
  return false;
};

export interface PreparedImageEdit {
  image: string;
  mask?: string;
  originalImage: Blob;
  compositeMask?: Blob;
  requestWidth: number;
  requestHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  focusedGeometry?: ImageEditFocusedGeometry;
}

/** 将编辑器的全尺寸蒙版转换为 NovelAI 官方使用的 1/8 尺寸蒙版，并生成官方标准羽化回贴蒙版。 */
export const prepareImageEdit = async (edit: {
  operation: ImageEditOperation;
  image: string;
  mask?: string;
  focused?: boolean;
  focusedRect?: ImageEditRect;
  minimumContextArea?: number;
}): Promise<PreparedImageEdit> => {
  const originalImage = await dataUrlToBlob(edit.image);
  const imageBitmap = await loadBitmap(originalImage);
  const originalWidth = imageBitmap.width;
  const originalHeight = imageBitmap.height;
  const sourceMask = edit.mask ? await loadBitmap(edit.mask) : null;
  const sourceMaskCanvas = sourceMask ? createCanvas(originalWidth, originalHeight) : null;
  const sourceMaskContext = sourceMaskCanvas?.getContext('2d') || null;
  if (sourceMask && sourceMaskContext) {
    sourceMaskContext.imageSmoothingEnabled = false;
    sourceMaskContext.drawImage(sourceMask, 0, 0, originalWidth, originalHeight);
  }

  let requestImageCanvas: HTMLCanvasElement;
  let apiMaskCanvas: HTMLCanvasElement | undefined;
  let compositeMaskCanvas: HTMLCanvasElement | undefined;
  let focusedGeometry: ImageEditFocusedGeometry | undefined;

  if (edit.operation === 'inpaint' && edit.focused && edit.focusedRect) {
    focusedGeometry = getFocusedImageEditGeometry(originalWidth, originalHeight, edit.focusedRect, edit.minimumContextArea);
    requestImageCanvas = createCanvas(focusedGeometry.requestWidth, focusedGeometry.requestHeight);
    const requestImageContext = requestImageCanvas.getContext('2d');
    if (!requestImageContext) throw new Error('无法创建 Focused 图片画布');
    requestImageContext.imageSmoothingQuality = 'high';
    requestImageContext.drawImage(imageBitmap, focusedGeometry.crop.x, focusedGeometry.crop.y, focusedGeometry.crop.width, focusedGeometry.crop.height, 0, 0, focusedGeometry.requestWidth, focusedGeometry.requestHeight);

    const focusedCropMaskCanvas = createCanvas(focusedGeometry.crop.width, focusedGeometry.crop.height);
    const focusedCropContext = focusedCropMaskCanvas.getContext('2d');
    if (!focusedCropContext) throw new Error('无法创建 Focused 裁剪蒙版');
    if (sourceMaskCanvas && sourceMaskContext && hasMaskInRect(sourceMaskContext, focusedGeometry.inner)) {
      focusedCropContext.drawImage(sourceMaskCanvas, focusedGeometry.crop.x, focusedGeometry.crop.y, focusedGeometry.crop.width, focusedGeometry.crop.height, 0, 0, focusedGeometry.crop.width, focusedGeometry.crop.height);
      const compositeImage = focusedCropContext.getImageData(0, 0, focusedCropMaskCanvas.width, focusedCropMaskCanvas.height);
      const innerX = focusedGeometry.inner.x - focusedGeometry.crop.x;
      const innerY = focusedGeometry.inner.y - focusedGeometry.crop.y;
      for (let y = 0; y < focusedCropMaskCanvas.height; y += 1) {
        for (let x = 0; x < focusedCropMaskCanvas.width; x += 1) {
          if (x < innerX || x >= innerX + focusedGeometry.inner.width || y < innerY || y >= innerY + focusedGeometry.inner.height) {
            compositeImage.data[(y * focusedCropMaskCanvas.width + x) * 4 + 3] = 0;
          }
        }
      }
      focusedCropContext.putImageData(compositeImage, 0, 0);
    } else {
      focusedCropContext.fillStyle = '#ffffff';
      focusedCropContext.fillRect(focusedGeometry.inner.x - focusedGeometry.crop.x, focusedGeometry.inner.y - focusedGeometry.crop.y, focusedGeometry.inner.width, focusedGeometry.inner.height);
      focusedGeometry.fullSizeMask = true;
    }

    const focusedRequestMaskCanvas = createCanvas(focusedGeometry.requestWidth, focusedGeometry.requestHeight);
    const focusedRequestMaskContext = focusedRequestMaskCanvas.getContext('2d');
    if (!focusedRequestMaskContext) throw new Error('无法创建 Focused 请求蒙版画布');
    focusedRequestMaskContext.imageSmoothingEnabled = false;
    focusedRequestMaskContext.drawImage(focusedCropMaskCanvas, 0, 0, focusedCropMaskCanvas.width, focusedCropMaskCanvas.height, 0, 0, focusedRequestMaskCanvas.width, focusedRequestMaskCanvas.height);

    apiMaskCanvas = buildThresholdMask(focusedRequestMaskCanvas, focusedGeometry.requestWidth, focusedGeometry.requestHeight, Math.max(8, focusedGeometry.requestWidth / 8), Math.max(8, focusedGeometry.requestHeight / 8));
    compositeMaskCanvas = buildCompositeMaskFromApiMask(apiMaskCanvas, focusedGeometry.crop.width, focusedGeometry.crop.height);
  } else {
    requestImageCanvas = createCanvas(originalWidth, originalHeight);
    const requestImageContext = requestImageCanvas.getContext('2d');
    if (!requestImageContext) throw new Error('无法创建图片编辑画布');
    requestImageContext.drawImage(imageBitmap, 0, 0, originalWidth, originalHeight);

    if (sourceMaskCanvas) {
      const requestWidth = requestImageCanvas.width;
      const requestHeight = requestImageCanvas.height;
      apiMaskCanvas = buildThresholdMask(sourceMaskCanvas, originalWidth, originalHeight, Math.max(8, requestWidth / 8), Math.max(8, requestHeight / 8));
      compositeMaskCanvas = buildCompositeMaskFromApiMask(apiMaskCanvas, originalWidth, originalHeight);
    }
  }

  imageBitmap.close();
  sourceMask?.close();
  const requestWidth = requestImageCanvas.width;
  const requestHeight = requestImageCanvas.height;

  return {
    image: canvasToDataUrl(requestImageCanvas),
    mask: apiMaskCanvas ? canvasToDataUrl(apiMaskCanvas) : undefined,
    originalImage,
    compositeMask: compositeMaskCanvas ? await canvasToBlob(compositeMaskCanvas) : undefined,
    requestWidth,
    requestHeight,
    sourceWidth: originalWidth,
    sourceHeight: originalHeight,
    focusedGeometry,
  };
};

/** 将 NovelAI 编辑结果按官方蒙版合成回原图，Focused 结果会先缩回原选区。 */
export const composeImageEditResult = async (result: Blob, prepared: PreparedImageEdit) => {
  if (!prepared.compositeMask) return result;
  const baseBitmap = await loadBitmap(prepared.originalImage);
  const resultBitmap = await loadBitmap(result);
  const maskBitmap = await loadBitmap(prepared.compositeMask);
  const output = createCanvas(baseBitmap.width, baseBitmap.height);
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('无法创建图片合成画布');
  outputContext.drawImage(baseBitmap, 0, 0);

  const generated = createCanvas(baseBitmap.width, baseBitmap.height);
  const generatedContext = generated.getContext('2d');
  const fullMask = createCanvas(baseBitmap.width, baseBitmap.height);
  const fullMaskContext = fullMask.getContext('2d');
  if (!generatedContext || !fullMaskContext) throw new Error('无法创建图片合成图层');
  const geometry = prepared.focusedGeometry;
  if (geometry) {
    generatedContext.drawImage(resultBitmap, 0, 0, resultBitmap.width, resultBitmap.height, geometry.crop.x, geometry.crop.y, geometry.crop.width, geometry.crop.height);
    fullMaskContext.drawImage(maskBitmap, 0, 0, maskBitmap.width, maskBitmap.height, geometry.crop.x, geometry.crop.y, geometry.crop.width, geometry.crop.height);
  } else {
    generatedContext.drawImage(resultBitmap, 0, 0, baseBitmap.width, baseBitmap.height);
    fullMaskContext.drawImage(maskBitmap, 0, 0, maskBitmap.width, maskBitmap.height, 0, 0, baseBitmap.width, baseBitmap.height);
  }

  // 1. 生成图以羽化蒙版调制 Alpha（destination-in）
  generatedContext.globalCompositeOperation = 'destination-in';
  generatedContext.drawImage(fullMask, 0, 0);
  generatedContext.globalCompositeOperation = 'source-over';

  // 2. 底图扣除重绘区域（destination-out: 像素透明度乘以 1 - MaskAlpha）
  outputContext.globalCompositeOperation = 'destination-out';
  outputContext.drawImage(fullMask, 0, 0);

  // 3. 将调制后的生成图回贴到底图上（source-over 实现精准 Output = Original*(1-A) + Generated*A）
  outputContext.globalCompositeOperation = 'source-over';
  outputContext.drawImage(generated, 0, 0);

  baseBitmap.close();
  resultBitmap.close();
  maskBitmap.close();
  return canvasToBlob(output);
};
