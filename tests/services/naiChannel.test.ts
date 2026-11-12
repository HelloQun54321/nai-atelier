// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/naiKeyVault', () => ({ naiKeyVault: { list: mocks.list } }));

let channel: typeof import('../../services/naiChannel');

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  mocks.list.mockReset();
  channel = await import('../../services/naiChannel');
});
afterEach(() => { sessionStorage.clear(); });

describe('当前 Key 的接入渠道', () => {
  it('按保管箱条目区分官方、生图网关与按次渠道', async () => {
    mocks.list.mockResolvedValue([
      { key: 'official-key', name: '官方' },
      { key: 'gateway-key', name: '网关', gatewayUrl: 'https://gateway.example/v1' },
      { key: 'per-use-key', name: '按次', gatewayUrl: 'https://relay.example/novelai', billingMode: 'per-use' },
    ]);
    sessionStorage.setItem('nai_api_key', 'official-key');
    expect(await channel.resolveNaiChannelMode()).toBe('official');
    sessionStorage.setItem('nai_api_key', 'gateway-key');
    expect(await channel.resolveNaiChannelMode()).toBe('gateway');
    sessionStorage.setItem('nai_api_key', 'per-use-key');
    expect(await channel.resolveNaiChannelMode()).toBe('per-use');
    expect(channel.getNaiChannelMode()).toBe('per-use');
    expect(channel.isPerUseNaiChannel()).toBe(true);
  });

  it('没有活动 Key 或保管箱不可达时保持官方，不误关额度', async () => {
    sessionStorage.removeItem('nai_api_key');
    mocks.list.mockResolvedValue([]);
    expect(await channel.resolveNaiChannelMode()).toBe('official');
    mocks.list.mockRejectedValue(new Error('synthetic-vault-offline'));
    sessionStorage.setItem('nai_api_key', 'per-use-key');
    expect(await channel.resolveNaiChannelMode()).toBe('official');
  });
});
