// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeManager } from '../../components/VibeManager';
import type { NAIParams } from '../../types';
const fixtures = vi.hoisted(() => ({ encodingCost: 2, needsEncoding: false, encode: vi.fn(), confirm: vi.fn(async () => true), refresh: vi.fn(async () => ({ active: false, tier: 0 })) }));

vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: { vibeEncodingCost: fixtures.encodingCost } }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsVibes: true }) }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 1666 }) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ refreshIfStale: fixtures.refresh }), isNovelaiSubscriptionInactive: (info: { active: boolean }) => info?.active === false }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => fixtures.confirm }));
vi.mock('../../services/vibeService', () => ({ vibeService: {
  list: async () => [{ id: 'new', name: '新 Vibe', hasOriginal: true, encodings: fixtures.needsEncoding ? [] : [{ id: 'new-encoded', model: 'nai-diffusion-4-5-full', informationExtracted: 1 }] }],
  listGroups: async () => [{ id: 'group-five', name: '五图组合', slots: Array.from({ length: 5 }, (_, i) => ({ vibeId: `v-${i}`, encodingId: `e-${i}`, informationExtracted: 1, strength: 0.2 })), normalizeStrengths: true }],
  encode: fixtures.encode,
} }));
afterEach(() => { cleanup(); fixtures.encodingCost = 2; fixtures.needsEncoding = false; fixtures.encode.mockReset(); fixtures.confirm.mockReset().mockResolvedValue(true); fixtures.refresh.mockClear(); });
const slots = Array.from({ length: 4 }, (_, i) => ({ vibeId: `v-${i}`, encodingId: `e-${i}`, informationExtracted: 1, strength: 0.2 }));
const params: NAIParams = { model: 'nai-diffusion-4-5-full', steps: 28, width: 832, height: 1216, scale: 5, sampler: 'k_euler_ancestral',
  vibes: { enabled: true, normalizeStrengths: true, slots } };
describe('Vibe 复用与编码入口', () => {
  it('新编码确认与预算预测跟随官方动态单价', async () => {
    fixtures.encodingCost = 6; fixtures.needsEncoding = true; fixtures.confirm.mockResolvedValueOnce(false);
    render(React.createElement(VibeManager, { params: { ...params, vibes: { ...params.vibes!, slots: [] } }, setParams: vi.fn(), notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' }));
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(await screen.findByRole('button', { name: /新 Vibe/ }));
    await waitFor(() => expect(fixtures.confirm).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: '支付 6 Anlas 并生成', message: expect.stringContaining('1666 → 1660'),
    })));
    expect(fixtures.encode).not.toHaveBeenCalled();
  });
  it('费用确认期间切换 Key 时不发出旧 Key 的编码请求', async () => {
    fixtures.needsEncoding = true;
    let confirm!: (value: boolean) => void;
    fixtures.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve; }));
    const props = { params: { ...params, vibes: { ...params.vibes!, slots: [] } }, setParams: vi.fn(), notify: vi.fn(), markChange: vi.fn(), apiKey: 'first-synthetic-key' };
    const view = render(React.createElement(VibeManager, props));
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(await screen.findByRole('button', { name: /新 Vibe/ }));
    await waitFor(() => expect(fixtures.confirm).toHaveBeenCalledOnce());
    view.rerender(React.createElement(VibeManager, { ...props, apiKey: 'second-synthetic-key' }));
    confirm(true);
    await waitFor(() => expect((screen.getByRole('button', { name: '上传并编码' }) as HTMLButtonElement).disabled).toBe(false));
    expect(fixtures.encode).not.toHaveBeenCalled(); expect(props.setParams).not.toHaveBeenCalled();
  });
  it('订阅过期仍可手动编码，取消费用确认不调用上游，确认后仅编码一次', async () => {
    fixtures.needsEncoding = true;
    fixtures.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    fixtures.encode.mockResolvedValue({ item: { id: 'new', name: '新 Vibe', encodings: [{ id: 'paid-encoded', model: 'nai-diffusion-4-5-full', informationExtracted: 1 }] } });
    const setParams = vi.fn(), notify = vi.fn();
    render(React.createElement(VibeManager, { params: { ...params, vibes: { ...params.vibes!, slots: [] } }, setParams, notify, markChange: vi.fn(), apiKey: 'test-key' }));
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    const add = await screen.findByRole('button', { name: /新 Vibe/ });
    fireEvent.click(add);
    await waitFor(() => expect(fixtures.confirm).toHaveBeenCalledTimes(1));
    expect(fixtures.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: '支付 2 Anlas 并生成', message: expect.stringContaining('本次估算：2 Anlas') }));
    expect(fixtures.encode).not.toHaveBeenCalled();
    expect(setParams).not.toHaveBeenCalled();
    fireEvent.click(add);
    await waitFor(() => expect(fixtures.encode).toHaveBeenCalledTimes(1));
    expect(fixtures.encode).toHaveBeenCalledWith('new', 1, 'test-key');
    await waitFor(() => expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ vibes: expect.objectContaining({ slots: [expect.objectContaining({ encodingId: 'paid-encoded' })] }) })));
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('密钥已失效'), 'error');
  });
  it('保留十六个选择上限，五图组合可直接复用已有编码', async () => {
    const setParams = vi.fn(), notify = vi.fn();
    render(React.createElement(VibeManager, { params, setParams, notify, markChange: vi.fn(), apiKey: 'test-key' }));
    expect(screen.getByText('4 / 16')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    await screen.findByRole('button', { name: /新 Vibe/ });
    fireEvent.click(screen.getByRole('tab', { name: '组合管理' }));
    fireEvent.click(screen.getByRole('button', { name: /五图组合 5 个 Vibe/ }));
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ vibes: expect.objectContaining({ slots: expect.arrayContaining([expect.objectContaining({ vibeId: 'v-4' })]) }) }));
    expect(fixtures.encode).not.toHaveBeenCalled();
    expect(params.vibes?.slots).toBe(slots);
  });
});
