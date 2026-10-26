// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeManager } from '../../components/VibeManager';
import type { NAIParams } from '../../types';
const fixtures = vi.hoisted(() => ({ encodingCost: 2, needsEncoding: false, multipleModels: false, unknownInformation: false, encode: vi.fn(), download: vi.fn(), downloadGroup: vi.fn(), importFile: vi.fn(), resolveParams: vi.fn(), confirm: vi.fn(async () => true), refresh: vi.fn(async () => ({ active: false, tier: 0 })) }));

vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: { vibeEncodingCost: fixtures.encodingCost, freeVibeCount: 4, extraVibeCost: 2 } }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsVibes: true }) }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 1666 }) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ refreshIfStale: fixtures.refresh }), isNovelaiSubscriptionInactive: (info: { active: boolean }) => info?.active === false }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => fixtures.confirm }));
vi.mock('../../services/vibeService', () => ({ vibeService: {
  list: async () => [{ id: 'new', name: '新 Vibe', hasOriginal: true, encodings: fixtures.needsEncoding ? [] : [{ id: 'new-encoded', model: 'nai-diffusion-4-5-full', informationExtracted: 1, informationKnown: !fixtures.unknownInformation }, ...(fixtures.multipleModels ? [{ id: 'curated-encoded', model: 'nai-diffusion-4-5-curated', informationExtracted: 1 }] : [])] }],
  listGroups: async () => [{ id: 'group-five', name: '五图组合', slots: Array.from({ length: 5 }, (_, i) => ({ vibeId: `v-${i}`, encodingId: `e-${i}`, informationExtracted: 1, strength: 0.2 })), normalizeStrengths: true }],
  encode: fixtures.encode,
  download: fixtures.download,
  downloadGroup: fixtures.downloadGroup,
  importFile: fixtures.importFile,
  resolveParams: fixtures.resolveParams,
} }));
afterEach(() => { cleanup(); fixtures.encodingCost = 2; fixtures.needsEncoding = false; fixtures.multipleModels = false; fixtures.unknownInformation = false; fixtures.encode.mockReset(); fixtures.download.mockReset(); fixtures.downloadGroup.mockReset(); fixtures.importFile.mockReset(); fixtures.resolveParams.mockReset(); fixtures.confirm.mockReset().mockResolvedValue(true); fixtures.refresh.mockClear(); });
const slots = Array.from({ length: 4 }, (_, i) => ({ vibeId: `v-${i}`, encodingId: `e-${i}`, informationExtracted: 1, strength: 0.2 }));
const params: NAIParams = { model: 'nai-diffusion-4-5-full', steps: 28, width: 832, height: 1216, scale: 5, sampler: 'k_euler_ancestral',
  vibes: { enabled: true, normalizeStrengths: true, slots } };
describe('Vibe 复用与编码入口', () => {
  it('管理窗口未打开时免费导入已有编码，等待期间的新参数仍保留', async () => {
    const pending = Promise.withResolvers<NAIParams>();
    fixtures.resolveParams.mockReturnValue(pending.promise);
    const embedded = { model: params.model!, encodings: ['synthetic'], strengths: [0.6] };
    const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [], embedded } };
    const setParams = vi.fn();
    const props = { params: initial, setParams, notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' };
    const view = render(React.createElement(VibeManager, props));
    expect(fixtures.resolveParams).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(React.createElement(VibeManager, { ...props, params: { ...initial, scale: 8 } }));
    await act(async () => pending.resolve({ ...initial, vibes: { enabled: true, normalizeStrengths: true, slots } }));
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ scale: 8, vibes: expect.objectContaining({ slots }) }));
    expect(fixtures.encode).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled();
  });

  it.each(['new-import', 'clear', 'unmount'])('免费导入等待期间 %s 后，旧响应不会覆盖新选择', async action => {
    const pending = Promise.withResolvers<NAIParams>();
    fixtures.resolveParams.mockReturnValueOnce(pending.promise).mockReturnValueOnce(new Promise(() => {}));
    const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [], embedded: { model: params.model!, encodings: ['first'], strengths: [0.6] } } };
    const setParams = vi.fn();
    const props = { params: initial, setParams, notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' };
    const view = render(React.createElement(VibeManager, props));
    expect(fixtures.resolveParams).toHaveBeenCalledOnce();
    if (action === 'unmount') view.unmount();
    else view.rerender(React.createElement(VibeManager, { ...props, params: { ...params, vibes: { enabled: false, normalizeStrengths: false, slots: [], ...(action === 'new-import' ? { embedded: { model: params.model!, encodings: ['second'], strengths: [0.4] } } : {}) } } }));
    await act(async () => pending.resolve({ ...initial, vibes: { enabled: true, normalizeStrengths: true, slots } }));
    expect(setParams).not.toHaveBeenCalled();
    if (action === 'clear') {
      fireEvent.click(screen.getByRole('button', { name: '管理' }));
      expect(screen.getByRole('button', { name: '上传并编码' })).toHaveProperty('disabled', false);
      expect(screen.getByRole('button', { name: '导入文件' })).toHaveProperty('disabled', false);
    }
    expect(fixtures.encode).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled();
  });

  it.each(['character-reference', 'normalization', 'add-slot'])('免费导入等待期间修改 %s，完成后保留最新选择', async action => {
    const pending = Promise.withResolvers<NAIParams>();
    fixtures.resolveParams.mockReturnValue(pending.promise);
    const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [], embedded: { model: params.model!, encodings: ['first'], strengths: [0.6] } } };
    const setParams = vi.fn();
    const props = { params: initial, setParams, notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' };
    const view = render(React.createElement(VibeManager, props));
    if (action === 'character-reference') {
      view.rerender(React.createElement(VibeManager, { ...props, params: { ...initial, vibes: { ...initial.vibes, enabled: false },
        characterReferences: { enabled: true, slots: [{ assetId: 'role', type: 'character', strength: 1, fidelity: 0.6 }] } } }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: '管理' }));
      await screen.findByRole('button', { name: /新 Vibe/ });
      if (action === 'normalization') fireEvent.click(screen.getByRole('checkbox', { name: /超限自动归一化/ }));
      else fireEvent.click(screen.getByRole('button', { name: /新 Vibe/ }));
    }
    const selected = setParams.mock.lastCall?.[0].vibes.slots;
    await act(async () => pending.resolve({ ...initial, vibes: { enabled: true, normalizeStrengths: true, slots } }));
    const result: NAIParams = setParams.mock.lastCall![0];
    expect(result.vibes?.embedded).toBeUndefined();
    if (action === 'character-reference') {
      expect(result.vibes?.enabled).toBe(false);
      expect(result.characterReferences?.enabled).toBe(true);
    } else if (action === 'normalization') {
      expect(result.vibes?.normalizeStrengths).toBe(false);
      expect(result.vibes?.slots).toEqual(slots);
    } else expect(result.vibes?.slots).toEqual(selected);
    expect(fixtures.encode).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled();
  });

  it('纯编码在参数选择中显示未知，正负强度按绝对值显示有效总量', async () => {
    fixtures.unknownInformation = true;
    const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [-0.6, 0.6].map(strength => ({ vibeId: 'new', encodingId: 'new-encoded', informationExtracted: 1, informationKnown: false, strength })) } };
    render(React.createElement(VibeManager, { params: initial, setParams: vi.fn(), notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' }));
    expect(screen.getByText('有效总强度 1.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '管理' })); await screen.findByRole('button', { name: /新 Vibe/ });
    fireEvent.click(screen.getByText('参数 · 强度 -0.60'));
    expect(screen.getAllByRole('option', { name: '提取量 未知', hidden: true })).toHaveLength(2);
    expect(screen.queryByRole('option', { name: '提取量 1.00', hidden: true })).toBeNull();
    expect(fixtures.encode).not.toHaveBeenCalled();
  });

  it('Curated 直接选取自己的已有编码，切模型只复用，不发出付费编码', async () => {
    fixtures.multipleModels = true;
    const setParams = vi.fn();
    const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'new', encodingId: 'new-encoded', informationExtracted: 1, strength: -0.4 }] } };
    const props = { params: initial, setParams, notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' };
    const view = render(React.createElement(VibeManager, props));
    view.rerender(React.createElement(VibeManager, { ...props, params: { ...initial, model: 'nai-diffusion-4-5-curated' } }));
    await waitFor(() => expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ vibes: expect.objectContaining({ slots: [expect.objectContaining({ encodingId: 'curated-encoded', strength: -0.4 })] }) })));
    expect(fixtures.encode).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled();
  });

  it('数值输入保留负值和超过 1 的强度，并能复制同一参考与导出组合', async () => {
    const setParams = vi.fn();
    const initial = { ...params, vibes: { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'new', encodingId: 'new-encoded', informationExtracted: 1, strength: 1.5 }] } };
    render(React.createElement(VibeManager, { params: initial, setParams, notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' }));
    fireEvent.click(screen.getByRole('button', { name: '管理' })); await screen.findByRole('button', { name: /新 Vibe/ });
    fireEvent.click(screen.getByText('参数 · 强度 1.50'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-2.5' } });
    expect(setParams.mock.lastCall?.[0].vibes.slots[0].strength).toBe(-2.5);
    fireEvent.click(screen.getByRole('button', { name: '添加副本' }));
    expect(setParams.mock.lastCall?.[0].vibes.slots).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: '组合管理' }));
    fireEvent.click(screen.getByRole('button', { name: '导出当前组合' }));
    expect(fixtures.downloadGroup).toHaveBeenCalledWith('', initial.vibes.slots, false);
    expect(fixtures.encode).not.toHaveBeenCalled();
  });

  it.each(['append', 'replace'])('官方组合导入 %s 保留顺序和强度，不请求付费编码', async mode => {
    const incoming = [{ vibeId: 'imported', encodingId: 'ie', informationExtracted: 0.7, informationKnown: false, strength: -0.3 }];
    fixtures.importFile.mockResolvedValue({ item: { id: 'imported', name: '导入素材' }, slots: incoming, bundle: true, imported: 1, normalizeStrengths: false });
    const setParams = vi.fn();
    render(React.createElement(VibeManager, { params, setParams, notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' }));
    fireEvent.click(screen.getByRole('button', { name: '管理' })); await screen.findByRole('button', { name: /新 Vibe/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Vibe 导入方式' }), { target: { value: mode } });
    fireEvent.change(screen.getByLabelText('导入 Vibe 编码文件'), { target: { files: [new File(['{}'], '组合.naiv4vibeBundle', { type: 'application/json' })] } });
    await waitFor(() => expect(setParams).toHaveBeenCalled());
    expect(setParams.mock.lastCall?.[0].vibes.slots).toEqual(mode === 'append' ? [...slots, ...incoming] : incoming);
    expect(fixtures.encode).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled();
  });
  it('Vibe导出目录权限失败沿用现有错误反馈，不留下未处理Promise', async () => {
    fixtures.download.mockRejectedValue(new Error('导出目录权限已失效，请重新选择目录'));
    const notify = vi.fn();
    render(React.createElement(VibeManager, { params, setParams: vi.fn(), notify, markChange: vi.fn(), apiKey: 'synthetic' }));
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '详情' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 .naiv4vibe' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('导出目录权限已失效，请重新选择目录', 'error'));
    expect(notify).toHaveBeenCalledTimes(1);
  });
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
    fixtures.encode.mockResolvedValue({ item: { id: 'new', name: '新 Vibe', encodings: [{ id: 'paid-encoded', model: 'nai-diffusion-4-5-full', informationExtracted: 0.7 }] } });
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
    expect(fixtures.encode).toHaveBeenCalledWith('new', 0.7, 'test-key', 'nai-diffusion-4-5-full');
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
