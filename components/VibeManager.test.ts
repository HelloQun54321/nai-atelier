// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeManager } from './VibeManager';
import type { NAIParams } from '../types';
const fixtures = vi.hoisted(() => ({ enabled: true, encode: vi.fn() }));
vi.mock('../services/lowConsumption', () => ({ useLowConsumption: () => ({ enabled: fixtures.enabled }) }));
vi.mock('../services/naiRuntime', () => ({ useNaiRuntime: () => ({}) }));
vi.mock('../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsVibes: true }) }));
vi.mock('../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 1666 }) }));
vi.mock('../services/naiUsage', () => ({ useNovelaiUsage: () => ({ refreshIfStale: vi.fn() }), isNovelaiSubscriptionInactive: () => false }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('../services/vibeService', () => ({ vibeService: {
  list: async () => [{ id: 'new', name: '新 Vibe', hasOriginal: true, encodings: [{ id: 'new-encoded', model: 'nai-diffusion-4-5-full', informationExtracted: 1 }] }],
  listGroups: async () => [{ id: 'group-five', name: '五图组合', slots: Array.from({ length: 5 }, (_, i) => ({ vibeId: `v-${i}`, encodingId: `e-${i}`, informationExtracted: 1, strength: 0.2 })), normalizeStrengths: true }],
  encode: fixtures.encode,
} }));
afterEach(() => { cleanup(); fixtures.enabled = true; fixtures.encode.mockClear(); });
const slots = Array.from({ length: 4 }, (_, i) => ({ vibeId: `v-${i}`, encodingId: `e-${i}`, informationExtracted: 1, strength: 0.2 }));
const params: NAIParams = { model: 'nai-diffusion-4-5-full', steps: 28, width: 832, height: 1216, scale: 5, sampler: 'k_euler_ancestral',
  vibes: { enabled: true, normalizeStrengths: true, slots } };
describe('低消耗 Vibe 复用入口', () => {
  it('界面最多选四个，五图组合不会覆盖原选择，也不触发新编码；关闭恢复十六个', async () => {
    const setParams = vi.fn(), notify = vi.fn();
    const props = { params, setParams, notify, markChange: vi.fn(), apiKey: 'test-key' };
    const { rerender } = render(React.createElement(VibeManager, props));
    expect(screen.getByText('4 / 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    const add = await screen.findByRole('button', { name: /新 Vibe/ });
    fireEvent.click(add);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('一次最多启用 4 个 Vibe', 'error'));
    fireEvent.click(screen.getByRole('button', { name: /五图组合 5 个 Vibe/ }));
    expect(setParams).not.toHaveBeenCalled();
    expect(fixtures.encode).not.toHaveBeenCalled();
    expect(params.vibes?.slots).toBe(slots);
    fixtures.enabled = false;
    rerender(React.createElement(VibeManager, props));
    expect(screen.getByText('4 / 16')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /五图组合 5 个 Vibe/ }));
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ vibes: expect.objectContaining({ slots: expect.arrayContaining([expect.objectContaining({ vibeId: 'v-4' })]) }) }));
  });
});
