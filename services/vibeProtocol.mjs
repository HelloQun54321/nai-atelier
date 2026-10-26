// 与官方 Vibe 文件共用的模型键、参数标识和强度语义。
export const VIBE_MODELS = Object.freeze({
  __proto__: null,
  v4full: 'nai-diffusion-4-full',
  v4curated: 'nai-diffusion-4-curated-preview',
  'v4-5full': 'nai-diffusion-4-5-full',
  'v4-5curated': 'nai-diffusion-4-5-curated',
  v5full: 'nai-diffusion-5-full',
  v5curated: 'nai-diffusion-5-curated',
});

export const vibeBaseModel = model => {
  const base = String(model || 'nai-diffusion-4-5-full').replace(/-inpainting$/, '').replace(/-medium$/, '');
  return base === 'nai-diffusion-4-curated' ? 'nai-diffusion-4-curated-preview' : base;
};
export const vibeModelKey = model => Object.keys(VIBE_MODELS).find(key => VIBE_MODELS[key] === vibeBaseModel(model));
export const defaultVibeInformation = model => vibeBaseModel(model) === 'nai-diffusion-4-5-full' ? 0.7 : 1;
export const vibeStrength = (value, fallback = 0.6) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const normalizeReferenceStrengths = (values, enabled = true) => {
  const total = values.reduce((sum, value) => sum + Math.abs(value), 0);
  return enabled && values.length > 1 && total > 1 ? values.map(value => value / total) : values;
};

export const vibeParameterKey = parameters => Object.entries(parameters || {}).sort(([a], [b]) => a.localeCompare(b, 'en'))
  .filter(([, value]) => value != null)
  .map(([key, value]) => `${key}:${typeof value === 'object' ? JSON.stringify(value) : value}`).join(',');
