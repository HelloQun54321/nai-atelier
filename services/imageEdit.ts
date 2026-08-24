import { ImageEditCanvasExpansion, ImageEditOperation } from '../types';

export const IMAGE_EDIT_MODEL_SUFFIX = '-inpainting';
export const IMAGE_EDIT_MIN_DIMENSION = 64;
export const IMAGE_EDIT_MAX_DIMENSION = 4096;
export const IMAGE_EDIT_MAX_AREA = 4_194_304;
export const IMAGE_EDIT_SUPPORTED_SAMPLERS = new Set(['k_euler_ancestral', 'k_euler']);
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
  if (!IMAGE_EDIT_SUPPORTED_SAMPLERS.has(String(sampler || '').trim())) throw new Error(`当前采样器不支持图像编辑：${sampler || '未设置'}`);
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
  imageContext.fillStyle = '#ffffff';
  imageContext.fillRect(0, 0, width, height);
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
  add_original_image: true,
  ...(focused ? { _local_focused_inpainting: true, ...(minimumContextArea === undefined ? {} : { _local_minimum_context_area: minimumContextArea }) } : {}),
});
