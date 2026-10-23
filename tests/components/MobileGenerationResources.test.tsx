// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileGenerationResources } from '../../components/MobileGenerationResources';
import { DEFAULT_NAI_RUNTIME, type NaiRuntimeConfig } from '../../services/naiRuntime';
import type { useNovelaiUsage } from '../../services/naiUsage';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';

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
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });

describe('手机实验室账户资源', () => {
  it.each(['正常', '旧值', '耗尽'])('成员摘要%s时五语完整翻译，数字保持原值', state => {
    fixture.subscription!.info!.source = 'gateway';
    if (state === '旧值') fixture.subscription!.error = '网关余额查询失败';
    if (state === '耗尽') fixture.subscription!.usage = { percent: 0, isNegative: true, timeUntilNextPercent: 0 };
    render(<MobileGenerationResources {...props('STA1N-translated-member')} />);
    for (const language of LANGUAGES) {
      act(() => setLanguage(language.code));
      const footer = screen.getByRole('button');
      expect(footer.textContent).toContain(t('成员额度'));
      expect(footer.textContent).toContain(state === '耗尽' ? '0.00%' : '196.00%');
      if (language.code === 'en') expect(footer.getAttribute('aria-label')).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
  it('首次成员查询失败使用未知来源标签，不提示官方余额或 Opus', () => {
    fixture.subscription = { ...fixture.subscription!, info: null, usage: undefined, error: '网关余额查询失败' };
    render(<MobileGenerationResources {...props('STA1N-first-failure')} />);
    expect(screen.getByRole('button').textContent).toContain('生成额度');
    expect(screen.getByRole('button').textContent).not.toContain('Opus');
    openPanel();
    expect(screen.getByText('账号余额')).toBeTruthy();
    expect(screen.queryByText('官方余额')).toBeNull();
  });
  it('成员 Key 摘要和详情都显示成员来源', async () => {
    fixture.subscription!.info!.source = 'gateway';
    render(<MobileGenerationResources {...props('STA1N-mobile-member')} />);
    const footer = screen.getByRole('button', { name: /成员额度 196\.00%/ });
    expect(footer.textContent).toContain('成员额度 196.00%');
    expect(footer.textContent).not.toContain('Opus');
    openPanel();
    expect(await screen.findByText('网关余额')).toBeTruthy();
    expect(screen.getByText('网关成员')).toBeTruthy();
    expect(screen.queryByText('官方余额')).toBeNull();
  });
  it.each([false, true])('成员小数额度在底栏、摘要和详情统一保留两位，刷新失败=%s', failed => {
    fixture.subscription!.info!.source = 'gateway';
    fixture.subscription!.usage!.percent = 12.7773534897032;
    if (failed) fixture.subscription!.error = '合成网络断开';
    render(<MobileGenerationResources {...props('STA1N-mobile-decimal')} />);
    const footer = screen.getByRole('button', { name: /成员额度 12\.78%/ });
    expect(footer.textContent).toContain('成员额度 12.78%');
    expect(footer.getAttribute('aria-label')).not.toContain('12.7773534897032');
    openPanel();
    if (failed) expect(screen.getByText('上次额度 12.78%（≈221 张）：合成网络断开')).toBeTruthy();
    else {
      expect(screen.getByText('12.78%')).toBeTruthy();
      expect(screen.getByRole('status').title).toContain('成员额度：12.78%（约 221 张）');
    }
    expect(fixture.subscription!.usage!.percent).toBe(12.7773534897032);
  });
  it('摘要紧凑显示来源，触屏展开保留完整点数、196% 真实额度、张数、备注、同步时间与刷新', async () => {
    render(<MobileGenerationResources {...props()} />);
    const entry = screen.getByRole('button', { name: /预算 1666 · 余额 6.84万 · Opus 196%/ });
    expect(entry.className).toContain('md:hidden');
    expect(entry.className.split(' ')).not.toContain('hidden');
    expect(entry.textContent).toBe('Anlas 1666/6.84万Opus额度 196%');
    expect(entry.querySelector('svg')?.classList.contains('lucide-chevron-up')).toBe(true);
    expect(entry.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(entry.firstElementChild?.className).toContain('decoration-dotted');
    expect(entry.className).not.toContain('appearance-panel');
    entry.focus(); fireEvent.click(entry);
    const dialog = screen.getByRole('dialog', { name: '账户资源' });
    expect(await within(dialog).findByText('合成主号')).toBeTruthy();
    expect(dialog.textContent).not.toContain('mobile-resources-synthetic-key');
    expect(within(dialog).getByText('68,420 点')).toBeTruthy();
    expect(within(dialog).getByText('100 / 68,320')).toBeTruthy();
    expect(within(dialog).getByText('≈3391 张')).toBeTruthy();
    expect(within(dialog).queryByText(/最近同步/)).toBeNull();
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
    expect(entry.textContent).toBe('Anlas 0/0Opus额度 0%');
    openPanel();
    expect(screen.getAllByText('0 点')).toHaveLength(2);
    expect(screen.getByText('额度已用尽，生成将消耗 Anlas')).toBeTruthy();
  });
  it('刷新失败标记余额和额度旧值，触屏能读错误与计费规则异常，不只放在 title', () => {
    fixture.subscription!.error = '合成网络断开';
    fixture.runtime!.health = { ok: false, reason: 'extract-failed', missed: ['freeMaxSteps'] };
    render(<MobileGenerationResources {...props()} />);
    const entry = screen.getByRole('button', { name: /余额 6.84万（旧值）.*Opus 196% · 旧值 · 规则异常/ });
    expect(entry.textContent).toBe('Anlas 1666/6.84万Opus额度 196%!');
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
    expect(screen.getByRole('button', { name: /^查看账户资源/ }).textContent).toBe('Anlas 1666/6.84万Opus额度 —!');
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
    expect(screen.getByText('账号余额').nextElementSibling?.textContent).toBe('未知');
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
  it('两项作为同一组居中贴底，键盘弹起后整体避让，收起只显示标签和数值', () => {
    fixture.subscription!.info!.trainingStepsLeft = { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 9885 };
    fixture.subscription!.usage!.percent = 100;
    const view = render(<MobileGenerationResources {...props()} />);
    const entry = screen.getByRole('button', { name: /^查看账户资源/ });
    expect(entry.textContent).toBe('Anlas 1666/9985Opus额度 100%');
    for (const token of ['fixed', 'inset-x-0', 'mx-auto', 'w-max', 'justify-center', 'gap-3', 'text-meta']) expect(entry.className.split(' ')).toContain(token);
    expect(entry.className).not.toContain('justify-between');
    expect(entry.style.bottom).toBe('');
    view.rerender(<MobileGenerationResources {...props()} keyboardOffset={260} />);
    expect(entry.style.bottom).toBe('calc(260px + env(safe-area-inset-bottom))');
  });
  it('详情限制阅读宽度，点数只显示一次，状态值紧邻标签且不推向右边缘', () => {
    render(<MobileGenerationResources {...props()} />); openPanel();
    const dialog = screen.getByRole('dialog');
    const status = within(dialog).getByText('订阅状态');
    expect(status.parentElement?.className).toContain('grid-cols-[max-content_minmax(0,1fr)]');
    expect(status.nextElementSibling?.className).not.toContain('text-right');
    expect(status.parentElement?.parentElement?.className).toContain('max-w-sm');
    expect(within(dialog).getAllByText('本地预算')).toHaveLength(1);
    expect(within(dialog).getAllByText('官方余额')).toHaveLength(1);
    expect(within(dialog).getAllByText('本地预算 ≠ 官方余额')).toHaveLength(1);
  });
});
