import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import type { D1Database, RouteContext } from '../../../worker/routes/types';

// 只使用内存合成设置，不打开真实 D1，也不执行初始化或迁移。
const fixture = () => {
  const rows = new Map<string, string>();
  const prepare = vi.fn(() => { throw new Error('生成不应读取或改写旧模式设置'); });
  const db = { prepare } as unknown as D1Database;
  const route = async (path: string, method: string, key = '', body?: unknown) => {
    const request = new Request('http://localhost' + path, { method, headers: key ? { Authorization: 'Bearer ' + key } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context: RouteContext = { request, path, method, url: new URL(request.url), db, currentUser: { role: 'admin' },
      env: { ASSETS: { fetch: async () => { throw new Error('不能读取资产'); } } }, initDB: async () => { throw new Error('不能初始化'); } };
    return handleSettingsRoute(context);
  };
  return { rows, prepare, route };
};

afterEach(() => vi.restoreAllMocks());

describe('纯 Worker 生成代理', () => {
  it.each(['/api/generate', '/api/generate-stream'])('%s 忽略已开启的旧设置，直接转发原参数', async path => {
    const { rows, prepare, route } = fixture();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-key'));
    const storedKey = 'low_consumption_v1:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    rows.set(storedKey, 'true');
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('synthetic image'));
    const payload = { model: 'nai-diffusion-4-5-full', action: 'img2img', parameters: { steps: 40, width: 1536, height: 1536, strength: 0.35 } };
    const response = await route(path, 'POST', 'synthetic-key', payload);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('synthetic image');
    expect(upstream).toHaveBeenCalledOnce();
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe('https://image.novelai.net/ai/generate-image' + (path.endsWith('-stream') ? '-stream' : ''));
    expect(JSON.parse(options!.body as string)).toEqual(payload);
    expect(prepare).not.toHaveBeenCalled();
    expect(rows.get(storedKey)).toBe('true');
  });

  it.each(['/api/generate', '/api/generate-stream'])('%s 无 Key 不调用上游', async path => {
    const { route } = fixture();
    const upstream = vi.spyOn(globalThis, 'fetch');
    expect((await route(path, 'POST', '', {}))?.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT'])('旧设置接口 %s 已移除，不读取或改写数据', async method => {
    const { prepare, route } = fixture();
    expect(await route('/api/low-consumption', method, 'synthetic-key', method === 'PUT' ? { enabled: true } : undefined)).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});
