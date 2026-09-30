// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLowConsumptionParams, assertLowConsumptionEstimate, getCachedLowConsumption, getLowConsumption, setLowConsumption } from './lowConsumption';
import { DEFAULT_NAI_RUNTIME } from './naiRuntime';
import type { NAIParams } from '../types';

const runtime = { ...DEFAULT_NAI_RUNTIME, health: { ok: true, reason: 'bundle', missed: [] } };
const params: NAIParams = { model: 'nai-diffusion-5-full', width: 1536, height: 1536, steps: 40, scale: 5, sampler: 'k_euler_ancestral',
  seed: 123, characterReferences: { enabled: true, slots: [] } };
const subscription = { active: true, tier: 3, usage: { percent: 20, isNegative: false, timeUntilNextPercent: 0 } };
const response = (enabled: boolean) => new Response(JSON.stringify({ enabled }));
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('低消耗实际参数与原配置隔离', () => {
  it.each(['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-5-full-inpainting'])('%s 严格限制 23 步并仅缩放文生图', model => {
    const original = { ...params, model };
    const actual = applyLowConsumptionParams(original, true, runtime);
    expect(actual.steps).toBe(23);
    expect(actual.width * actual.height).toBeLessThanOrEqual(runtime.freeMaxArea);
    expect(actual.width % 64).toBe(0);
    expect(actual.height % 64).toBe(0);
    expect(actual.characterReferences?.enabled).toBe(false);
    expect(actual.characterReferences?.slots).toBe(original.characterReferences?.slots);
    expect(original.steps).toBe(40);
    expect(original.width).toBe(1536);
    expect(original.characterReferences?.enabled).toBe(true);
    expect(actual.seed).toBe(original.seed);
  });
  it.each(['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full'])('%s 保持 28 步上限，不增加用户的更低步数', model => {
    expect(applyLowConsumptionParams({ ...params, model }, true, runtime).steps).toBe(28);
    expect(applyLowConsumptionParams({ ...params, model, steps: 17 }, true, runtime).steps).toBe(17);
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 保留底图／扩展画布几何与种子', operation => {
    const actual = applyLowConsumptionParams(params, true, runtime, operation);
    expect([actual.width, actual.height, actual.seed]).toEqual([1536, 1536, 123]);
    expect(actual.steps).toBe(23);
  });
  it('关闭开关原样返回配置，官方免费门槛降低时同时遵守', () => {
    expect(applyLowConsumptionParams(params, false, runtime)).toBe(params);
    expect(applyLowConsumptionParams(params, true, { ...runtime, freeMaxSteps: 20 }).steps).toBe(20);
  });
  it('V5 额度为零或未知时拒绝，V4.5 不受 V5 额度耗尽影响', () => {
    const actual = applyLowConsumptionParams(params, true, runtime);
    expect(() => assertLowConsumptionEstimate(actual, 'text-to-image', runtime, { ...subscription, usage: { ...subscription.usage, percent: 0 } }, 0, 1666)).toThrow('额度已用尽');
    expect(() => assertLowConsumptionEstimate(actual, 'text-to-image', runtime, { active: true, tier: 3 }, 0, 1666)).toThrow('无法确认');
    expect(() => assertLowConsumptionEstimate({ ...actual, model: 'nai-diffusion-4-5-full' }, 'text-to-image', runtime, { ...subscription, usage: { ...subscription.usage, percent: 0 } }, 0, 0)).not.toThrow();
  });
  it('官方规则快照超过 48 小时，或免费路径并非 Opus 时拒绝', () => {
    const actual = applyLowConsumptionParams(params, true, runtime);
    expect(() => assertLowConsumptionEstimate(actual, 'text-to-image', { ...runtime, syncedAt: Date.now() - 49 * 3600000 }, subscription, 0, 1666)).toThrow('无法确认');
    expect(() => assertLowConsumptionEstimate(actual, 'text-to-image', runtime, { active: true, tier: 2 }, 0, 1666)).toThrow('Opus');
  });
});

describe('按 Key 读取和持久化，迟到响应隔离', () => {
  it('不同 Key 隔离，切换后旧响应不能改变当前开关', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn((_url, options) => options.headers.Authorization === 'Bearer old-key'
      ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(response(false))));
    sessionStorage.setItem('nai_api_key', 'old-key');
    const old = getLowConsumption();
    await vi.waitFor(() => expect(finish).toBeDefined());
    sessionStorage.setItem('nai_api_key', 'new-key');
    await getLowConsumption();
    finish(response(true));
    await old;
    expect(getCachedLowConsumption().enabled).toBe(false);
    sessionStorage.setItem('nai_api_key', 'old-key');
    expect(getCachedLowConsumption().enabled).toBe(true);
  });
  it('写入期间的生成读取等保存完成，旧 GET 不覆盖新 PUT', async () => {
    let finishRead!: (value: Response) => void;
    let finishWrite!: (value: Response) => void;
    let readCalls = 0;
    vi.stubGlobal('fetch', vi.fn((_url, options) => options.method === 'PUT'
      ? new Promise<Response>(resolve => { finishWrite = resolve; })
      : ++readCalls === 1 ? new Promise<Response>(resolve => { finishRead = resolve; }) : Promise.resolve(response(true))));
    sessionStorage.setItem('nai_api_key', 'write-race-key');
    const old = getLowConsumption();
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    const write = setLowConsumption(true);
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    const next = getLowConsumption();
    expect(readCalls).toBe(1);
    finishRead(response(false));
    await old;
    finishWrite(response(true));
    await write;
    expect((await next).enabled).toBe(true);
    expect(getCachedLowConsumption().enabled).toBe(true);
  });
  it('无 Key 默认关闭，异常设置响应不放行生成', async () => {
    expect((await getLowConsumption()).enabled).toBe(false);
    await expect(setLowConsumption(true)).rejects.toThrow('配置');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    await expect(getLowConsumption('invalid-key')).rejects.toThrow('响应无效');
  });
  it('手机局域网会话失效时唤起现有解锁入口，同时阻止生成', async () => {
    const listener = vi.fn();
    window.addEventListener('nai-lan-access-required', listener);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' }), { status: 401 })));
    try {
      await expect(getLowConsumption('locked-lan-key')).rejects.toThrow('访问密码');
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('nai-lan-access-required', listener); }
  });
});
