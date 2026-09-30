// 创作策略与官方计费常量分离；前端和本地网关共用限制，官方规则仍由运行时同步。
export const LOW_CONSUMPTION_RESERVE = 166;
export const lowConsumptionRuntimeHealthy = (runtime, now = Date.now()) => runtime.health?.ok === true
  && !(runtime.syncedAt > 0 && now - runtime.syncedAt > 48 * 60 * 60 * 1000);
export const lowConsumptionStepLimit = (model, freeMaxSteps = 28) => Math.min(
  /^nai-diffusion-5(?:-|$)/.test(String(model || '')) ? 23 : 28,
  Math.max(1, Math.floor(Number(freeMaxSteps) || 28)),
);
export const lowConsumptionCostLimit = operation => operation === 'image-to-image' ? 10 : operation === 'outpaint' ? 20 : 0;

export const fitLowConsumptionDimensions = (width, height, maxArea) => {
  if (width * height <= maxArea) return { width, height };
  const scale = Math.sqrt(maxArea / (width * height));
  let nextWidth = Math.max(64, Math.floor(width * scale / 64) * 64);
  let nextHeight = Math.max(64, Math.floor(height * scale / 64) * 64);
  while (nextWidth * nextHeight > maxArea && (nextWidth > 64 || nextHeight > 64)) {
    if (nextWidth >= nextHeight && nextWidth > 64) nextWidth -= 64;
    else nextHeight -= 64;
  }
  return { width: nextWidth, height: nextHeight };
};

export const lowConsumptionViolation = options => {
  const { operation, model, steps, freeMaxSteps, width, height, freeMaxArea,
    referenceCount, vibeCount, focused, estimatedCost, remaining, runtimeHealthy,
    subscriptionKnown, usageLimited, usageExhausted } = options;
  if (!runtimeHealthy || !subscriptionKnown) return '低消耗模式：无法确认官方计费规则或当前订阅额度，请刷新后再生成';
  if (!Number.isFinite(steps) || steps < 1 || steps > lowConsumptionStepLimit(model, freeMaxSteps)) return `低消耗模式：当前模型最多 ${lowConsumptionStepLimit(model, freeMaxSteps)} 步`;
  if (referenceCount > 0) return '低消耗模式：角色／精确参考已暂停，请关闭该参考或低消耗模式';
  if (vibeCount > 4) return '低消耗模式：最多使用 4 个已编码 Vibe，请调整选择';
  if (!['text-to-image', 'image-to-image', 'inpaint', 'outpaint'].includes(operation)) return '低消耗模式：无法确认当前生成模式';
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '低消耗模式：图片尺寸无效';
  if (operation === 'text-to-image' && width * height > freeMaxArea) return '低消耗模式：文生图尺寸需要保持在官方免费面积内';
  if (operation === 'inpaint' && !focused) return '低消耗模式：局部重绘只允许免费 Focused 模式，请选择局部区域';
  if (usageLimited && usageExhausted) return '低消耗模式：当前 Opus 额度已用尽，请等待恢复或关闭低消耗模式';
  const limit = lowConsumptionCostLimit(operation);
  if (!Number.isFinite(estimatedCost) || estimatedCost < 0) return '低消耗模式：无法确认本次费用，请刷新后再生成';
  if (estimatedCost > limit) return `低消耗模式：本次预计 ${estimatedCost} Anlas，超过${operation === 'image-to-image' ? '图生图' : operation === 'outpaint' ? '扩图' : '当前模式'} ${limit} 点上限，请调整参数或关闭低消耗模式`;
  if (estimatedCost > 0 && (!Number.isFinite(remaining) || remaining - estimatedCost < LOW_CONSUMPTION_RESERVE)) return `低消耗模式：本次预计 ${estimatedCost} Anlas，需保留 ${LOW_CONSUMPTION_RESERVE} 点预算，请校准预算或关闭低消耗模式`;
  return null;
};
