// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileGenerationResources } from '../../components/MobileGenerationResources';
import { DEFAULT_NAI_RUNTIME, type NaiRuntimeConfig } from '../../services/naiRuntime';
import type { useNovelaiUsage } from '../../services/naiUsage';

type Subscription = ReturnType<typeof useNovelaiUsage>;
const fixture = vi.hoisted(() => ({
  subscription: null as Subscription | null,
  runtime: null as NaiRuntimeConfig | null,
  list: vi.fn(),
}));
vi.mock('../../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiUsage')>(),
  useNovelaiUsage: () => fixture.subscription,
}));
vi.mock('../../services/naiRuntime', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiRuntime')>(),
  useNaiRuntime: () => fixture.runtime,
}));
vi.mock('../../services/naiKeyVault', () => ({ naiKeyVault: { list: fixture.list } }));
const props = (apiKey = 'mobile-resources-synthetic-key') => ({
  apiKey, budget: { remaining: 1666, loading: false }, subscription: fixture.subscription!, runtime: fixture.runtime,
});
const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /^查看账户资源/ }));
beforeEach(() => {
  fixture.subscription = {
    info: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 68320 } },
    usage: { percent: 196, isNegative: false, timeUntilNextPercent: 0 },
    loading: false, error: null, fetchedAt: new Date('2026-10-04T03:04:05Z').getTime(),
    refresh: vi.fn(async () => null), refreshIfStale: vi.fn(async () => null),
  };
  fixture.runtime = { ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } };
  fixture.list.mockReset().mockResolvedValue([{ key: 'mobile-resources-synthetic-key', name: '合成主号' }]);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('手机实验室账户资源', () => {
  it('摘要紧凑显示来源，触屏展开保留完整点数、196% 真实额度、张数、备注、同步时间与刷新', async () => {
    render(<MobileGenerationResources {...props()} />);
    const entry = screen.getByRole('button', { name: /预算 1666 · 余额 6.84万 · Opus 196%/ });
    expect(entry.className).toContain('md:hidden');
    expect(entry.className.split(' ')).not.toContain('hidden');
    entry.focus(); fireEvent.click(entry);
    const dialog = screen.getByRole('dialog', { name: '账户资源' });
    expect(await within(dialog).findByText('合成主号')).toBeTruthy();
    expect(dialog.textContent).not.toContain('mobile-resources-synthetic-key');
    expect(within(dialog).getByText('68,420 点')).toBeTruthy();
    expect(within(dialog).getByText('100 / 68,320')).toBeTruthy();
    expect(within(dialog).getByText('≈3391 张')).toBeTruthy();
    expect(within(dialog).getByText(/最近同步/)).toBeTruthy();
    expect(within(dialog).getByText('最近成功同步').nextElementSibling?.textContent).not.toBe('尚未同步');
    fireEvent.click(within(dialog).getByRole('button', { name: /刷新 Anlas 余额/ }));
    expect(fixture.subscription!.refresh).toHaveBeenCalledTimes(1);
    expect(props().budget.remaining).toBe(1666);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(entry);
  });
  it.each([
    ['缺失', undefined],
    ['负数', { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: -1 }],
    ['非法数值', { fixedTrainingStepsLeft: NaN, purchasedTrainingSteps: 20 }],
    ['溢出', { fixedTrainingStepsLeft: Number.MAX_VALUE, purchasedTrainingSteps: Number.MAX_VALUE }],
  ] as const)('官方余额%s时未知，不冒充零或把本地预算当余额', (_label, balance) => {
    fixture.subscription!.info!.trainingStepsLeft = balance;
    render(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /预算 1666 · 余额 未知/ })).toBeTruthy();
    openPanel();
    expect(screen.getByText('官方余额').nextElementSibling?.textContent).toBe('未知');
    expect(screen.queryByText('0 点')).toBeNull();
  });
  it('明确的零余额与零预算保留两个零，透支提示实际耗尽并标红', () => {
    fixture.subscription!.info!.trainingStepsLeft = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 };
    fixture.subscription!.usage = { percent: -3, isNegative: true, timeUntilNextPercent: 100 };
    render(<MobileGenerationResources {...props()} budget={{ remaining: 0, loading: false }} />);
    const entry = screen.getByRole('button', { name: /预算 0 · 余额 0 · Opus 已用尽/ });
    expect(entry.querySelector('span')?.className).toContain('text-red-600');
    openPanel();
    expect(screen.getAllByText('0 点')).toHaveLength(2);
    expect(screen.getByText('额度已用尽，生成将消耗 Anlas')).toBeTruthy();
  });
  it('刷新失败标记余额和额度旧值，触屏能读错误与计费规则异常，不只放在 title', () => {
    fixture.subscription!.error = '合成网络断开';
    fixture.runtime!.health = { ok: false, reason: 'extract-failed', missed: ['freeMaxSteps'] };
    render(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /余额 6.84万（旧值）.*Opus 196% · 旧值 · 规则异常/ })).toBeTruthy();
    openPanel();
    expect(screen.getByText('显示上次余额：合成网络断开')).toBeTruthy();
    expect(screen.getByText('上次额度 196%（≈3391 张）：合成网络断开')).toBeTruthy();
    expect(screen.getByText('计费规则同步异常，张数换算可能过期')).toBeTruthy();
  });
  it('首次查询失败只说未知，不宣称有上次状态；重试与未完成请求显示不同状态', () => {
    fixture.subscription!.info = null; fixture.subscription!.usage = undefined; fixture.subscription!.fetchedAt = 0;
    fixture.subscription!.error = '合成查询失败';
    const view = render(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /余额 未知 · 额度查询失败/ })).toBeTruthy();
    openPanel();
    expect(screen.getByText('额度未知：合成查询失败')).toBeTruthy();
    expect(screen.queryByText(/上次/)).toBeNull();
    fireEvent.click(screen.getByRole('status', { name: /同步失败/ }));
    expect(fixture.subscription!.refresh).toHaveBeenCalledTimes(1);
    fixture.subscription = { ...fixture.subscription!, loading: true, error: null };
    view.rerender(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /余额 … · 额度同步中/ })).toBeTruthy();
  });
  it('过期订阅保留 Paid 余额，但不显示残留免费百分比，也不误报 Key 失效', () => {
    fixture.subscription!.info!.active = false;
    render(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /余额 6.84万 · 订阅过期/ })).toBeTruthy();
    openPanel();
    expect(screen.queryByText('196%')).toBeNull();
    expect(screen.getByRole('status', { name: /订阅已过期 · Paid Anlas：68,320 点/ })).toBeTruthy();
    expect(screen.queryByText(/Key 失效/)).toBeNull();
  });
  it('未配置、非 Opus 和 Opus 缺失额度分别表达', () => {
    fixture.subscription!.info = null; fixture.subscription!.usage = undefined;
    const view = render(<MobileGenerationResources {...props('')} />);
    expect(screen.getByRole('button', { name: '查看账户资源：未配置 Key' })).toBeTruthy();
    expect(fixture.list).not.toHaveBeenCalled();
    fixture.subscription!.info = { active: true, tier: 1 };
    view.rerender(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /非 Opus/ })).toBeTruthy();
    fixture.subscription!.info = { active: true, tier: 3 };
    view.rerender(<MobileGenerationResources {...props()} />);
    expect(screen.getByRole('button', { name: /额度未知/ })).toBeTruthy();
  });
  it('备注查询迟到与切 Key 不串账号，面板不泄露密钥明文', async () => {
    let finish!: (entries: unknown[]) => void;
    fixture.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<MobileGenerationResources {...props()} />); openPanel();
    fixture.list.mockResolvedValueOnce([{ key: 'second-synthetic-key', name: '合成副号' }]);
    fixture.subscription = { ...fixture.subscription!, info: null, usage: undefined, loading: true, fetchedAt: 0 };
    view.rerender(<MobileGenerationResources {...props('second-synthetic-key')} />);
    expect(await screen.findByText('合成副号')).toBeTruthy();
    await act(async () => finish([{ key: 'mobile-resources-synthetic-key', name: '旧主号' }]));
    expect(screen.queryByText('旧主号')).toBeNull();
    expect(screen.getByText('官方余额').nextElementSibling?.textContent).toBe('未知');
    expect(screen.getByRole('dialog').textContent).not.toContain('second-synthetic-key');
  });
  it('手机从资源面板进入账户设置时，先退掉资源历史层，不误关新设置', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const navigate = vi.fn((event: Event) => {
      expect(window.history.state?.__naiMobileLayer).toBeUndefined();
      expect((event as CustomEvent).detail.section).toBe('novelai');
    });
    window.addEventListener('nai-open-global-settings', navigate);
    try {
      render(<MobileGenerationResources {...props()} />); openPanel();
      expect(window.history.state?.__naiMobileLayer).toMatch(/^sheet-/);
      fireEvent.click(screen.getByRole('button', { name: '账户设置' }));
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally { window.removeEventListener('nai-open-global-settings', navigate); }
  });
  it('恢复桌面宽度时关闭手机面板，不留下隐藏的模态与历史层', () => {
    let resize!: () => void;
    const desktop = { matches: false, addEventListener: vi.fn((_type: string, callback: () => void) => { resize = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', (query: string) => query.includes('min-width') ? desktop : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<MobileGenerationResources {...props()} />); openPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => { desktop.matches = true; resize(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(desktop.removeEventListener).toHaveBeenCalledWith('change', resize);
  });
});
