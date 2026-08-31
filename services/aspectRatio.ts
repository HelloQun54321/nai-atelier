/**
 * 画幅比例预设与基于 Opus 免费基准点的尺寸缩放计算服务。
 */

export interface AspectRatioPreset {
  id: string;
  label: string;
  ratio: string;
  widthRatio: number;
  heightRatio: number;
  description: string;
  category: 'portrait' | 'landscape' | 'square';
  /** 1.0x 基准档位下的默认像素尺寸（均为 64 的倍数且 <= 1,048,576） */
  baseWidth: number;
  baseHeight: number;
}

export const OPUS_FREE_PIXEL_LIMIT = 1048576; // 1024 * 1024
export const NOVELAI_MAX_DIMENSION = 2048;
export const NOVELAI_MAX_PIXELS = 1536 * 2048; // 3,145,728
export const RESOLUTION_STEP = 64;
export const GENERATION_MIN_DIMENSION = 64;
export const GENERATION_MAX_DIMENSION = NOVELAI_MAX_DIMENSION;

export const BUILTIN_ASPECT_RATIOS: AspectRatioPreset[] = [
  // 方形
  {
    id: '1:1',
    label: '1:1 方形',
    ratio: '1:1',
    widthRatio: 1,
    heightRatio: 1,
    description: '头像 / 社交配图 / 贴纸',
    category: 'square',
    baseWidth: 1024,
    baseHeight: 1024,
  },
  // 竖屏
  {
    id: '2:3',
    label: '2:3 经典写真',
    ratio: '2:3',
    widthRatio: 2,
    heightRatio: 3,
    description: 'NovelAI 官方人像写真',
    category: 'portrait',
    baseWidth: 832,
    baseHeight: 1216,
  },
  {
    id: '3:4',
    label: '3:4 标准竖屏',
    ratio: '3:4',
    widthRatio: 3,
    heightRatio: 4,
    description: '常见竖插画 / 立绘',
    category: 'portrait',
    baseWidth: 896,
    baseHeight: 1152,
  },
  {
    id: '9:16',
    label: '9:16 手机壁纸',
    ratio: '9:16',
    widthRatio: 9,
    heightRatio: 16,
    description: '全面屏手机壁纸 / 故事',
    category: 'portrait',
    baseWidth: 768,
    baseHeight: 1344,
  },
  {
    id: '1:2',
    label: '1:2 超长立绘',
    ratio: '1:2',
    widthRatio: 1,
    heightRatio: 2,
    description: '全身立绘 / 长条卡片',
    category: 'portrait',
    baseWidth: 704,
    baseHeight: 1408,
  },
  {
    id: '9:21',
    label: '9:21 极长竖屏',
    ratio: '9:21',
    widthRatio: 9,
    heightRatio: 21,
    description: '超长折叠屏壁纸',
    category: 'portrait',
    baseWidth: 640,
    baseHeight: 1536,
  },
  // 横屏
  {
    id: '3:2',
    label: '3:2 经典横屏',
    ratio: '3:2',
    widthRatio: 3,
    heightRatio: 2,
    description: 'NovelAI 官方横向插画',
    category: 'landscape',
    baseWidth: 1216,
    baseHeight: 832,
  },
  {
    id: '4:3',
    label: '4:3 标准横屏',
    ratio: '4:3',
    widthRatio: 4,
    heightRatio: 3,
    description: '传统电脑壁纸 / CG 场景',
    category: 'landscape',
    baseWidth: 1152,
    baseHeight: 896,
  },
  {
    id: '16:9',
    label: '16:9 电脑宽屏',
    ratio: '16:9',
    widthRatio: 16,
    heightRatio: 9,
    description: '桌面宽屏壁纸 / 1080P',
    category: 'landscape',
    baseWidth: 1344,
    baseHeight: 768,
  },
  {
    id: '2:1',
    label: '2:1 横幅长图',
    ratio: '2:1',
    widthRatio: 2,
    heightRatio: 1,
    description: '横幅 Banner / 宽景图',
    category: 'landscape',
    baseWidth: 1408,
    baseHeight: 704,
  },
  {
    id: '21:9',
    label: '21:9 电影画幅',
    ratio: '21:9',
    widthRatio: 21,
    heightRatio: 9,
    description: '宽银幕大场景 / 电影长卷',
    category: 'landscape',
    baseWidth: 1536,
    baseHeight: 640,
  },
];

export const SCALE_STEPS = [
  { value: 1.0, label: '1.0x (Opus免费)' },
  { value: 1.15, label: '1.15x' },
  { value: 1.3, label: '1.3x' },
  { value: 1.5, label: '1.5x (高清壁纸)' },
  { value: 1.75, label: '1.75x' },
  { value: 2.0, label: '2.0x (封顶)' },
];

export const normalizeTo64Step = (value: number) => {
  const finite = Number.isFinite(value) ? value : RESOLUTION_STEP;
  return Math.min(GENERATION_MAX_DIMENSION, Math.max(GENERATION_MIN_DIMENSION, Math.round(finite / RESOLUTION_STEP) * RESOLUTION_STEP));
};

export const calculateDimensionsForRatio = (
  preset: AspectRatioPreset,
  scale: number,
): { width: number; height: number } => {
  const effectiveScale = Math.max(1.0, scale);
  if (Math.abs(effectiveScale - 1.0) < 0.001) {
    return { width: preset.baseWidth, height: preset.baseHeight };
  }

  let rawWidth = Math.round((preset.baseWidth * effectiveScale) / RESOLUTION_STEP) * RESOLUTION_STEP;
  let rawHeight = Math.round((preset.baseHeight * effectiveScale) / RESOLUTION_STEP) * RESOLUTION_STEP;

  // 约束单边不超过 NovelAI 官方最大上限 2048
  if (rawWidth > NOVELAI_MAX_DIMENSION) {
    const ratio = preset.baseHeight / preset.baseWidth;
    rawWidth = NOVELAI_MAX_DIMENSION;
    rawHeight = Math.round((rawWidth * ratio) / RESOLUTION_STEP) * RESOLUTION_STEP;
  }
  if (rawHeight > NOVELAI_MAX_DIMENSION) {
    const ratio = preset.baseWidth / preset.baseHeight;
    rawHeight = NOVELAI_MAX_DIMENSION;
    rawWidth = Math.round((rawHeight * ratio) / RESOLUTION_STEP) * RESOLUTION_STEP;
  }

  // 约束总像素不超过 NovelAI 官方上限 1536 * 2048 = 3,145,728
  while (rawWidth * rawHeight > NOVELAI_MAX_PIXELS && (rawWidth > RESOLUTION_STEP || rawHeight > RESOLUTION_STEP)) {
    if (rawWidth >= rawHeight) {
      rawWidth -= RESOLUTION_STEP;
    } else {
      rawHeight -= RESOLUTION_STEP;
    }
  }

  return {
    width: Math.max(GENERATION_MIN_DIMENSION, Math.min(NOVELAI_MAX_DIMENSION, rawWidth)),
    height: Math.max(GENERATION_MIN_DIMENSION, Math.min(NOVELAI_MAX_DIMENSION, rawHeight)),
  };
};

export const detectClosestAspectRatio = (width: number, height: number): { preset: AspectRatioPreset | null; scale: number } => {
  if (!width || !height) return { preset: null, scale: 1.0 };
  for (const preset of BUILTIN_ASPECT_RATIOS) {
    if (preset.baseWidth === width && preset.baseHeight === height) {
      return { preset, scale: 1.0 };
    }
  }
  // 匹配已知比例与倍率
  const currentRatio = width / height;
  let bestPreset: AspectRatioPreset | null = null;
  let minRatioDiff = Infinity;

  for (const preset of BUILTIN_ASPECT_RATIOS) {
    const targetRatio = preset.baseWidth / preset.baseHeight;
    const diff = Math.abs(currentRatio - targetRatio);
    if (diff < 0.03 && diff < minRatioDiff) {
      minRatioDiff = diff;
      bestPreset = preset;
    }
  }

  if (bestPreset) {
    const scale = Math.round((width / bestPreset.baseWidth) * 100) / 100;
    return { preset: bestPreset, scale };
  }

  return { preset: null, scale: 1.0 };
};

export interface UserDimensionPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: number;
}

const STORAGE_KEY = 'nai_user_resolution_presets';

export const getUserDimensionPresets = (): UserDimensionPreset[] => {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveUserDimensionPreset = (name: string, width: number, height: number): UserDimensionPreset[] => {
  const current = getUserDimensionPresets();
  const trimmedName = name.trim() || `${width}×${height}`;
  const newPreset: UserDimensionPreset = {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    width: normalizeTo64Step(width),
    height: normalizeTo64Step(height),
    createdAt: Date.now(),
  };
  const next = [newPreset, ...current.filter(item => item.name !== trimmedName)];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('保存用户尺寸预设失败:', error);
  }
  return next;
};

export const deleteUserDimensionPreset = (id: string): UserDimensionPreset[] => {
  const current = getUserDimensionPresets();
  const next = current.filter(item => item.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('删除用户尺寸预设失败:', error);
  }
  return next;
};

