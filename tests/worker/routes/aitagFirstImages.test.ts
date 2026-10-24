// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { handleAitagRoute } from '../../../worker/routes/aitagRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(sql: string) {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
    };
  }, async batch(statements: { run(): Promise<unknown> }[]) { const result = []; for (const statement of statements) result.push(await statement.run()); return result; } } as unknown as D1Database;
  const files = new Map<string, Uint8Array>(), pending: Promise<unknown>[] = [];
  const invoke = async (path: string) => {
    const url = new URL(path, 'http://localhost');
    return (await handleAitagRoute({ db, url, path: url.pathname, method: 'GET', request: new Request(url),
      env: { BUCKET: { put: async (key: string, bytes: ArrayBuffer) => files.set(key, new Uint8Array(bytes)) } },
      ctx: { waitUntil: (task: Promise<unknown>) => pending.push(task) }, initDB: async () => { throw new Error('不迁移真实资料'); },
    } as unknown as RouteContext))!;
  };
  return { sqlite, files, pending, invoke };
}
const works = [1, 2].map(id => ({ id, title: `synthetic-${id}`, AI_type: 'NAI', image_count: 2 }));
const detail = (id: number) => ({ work: works[id - 1], images: [{ work_id: id, file_name: `${id}_p3.png`, remote_image_url: `https://ai-img.10118899.xyz/${id}.png`, ai_json: { prompt: `recipe-${id}`, model: 'nai-diffusion-4-5-full' } }] });

it.each([false, true])('慢原图不阻塞元数据和下一作品，图片失败=%s仍保留真实资料且普通poll不提前命中', async failImage => {
  vi.useFakeTimers(); const f = fixture();
  let finish!: (value: Response) => void;
  const slow = new Promise<Response>(resolve => { finish = resolve; });
  const fetch = vi.fn(async (value: string | URL) => {
    const url = new URL(value);
    if (url.hostname === 'aitag.win' && url.pathname.includes('ai_works_search')) return Response.json({ items: works, total: 2, page: 1 });
    if (url.hostname === 'aitag.win' && url.pathname.startsWith('/api/work/')) return Response.json(detail(Number(url.pathname.split('/').pop())));
    if (url.hostname === 'ai-img.10118899.xyz') return url.pathname === '/1.png' ? slow : new Response(new Uint8Array([2, 3, 4]), { headers: { 'content-type': 'image/png' } });
    throw new Error('测试禁止外网');
  }); vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'error').mockImplementation(() => {});
  await f.invoke('/api/aitag/search?page=1');
  expect(f.pending).toHaveLength(1);
  let settled = false; void f.pending[0].then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0);
  const early = await (await f.invoke('/api/aitag/cache/first-images?ids=1,2&metadata_ids=1,2&timeout_ms=0')).json() as any;
  expect(early.items).toHaveLength(1); expect(early.items[0]).toMatchObject({ id: 1, firstImageStatus: 'metadata', firstImage: { ai_json: { prompt: 'recipe-1' } } });
  expect(early.items[0].localFirstImageUrl).toBeFalsy(); expect(f.files.size).toBe(0);
  await vi.advanceTimersByTimeAsync(550);
  const next = await (await f.invoke('/api/aitag/cache/first-images?ids=1,2&metadata_ids=2,999&timeout_ms=0')).json() as any;
  expect(next.items.map((item: any) => item.id)).toEqual([2]); expect(next.items[0].firstImage.ai_json.prompt).toBe('recipe-2');
  expect(fetch.mock.calls.filter(([url]) => new URL(url).hostname === 'ai-img.10118899.xyz')).toHaveLength(1);
  const ordinary = await (await f.invoke('/api/aitag/cache/first-images?ids=1,2&timeout_ms=0')).json() as any;
  expect(ordinary.items).toEqual([]); expect(ordinary.timedOut).toBe(true);
  expect(settled).toBe(false);
  // 重复列表请求复用同作品在途任务，不再获取详情或启动重复原图保存。
  await f.invoke('/api/aitag/search?page=1');
  expect(fetch.mock.calls.filter(([url]) => String(url).includes('/api/work/'))).toHaveLength(2);
  finish(failImage ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1, 9, 8]), { headers: { 'content-type': 'image/png' } }));
  await vi.advanceTimersByTimeAsync(1100); await Promise.all(f.pending);
  expect(settled).toBe(true);
  const final = await (await f.invoke('/api/aitag/cache/first-images?ids=1,2&timeout_ms=0')).json() as any;
  expect(final.items).toHaveLength(2);
  expect(final.items[0].firstImage.ai_json.prompt).toBe('recipe-1');
  expect(final.items[0].firstImageStatus).toBe(failImage ? 'error' : 'cached');
  if (!failImage) expect(f.files.get('aitag-covers/1.webp')).toEqual(new Uint8Array([1, 9, 8]));
  expect(f.files.get('aitag-covers/2.webp')).toEqual(new Uint8Array([2, 3, 4]));
  expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM aitag_work_details').get()?.count).toBe(0);
  if (!failImage) {
    const calls = fetch.mock.calls.length;
    await f.invoke('/api/aitag/search?page=1'); await Promise.all(f.pending);
    expect(fetch).toHaveBeenCalledTimes(calls + 1);
    expect(vi.getTimerCount()).toBe(0);
  }
});

it('图片连续失败两次后停止本批图片请求，元数据继续取得；下次请求可复用资料重试图片', async () => {
  vi.useFakeTimers(); const f = fixture();
  const three = [...works, { ...works[1], id: 3 }];
  let failing = true;
  const fetch = vi.fn(async (value: string | URL) => {
    const url = new URL(value);
    if (url.pathname.includes('ai_works_search')) return Response.json({ items: three, total: 3, page: 1 });
    if (url.hostname === 'aitag.win') {
      const id = Number(url.pathname.split('/').pop()); return Response.json({ work: { id }, images: [{ work_id: id, file_name: `${id}_p0`, remote_image_url: `https://ai-img.10118899.xyz/${id}.png`, ai_json: { prompt: String(id) } }] });
    }
    if (url.hostname !== 'ai-img.10118899.xyz') throw new Error('测试禁止外网');
    return failing ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
  }); vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'error').mockImplementation(() => {});
  await f.invoke('/api/aitag/search'); await vi.advanceTimersByTimeAsync(1650); await Promise.all(f.pending);
  expect(fetch.mock.calls.filter(([url]) => new URL(url).hostname === 'ai-img.10118899.xyz')).toHaveLength(2);
  const metadata = await (await f.invoke('/api/aitag/cache/first-images?ids=3&metadata_ids=3&timeout_ms=0')).json() as any;
  expect(metadata.items[0]).toMatchObject({ id: 3, firstImageStatus: 'metadata' });
  failing = false; await f.invoke('/api/aitag/search');
  await vi.advanceTimersByTimeAsync(1650); await Promise.all(f.pending);
  expect(fetch.mock.calls.filter(([url]) => new URL(url).hostname === 'aitag.win' && String(url).includes('/api/work/'))).toHaveLength(3);
  expect(f.files.size).toBe(3);
});

it('旧首图JSON损坏时回退远程资料并恢复图片缓存', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.invoke('/api/aitag/cache/first-images?ids=1&timeout_ms=0');
  f.sqlite.prepare("INSERT INTO aitag_works (id,source_sort,first_image_json) VALUES (1,'new','broken-json')").run();
  const fetch = vi.fn(async (value: string | URL) => {
    const url = new URL(value);
    if (url.pathname.includes('ai_works_search')) return Response.json({ items: [works[0]], total: 1 });
    if (url.hostname === 'aitag.win') return Response.json(detail(1));
    if (url.hostname === 'ai-img.10118899.xyz') return new Response(new Uint8Array([7]), { headers: { 'content-type': 'image/png' } });
    throw new Error('测试禁止外网');
  }); vi.stubGlobal('fetch', fetch);
  await f.invoke('/api/aitag/search'); await vi.advanceTimersByTimeAsync(550); await Promise.all(f.pending);
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/api/work/1'))).toBe(true);
  const row = f.sqlite.prepare('SELECT first_image_json,cover_status FROM aitag_works WHERE id=1').get()!;
  expect(JSON.parse(String(row.first_image_json)).ai_json.prompt).toBe('recipe-1'); expect(row.cover_status).toBe('cached');
});

it('慢图迟到失败不降级详情已经保存成功的首图快照，排队图片也复用新成功结果', async () => {
  vi.useFakeTimers(); const f = fixture(); let finish!: (value: Response) => void;
  const slow = new Promise<Response>(resolve => { finish = resolve; });
  const fetch = vi.fn(async (value: string | URL) => {
    const url = new URL(value);
    if (url.pathname.includes('ai_works_search')) return Response.json({ items: works, total: 2 });
    if (url.hostname === 'aitag.win') return Response.json(detail(Number(url.pathname.split('/').pop())));
    if (url.hostname === 'ai-img.10118899.xyz') return slow;
    throw new Error('测试禁止外网');
  }); vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'error').mockImplementation(() => {});
  await f.invoke('/api/aitag/search'); await vi.advanceTimersByTimeAsync(550);
  const snapshots = works.map(work => ({ ...detail(work.id).images[0], local_image_url: `/api/assets/actual-${work.id}.png`, image_cache_status: 'cached' }));
  const update = f.sqlite.prepare("UPDATE aitag_works SET local_cover_url=?,first_image_json=?,cover_status='cached' WHERE id=?");
  snapshots.forEach((snapshot, index) => update.run(snapshot.local_image_url, JSON.stringify(snapshot), index + 1));
  finish(new Response(null, { status: 503 })); await vi.advanceTimersByTimeAsync(550); await Promise.all(f.pending);
  expect(fetch.mock.calls.filter(([url]) => new URL(url).hostname === 'ai-img.10118899.xyz')).toHaveLength(1);
  for (const [index, snapshot] of snapshots.entries()) {
    const row = f.sqlite.prepare('SELECT local_cover_url,first_image_json,cover_status FROM aitag_works WHERE id=?').get(index + 1)!;
    expect(row.local_cover_url).toBe(snapshot.local_image_url); expect(row.cover_status).toBe('cached'); expect(JSON.parse(String(row.first_image_json))).toEqual(snapshot);
  }
});
