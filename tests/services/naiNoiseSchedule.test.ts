import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_SCHEDULE,
  NAI_NOISE_SCHEDULES,
  normalizeNoiseSchedule,
  parseSamplerWithSchedule,
} from '../../services/naiNoiseSchedule.mjs';

describe('naiNoiseSchedule', () => {
  it('归一化合法日程，native 与未知回落默认 karras', () => {
    expect(DEFAULT_NOISE_SCHEDULE).toBe('karras');
    expect(NAI_NOISE_SCHEDULES).toEqual(['karras', 'exponential', 'polyexponential']);
    expect(normalizeNoiseSchedule('exponential')).toBe('exponential');
    expect(normalizeNoiseSchedule('Polyexponential')).toBe('polyexponential');
    expect(normalizeNoiseSchedule('native')).toBe('karras');
    expect(normalizeNoiseSchedule('')).toBe('karras');
    expect(normalizeNoiseSchedule('weird')).toBe('karras');
  });

  it('从 Sampler 括号写法拆出日程，避免把括号粘进采样器名', () => {
    expect(parseSamplerWithSchedule('k_dpmpp_2m (exponential)')).toEqual({
      sampler: 'k_dpmpp_2m',
      noiseSchedule: 'exponential',
    });
    expect(parseSamplerWithSchedule('DPM++ 2M (Polyexponential)')).toEqual({
      sampler: 'dpm++_2m',
      noiseSchedule: 'polyexponential',
    });
    expect(parseSamplerWithSchedule('k_euler_ancestral')).toEqual({ sampler: 'k_euler_ancestral' });
  });
});
