import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { StChatu8Bridge } from '../../scripts/st-chatu8-bridge.mjs';
import { handleStBridgeRoute } from '../../worker/routes/stBridgeRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../worker/routes/types';

// 真实桥接状态机 + 真实 Worker 设置接口；全部资产、D1 与回执均隔离在内存。
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(INIT_SQL);
  sqlite.exec("INSERT INTO settings (key, value) VALUES ('st_chatu8_preferences_v1', '{\"enabled\":true}'), ('unrelated', 'preserve')");
  const chain = { id: 'chosen', name: '风格', type: 'style', basePrompt: 'artist:original', negativePrompt: '', modules: [], params: { model: 'nai-diffusion-5-full' }, previewImage: '/api/assets/original.png', createdAt: 1, updatedAt: 1 };
  const chains = [chain];
  sqlite.prepare('INSERT INTO chains (id, name, type, base_prompt, preview_image, params) VALUES (?, ?, ?, ?, ?, ?)').run(chain.id, chain.name, chain.type, chain.basePrompt, chain.previewImage, JSON.stringify(chain.params));
  const writes: string[] = [];
  const db = { prepare(query: string) {
    let values: unknown[] = [];
    return { bind(...args: unknown[]) { values = args; return this; },
      async first() { return sqlite.prepare(query).get(...values as never[]) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(query).run(...values as never[]).changes) } }; },
    };
  } } as unknown as D1Database;
  const invoke = async (path: string, body?: unknown, role = 'user') => {
    const method = body === undefined ? 'GET' : 'POST';
    const response = await handleStBridgeRoute({ path, method, request: new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), db, env: {}, currentUser: { id: 'owner', role } } as RouteContext);
    if (!response) throw new Error(`Unexpected route ${path}`);
    const result = await response.json() as any;
    if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
    return result;
  };
  const bridge = new StChatu8Bridge({ requestWorkerJson: async (path: string, options?: { method?: string; body?: any }) => {
    if (path.includes('/st-chatu8/')) return invoke(path, options?.body);
    if (path === '/api/chains') return structuredClone(chains);
    if (path.startsWith('/api/chains/')) {
      if (options?.method === 'PUT') { writes.push(path); Object.assign(chain, options.body); return { success: true }; }
      return structuredClone(chain);
    }
    if (path === '/api/vibes' || path === '/api/vibe-groups') return { items: [] };
    throw new Error(`Unexpected synthetic request ${path}`);
  }, requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }) });
  bridge.applyPreferences({ enabled: true }); bridge.saveState = async () => {};
  const workspace = () => invoke('/api/st-chatu8/workspace');
  const action = (action: string, chainIds = ['chosen']) => invoke('/api/st-chatu8/workspace', { action, chainIds });
  const snapshot = (artists: any[], complete = true) => ({ artists, artistSnapshot: { version: 2, complete, count: artists.length, cursor: bridge.status().snapshotCursor } });
  const received = (artist: any) => ({ externalId: artist.externalId, name: artist.name, fixedPrompt: artist.fixedPrompt, fixedPromptEnd: artist.fixedPromptEnd, negativePrompt: artist.negativePrompt, previewPath: '/user/preview.png', previewSourceImage: artist.previewImage });
  const deliver = async () => {
    await action('enqueue');
    const result = await bridge.sync(snapshot([]));
    const artist = result.artists[0]!;
    const receipt = { externalId: artist.externalId, ...artist.receipt, success: true };
    const ack = await bridge.acknowledgeArtists({ ...snapshot([received(artist)]), receipts: [receipt, receipt] });
    expect(ack.confirmed).toBe(1);
    return artist;
  };
  return { sqlite, bridge, workspace, action, snapshot, received, deliver, chain, writes, invoke };
}

describe('智慧姬实际接收、移除与增量协议', () => {
  it('发出响应仍待同步，正文及封面接收确认后才进入记录；重复确认和重复同步不重发', async () => {
    const f = fixture(); await f.action('enqueue');
    const first = await f.bridge.sync(f.snapshot([])); const artist = first.artists[0]!;
    expect(first.artistSnapshotComplete).toBe(true);
    expect((await f.workspace()).entries[0].status).toBe('pending');
    const receipt = { externalId: artist.externalId, ...artist.receipt, success: true };
    expect((await f.bridge.acknowledgeArtists({ ...f.snapshot([f.received(artist)]), receipts: [receipt] })).confirmed).toBe(1);
    const saved = await f.workspace();
    expect(saved.chainIds).toEqual([]); expect(saved.entries[0]).toMatchObject({ status: 'synced', error: '' });
    expect(saved.entries[0].confirmedAt).toBeGreaterThan(0);
    const repeated = await f.bridge.sync(f.snapshot([f.received(artist)]));
    expect(repeated.artists).toEqual([]); expect(f.writes).toEqual([]);
    expect((await f.bridge.acknowledgeArtists({ ...f.snapshot([f.received(artist)]), receipts: [receipt] })).confirmed).toBe(0);
    expect((await f.workspace()).entries).toHaveLength(1);
    expect(f.chain.params.model).toBe('nai-diffusion-5-full');
    f.sqlite.close();
  });
  it('完整快照确认对方已移除，保留工坊资产且不会补回；显式重新加入才再发送', async () => {
    const f = fixture(); await f.deliver();
    expect((await f.bridge.sync(f.snapshot([]))).artists).toEqual([]);
    expect((await f.workspace()).entries[0].status).toBe('removed');
    expect((await f.bridge.sync(f.snapshot([]))).artists).toEqual([]);
    // 旧页面的普通加入不能复活已移除记录。
    await f.action('enqueue'); expect((await f.workspace()).chainIds).toEqual([]);
    const originalRequest = (await f.workspace()).entries[0].requestId;
    await f.action('requeue');
    expect((await f.workspace()).entries[0].requestId).not.toBe(originalRequest);
    expect((await f.bridge.sync(f.snapshot([]))).artists).toHaveLength(1);
    expect(f.sqlite.prepare("SELECT base_prompt, preview_image FROM chains WHERE id = 'chosen'").get()).toMatchObject({ base_prompt: 'artist:original', preview_image: '/api/assets/original.png' });
    f.sqlite.close();
  });
  it('不完整、旧连接器、重复 ID、过时页面及请求失败都不能推断删除', async () => {
    const f = fixture(); await f.deliver(); const saved = await f.workspace();
    for (const payload of [f.snapshot([], false), { artists: [] }, { ...f.snapshot([]), artistSnapshot: { ...f.snapshot([]).artistSnapshot, cursor: 'stale-page' } }, { ...f.snapshot([]), artistSnapshot: { ...f.snapshot([]).artistSnapshot, count: 1 } }]) {
      expect((await f.bridge.sync(payload)).artistSnapshotComplete).toBe(false);
      expect((await f.workspace()).entries[0].status).toBe('synced');
      expect((await f.workspace()).lastSnapshotAt).toBe(saved.lastSnapshotAt);
    }
    const incoming = { externalId: 'st:bad', name: '错误', fixedPrompt: '', fixedPromptEnd: '', negativePrompt: '', previewPath: '', previewSourceImage: '' };
    // 验证器需拒绝重复 ID，不能误把未列出的已同步条目当删除。
    const read = f.bridge.requestWorkerJson;
    f.bridge.requestWorkerJson = async (path: string, options?: any) => path === '/api/chains' && options?.method === 'POST' ? { id: null } : read(path, options);
    await f.bridge.sync(f.snapshot([incoming, incoming]));
    expect((await f.workspace()).entries[0].status).toBe('synced');
    f.bridge.requestWorkerJson = async (path: string, options?: any) => { if (path === '/api/chains') throw new Error('offline'); return read(path, options); };
    await expect(f.bridge.sync(f.snapshot([]))).rejects.toThrow('offline');
    expect((await f.workspace()).entries[0].status).toBe('synced'); expect((await f.workspace()).lastSnapshotAt).toBe(saved.lastSnapshotAt);
    f.sqlite.close();
  });
  it('封面失败保留待同步与原封面；自动核对不重试失败任务，手动操作可重试', async () => {
    const f = fixture(); await f.action('enqueue');
    const artist = (await f.bridge.sync(f.snapshot([]))).artists[0]!;
    const partial = { ...f.received(artist), previewPath: '', previewSourceImage: '' };
    await f.bridge.acknowledgeArtists({ ...f.snapshot([partial]), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: false, reason: '封面下载失败 (503)' }] });
    expect((await f.workspace()).entries[0]).toMatchObject({ status: 'pending', error: '封面下载失败 (503)' });
    expect((await f.bridge.sync(f.snapshot([partial]))).artists).toEqual([]);
    expect(f.chain.previewImage).toBe('/api/assets/original.png');
    expect((await f.bridge.sync({ ...f.snapshot([partial]), manual: true })).artists).toHaveLength(1);
    await f.action('requeue');
    expect((await f.workspace()).entries[0].error).toBe('');
    expect((await f.bridge.sync(f.snapshot([partial]))).artists).toHaveLength(1);
    f.sqlite.close();
  });
  it('正文或封面未实际保存、失效 token 和旧会话回执不算成功', async () => {
    const f = fixture(); await f.action('enqueue'); const artist = (await f.bridge.sync(f.snapshot([]))).artists[0]!;
    for (const body of [
      { ...f.snapshot([{ ...f.received(artist), fixedPrompt: 'wrong' }]), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: true }] },
      { ...f.snapshot([{ ...f.received(artist), previewSourceImage: '' }]), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: true }] },
      { ...f.snapshot([f.received(artist)], false), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: true }] },
      { ...f.snapshot([f.received(artist)]), receipts: [{ externalId: artist.externalId, ...artist.receipt, token: 'unknown', success: true }] },
    ]) { expect((await f.bridge.acknowledgeArtists(body)).confirmed).toBe(0); expect((await f.workspace()).entries[0].status).toBe('pending'); }
    f.bridge.applyPreferences({ enabled: false }); f.bridge.applyPreferences({ enabled: true });
    expect((await f.bridge.acknowledgeArtists({ ...f.snapshot([f.received(artist)]), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: true }] })).confirmed).toBe(0);
    f.sqlite.close();
  });
  it('取消任务后的迟到回执不能重新加入，已移除记录不能被旧成功回执复活', async () => {
    const f = fixture(); await f.action('enqueue'); const artist = (await f.bridge.sync(f.snapshot([]))).artists[0]!;
    const ack = { ...f.snapshot([f.received(artist)]), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: true }] };
    await f.action('remove'); await f.bridge.acknowledgeArtists(ack);
    expect((await f.workspace()).entries).toEqual([]);
    await f.action('enqueue'); const second = (await f.bridge.sync(f.snapshot([]))).artists[0]!;
    const secondAck = { ...f.snapshot([f.received(second)]), receipts: [{ externalId: second.externalId, ...second.receipt, success: true }] };
    await f.bridge.acknowledgeArtists(secondAck); await f.bridge.sync(f.snapshot([]));
    await f.bridge.acknowledgeArtists(secondAck);
    expect((await f.workspace()).entries[0].status).toBe('removed');
    f.sqlite.close();
  });
  it('并发加入、接收与移除不会覆盖其他记录，游客与关闭状态不能写入', async () => {
    const f = fixture();
    f.sqlite.exec("INSERT INTO chains (id, name, type) VALUES ('other', '其他', 'style')");
    await Promise.all([f.action('enqueue'), f.action('enqueue', ['other'])]);
    const workspace = await f.workspace(); expect(workspace.chainIds.sort()).toEqual(['chosen', 'other']);
    await Promise.all([f.invoke('/api/integrations/st-chatu8/artist-records', { updates: [{ chainId: 'chosen', requestId: workspace.entries.find((entry: any) => entry.chainId === 'chosen').requestId, status: 'synced' }], verifiedAt: Date.now() }), f.action('remove', ['other'])]);
    expect((await f.workspace()).entries).toHaveLength(1); expect((await f.workspace()).entries[0].status).toBe('synced');
    await expect(f.invoke('/api/st-chatu8/workspace', { action: 'requeue', chainIds: ['chosen'] }, 'guest')).rejects.toMatchObject({ status: 403 });
    await f.invoke('/api/st-chatu8/preferences', { enabled: false });
    await expect(f.action('requeue')).rejects.toMatchObject({ status: 409 });
    expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'unrelated'").get()?.value).toBe('preserve');
    f.sqlite.close();
  });
  it('已关联的酒馆原生 ID 也尊重对方删除；取消重新加入后仍显示已移除', async () => {
    const f = fixture();
    Object.assign(f.bridge.state.artistLinks, { 'st:native': { chainId: 'chosen', lastStHash: '', lastNpmHash: '' } });
    const artist = await f.deliver(); expect(artist.externalId).toBe('st:native');
    await f.bridge.sync(f.snapshot([])); expect((await f.workspace()).entries[0].status).toBe('removed');
    await f.action('requeue'); await f.action('remove');
    expect((await f.workspace()).entries[0].status).toBe('removed');
    expect((await f.bridge.sync(f.snapshot([]))).artists).toEqual([]);
    f.sqlite.close();
  });
  it('发送后工坊修改内容，旧内容的接收回执不能把最新条目标成已同步', async () => {
    const f = fixture(); await f.action('enqueue'); const artist = (await f.bridge.sync(f.snapshot([]))).artists[0]!;
    f.chain.basePrompt = 'artist:latest';
    const ack = await f.bridge.acknowledgeArtists({ ...f.snapshot([f.received(artist)]), receipts: [{ externalId: artist.externalId, ...artist.receipt, success: true }] });
    expect(ack.confirmed).toBe(0); expect((await f.workspace()).entries[0]).toMatchObject({ status: 'pending', error: '工坊条目已更新，请手动同步最新内容' });
    f.sqlite.close();
  });
});
