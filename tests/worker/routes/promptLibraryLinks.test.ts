import { DatabaseSync } from 'node:sqlite';
import { encode } from 'fast-png';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../../worker/index';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import { handlePromptLibraryLinkRoute, normalizePromptLibraryText } from '../../../worker/routes/promptLibraryLinkRoutes';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import * as artistUsage from '../../../worker/routes/artistUsageIndex';
import * as libraryLinks from '../../../worker/routes/promptLibraryLinkRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../../worker/routes/types';

// 内存 D1 + 真实 SQLite 事务及内存 R2：不读真实 local-data，也不写磁盘。
const png = encode({ width: 8, height: 8, channels: 4, data: new Uint8Array(8 * 8 * 4).fill(255) });
const IMAGE_URL = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const databases: DatabaseSync[] = [];
afterEach(() => { for (const sqlite of databases.splice(0)) sqlite.close(); vi.restoreAllMocks(); });

const fixture = () => {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(INIT_SQL);
  let pendingBatch = Promise.resolve<unknown>(undefined);
  const db = { prepare(query: string) {
    let values: any[] = [];
    return {
      bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; },
    };
  }, async batch(statements: { run(): Promise<unknown> }[]) {
    const result = pendingBatch.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const output = [];
        for (const statement of statements) output.push(await statement.run());
        sqlite.exec('COMMIT');
        return output;
      } catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
    });
    pendingBatch = result.catch(() => {});
    return result;
  } } as unknown as D1Database;
  const images = new Map<string, Uint8Array>();
  const bucket = {
    put: vi.fn(async (key: string, bytes: ArrayBuffer) => { images.set(key, new Uint8Array(bytes).slice()); }),
    get: vi.fn(async () => null),
    delete: vi.fn(async (key: string) => { images.delete(key); }),
  };
  const env = { DB: db, BUCKET: bucket, LOCAL_HISTORY_ENABLED: 'true', PERSONAL_MODE_ENABLED: 'true' } as unknown as Env;
  const user = (id = 'owner', role = 'admin') => ({ id, username: id, role });
  const invoke = async (target: string, method = 'GET', body?: unknown, who = user()) => {
    const url = new URL(`http://localhost${target}`);
    const path = url.pathname;
    const request = new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context = { request, url, path, method, db, env, currentUser: who } as unknown as RouteContext;
    const response = path.startsWith('/api/prompt-library-links') ? await handlePromptLibraryLinkRoute(context)
      : path.startsWith('/api/local-history') ? await handleHistoryRoute(context)
        : await handleSettingsRoute(context);
    return response!;
  };
  return { sqlite, db, env, bucket, images, user, invoke };
};
type Fixture = ReturnType<typeof fixture>;

it('内存 D1 batch 失败整体回滚，后续批次继续串行执行', async () => {
  const { db, sqlite } = fixture();
  const failed = db.batch([
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('batch-test', 'rolled-back'),
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('batch-test', 'duplicate'),
  ]);
  const following = db.batch([
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('batch-test', 'committed'),
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind('updated', 'batch-test'),
  ]);
  await expect(failed).rejects.toThrow();
  expect(await following).toHaveLength(2);
  expect(sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('batch-test')?.value).toBe('updated');
});

const addChain = (f: Fixture, entry: { id: string; type?: string; name?: string; basePrompt?: string; createdAt?: number }) => {
  f.sqlite.prepare('INSERT INTO chains (id, user_id, username, type, name, base_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(entry.id, 'owner', 'owner', entry.type || 'pose', entry.name || entry.id, entry.basePrompt || '', entry.createdAt || 1, entry.createdAt || 1);
};
const addHistory = (f: Fixture, row: { id: string; prompt?: string; createdAt?: number; userId?: string; sourceChainId?: string | null; sourceChainType?: string | null }) => {
  f.sqlite.prepare(`INSERT INTO local_generation_history
    (id, user_id, image_key, prompt, negative_prompt, params, source_chain_id, source_chain_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.userId || 'owner', `synthetic/${row.id}`, row.prompt || '', '', '{"model":"nai-diffusion-4-5-full"}',
      row.sourceChainId ?? null, row.sourceChainType ?? null, row.createdAt ?? 1);
};
const saveHistory = (f: Fixture, body: any = {}, who?: any) => f.invoke('/api/local-history', 'POST', {
  imageUrl: IMAGE_URL, prompt: 'solo', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' }, ...body,
}, who);
const savedRow = (f: Fixture, id: string) => f.sqlite.prepare('SELECT * FROM local_generation_history WHERE id = ?').get(id) as any;
const linkIds = (f: Fixture, historyId: string) => (f.sqlite.prepare('SELECT chain_id FROM prompt_library_links WHERE history_id = ? ORDER BY chain_id')
  .all(historyId) as any[]).map(row => row.chain_id);
const linkCount = (f: Fixture) => Number((f.sqlite.prepare('SELECT COUNT(*) AS count FROM prompt_library_links').get() as any).count);
const progressOf = (f: Fixture, userId = 'owner') => {
  const row = f.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(`prompt_library_links_backfill_v1:${userId}`) as any;
  return row ? JSON.parse(row.value) : null;
};
const savedMeta = (f: Fixture, id: string) => JSON.parse(savedRow(f, id).params)._promptLibrary;

it.each(['artist', 'library'])('保存并行启动统计与关联，%s 先完成仍等待另一支及自动封面', async first => {
  const f = fixture();
  addChain(f, { id: 'lib', basePrompt: 'silver hair' });
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  };
  const artist = gate();
  const library = gate();
  const cover = gate();
  const record = artistUsage.recordArtistHistory;
  const write = libraryLinks.writePromptLibraryLinks;
  const sync = libraryLinks.syncPromptLibraryCover;
  const recordSpy = vi.spyOn(artistUsage, 'recordArtistHistory').mockImplementation(async (...args) => {
    await artist.promise;
    return record(...args);
  });
  const writeSpy = vi.spyOn(libraryLinks, 'writePromptLibraryLinks').mockImplementation(async (...args) => {
    await library.promise;
    return write(...args);
  });
  const coverSpy = vi.spyOn(libraryLinks, 'syncPromptLibraryCover').mockImplementation(async (...args) => {
    await cover.promise;
    return sync(...args);
  });
  let completed = false;
  const saving = saveHistory(f, { id: 'parallel', prompt: 'silver hair' }).then(response => { completed = true; return response; });
  await vi.waitFor(() => {
    expect(recordSpy).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledOnce();
  });
  expect(savedRow(f, 'parallel')).toBeTruthy();
  expect(completed).toBe(false);
  (first === 'artist' ? artist : library).release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  (first === 'artist' ? library : artist).release();
  await vi.waitFor(() => expect(coverSpy).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  cover.release();
  expect((await saving).status).toBe(200);
  expect(linkIds(f, 'parallel')).toEqual(['lib']);
  expect(f.sqlite.prepare('SELECT preview_image FROM chains WHERE id = ?').get('lib')?.preview_image)
    .toBe('/api/assets/local-history%2Fowner%2Fparallel.png');
  expect(f.sqlite.prepare('SELECT key FROM settings WHERE key = ?').get('artist_usage_v1:owner:history:parallel')).toBeTruthy();
});

it('并行统计失败仍等关联和封面落库后交付历史', async () => {
  const f = fixture();
  addChain(f, { id: 'lib', basePrompt: 'silver hair' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(artistUsage, 'recordArtistHistory').mockRejectedValue(new Error('synthetic stats failure'));
  const response = await saveHistory(f, { id: 'stats-failure', prompt: 'silver hair' });
  expect(response.status).toBe(200);
  expect(savedRow(f, 'stats-failure')).toBeTruthy();
  expect(linkIds(f, 'stats-failure')).toEqual(['lib']);
  expect(f.sqlite.prepare('SELECT preview_image FROM chains WHERE id = ?').get('lib')?.preview_image)
    .toBe('/api/assets/local-history%2Fowner%2Fstats-failure.png');
});

it('关联分支失败仍等待统计完成，不提前返回保存回执', async () => {
  const f = fixture();
  addChain(f, { id: 'lib', basePrompt: 'silver hair' });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const record = artistUsage.recordArtistHistory;
  vi.spyOn(artistUsage, 'recordArtistHistory').mockImplementation(async (...args) => {
    await pending;
    return record(...args);
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(libraryLinks, 'writePromptLibraryLinks').mockRejectedValue(new Error('synthetic link failure'));
  let completed = false;
  const saving = saveHistory(f, { id: 'links-failure', prompt: 'silver hair' }).then(response => { completed = true; return response; });
  await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
  expect(completed).toBe(false);
  expect(savedRow(f, 'links-failure')).toBeTruthy();
  release();
  expect((await saving).status).toBe(200);
  expect(f.sqlite.prepare('SELECT key FROM settings WHERE key = ?').get('artist_usage_v1:owner:history:links-failure')).toBeTruthy();
});

it('多条关联和旧归属清理使用同一批次，写入失败整体回滚', async () => {
  const f = fixture();
  await libraryLinks.ensurePromptLibraryLinkSchema(f.db);
  const entry = (id: string) => ({ id, kind: 'pose', name: id, text: 'silver hair', createdAt: 1 });
  await libraryLinks.writePromptLibraryLinks(f.db, { matches: [entry('old')] }, 'batch-links', 1);
  f.sqlite.exec(`CREATE TRIGGER fail_link BEFORE INSERT ON prompt_library_links
    WHEN NEW.chain_id = 'fail' BEGIN SELECT RAISE(ABORT, 'synthetic link failure'); END;`);
  const batchSpy = vi.spyOn(f.db, 'batch');
  await expect(libraryLinks.writePromptLibraryLinks(f.db, { matches: [entry('new'), entry('fail')] }, 'batch-links', 2))
    .rejects.toThrow('synthetic link failure');
  expect(batchSpy).toHaveBeenCalledOnce();
  expect(batchSpy.mock.calls[0][0]).toHaveLength(3);
  expect(linkIds(f, 'batch-links')).toEqual(['old']);
});

it('长条目优先命中，短正文与其它分类的正文不参与归属', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-long', type: 'appearance', name: '长发双马尾', basePrompt: 'Silver  Hair, long twin tails with red ribbon' });
  addChain(f, { id: 'lib-mid', type: 'pose', name: '双马尾', basePrompt: 'silver hair, long twin tails' });
  addChain(f, { id: 'lib-short', type: 'scene', name: '短标签', basePrompt: '1girl' });
  addChain(f, { id: 'lib-other', type: 'wardrobe', name: '无关条目', basePrompt: 'black thighhighs' });
  addChain(f, { id: 'style-a', type: 'style', name: '风格串', basePrompt: 'masterpiece, 1girl' });

  const response = await saveHistory(f, { id: 'img-1', prompt: '1girl, silver hair, long twin tails with red ribbon, smile' });
  expect(response.status).toBe(200);
  // 短正文（1girl）与风格串正文都不参与；两条命中的长条目按正文长度降序落库
  expect(linkIds(f, 'img-1')).toEqual(['lib-long', 'lib-mid']);
  const longRow = f.sqlite.prepare('SELECT kind, chain_name, matched_length FROM prompt_library_links WHERE history_id = ? AND chain_id = ?')
    .get('img-1', 'lib-long') as any;
  expect(longRow).toEqual({
    kind: 'appearance', chain_name: '长发双马尾',
    matched_length: normalizePromptLibraryText('Silver  Hair, long twin tails with red ribbon').length,
  });
  const meta = savedMeta(f, 'img-1');
  expect(meta).toMatchObject({ version: 1, primaryId: 'lib-long' });
  expect(meta.sources.map((source: any) => source.id)).toEqual(['lib-long', 'lib-mid']);
  // 空来源可覆盖：主来源跟随最长命中的库条目
  expect(savedRow(f, 'img-1')).toMatchObject({ source_chain_id: 'lib-long', source_chain_name: '长发双马尾', source_chain_type: 'appearance' });
});

it('一张图命中多条条目时逐条记录，summary 按条目分组且只统计本人', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  addChain(f, { id: 'lib-b', type: 'wardrobe', name: '服装B', basePrompt: 'white sailor dress' });
  addChain(f, { id: 'lib-c', type: 'camera', name: '镜头C', basePrompt: 'from above' });
  addChain(f, { id: 'style-a', type: 'style', name: '风格串', basePrompt: 'masterpiece' });

  await saveHistory(f, { id: 'img-multi', prompt: 'red hair with hairband, white sailor dress, from above' });
  await saveHistory(f, { id: 'img-two', prompt: 'red hair with hairband' });
  // 他人的同款图片不能进入本人汇总
  await saveHistory(f, { id: 'img-other', prompt: 'red hair with hairband' }, f.user('other'));

  expect(linkIds(f, 'img-multi')).toEqual(['lib-a', 'lib-b', 'lib-c']);
  expect(linkIds(f, 'img-other')).toEqual(['lib-a']);

  const summary = await (await f.invoke('/api/prompt-library-links/summary')).json();
  expect(summary.items[0]).toEqual({ chainId: 'lib-a', kind: 'appearance', name: '外观A', count: 2, lastAt: expect.any(Number) });
  // count 相同的两条按最近使用排序，同一张图命中时先后不定，只比较集合
  expect(summary.items.slice(1).map((item: any) => [item.chainId, item.count]).sort())
    .toEqual([['lib-b', 1], ['lib-c', 1]]);
  // 一张图多条关联只算一张图；entries 为库条目总数（风格串不计）
  expect(summary.linkedImages).toBe(2);
  expect(summary.entries).toBe(3);
});

it('风格串/角色/画师样张/Roll 来源不被覆盖，空来源与 playground 会被覆盖', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  const saved = async (body: any) => {
    expect((await saveHistory(f, body)).status).toBe(200);
    return savedRow(f, body.id);
  };
  const prompt = 'red hair with hairband';
  expect(await saved({ id: 'img-style', prompt, sourceChainId: 'style-1', sourceChainName: '合成风格', sourceChainType: 'style' }))
    .toMatchObject({ source_chain_id: 'style-1', source_chain_name: '合成风格', source_chain_type: 'style' });
  expect(await saved({ id: 'img-char', prompt, sourceChainId: 'char-1', sourceChainType: 'character' }))
    .toMatchObject({ source_chain_id: 'char-1', source_chain_type: 'character' });
  // 画师样张与 Roll 串的来源标记只写在 ID 上，绝不能改写（否则会切断样张归档）
  expect(await saved({ id: 'img-sample', prompt, sourceChainId: 'artist-sample:v45:Synthetic' }))
    .toMatchObject({ source_chain_id: 'artist-sample:v45:Synthetic' });
  expect(await saved({ id: 'img-roll', prompt, sourceChainId: 'roll:abc' }))
    .toMatchObject({ source_chain_id: 'roll:abc' });
  // 来源受保护时关联照记，只是不改主来源
  expect(linkIds(f, 'img-style')).toEqual(['lib-a']);
  expect(savedMeta(f, 'img-style').sources.map((source: any) => source.id)).toEqual(['lib-a']);
  expect(await saved({ id: 'img-empty', prompt }))
    .toMatchObject({ source_chain_id: 'lib-a', source_chain_name: '外观A', source_chain_type: 'appearance' });
  expect(await saved({ id: 'img-play', prompt, sourceChainId: 'playground', sourceChainName: '自由实验室', sourceChainType: 'playground' }))
    .toMatchObject({ source_chain_id: 'lib-a', source_chain_type: 'appearance' });
  // 已经记了具体来源 id 的（含库条目）也不再改写：只补关联，不动来源
  expect(await saved({ id: 'img-lib', prompt, sourceChainId: 'lib-other', sourceChainType: 'pose' }))
    .toMatchObject({ source_chain_id: 'lib-other', source_chain_type: 'pose' });
  // 既有的 _promptLibrary 元数据里没有归属信息（合并后由本次命中补上）
  expect(Object.keys(savedMeta(f, 'img-lib')).sort()).toEqual(['linkedAt', 'primaryId', 'sources', 'version']);
  expect(await saved({
    id: 'img-meta', prompt, params: { _promptLibrary: { bilingual: '红发（发带）', references: [{ id: 'ref', url: '/api/assets/x.png' }] } },
  })).toBeTruthy();
  expect(savedMeta(f, 'img-meta')).toMatchObject({
    bilingual: '红发（发带）', references: [{ id: 'ref', url: '/api/assets/x.png' }], version: 1, primaryId: 'lib-a',
  });
});

it('懒回填每次最多 200 行，进度落 settings，重复请求幂等', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  for (let index = 0; index < 250; index++) addHistory(f, { id: `bulk-${index}`, prompt: 'red hair with hairband, solo', createdAt: 1000 + index });
  addHistory(f, { id: 'other-user', prompt: 'red hair with hairband', createdAt: 9999, userId: 'other' });
  expect(linkCount(f)).toBe(0);
  expect(progressOf(f)).toBeNull();

  const first = await (await f.invoke('/api/prompt-library-links/summary')).json();
  expect(first.linkedImages).toBe(200);
  expect(progressOf(f)).toEqual({ cursor: 200, scanned: 200, linked: 200, done: false });

  const second = await (await f.invoke('/api/prompt-library-links/summary')).json();
  expect(second.linkedImages).toBe(250);
  expect(progressOf(f)).toEqual({ cursor: 250, scanned: 250, linked: 250, done: true });

  // 已完成后再请求：不再扫描，也不再改写进度
  const third = await (await f.invoke('/api/prompt-library-links/summary')).json();
  expect(third.linkedImages).toBe(250);
  expect(progressOf(f)).toEqual({ cursor: 250, scanned: 250, linked: 250, done: true });
  expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM prompt_library_links WHERE history_id = 'other-user'").get()).toEqual({ count: 0 });
});

it('rebuild 重置进度后继续分批推进，返回累计扫描量与完成标记', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  for (let index = 0; index < 250; index++) addHistory(f, { id: `bulk-${index}`, prompt: 'red hair with hairband', createdAt: 1000 + index });
  await f.invoke('/api/prompt-library-links/summary');
  await f.invoke('/api/prompt-library-links/summary');
  expect(progressOf(f)).toMatchObject({ done: true });

  const rebuilt = await (await f.invoke('/api/prompt-library-links/rebuild', 'POST')).json();
  expect(rebuilt).toEqual({ success: true, scanned: 200, linked: 200, done: false });
  expect(progressOf(f)).toEqual({ cursor: 200, scanned: 200, linked: 200, done: false });
  // 正在进行的一轮不会被再次重置，否则 rebuild 会永远停在第一页
  const again = await (await f.invoke('/api/prompt-library-links/rebuild', 'POST')).json();
  expect(again).toEqual({ success: true, scanned: 250, linked: 250, done: true });
  expect(linkCount(f)).toBe(250);
  expect((await f.invoke('/api/prompt-library-links/rebuild', 'POST', undefined, f.user('visitor', 'guest'))).status).toBe(403);
});

it('images 接口按条目反查、分页受上限约束并复用历史行映射', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  addChain(f, { id: 'lib-b', type: 'pose', name: '姿势B', basePrompt: 'arms behind back' });
  await saveHistory(f, { id: 'img-1', prompt: 'red hair with hairband, arms behind back', createdAt: 100 });
  await saveHistory(f, { id: 'img-2', prompt: 'red hair with hairband', createdAt: 200 });
  await saveHistory(f, { id: 'img-3', prompt: 'red hair with hairband', createdAt: 300 });

  const all = await (await f.invoke('/api/prompt-library-links/images?chainId=lib-a')).json();
  expect(all).toMatchObject({ count: 3, limit: 60, offset: 0 });
  expect(all.items.map((item: any) => item.id)).toEqual(['img-3', 'img-2', 'img-1']);
  expect(all.items[0]).toMatchObject({
    imageUrl: '/api/local-history/img-3/image', linkKind: 'appearance', linkChainName: '外观A',
    params: { model: 'nai-diffusion-4-5-full' }, createdAt: 300,
  });

  const page = await (await f.invoke('/api/prompt-library-links/images?chainId=lib-a&limit=1&offset=1')).json();
  expect(page).toMatchObject({ count: 3, limit: 1, offset: 1 });
  expect(page.items.map((item: any) => item.id)).toEqual(['img-2']);
  // limit 超上限被夹到 200
  expect((await (await f.invoke('/api/prompt-library-links/images?chainId=lib-a&limit=500')).json()).limit).toBe(200);

  const other = await (await f.invoke('/api/prompt-library-links/images?chainId=lib-b')).json();
  expect(other.items.map((item: any) => [item.id, item.linkKind, item.linkChainName])).toEqual([['img-1', 'pose', '姿势B']]);
  // 缺少 chainId 直接拒绝；他人图片不计入
  expect((await f.invoke('/api/prompt-library-links/images')).status).toBe(400);
  await saveHistory(f, { id: 'img-other', prompt: 'red hair with hairband', createdAt: 400 }, f.user('other'));
  expect((await (await f.invoke('/api/prompt-library-links/images?chainId=lib-a')).json()).count).toBe(3);
});

it('删除历史、删除条目与解除来源都会清掉关联', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  addChain(f, { id: 'lib-b', type: 'pose', name: '姿势B', basePrompt: 'arms behind back' });

  await saveHistory(f, { id: 'img-1', prompt: 'red hair with hairband, arms behind back' });
  expect(linkIds(f, 'img-1')).toEqual(['lib-a', 'lib-b']);
  expect((await f.invoke('/api/local-history/img-1', 'DELETE')).status).toBe(200);
  expect(linkCount(f)).toBe(0);

  await saveHistory(f, { id: 'img-2', prompt: 'red hair with hairband' });
  expect((await f.invoke('/api/chains/lib-a', 'DELETE')).status).toBe(200);
  expect(linkCount(f)).toBe(0);

  // 解除来源与单条解除同样清关联：lib-c 是删除 lib-a 之后仍存在的条目
  addChain(f, { id: 'lib-c', type: 'scene', name: '场景C', basePrompt: 'red hair with hairband' });
  await saveHistory(f, { id: 'img-3', prompt: 'red hair with hairband, arms behind back' });
  expect(linkIds(f, 'img-3')).toEqual(['lib-b', 'lib-c']);
  await f.invoke('/api/local-history/unlink-source', 'POST', { sourceChainId: 'lib-b' });
  expect(linkIds(f, 'img-3')).toEqual(['lib-c']);

  await saveHistory(f, { id: 'img-4', prompt: 'red hair with hairband, arms behind back' });
  await f.invoke('/api/local-history/img-4/unlink', 'PUT');
  expect(linkIds(f, 'img-4')).toEqual([]);
});

it('条目正文改动后重算归属：仍命中保留、不再命中则清掉主来源', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'purple gradient lighting' });
  await saveHistory(f, { id: 'img-1', prompt: 'purple gradient lighting, solo' });
  expect(savedRow(f, 'img-1')).toMatchObject({ source_chain_id: 'lib-a', source_chain_type: 'appearance' });
  expect(linkIds(f, 'img-1')).toEqual(['lib-a']);

  // 改名只刷新关联里保存的名称，归属不变
  expect((await f.invoke('/api/chains/lib-a', 'PUT', { name: '外观A改' })).status).toBe(200);
  expect(linkIds(f, 'img-1')).toEqual(['lib-a']);
  expect((f.sqlite.prepare('SELECT chain_name FROM prompt_library_links WHERE history_id = ?').get('img-1') as any).chain_name).toBe('外观A改');

  // 正文改成不再命中：关联消失，以它为主来源的历史也不再指向它
  expect((await f.invoke('/api/chains/lib-a', 'PUT', { basePrompt: 'orange rim light' })).status).toBe(200);
  expect(linkIds(f, 'img-1')).toEqual([]);
  expect(savedRow(f, 'img-1').source_chain_id).toBeNull();
  expect(savedRow(f, 'img-1').source_chain_type).toBeNull();
});

it('风格串等非库条目的正文改动不会产生假归属', async () => {
  const f = fixture();
  addChain(f, { id: 'style-a', type: 'style', name: '风格串', basePrompt: 'masterpiece, blue eyes' });
  addHistory(f, { id: 'style-img', prompt: 'masterpiece, blue eyes, solo', createdAt: 5, sourceChainId: 'style-a', sourceChainType: 'style' });
  expect((await f.invoke('/api/chains/style-a', 'PUT', { basePrompt: 'masterpiece, blue eyes, best quality' })).status).toBe(200);
  expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM prompt_library_links WHERE chain_id = 'style-a'").get()).toEqual({ count: 0 });
  // 风格串的来源也不因重算被清掉
  expect(savedRow(f, 'style-img')).toMatchObject({ source_chain_id: 'style-a', source_chain_type: 'style' });
});

it('worker 入口注册后可直接反查：summary 命中条目并返回统计', async () => {
  const f = fixture();
  // 个人模式用 users 里历史最多的账号作为当前用户
  f.sqlite.prepare("INSERT INTO users (id, username, password, role, created_at) VALUES ('owner', 'owner', '', 'admin', 1)").run();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  addHistory(f, { id: 'img-1', prompt: 'red hair with hairband, solo', createdAt: 10 });
  const response = await worker.fetch(new Request('http://localhost/api/prompt-library-links/summary'), f.env);
  expect(response.status).toBe(200);
  const summary = await response.json() as any;
  expect(summary.entries).toBe(1);
  expect(summary.items.map((item: any) => [item.chainId, item.count])).toEqual([['lib-a', 1]]);
  // 未注册的子路径仍按 404 处理，不会被本模块吞掉
  expect((await worker.fetch(new Request('http://localhost/api/prompt-library-links/unknown'), f.env)).status).toBe(404);
});

it('同一 id 重存且本次未命中时清掉旧关联，关联写入失败不影响历史保存', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '外观A', basePrompt: 'red hair with hairband' });
  await saveHistory(f, { id: 'img-1', prompt: 'red hair with hairband' });
  expect(linkIds(f, 'img-1')).toEqual(['lib-a']);
  await saveHistory(f, { id: 'img-1', prompt: 'completely different prompt' });
  expect(linkIds(f, 'img-1')).toEqual([]);
  expect(savedRow(f, 'img-1').source_chain_id).toBeNull();

  // ensure 已跑过一次后再删表：关联写入必然失败，但历史本身仍要落库
  await f.invoke('/api/prompt-library-links/summary');
  f.sqlite.exec('DROP TABLE prompt_library_links');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await saveHistory(f, { id: 'img-2', prompt: 'red hair with hairband' });
  expect(response.status).toBe(200);
  expect(savedRow(f, 'img-2').prompt).toBe('red hair with hairband');
  expect(console.error).toHaveBeenCalled();
});

it('结构化角色的分栏参与归属：服饰只在角色分栏里也能命中，且不顶掉风格串来源', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-miao', type: 'wardrobe', name: '苗族服饰', basePrompt: 'miao traditional clothes, ethnic clothes, cross-collar top' });
  addChain(f, { id: 'lib-scene', type: 'scene', name: '废弃游乐园', basePrompt: 'abandoned amusement park, overcast' });
  addChain(f, { id: 'lib-expression', type: 'expression', name: '撩人表情', basePrompt: 'seductive smile, half closed eyes' });

  const response = await saveHistory(f, {
    id: 'img-character',
    // 整段 Prompt 里只有场景，人物/服饰/表情都在角色分栏里
    prompt: 'masterpiece, best quality, abandoned amusement park, overcast',
    params: {
      model: 'nai-diffusion-4-5-full',
      characters: [{
        id: 'char-1', prompt: '', x: 0.5, y: 0.5,
        sections: {
          appearance: 'black hair',
          wardrobe: 'miao traditional clothes, ethnic clothes, cross-collar top',
          pose: 'lying',
          expression: 'seductive smile, half closed eyes',
        },
      }],
    },
    sourceChainId: 'style-a', sourceChainName: '风格串', sourceChainType: 'style',
  });
  expect(response.status).toBe(200);
  expect(linkIds(f, 'img-character')).toEqual(['lib-expression', 'lib-miao', 'lib-scene']);
  // 来源是风格串时仍受保护：不会被库条目改写
  expect(savedRow(f, 'img-character')).toMatchObject({ source_chain_id: 'style-a', source_chain_type: 'style' });
  expect(savedMeta(f, 'img-character').sources.map((source: any) => source.kind)).toEqual(['wardrobe', 'scene', 'expression']);
});

it('回填同样读角色分栏：旧图重算后补上只在 params.characters 里的条目', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-miao', type: 'wardrobe', name: '苗族服饰', basePrompt: 'miao traditional clothes, ethnic clothes' });
  f.sqlite.prepare(`INSERT INTO local_generation_history
    (id, user_id, image_key, prompt, negative_prompt, params, source_chain_id, source_chain_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('img-old', 'owner', 'synthetic/img-old', 'solo, outdoors', '',
      JSON.stringify({ characters: [{ id: 'c1', prompt: '', sections: { wardrobe: 'miao traditional clothes, ethnic clothes' } }] }),
      null, null, 5);
  // 回填前：只看 prompt，必然没有归属
  expect(linkIds(f, 'img-old')).toEqual([]);
  expect((await f.invoke('/api/prompt-library-links/rebuild', 'POST', {})).status).toBe(200);
  expect(linkIds(f, 'img-old')).toEqual(['lib-miao']);
});

it('已有来源 id 时不会被库条目接管（即使类型为空），实验室来源仍可被接管', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '白发', basePrompt: 'white hair, long hair' });

  // 类型为空但已经记了具体来源：保留原来源，只记录关联
  await saveHistory(f, { id: 'img-keep', prompt: 'white hair, long hair', sourceChainId: 'style-a', sourceChainType: '' });
  expect(savedRow(f, 'img-keep').source_chain_id).toBe('style-a');
  expect(linkIds(f, 'img-keep')).toEqual(['lib-a']);

  // 生图实验室来源：允许被命中的库条目接管（这是图墙能统计实验室图片的前提）
  await saveHistory(f, { id: 'img-lab', prompt: 'white hair, long hair', sourceChainId: 'playground', sourceChainType: 'playground' });
  expect(savedRow(f, 'img-lab')).toMatchObject({ source_chain_id: 'lib-a', source_chain_type: 'appearance' });
});

const coverOf = (f: Fixture, chainId: string) => (f.sqlite.prepare('SELECT preview_image FROM chains WHERE id = ?').get(chainId) as any)?.preview_image;

it('保存历史命中库条目时，立刻把这张图设为该条目的自动封面', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', type: 'appearance', name: '白发', basePrompt: 'white hair, long hair' });
  const response = await saveHistory(f, { id: 'img-1', prompt: 'white hair, long hair, solo' });
  expect(response.status).toBe(200);
  expect(coverOf(f, 'lib-a')).toBe('/api/assets/local-history%2Fowner%2Fimg-1.png');
});

it('自动封面取最早关联到的生成图，且不覆盖手动换过的封面', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-appearance', type: 'appearance', name: '白发', basePrompt: 'white hair, long hair' });
  addChain(f, { id: 'lib-pose', type: 'pose', name: '坐姿', basePrompt: 'sitting on chair' });
  addChain(f, { id: 'lib-wardrobe', type: 'wardrobe', name: '风衣', basePrompt: 'long coat' });
  // 手动换过的封面：不应被自动封面覆盖
  f.sqlite.prepare("UPDATE chains SET preview_image = '/api/assets/covers/manual.png' WHERE id = 'lib-wardrobe'").run();
  addHistory(f, { id: 'img-newer', prompt: 'white hair, long hair, sitting on chair, long coat', createdAt: 300 });
  addHistory(f, { id: 'img-older', prompt: 'white hair, long hair, sitting on chair, long coat', createdAt: 100 });

  expect((await f.invoke('/api/prompt-library-links/rebuild', 'POST', {})).status).toBe(200);

  expect(coverOf(f, 'lib-appearance')).toBe('/api/assets/synthetic%2Fimg-older');
  expect(coverOf(f, 'lib-pose')).toBe('/api/assets/synthetic%2Fimg-older');
  expect(coverOf(f, 'lib-wardrobe')).toBe('/api/assets/covers/manual.png');
});

it('自动封面保留历史原件，删除历史不丢图，最后一个封面释放后才清理', async () => {
  const f = fixture();
  for (const id of ['lib-a', 'lib-b']) addChain(f, { id, basePrompt: 'white hair, long hair' });
  await saveHistory(f, { id: 'cover-img', prompt: 'white hair, long hair' });
  const key = savedRow(f, 'cover-img').image_key;
  const url = `/api/assets/${encodeURIComponent(key)}`;
  expect(coverOf(f, 'lib-a')).toBe(url);
  expect(coverOf(f, 'lib-b')).toBe(url);
  expect((await f.invoke('/api/local-history/cover-img', 'DELETE')).status).toBe(200);
  expect(f.images.has(key)).toBe(true);
  expect(coverOf(f, 'lib-a')).toBe(url);
  expect((await f.invoke('/api/chains/lib-a', 'PUT', { previewImage: '' })).status).toBe(200);
  expect(f.images.has(key)).toBe(true);
  expect((await f.invoke('/api/chains/lib-b', 'DELETE')).status).toBe(200);
  expect(f.images.has(key)).toBe(false);
});

it('回填完成后新建条目仍分批补算旧图，且不恢复其他条目已解除的关联', async () => {
  const f = fixture();
  addChain(f, { id: 'existing', basePrompt: 'white hair, long hair' });
  for (let index = 0; index < 250; index++) addHistory(f, { id: `old-${index}`, prompt: 'white hair, long hair', createdAt: index + 1 });
  await f.invoke('/api/prompt-library-links/summary');
  await f.invoke('/api/prompt-library-links/summary');
  const completed = progressOf(f);
  expect(completed.done).toBe(true);
  await f.invoke('/api/local-history/old-249/unlink', 'PUT');
  expect(linkIds(f, 'old-249')).toEqual([]);

  const created = await (await f.invoke('/api/chains', 'POST', { type: 'appearance', name: '白发', basePrompt: 'white hair, long hair' })).json() as any;
  const pendingKey = `prompt_library_links_backfill_v1:owner:chain:${created.id}`;
  const first = await (await f.invoke(`/api/prompt-library-links/images?chainId=${created.id}`)).json() as any;
  expect(first.count).toBe(200);
  expect(linkIds(f, 'old-249')).toEqual([created.id]);
  expect(linkIds(f, 'old-248')).toEqual([created.id, 'existing'].sort());
  expect(JSON.parse((f.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(pendingKey) as any).value)).toMatchObject({ cursor: 200, done: false });
  const second = await (await f.invoke(`/api/prompt-library-links/images?chainId=${created.id}`)).json() as any;
  expect(second.count).toBe(250);
  expect(f.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(pendingKey)).toBeUndefined();
  expect(progressOf(f)).toEqual(completed);
  // 这次补算不改历史的主来源或参数。
  expect(savedRow(f, 'old-249')).toMatchObject({ source_chain_id: null, params: '{"model":"nai-diffusion-4-5-full"}' });
});

it('改正文会补上新命中的旧图，改名及非库条目不安排补算', async () => {
  const f = fixture();
  addChain(f, { id: 'lib-a', basePrompt: 'white hair, long hair' });
  addHistory(f, { id: 'white', prompt: 'white hair, long hair' });
  addHistory(f, { id: 'black', prompt: 'black hair, short hair' });
  await f.invoke('/api/prompt-library-links/summary');
  expect(linkIds(f, 'white')).toEqual(['lib-a']);
  await f.invoke('/api/chains/lib-a', 'PUT', { basePrompt: 'black hair, short hair' });
  const page = await (await f.invoke('/api/prompt-library-links/images?chainId=lib-a')).json() as any;
  expect(page.items.map((item: any) => item.id)).toEqual(['black']);
  expect(linkIds(f, 'white')).toEqual([]);
  await f.invoke('/api/chains/lib-a', 'PUT', { name: '改名' });
  await f.invoke('/api/chains', 'POST', { type: 'style', name: '风格串', basePrompt: 'black hair, short hair' });
  expect(f.sqlite.prepare("SELECT key FROM settings WHERE key GLOB 'prompt_library_links_backfill_v1:owner:chain:*'").all()).toEqual([]);
});

it('一批新建多个条目时，打开详情优先补算当前条目', async () => {
  const f = fixture();
  addHistory(f, { id: 'old', prompt: 'white hair, long hair' });
  await f.invoke('/api/prompt-library-links/summary');
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const created = await (await f.invoke('/api/chains', 'POST', { type: 'appearance', name: `白发${index}`, basePrompt: 'white hair, long hair' })).json() as any;
    ids.push(created.id);
  }
  ids.sort();
  const page = await (await f.invoke(`/api/prompt-library-links/images?chainId=${ids[1]}`)).json() as any;
  expect(page.items.map((item: any) => item.id)).toEqual(['old']);
  expect(linkIds(f, 'old')).toEqual([ids[1]]);
  await f.invoke('/api/prompt-library-links/summary');
  expect(linkIds(f, 'old')).toEqual(ids);
});


it('用途 Tag 写入校验固定清单，更新不抹掉旧自由标签', async () => {
  const f = fixture();
  const body = { id: 'purpose-test', name: 'dress', type: 'preset', basePrompt: 'dress', tags: ['旧自由标签'], params: { _collectedCategory: 'general', _promptLibraryPurposes: ['clothing'] } };
  const response = await f.invoke('/api/chains', 'POST', body);
  expect(response.status).toBe(200);
  const { id } = await response.json() as { id: string };
  expect((await f.invoke('/api/chains/' + id, 'PUT', { params: { ...body.params, _promptLibraryPurposes: ['clothing', 'pose'] } })).status).toBe(200);
  const row = f.sqlite.prepare('SELECT params, tags FROM chains WHERE id = ?').get(id) as any;
  expect(JSON.parse(row.params)._promptLibraryPurposes).toEqual(['clothing', 'pose']);
  expect(JSON.parse(row.tags)).toEqual(['旧自由标签']);
  expect((await f.invoke('/api/chains/' + id, 'PUT', { params: { _promptLibraryPurposes: ['custom'] } })).status).toBe(422);
  expect(f.sqlite.prepare('SELECT params FROM chains WHERE id = ?').get(id)?.params).toBe(row.params);
});
