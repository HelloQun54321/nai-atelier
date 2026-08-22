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
      expect(screen.getByText('≈1263张')).toBeTruthy();
    });
  });
});
