// 前端估算与网关记账共用官方计费语义；默认值仅用于同步前兜底。
export const DEFAULT_NAI_BILLING = {
  minimumCost: 2,
  freeSamples: 1,
  freeImageToImage: true,
  freeInpainting: true,
  // 官方费用调用没有传入重试判定用的 characterRef；参考另收附加费。
  freeWithCharacterReference: true,
  modelMultipliers: { v5: 1.5 },
  modelStepMultipliers: {},
  smeaMultiplier: 1.2,
  smeaDynamicMultiplier: 1.4,
  freeVibeCount: 4,
  extraVibeCost: 2,
  characterReferenceCost: 5,
  vibeEncodingCost: 2,
};

/** 持久快照和接口响应缺项／损坏时不能作为有效计费依据。 */
export const isNaiBillingRules = value => Boolean(value && typeof value === 'object')
  && Object.entries(DEFAULT_NAI_BILLING).every(([key, baseline]) => {
    const actual = value[key];
    if (key === 'modelMultipliers' || key === 'modelStepMultipliers') return actual && typeof actual === 'object' && !Array.isArray(actual)
      && Object.values(actual).every(multiplier => Number.isFinite(multiplier) && multiplier > 0);
    return typeof baseline === 'boolean' ? typeof actual === 'boolean' : Number.isFinite(actual) && actual >= 0;
  });

export const estimateNaiBilling = (parameters, model, runtime, opus = false, usageExhausted = false) => {
  const rules = runtime.billing || DEFAULT_NAI_BILLING;
  const width = Math.max(1, Number(parameters.width) || 1);
  const height = Math.max(1, Number(parameters.height) || 1);
  const steps = Math.max(1, Number(parameters.steps) || 1);
  const samples = Math.max(1, Math.floor(Number(parameters.samples) || 1));
  const referenceCount = Math.max(0, Number(parameters.referenceCount) || 0);
  const vibeCount = Math.max(0, Number(parameters.vibeCount) || 0);
  const usageLimited = runtime.usageLimitedModels.includes(model);
  const free = opus && !(usageLimited && usageExhausted)
    && width * height <= runtime.freeMaxArea && steps <= runtime.freeMaxSteps
    && (!referenceCount || rules.freeWithCharacterReference)
    && (!parameters.image || rules.freeImageToImage)
    && (!parameters.mask || rules.freeInpainting);
  const stepMultiplier = rules.modelStepMultipliers[model] ?? 1;
  const raw = Math.ceil(runtime.costCoefficientArea * width * height + runtime.costCoefficientSteps * width * height * steps * stepMultiplier);
  const family = String(model || '').match(/^nai-diffusion-(\d+)(?:-|$)/)?.[1];
  const multiplier = rules.modelMultipliers[`v${family}`] ?? 1;
  const smea = parameters.sm ? parameters.sm_dyn ? rules.smeaDynamicMultiplier : rules.smeaMultiplier : 1;
  const strength = Math.max(0, Math.min(1, Number(parameters.strength ?? 1) || 0));
  const baseCost = Math.max(rules.minimumCost, Math.ceil(raw * multiplier * smea * strength));
  const freeSamples = free ? Math.min(samples, rules.freeSamples) : 0;
  return {
    cost: baseCost * (samples - freeSamples)
      + Math.max(0, vibeCount - rules.freeVibeCount) * rules.extraVibeCost
      + referenceCount * rules.characterReferenceCost * samples,
    opusImages: usageLimited ? freeSamples : 0,
  };
};
