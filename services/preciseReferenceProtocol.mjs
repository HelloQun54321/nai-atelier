/**
 * NovelAI 精准参考（Precise Reference）共享协议与能力裁决工具。
 *
 * 供前端界面、Worker 计费、桌面网关与独立 Android 共用，确保各端对 V4.5 / V5
 * 的参考类型过滤、Prefer same outfit 映射与 V5 多比例分桶裁剪保持一致。
 */

/** 官方 V5 精准参考多比例分桶表（约 100 万像素，覆盖 1:16 到 16:1，共 97 档）。 */
export const PRECISE_REFERENCE_BUCKETS = [
  [256, 4096], [256, 4032], [256, 3968], [256, 3904], [256, 3840], [256, 3776], [256, 3712], [256, 3648], [256, 3584], [256, 3520], [256, 3456], [256, 3392], [256, 3328],
  [320, 3264], [320, 3200], [320, 3136], [320, 3072], [320, 3008], [320, 2944], [320, 2880], [320, 2816], [320, 2752],
  [384, 2688], [384, 2624], [384, 2560], [384, 2496], [384, 2432], [384, 2368],
  [448, 2304], [448, 2240], [448, 2176], [448, 2112],
  [512, 2048], [512, 1984], [512, 1920], [512, 1856],
  [576, 1792], [576, 1728], [576, 1664],
  [640, 1600], [640, 1536],
  [704, 1472], [704, 1408],
  [768, 1344], [768, 1280],
  [832, 1216], [896, 1152], [960, 1088], [1024, 1024], [1088, 960], [1152, 896], [1216, 832],
  [1280, 768], [1344, 768],
  [1408, 704], [1472, 704],
  [1536, 640], [1600, 640],
  [1664, 576], [1728, 576], [1792, 576],
  [1856, 512], [1920, 512], [1984, 512], [2048, 512],
  [2112, 448], [2176, 448], [2240, 448], [2304, 448],
  [2368, 384], [2432, 384], [2496, 384], [2560, 384], [2624, 384], [2688, 384],
  [2752, 320], [2816, 320], [2880, 320], [2944, 320], [3008, 320], [3072, 320], [3136, 320], [3200, 320], [3264, 320],
  [3328, 256], [3392, 256], [3456, 256], [3520, 256], [3584, 256], [3648, 256], [3712, 256], [3776, 256], [3840, 256], [3904, 256], [3968, 256], [4032, 256], [4096, 256],
];

/** 按原图宽高比选择最接近的 V5 官方分桶并计算等比覆盖缩放与居中裁剪矩形。 */
export const selectPreciseReferenceBucket = (width, height) => {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const logRatio = Math.log(sourceWidth / sourceHeight);
  let chosen = PRECISE_REFERENCE_BUCKETS[0];
  let bestDistance = Math.abs(logRatio - Math.log(chosen[0] / chosen[1]));
  for (const bucket of PRECISE_REFERENCE_BUCKETS) {
    const distance = Math.abs(logRatio - Math.log(bucket[0] / bucket[1]));
    if (distance < bestDistance) {
      chosen = bucket;
      bestDistance = distance;
    }
  }
  const [targetWidth, targetHeight] = chosen;
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const resizeWidth = Math.max(Math.floor(sourceWidth * scale + 0.5), targetWidth);
  const resizeHeight = Math.max(Math.floor(sourceHeight * scale + 0.5), targetHeight);
  return {
    width: targetWidth,
    height: targetHeight,
    resizeWidth,
    resizeHeight,
    left: Math.floor((resizeWidth - targetWidth) / 2),
    top: Math.floor((resizeHeight - targetHeight) / 2),
    unchanged: sourceWidth === targetWidth && sourceHeight === targetHeight,
  };
};

/**
 * V5「优先同款服装」开关状态：
 * - character 默认关闭（false → 发送 `character`，开启 → 发送 `character_mainoutfit`）
 * - character_style 默认开启（true → 发送 `character&style`，关闭 → 发送 `character&style_anyoutfit`）
 */
export const isPreferSameOutfitEnabled = slot => {
  if (slot?.type === 'character') return slot.preferSameOutfit === true;
  if (slot?.type === 'character_style') return slot.preferSameOutfit !== false;
  return false;
};

/** 按目标模型能力与编辑模式过滤实际会发送与计费的精准参考槽。 */
export const filterEffectiveCharacterReferences = (slots, capability, isInpaint = false) => {
  if (!Array.isArray(slots) || !slots.length) return [];
  const allowed = isInpaint
    ? capability?.supportsCharacterReferenceInpainting === true
    : capability?.supportsCharacterReferences === true;
  if (!allowed) return [];
  const supportsOutfits = capability?.supportsOutfitReferences === true;
  return slots.filter(slot => supportsOutfits || slot?.type !== 'costume');
};

/** 将槽位类型与「优先同款服装」映射为官方 `director_reference_descriptions` 的 `base_caption`。 */
export const resolvePreciseReferenceCaption = (slot, supportsOutfitReferences = false) => {
  switch (slot?.type) {
    case 'character':
      return supportsOutfitReferences && slot?.preferSameOutfit === true
        ? 'character_mainoutfit'
        : 'character';
    case 'character_style':
      return supportsOutfitsCaption(supportsOutfitReferences, slot?.preferSameOutfit);
    case 'style':
      return 'style';
    case 'costume':
      return 'costume';
    case 'delta':
      return 'delta';
    default:
      return null;
  }
};

const supportsOutfitsCaption = (supportsOutfitReferences, preferSameOutfit) =>
  supportsOutfitReferences && preferSameOutfit === false
    ? 'character&style_anyoutfit'
    : 'character&style';
