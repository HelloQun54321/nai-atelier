import { describe, expect, it } from 'vitest';
import { formatGenerationCostLabel } from './anlasBudget';

describe('formatGenerationCostLabel', () => {
  it('V5 免费档提示会消耗 Opus 额度而不是免费', () => {
    expect(formatGenerationCostLabel(0, 'nai-diffusion-5-full')).toBe('消耗额度');
    expect(formatGenerationCostLabel(0, 'nai-diffusion-5-curated')).toBe('消耗额度');
  });

  it('V4.5 免费档仍显示免费，超出免费档显示 Anlas 点数', () => {
    expect(formatGenerationCostLabel(0, 'nai-diffusion-4-5-full')).toBe('免费');
    expect(formatGenerationCostLabel(2, 'nai-diffusion-5-full')).toBe('2 点');
  });
});
