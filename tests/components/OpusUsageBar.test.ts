// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAI_RUNTIME, refreshNaiRuntimeConfig } from '../../services/naiRuntime';
import { OpusUsageBar } from '../../components/OpusUsageBar';

const responseFor = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => '',
}) as Response;

describe('OpusUsageBar', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it('详情把额度与估算张数放入等宽两列，同步信息另起公共行，显式提示刷新', async () => {
    sessionStorage.setItem('nai_api_key', 'opus-details-synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/novelai-runtime')
      ? responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } })
      : responseFor({ tier: 3, active: true, usage: { percent: 100, isNegative: false, timeUntilNextPercent: 0 } })));
    const view = render(React.createElement(OpusUsageBar, { collapsed: false, showDetails: true }));
    const count = await screen.findByText('≈1730 张');
    const quota = screen.getByText('剩余额度');
    const columns = quota.parentElement?.parentElement;
    expect(columns?.className).toContain('grid-cols-2');
    expect(count.parentElement?.parentElement).toBe(columns);
    expect(columns?.contains(screen.getByText('V5 等受限模型共用额度'))).toBe(false);
    expect(screen.getByRole('status').querySelector('.lucide-refresh-cw')).toBeTruthy();
    expect(screen.getByText(/最近同步/)).toBeTruthy();
    view.rerender(React.createElement(OpusUsageBar, { collapsed: false, showDetails: true, showSyncTime: false }));
    expect(screen.queryByText(/最近同步/)).toBeNull();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('切 Key 后同步失败保留红色错误行，点击后可重试恢复', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-opus-error-key');
    let subscriptionAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) {
        return responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true, extracted: [], missed: [] } });
      }
      subscriptionAttempts += 1;
      if (subscriptionAttempts === 1) {
        return { ok: false, text: async () => 'temporary subscription failure' } as Response;
      }
      return responseFor({ tier: 4, active: true, usage: { percent: 73, isNegative: false, timeUntilNextPercent: 1500 } });
    }));

    render(React.createElement(OpusUsageBar, { collapsed: false }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /同步失败/ })).toBeTruthy();
      expect(screen.getByText('同步失败，点击重试')).toBeTruthy();
      expect(screen.getByText('×').parentElement?.className).toContain('text-red-500');
    });

    fireEvent.click(screen.getByRole('status', { name: /同步失败/ }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /73%/ })).toBeTruthy();
      expect(screen.getByText('≈1263 张')).toBeTruthy();
    });
  });

  it('活动加成超过 100% 时显示官方真实额度和对应张数', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-opus-bonus-key');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) {
        return responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true, extracted: [], missed: [] } });
      }
      return responseFor({ tier: 3, active: true, usage: { percent: 196, isNegative: false, timeUntilNextPercent: 0 } });
    }));

    const { container } = render(React.createElement(OpusUsageBar, { collapsed: false }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /196%/ })).toBeTruthy();
      expect(screen.getByText('196%')).toBeTruthy();
      expect(screen.getByText('≈3391 张')).toBeTruthy();
    });
    expect(container.querySelectorAll('circle')[1]?.getAttribute('stroke-dashoffset')).toBe('0');
  });

  it('订阅过期时显示付费状态，不显示残留 Opus 额度', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-opus-expired-key');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) {
        return responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true, extracted: [], missed: [] } });
      }
      // 过期后官方仍可能返回 usage，不能把它作为免费权益。
      return responseFor({ tier: 0, active: false, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 420 }, usage: { percent: 79, isNegative: false, timeUntilNextPercent: 7888 } });
    }));

    render(React.createElement(OpusUsageBar, { collapsed: false }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /订阅已过期/ })).toBeTruthy();
    });
    // 过期后不显示残留免费额度
    expect(screen.queryByText('×')).toBeNull();
    expect(screen.queryByText('79%')).toBeNull();
    expect(screen.getByRole('status').title).toContain('Paid Anlas：420 点');
    expect(screen.getByText('免费权益不可用')).toBeTruthy();
    // 显示 Paid Anlas，不把订阅过期说成 Key 失效
    expect(screen.getByText('订阅已过期')).toBeTruthy();
    expect(screen.getByRole('status').className).toContain('text-amber-600');
  });

  it('订阅过期且没有余额时明确余额未知', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-opus-expired-nousage-key'); // secret-scan: allow 测试用假密钥，非真实凭据
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) {
        return responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true, extracted: [], missed: [] } });
      }
      // 网关保留订阅过期状态，但余额未知不伪造为 0。
      return responseFor({ tier: 0, active: false });
    }));

    render(React.createElement(OpusUsageBar, { collapsed: false }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /订阅已过期/ })).toBeTruthy();
    });
    expect(screen.queryByText('×')).toBeNull();
    expect(screen.getByText('订阅已过期')).toBeTruthy();
    expect(screen.getByRole('status').title).toContain('Paid Anlas 余额未知');
  });

  it('Paid Anlas 为零也显示，折叠状态保留余额提示且点击仍可刷新', async () => {
    sessionStorage.setItem('nai_api_key', 'expired-zero-balance-test-key');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/novelai-runtime')
      ? responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } })
      : responseFor({ tier: 0, active: false, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 } }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(React.createElement(OpusUsageBar, { collapsed: false }));
    expect((await screen.findByRole('status', { name: /Paid Anlas：0 点/ })).title).toContain('Paid Anlas：0 点');
    expect(screen.queryByText('Paid Anlas 余额未知')).toBeNull();
    view.rerender(React.createElement(OpusUsageBar, { collapsed: true }));
    const button = screen.getByRole('status', { name: /Paid Anlas：0 点/ });
    expect(button.title).toContain('关闭低消耗模式');
    const attempts = fetchMock.mock.calls.length;
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(attempts));
  });

  it('过期订阅展示余额时也保留官方计费规则同步异常警告', async () => {
    sessionStorage.setItem('nai_api_key', 'expired-sync-warning-test-key');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/novelai-runtime')
      ? responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: false, reason: 'extract-failed', missed: ['freeMaxSteps'] } })
      : responseFor({ tier: 0, active: false, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 420 } })));
    await refreshNaiRuntimeConfig();
    render(React.createElement(OpusUsageBar, { collapsed: false }));
    expect((await screen.findByRole('status', { name: /Paid Anlas：420 点/ })).title).toContain('Paid Anlas：420 点');
    expect(await screen.findByText('计费规则同步异常')).toBeTruthy();
    expect(screen.getByRole('status').className).toContain('text-red-500');
    expect(screen.getByRole('status').title).toContain('官方计费规则同步异常');
  });
});
