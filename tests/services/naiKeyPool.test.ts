// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPoolMaxOpusPercent,
  naiKeyPoolService,
  prepareGenerationWithPool,
  reportPoolKeyCooldown,
  selectBestPoolMember,
} from '../../services/naiKeyPool';
import { readActiveNaiKey, setActiveNaiKey } from '../../services/naiKeyStorage';
import type { NaiKeyEntry } from '../../services/naiKeyVault';

const responseFor = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => '',
}) as Response;

const entry = (id: string, name: string, key: string, extra: Partial<NaiKeyEntry> = {}): NaiKeyEntry => ({
  id, name, key, createdAt: 1, ...extra,
});

describe('Key 池自动轮询（满圈率优先）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    naiKeyPoolService._resetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    naiKeyPoolService._resetForTests();
  });

  it('按满圈率优先选 Key：满额拼车号优先于未满官方号，避免满额空转浪费回血', () => {
    const official = entry('a', '官方主号', 'pst-official-a');
    const carpool = entry('b', '4人车成员', 'STA1N-carpool-b', { gatewayUrl: 'https://gateway.example/v1' });
    const picked = selectBestPoolMember([
      { entry: official, info: { active: true, tier: 3, usage: { percent: 60, isNegative: false, timeUntilNextPercent: 6048 } } },
      { entry: carpool, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
    ], official.key);
    expect(picked.ok).toBe(true);
    if (picked.ok) {
      expect(picked.entry.id).toBe('b');
      expect(picked.fillRatio).toBe(100);
      expect(picked.switched).toBe(true);
    }
  });

  it('严格按满圈率优先切换；同满圈率且同绝对剩余时自动轮换避开刚用过的 Key，平局优先绝对剩余更高', () => {
    const k1 = entry('1', '车位1', 'STA1N-1', { gatewayUrl: 'https://g1.example' });
    const k2 = entry('2', '车位2', 'STA1N-2', { gatewayUrl: 'https://g2.example' });
    // k1 用掉一点后（99.2%），立即切到仍满血的 k2（100%），让两把 Key 同时开始回血
    const rotateToFull = selectBestPoolMember([
      { entry: k1, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 24.8, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
      { entry: k2, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25.0, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
    ], k1.key);
    expect(rotateToFull.ok).toBe(true);
    if (rotateToFull.ok) {
      expect(rotateToFull.entry.id).toBe('2');
      expect(rotateToFull.switched).toBe(true);
    }

    // 两把同为 25%/25% 时，自动轮换避开刚用过的 k1
    const tieRotate = selectBestPoolMember([
      { entry: k1, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25.0, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
      { entry: k2, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25.0, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
    ], k1.key);
    expect(tieRotate.ok).toBe(true);
    if (tieRotate.ok) {
      expect(tieRotate.entry.id).toBe('2');
      expect(tieRotate.switched).toBe(true);
    }

    // 同为 100% 满圈时，优先绝对剩余百分比更高者
    const official = entry('o', '官方满血', 'pst-full');
    const tie = selectBestPoolMember([
      { entry: k2, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
      { entry: official, info: { active: true, tier: 3, usage: { percent: 100, isNegative: false, timeUntilNextPercent: 0 } } },
    ], '');
    expect(tie.ok).toBe(true);
    if (tie.ok) expect(tie.entry.id).toBe('o');
  });

  it('自动跳过按次渠道、过期、冷却中与耗尽密钥；全池耗尽直接停止提示', () => {
    const now = 1_700_000_000_000;
    const perUse = entry('p', '按次', 'sk-per-use', { gatewayUrl: 'https://pay.example', billingMode: 'per-use' });
    const expired = entry('e', '过期', 'pst-expired');
    const cooling = entry('c', '冷却', 'pst-cooling');
    const exhausted = entry('x', '耗尽', 'STA1N-empty', { gatewayUrl: 'https://g.example' });
    const res = selectBestPoolMember([
      { entry: perUse, info: { active: true, tier: 3, usage: { percent: 100, isNegative: false, timeUntilNextPercent: 0 } } },
      { entry: expired, info: { active: false, tier: 3, usage: { percent: 80, isNegative: false, timeUntilNextPercent: 0 } } },
      { entry: cooling, info: { active: true, tier: 3, usage: { percent: 90, isNegative: false, timeUntilNextPercent: 0 } }, cooldownUntil: now + 30_000 },
      { entry: exhausted, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 0, capacity: 25, isNegative: true, timeUntilNextPercent: 0 } } },
    ], '', { now });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('pool_exhausted');

    // 非受限模型（V4.5）只要求活跃 Opus 订阅，不要求 V5 额度大于 0
    const v45 = selectBestPoolMember([
      { entry: exhausted, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 0, capacity: 25, isNegative: true, timeUntilNextPercent: 0 } } },
    ], '', { requireOpusQuota: false, now });
    expect(v45.ok).toBe(true);
  });

  it('prepareGenerationWithPool：关闭时零开销直通；开启时付费参数直接拦截，免费图自动切到满圈率最高密钥并支持冷却规避', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/nai-key-vault') {
        return responseFor({
          entries: [
            entry('k1', '车位1', 'STA1N-pool-1', { gatewayUrl: 'https://g1.example' }),
            entry('k2', '车位2', 'STA1N-pool-2', { gatewayUrl: 'https://g2.example' }),
          ],
        });
      }
      if (url === '/api/nai-key-vault/pool') {
        if (init?.method === 'PUT') return responseFor({ pool: JSON.parse(String(init.body)) });
        return responseFor({ pool: { enabled: true, memberIds: ['k1', 'k2'] } });
      }
      if (url.startsWith('/api/novelai-subscription')) {
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        if (auth === 'Bearer STA1N-pool-1') {
          return responseFor({ source: 'gateway', gatewayManagedWallet: true, active: true, tier: 3, usage: { percent: 10, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } });
        }
        return responseFor({ source: 'gateway', gatewayManagedWallet: true, active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    // 1) 未开启 Key 池：直接透传，不发任何请求
    const offResult = await prepareGenerationWithPool({ model: 'nai-diffusion-5-full', estimatedCostWithOpus: 0 });
    expect(offResult).toEqual({ pooled: false });
    expect(fetchMock).not.toHaveBeenCalled();

    // 2) 开启 Key 池（初始激活 k1）
    setActiveNaiKey('STA1N-pool-1');
    await naiKeyPoolService.set({ enabled: true, memberIds: ['k1', 'k2'] });

    // 3) 需要花 Anlas 的付费参数：直接停止提示，绝不静默扣费
    const paidBlocked = await prepareGenerationWithPool({ model: 'nai-diffusion-5-full', estimatedCostWithOpus: 5 });
    expect(paidBlocked).toMatchObject({ pooled: true, ok: false, code: 'pool_paid_blocked' });

    // 4) 免费 V5 生成：自动选满圈率更高的 k2 并切换当前激活 Key
    const picked = await prepareGenerationWithPool({ model: 'nai-diffusion-5-full', estimatedCostWithOpus: 0 });
    expect(picked.pooled).toBe(true);
    if (picked.pooled && picked.ok) {
      expect(picked.entry.id).toBe('k2');
      expect(readActiveNaiKey()).toBe('STA1N-pool-2');
    }
    expect(getPoolMaxOpusPercent()).toBe(25);

    // 5) k2 进入限流冷却后，下次生成自动退避改选 k1
    reportPoolKeyCooldown('STA1N-pool-2', 60_000);
    const fallback = await prepareGenerationWithPool({ model: 'nai-diffusion-5-full', estimatedCostWithOpus: 0 });
    expect(fallback.pooled).toBe(true);
    if (fallback.pooled && fallback.ok) {
      expect(fallback.entry.id).toBe('k1');
      expect(readActiveNaiKey()).toBe('STA1N-pool-1');
    }
    expect(getPoolMaxOpusPercent()).toBe(10);
  });
});
