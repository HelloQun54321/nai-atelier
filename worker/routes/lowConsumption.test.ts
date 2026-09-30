import { describe, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from './settingsRoutes';
import type { D1Database, RouteContext } from './types';

// 内存 settings 表；不打开真实 D1，也不执行初始化或迁移。
const fixture = () => {
  const rows = new Map<string, string>();
  const db = { prepare: (sql: string) => ({ bind: (...values: string[]) => ({
    first: async () => rows.has(values[0]) ? { value: rows.get(values[0]) } : null,
    run: async () => { expect(sql).toMatch(/^INSERT INTO settings/); rows.set(values[0], values[1]); return { success: true }; },
  }) }) } as unknown as D1Database;
  const route = async (path: string, method: string, key = '', body?: unknown) => {
    const request = new Request(`http://localhost${path}`, { method, headers: key ? { Authorization: `Bearer ${key}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context: RouteContext = { request, path, method, url: new URL(request.url), db, currentUser: { role: 'admin' },
      env: { ASSETS: { fetch: async () => { throw new Error('不能读取资产'); } } }, initDB: async () => { throw new Error('不能初始化'); } };
    return (await handleSettingsRoute(context))!;
  };
  return { rows, route };
};
describe('低消耗设置按 Key 隔离并复用原表', () => {
  it('旧数据默认关闭，GET 无写入，两 Key 独立开关，持久化字段不保存明文 Key', async () => {
    const { rows, route } = fixture();
    expect(await (await route('/api/low-consumption', 'GET', 'key-a')).json()).toEqual({ enabled: false });
    expect(rows.size).toBe(0);
    expect(await (await route('/api/low-consumption', 'PUT', 'key-a', { enabled: true })).json()).toEqual({ enabled: true });
    expect(await (await route('/api/low-consumption', 'GET', 'key-a')).json()).toEqual({ enabled: true });
    expect(await (await route('/api/low-consumption', 'GET', 'key-b')).json()).toEqual({ enabled: false });
    expect([...rows.keys()][0]).toMatch(/^low_consumption_v1:[0-9a-f]{64}$/);
    await route('/api/low-consumption', 'PUT', 'key-b', { enabled: true });
    await route('/api/low-consumption', 'PUT', 'key-a', { enabled: false });
    expect(await (await route('/api/low-consumption', 'GET', 'key-b')).json()).toEqual({ enabled: true });
  });
  it('拒绝无 Key、错误类型和非预期请求方式，不落无效设置', async () => {
    const { rows, route } = fixture();
    expect((await route('/api/low-consumption', 'GET')).status).toBe(401);
    expect((await route('/api/low-consumption', 'PUT', 'key', { enabled: 'true' })).status).toBe(400);
    expect((await route('/api/low-consumption', 'DELETE', 'key')).status).toBe(405);
    expect(rows.size).toBe(0);
  });
  it.each(['/api/generate', '/api/generate-stream'])('%s 的纯 Worker 路径开关开启时拒绝转发，不能绕过网关费用校验', async path => {
    const { route } = fixture();
    await route('/api/low-consumption', 'PUT', 'protected-key', { enabled: true });
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('不能调用上游'); });
    try {
      expect((await route(path, 'POST', 'protected-key', {})).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    } finally { upstream.mockRestore(); }
  });
});
