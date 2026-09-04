// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAI_RUNTIME } from '../services/naiRuntime';
import { OpusUsageBar } from './OpusUsageBar';

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

  it('订阅已失效（active=false）时显示红色 × 与切换提示，而非额度数字', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-opus-expired-key');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) {
        return responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true, extracted: [], missed: [] } });
      }
      // 过期 key：官方仍返回 tier:0/active:false/usage 79%，但界面必须识破为失效。
      return responseFor({ tier: 0, active: false, usage: { percent: 79, isNegative: false, timeUntilNextPercent: 7888 } });
    }));

    render(React.createElement(OpusUsageBar, { collapsed: false }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /当前密钥已失效/ })).toBeTruthy();
    });
    // 中央是 × 而非 79%
    expect(screen.getByText('×')).toBeTruthy();
    expect(screen.queryByText('79%')).toBeNull();
    // 副文案提示切换而非张数
    expect(screen.getByText('当前密钥已失效，点击切换')).toBeTruthy();
    expect(screen.getByText('×').parentElement?.className).toContain('text-red-500');
  });

  it('失效 key 即使官方不带 usage 也显示红叉而非整行消失', async () => {
    sessionStorage.setItem('nai_api_key', 'pst-opus-expired-nousage-key'); // secret-scan: allow 测试用假密钥，非真实凭据
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/novelai-runtime')) {
        return responseFor({ ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true, extracted: [], missed: [] } });
      }
      // 网关源头净化后：失效 key 不带 usage，只带 active:false。
      return responseFor({ tier: 0, active: false });
    }));

    render(React.createElement(OpusUsageBar, { collapsed: false }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /当前密钥已失效/ })).toBeTruthy();
    });
    expect(screen.getByText('×')).toBeTruthy();
    expect(screen.getByText('当前密钥已失效，点击切换')).toBeTruthy();
  });
});
