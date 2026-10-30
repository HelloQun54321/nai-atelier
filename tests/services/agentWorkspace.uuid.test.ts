// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); sessionStorage.clear(); });
beforeEach(() => { sessionStorage.clear(); vi.resetModules(); });

it('页面客户端 ID 在缺少 randomUUID 时仍可写入 sessionStorage', async () => {
  let seed = 3;
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed++ * 13) & 0xff;
      return bytes;
    },
  });
  const { getAgentPageClientId } = await import('../../services/agentWorkspace');
  const first = getAgentPageClientId();
  const second = getAgentPageClientId();
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(second).toBe(first);
  expect(sessionStorage.getItem('nai-agent-page-client')).toBe(first);
});
