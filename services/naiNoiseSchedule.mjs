/**
 * NovelAI 噪声调度（noise_schedule）选项与归一化。
 * V4／V5 实际可选 karras／exponential／polyexponential；native 会被官方拒绝，导入时回落 karras。
 */

/**
 * @typedef {'karras' | 'exponential' | 'polyexponential'} NaiNoiseSchedule
 */

/** @type {NaiNoiseSchedule} */
export const DEFAULT_NOISE_SCHEDULE = 'karras';

/** 实验室与助手可选的调度；不含已被 V4+ 拒绝的 native。
 * @type {readonly NaiNoiseSchedule[]}
 */
export const NAI_NOISE_SCHEDULES = Object.freeze(/** @type {const} */ (['karras', 'exponential', 'polyexponential']));

const SCHEDULE_SET = new Set(NAI_NOISE_SCHEDULES);

/**
 * @param {unknown} value
 * @returns {NaiNoiseSchedule}
 */
export const normalizeNoiseSchedule = value => {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (raw === 'native') return DEFAULT_NOISE_SCHEDULE;
  if (SCHEDULE_SET.has(/** @type {NaiNoiseSchedule} */ (raw))) return /** @type {NaiNoiseSchedule} */ (raw);
  return DEFAULT_NOISE_SCHEDULE;
};

/**
 * 解析「Sampler: k_dpmpp_2m (exponential)」这类合并写法。
 * @param {unknown} raw
 * @returns {{ sampler: string; noiseSchedule?: NaiNoiseSchedule }}
 */
export const parseSamplerWithSchedule = raw => {
  const text = String(raw ?? '').trim();
  if (!text) return { sampler: '' };
  const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return {
      sampler: match[1].trim().toLowerCase().replace(/ /g, '_'),
      noiseSchedule: normalizeNoiseSchedule(match[2]),
    };
  }
  return { sampler: text.toLowerCase().replace(/ /g, '_') };
};

/** 界面展示名；API 值保持小写。
 * @type {Readonly<Record<NaiNoiseSchedule, string>>}
 */
export const NOISE_SCHEDULE_LABELS = Object.freeze({
  karras: 'Karras',
  exponential: 'Exponential',
  polyexponential: 'Polyexponential',
});
