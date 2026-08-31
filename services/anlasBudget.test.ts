// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { ANLAS_BUDGET_CHANGED_EVENT, estimateImageEditCost, formatGenerationCostLabel, formatImageEditCostLabel, hashNaiApiKey, useAnlasBudget } from './anlasBudget';

const responseFor = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => '',
}) as Response;

describe('useAnlasBudget', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('切换 Key 后忽略迟到的旧预算事件，并刷新当前 Key 的个人统计', async () => {
    const keyA = 'pst-budget-event-a';
    const keyB = 'pst-budget-event-b';
    const keyHashA = await hashNaiApiKey(keyA);
    const keyHashB = await hashNaiApiKey(keyB);
    let currentBPersonal = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const keyHash = new URL(String(input), 'http://local.test').searchParams.get('keyHash');
      if (keyHash === keyHashA) return responseFor({ remaining: 1400, personal: { [keyHashA]: { anlasSpent: 4, opusImages: 1 } } });
      if (keyHash === keyHashB) return responseFor({
        remaining: currentBPersonal ? 799 : 800,
        personal: currentBPersonal ? { [keyHashB]: { anlasSpent: 0, opusImages: 1 } } : {},
      });
      return responseFor({ remaining: 1666, personal: {} });
    }));

    sessionStorage.setItem('nai_api_key', keyA);
    const hook = renderHook(() => useAnlasBudget());
    await waitFor(() => expect(hook.result.current.remaining).toBe(1400));

    await act(async () => {
      sessionStorage.setItem('nai_api_key', keyB);
      window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: keyB }));
    });
    await waitFor(() => expect(hook.result.current.remaining).toBe(800));

    await act(async () => {
      window.dispatchEvent(new CustomEvent(ANLAS_BUDGET_CHANGED_EVENT, {
        detail: { remaining: 123, keyHash: keyHashA, refreshPersonal: true },
      }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(hook.result.current.remaining).toBe(800);
    expect(hook.result.current.personal).toBeNull();

    currentBPersonal = true;
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ANLAS_BUDGET_CHANGED_EVENT, {
        detail: { remaining: 799, keyHash: keyHashB, refreshPersonal: true },
      }));
    });
    await waitFor(() => {
      expect(hook.result.current.remaining).toBe(799);
      expect(hook.result.current.personal?.opusImages).toBe(1);
    });
    hook.unmount();
  });
});

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

describe('image edit cost estimation', () => {
  const params = { model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' };

  it('does not apply ordinary Opus free generation to image edits', () => {
    expect(estimateImageEditCost(params, 'image-to-image', 1, false, 4, false)).toBeGreaterThan(0);
    expect(estimateImageEditCost(params, 'inpaint', 1, false, 4, false)).toBeGreaterThan(0);
    expect(estimateImageEditCost(params, 'outpaint', 1, false, 4, false)).toBeGreaterThan(0);
  });

  it('only marks focused inpainting free for a confirmed Opus account', () => {
    expect(estimateImageEditCost(params, 'inpaint', 1, true, 3, false)).toBe(0);
    expect(estimateImageEditCost(params, 'inpaint', 1, true, 4, false)).toBe(0);
    expect(estimateImageEditCost(params, 'inpaint', 1, true, 2, false)).toBeGreaterThan(0);
    expect(formatImageEditCostLabel(0, 'inpaint', true, 3)).toBe('Opus 免费');
    expect(formatImageEditCostLabel(0, 'inpaint', true, 4)).toBe('Opus 免费');
    expect(formatImageEditCostLabel(0, 'inpaint', true, undefined)).toBe('费用以官方返回为准');
  });

  it('does not charge retained Vibe slots for operations that do not send Vibe', () => {
    const withFiveVibes = {
      ...params,
      vibes: {
        enabled: true,
        normalizeStrengths: true,
        slots: Array.from({ length: 5 }, (_, index) => ({ vibeId: `v${index}`, encodingId: `e${index}`, informationExtracted: 1, strength: 0.2 })),
      },
    };
    expect(estimateImageEditCost(withFiveVibes, 'image-to-image', 1, false, 4, false)
      - estimateImageEditCost(withFiveVibes, 'inpaint', 1, false, 4, false)).toBe(2);
  });

  it('treats strength 0 as a valid minimum that scales cost to near zero', () => {
    const atFull = estimateImageEditCost(params, 'image-to-image', 1, false, 4, false);
    const atZero = estimateImageEditCost(params, 'image-to-image', 0, false, 4, false);
    expect(atZero).toBeLessThan(atFull);
    expect(atZero).toBeLessThanOrEqual(2);
  });
});
