// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnlasBalanceBar } from '../../components/AnlasBalanceBar';
import { OpusUsageBar } from '../../components/OpusUsageBar';
import { hashNaiApiKey, useAnlasBudget } from '../../services/anlasBudget';
import { useNovelaiUsage } from '../../services/naiUsage';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { MobileGenerationResources } from '../../components/MobileGenerationResources';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';

type Subscription = React.ComponentProps<typeof AnlasBalanceBar>['subscription'];
const budget = { remaining: 1666, loading: false };
const subscription = (total = 8000, overrides: Partial<Subscription> = {}): Subscription => ({
  info: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: total } },
  loading: false, error: null, fetchedAt: new Date('2026-09-30T08:00:00Z').getTime(), refresh: vi.fn(async () => null), ...overrides,
});
const responseFor = (payload: unknown) => ({ ok: true, json: async () => payload, text: async () => '' }) as Response;
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });

describe('Anlas 预算／余额布局', () => {
  it('五种语言翻译余额详情、状态与悬停组合文案，保留真实数量', () => {
    render(React.createElement(AnlasBalanceBar, { variant: 'details', budget, subscription: subscription(200) }));
    for (const language of LANGUAGES) {
      act(() => setLanguage(language.code));
      expect(screen.getByText(t('本地预算')).nextElementSibling?.textContent).toContain('1,666');
      const refresh = screen.getByRole('button');
      expect(refresh.title).toContain(t('账号余额已同步'));
      if (language.code === 'en') expect(refresh.title).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
  it('设置与触屏详情将标签放在数值上方，以等宽两列保留完整余额和显式刷新入口', () => {
    const account = subscription(68420);
    render(React.createElement(AnlasBalanceBar, { variant: 'details', budget, subscription: account }));
    const label = screen.getByText('本地预算');
    const official = screen.getByText('官方余额');
    expect(label.nextElementSibling?.textContent).toBe('1,666 点');
    expect(official.nextElementSibling?.textContent).toBe('68,420 点');
    expect(label.parentElement?.parentElement?.className).toContain('grid-cols-2');
    expect(label.parentElement?.parentElement).toBe(official.parentElement?.parentElement);
    expect(official.parentElement?.className).toContain('min-w-0');
    expect(screen.queryByText('6.84万')).toBeNull();
    const refresh = screen.getByRole('button', { name: /刷新 Anlas 余额/ });
    expect(refresh.querySelector('svg')?.classList.contains('lucide-refresh-cw')).toBe(true);
    fireEvent.click(refresh);
    expect(account.refresh).toHaveBeenCalledTimes(1);
  });
  it('展开时横排个人预算与两种官方点数之和，说明明细和同步时间', () => {
    const account = subscription(200);
    account.info!.trainingStepsLeft!.fixedTrainingStepsLeft = 100;
    render(React.createElement(AnlasBalanceBar, { budget, subscription: account }));
    const row = screen.getByRole('button', { name: /个人剩余预算 1,666 点.*账号剩余点数 300 点/ });
    expect(screen.getByText('1666').className).toContain('text-indigo-600');
    expect(screen.getByText('300').className).toContain('text-gray-500');
    expect(screen.getByText('1666').parentElement?.parentElement?.className).toBe('contents');
    expect(screen.getByText('/')).toBeTruthy();
    expect(screen.getByText('Anlas')).toBeTruthy();
    expect(row.className).toContain('h-11');
    expect(row.title).toContain('订阅赠送：100 点；Paid Anlas：200 点');
    expect(row.title).toContain('最近成功同步');
    expect(row.title).toContain('共享账号余额不等于个人可支配点数');
    expect(budget.remaining).toBe(1666);
  });

  it('收起时固定 60px，上下分数与大数单位，不用省略号截断，展开恢复完整值', () => {
    const props = { budget, subscription: subscription(68420) };
    const view = render(React.createElement(AnlasBalanceBar, { ...props, collapsed: true }));
    const row = screen.getByRole('button', { name: /账号剩余点数 68,420 点/ });
    expect(row.className).toContain('h-[60px]');
    expect(screen.getByText('1666').parentElement?.className).toContain('flex-col');
    expect(screen.getByText('6.84万')).toBeTruthy();
    expect(screen.queryByText('/')).toBeNull();
    expect(row.title).toContain('68,420');
    expect(row.querySelector('.truncate')).toBeNull();
    view.rerender(React.createElement(AnlasBalanceBar, { ...props, collapsed: false }));
    expect(screen.getByText('68420')).toBeTruthy();
    expect(screen.getByText('/')).toBeTruthy();
    expect(screen.queryByText('6.84万')).toBeNull();
  });

  it('个人预算与账号余额为 0 时明确显示两个零，不显示未知', () => {
    render(React.createElement(AnlasBalanceBar, { budget: { ...budget, remaining: 0 }, subscription: subscription(0) }));
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('个人剩余预算 0 点 / 账号剩余点数 0 点');
    expect(screen.queryByText('—')).toBeNull();
  });

  it.each([
    ['缺失余额', undefined],
    ['负余额', { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: -1 }],
    ['非数值', { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: NaN }],
    ['总数溢出', { fixedTrainingStepsLeft: Number.MAX_VALUE, purchasedTrainingSteps: Number.MAX_VALUE }],
  ] as const)('%s 不伪造为零', (_label, balance) => {
    const account = subscription();
    account.info!.trainingStepsLeft = balance;
    render(React.createElement(AnlasBalanceBar, { budget, subscription: account }));
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByRole('button').title).toContain('账号余额未知');
    expect(screen.queryByText('0')).toBeNull();
  });

  it('过期订阅仍显示官方点数，个人预算可大于余额，不把分数当百分比', () => {
    const account = subscription(420);
    account.info!.active = false;
    render(React.createElement(AnlasBalanceBar, { budget, subscription: account }));
    expect(screen.getByText('1666')).toBeTruthy();
    expect(screen.getByText('420')).toBeTruthy();
    expect(screen.getByRole('button').title).toContain('订阅已过期');
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('较大数值使用有效数字控制单位长度，完整值保留在说明中', () => {
    render(React.createElement(AnlasBalanceBar, { collapsed: true, budget: { ...budget, remaining: 1_000_000_000 }, subscription: subscription(9_999_999) }));
    expect(screen.getByText('10.0亿')).toBeTruthy();
    expect(screen.getByText('1000万')).toBeTruthy();
    expect(screen.getByRole('button').title).toContain('9,999,999');
  });

  it('刷新失败保留上次值并明确提示；刷新中保持高度，完成后替换余额', () => {
    const failed = subscription(8000, { error: '模拟网络失败' });
    const view = render(React.createElement(AnlasBalanceBar, { budget, subscription: failed }));
    const row = screen.getByRole('button');
    expect(screen.getByText('8000').className).toContain('text-amber-600');
    expect(screen.getByText('!')).toBeTruthy();
    expect(row.title).toContain('刷新失败，显示上次同步值');
    expect(row.title).toContain('模拟网络失败');
    fireEvent.click(row);
    expect(failed.refresh).toHaveBeenCalledTimes(1);
    view.rerender(React.createElement(AnlasBalanceBar, { budget, subscription: subscription(8000, { loading: true }) }));
    expect(screen.getByText('8000')).toBeTruthy();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button').className).toContain('h-11');
    view.rerender(React.createElement(AnlasBalanceBar, { budget, subscription: subscription(7900) }));
    expect(screen.getByText('7900')).toBeTruthy();
    expect(screen.queryByText('8000')).toBeNull();
    expect(screen.queryByText('!')).toBeNull();
  });
});

// 使用真实 Hook 与模拟接口，验证复用查询、刷新广播及 Key／迟到响应隔离。
const Harness: React.FC = () => {
  const budget = useAnlasBudget();
  const subscription = useNovelaiUsage();
  return React.createElement(React.Fragment, null,
    React.createElement(AnlasBalanceBar, { budget, subscription }),
    React.createElement(OpusUsageBar, { collapsed: false }));
};
const opusInfo = (paid: number, percent: number) => ({ active: true, tier: 3,
  trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: paid },
  usage: { percent, isNegative: false, timeUntilNextPercent: 0 } });
const runtimeResponse = () => responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } });

describe('Anlas 官方余额与订阅驱动', () => {
  it('打开手机资源详情不新增订阅请求，点按 Opus 同时更新余额和摘要且仅查询一次', async () => {
    const key = 'mobile-shared-query-fixture';
    sessionStorage.setItem('nai_api_key', key);
    const MobileHarness = () => {
      const budget = useAnlasBudget();
      const subscription = useNovelaiUsage();
      const [apiKey, setApiKey] = useState(key);
      useEffect(() => {
        const sync = () => setApiKey(sessionStorage.getItem('nai_api_key') || '');
        window.addEventListener('nai-api-key-changed', sync);
        return () => window.removeEventListener('nai-api-key-changed', sync);
      }, []);
      return React.createElement(MobileGenerationResources, { apiKey, budget, subscription,
        runtime: { ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } } });
    };
    let queries = 0;
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) return runtimeResponse();
      if (url.startsWith('/api/anlas-budget')) return responseFor({ remaining: 1000 });
      if (url.startsWith('/api/novelai-subscription')) return responseFor(++queries === 1 ? opusInfo(8000, 74) : opusInfo(7800, 73));
      if (url.startsWith('/api/nai-key-vault')) return responseFor({ entries: [] });
      throw new Error(`测试禁止其他接口：${url}`);
    }));
    render(React.createElement(MobileHarness));
    const entry = await screen.findByRole('button', { name: /预算 1000 · 余额 8100 · Opus 74%/ });
    fireEvent.click(entry);
    await screen.findByText('74%');
    expect(queries).toBe(1);
    fireEvent.click(screen.getByRole('status', { name: /74%/ }));
    await screen.findByRole('button', { name: /预算 1000 · 余额 7900 · Opus 73%/ });
    expect(screen.getByText('73%')).toBeTruthy();
    expect(screen.getByText('官方余额').nextElementSibling?.textContent).toBe('7,900 点');
    expect(queries).toBe(2);
    act(() => { sessionStorage.removeItem('nai_api_key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: '' })); });
    expect(screen.getByRole('button', { name: /查看账户资源：未配置 Key/ })).toBeTruthy();
    expect(screen.queryByText('73%')).toBeNull();
    expect(screen.getByText('官方余额').nextElementSibling?.textContent).toBe('未知');
  });
  it('余额与 Opus 共用一次查询，手动刷新同时更新两行且不改写本地预算', async () => {
    sessionStorage.setItem('nai_api_key', 'balance-shared-query-test-key');
    let queries = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) return runtimeResponse();
      if (url.startsWith('/api/anlas-budget')) return responseFor({ remaining: 1000 });
      if (url.startsWith('/api/novelai-subscription')) return responseFor(++queries === 1 ? opusInfo(8000, 74) : opusInfo(7800, 73));
      throw new Error('测试不允许其他接口');
    }));
    render(React.createElement(Harness));
    await waitFor(() => expect(screen.getByRole('button', { name: /个人剩余预算 1,000 点.*账号剩余点数 8,100 点/ })).toBeTruthy());
    expect(screen.getByText('74%')).toBeTruthy();
    expect(queries).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /刷新 Anlas 余额/ }));
    await waitFor(() => expect(screen.getByText('7900')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('73%')).toBeTruthy());
    expect(queries).toBe(2);
    expect(screen.getByText('1000')).toBeTruthy();
  });

  it('切 Key 先清空旧分数，等待新预算与余额，迟到的旧账号刷新不能覆盖新账号', async () => {
    const keyA = 'balance-switch-account-a', keyB = 'balance-switch-account-b';
    const hashA = await hashNaiApiKey(keyA);
    let resolveOld!: (response: Response) => void, resolveBalance!: (response: Response) => void, resolveBudget!: (response: Response) => void;
    let queriesA = 0;
    sessionStorage.setItem('nai_api_key', keyA);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) return runtimeResponse();
      if (url.startsWith('/api/anlas-budget')) {
        if (new URL(url, 'http://local.test').searchParams.get('keyHash') === hashA) return responseFor({ remaining: 1000 });
        return new Promise<Response>(resolve => { resolveBudget = resolve; });
      }
      if (url.startsWith('/api/novelai-subscription')) {
        if ((options?.headers as Record<string, string>).Authorization === `Bearer ${keyA}`) {
          if (++queriesA === 1) return responseFor(opusInfo(8000, 74));
          return new Promise<Response>(resolve => { resolveOld = resolve; });
        }
        return new Promise<Response>(resolve => { resolveBalance = resolve; });
      }
      throw new Error('测试不允许其他接口');
    }));
    render(React.createElement(Harness));
    await waitFor(() => expect(screen.getByText('8100')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /刷新 Anlas 余额/ }));
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    act(() => { sessionStorage.setItem('nai_api_key', keyB); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: keyB })); });
    expect(screen.queryByText('1000')).toBeNull();
    expect(screen.queryByText('8100')).toBeNull();
    await waitFor(() => { expect(resolveBalance).toBeTypeOf('function'); expect(resolveBudget).toBeTypeOf('function'); });
    await act(async () => {
      resolveBudget(responseFor({ remaining: 800 }));
      resolveBalance(responseFor({ active: false, tier: 0, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 420 } }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /个人剩余预算 800 点.*账号剩余点数 420 点/ })).toBeTruthy());
    await act(async () => { resolveOld(responseFor(opusInfo(999, 20))); });
    expect(screen.getByText('800')).toBeTruthy();
    expect(screen.getByText('420')).toBeTruthy();
    expect(screen.queryByText('1099')).toBeNull();
    expect(screen.queryByText('20%')).toBeNull();
  });
});
