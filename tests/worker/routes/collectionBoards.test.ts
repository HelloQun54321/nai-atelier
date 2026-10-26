import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(INIT_SQL);
  const queries: string[] = [];
  let afterSaveRead: (() => Promise<void>) | undefined;
  const db = {
    prepare(query: string) {
      queries.push(query);
      let values: any[] = [];
      return {
        bind(...next: any[]) { values = next; return this; },
        async all() { return { results: sqlite.prepare(query).all(...values) }; },
        async first() {
          const row = sqlite.prepare(query).get(...values) || null;
          if (query === 'SELECT id, user_id, board_id, analysis FROM inspirations WHERE id = ?' && afterSaveRead) {
            const callback = afterSaveRead; afterSaveRead = undefined; await callback();
          }
          return row;
        },
        async run() { const result = sqlite.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
    },
  } as unknown as D1Database;
  const invoke = async (path = '/api/inspirations', method = 'GET', body?: unknown, userId = 'owner', role = 'user') => {
    const url = new URL('http://localhost' + path);
    const request = new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return (await handleHistoryRoute({ request, url, path, method, db, currentUser: { id: userId, username: userId, role }, env: {} } as RouteContext))!;
  };
  await invoke();
  for (const id of ['a', 'b', 'c', 'private']) sqlite.prepare('INSERT INTO inspiration_boards (id,user_id,name,created_at,updated_at) VALUES (?,?,?,1,1)').run(id, id === 'private' ? 'other' : 'owner', id);
  const seed = (id: string, boardId: string | null, analysis: unknown = {}, user = 'owner') => sqlite.prepare('INSERT INTO inspirations (id,user_id,title,prompt,board_id,analysis,created_at) VALUES (?,?,?,?,?,?,1)').run(id, user, id, 'original prompt', boardId, typeof analysis === 'string' ? analysis : JSON.stringify(analysis));
  const item = async (id: string) => (await (await invoke('/api/inspirations/' + id)).json() as any).item;
  return { sqlite, queries, invoke, seed, item, afterSaveRead(callback: () => Promise<void>) { afterSaveRead = callback; } };
}

it('收藏多归属保存、回读，旧primary与普通来源编辑均保留成员，显式清空进入未整理', async () => {
  const { sqlite, invoke, seed, item } = await fixture();
  try {
    seed('legacy', 'a', { collectionOriginalUrl: '/original', keep: 1 });
    expect((await item('legacy')).boardIds).toEqual(['a']);
    expect((await invoke('/api/inspirations/legacy', 'PUT', { boardIds: ['a', 'b', 'a'] })).status).toBe(200);
    expect(await item('legacy')).toMatchObject({ boardId: 'a', boardIds: ['a', 'b'], analysis: { keep: 1, collectionOriginalUrl: '/original' } });
    await invoke('/api/inspirations/legacy', 'PUT', { boardId: 'a', title: 'edited', analysis: { collectionOriginalUrl: '/new', collectionBoardIds: ['c'] } });
    expect(await item('legacy')).toMatchObject({ title: 'edited', boardIds: ['a', 'b'], analysis: { collectionOriginalUrl: '/new', collectionBoardIds: ['a', 'b'] } });
    await invoke('/api/inspirations', 'POST', { id: 'legacy', boardId: 'a', imageUrl: '/image', analysis: { fresh: true } });
    expect(await item('legacy')).toMatchObject({ boardIds: ['a', 'b'], analysis: { fresh: true, collectionBoardIds: ['a', 'b'] } });
    await invoke('/api/inspirations/legacy', 'PUT', { boardIds: [] });
    expect(await item('legacy')).toMatchObject({ boardIds: [], analysis: { fresh: true, collectionBoardIds: [] } });
    expect(sqlite.prepare("SELECT board_id FROM inspirations WHERE id='legacy'").get()?.board_id).toBeNull();
    await invoke('/api/inspirations', 'POST', { id: 'created', boardIds: ['c', 'b'], imageUrl: '/created' });
    expect(await item('created')).toMatchObject({ boardId: 'c', boardIds: ['c', 'b'] });
  } finally { sqlite.close(); }
});

it('批量增删按每条当前归属计算，保留其它夹、来源元数据和非本人收藏，列表仍单查询', async () => {
  const { sqlite, queries, invoke, seed, item } = await fixture();
  try {
    seed('first', 'a', { collectionBoardIds: ['a', 'b'], original: 1 });
    seed('second', 'c', { original: 2 });
    seed('foreign', 'private', { collectionBoardIds: ['private'] }, 'other');
    const result = await invoke('/api/inspirations/bulk-update', 'POST', { ids: ['first', 'second', 'foreign'], updates: { addBoardIds: ['b'], removeBoardIds: ['a'] } });
    expect(await result.json()).toMatchObject({ updatedCount: 2 });
    expect(await item('first')).toMatchObject({ boardId: 'b', boardIds: ['b'], analysis: { original: 1 } });
    expect(await item('second')).toMatchObject({ boardId: 'c', boardIds: ['c', 'b'], analysis: { original: 2 } });
    await invoke('/api/inspirations/bulk-update', 'POST', { ids: ['first', 'second'], updates: { analysis: { collectionBoardIds: [], source: 'edited' } } });
    expect((await item('first')).boardIds).toEqual(['b']);
    expect((await item('second')).boardIds).toEqual(['c', 'b']);
    expect(sqlite.prepare("SELECT board_id FROM inspirations WHERE id='foreign'").get()?.board_id).toBe('private');
    queries.length = 0;
    expect((await invoke()).status).toBe(200);
    expect(queries).toEqual(['SELECT * FROM inspirations ORDER BY is_pinned DESC, created_at DESC']);
  } finally { sqlite.close(); }
});

it('同ID POST读到旧归属后并发PUT加夹，普通保存及delta保留最新成员，显式替换仍按用户选择', async () => {
  const { sqlite, invoke, seed, item, afterSaveRead } = await fixture();
  try {
    const cases = [
      { id: 'metadata', updates: { analysis: { source: 'fresh', collectionBoardIds: [] } }, expected: ['a', 'b'] },
      { id: 'legacy', updates: { boardId: 'a' }, expected: ['a', 'b'] },
      { id: 'delta', updates: { addBoardIds: ['c'] }, expected: ['a', 'b', 'c'] },
      { id: 'replace', updates: { boardIds: ['c'] }, expected: ['c'] },
    ];
    for (const { id, updates, expected } of cases) {
      seed(id, 'a', { collectionBoardIds: ['a'], original: true });
      afterSaveRead(async () => {
        expect((await invoke('/api/inspirations/' + id, 'PUT', { addBoardIds: ['b'] })).status).toBe(200);
      });
      expect((await invoke('/api/inspirations', 'POST', { id, imageUrl: '/saved', ...updates })).status).toBe(200);
      expect(await item(id)).toMatchObject({ boardId: expected[0], boardIds: expected, analysis: { collectionBoardIds: expected } });
    }
    expect((await item('metadata')).analysis.source).toBe('fresh');
    expect((await item('delta')).analysis.original).toBe(true);
  } finally { sqlite.close(); }
});

it('删除收藏夹只移除其成员并顺延primary，末个成员删除后未整理，坏JSON不阻断整理', async () => {
  const { sqlite, invoke, seed, item } = await fixture();
  try {
    seed('multi', 'a', { collectionBoardIds: ['a', 'b', 'c'], keep: true });
    seed('secondary', 'b', { collectionBoardIds: ['b', 'a'] });
    seed('bad', 'a', '{broken');
    expect((await invoke('/api/inspiration-boards/a', 'DELETE')).status).toBe(200);
    expect(await item('multi')).toMatchObject({ boardId: 'b', boardIds: ['b', 'c'], analysis: { keep: true } });
    expect((await item('secondary')).boardIds).toEqual(['b']);
    expect((await item('bad')).boardIds).toEqual([]);
    await invoke('/api/inspiration-boards/b', 'DELETE');
    expect((await item('multi')).boardIds).toEqual(['c']);
    expect((await item('secondary')).boardIds).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM inspirations').get()?.count).toBe(3);
  } finally { sqlite.close(); }
});

it('拒绝不存在、跨用户及非法收藏夹输入，并防止POST覆盖他人记录', async () => {
  const { sqlite, invoke, seed, item } = await fixture();
  try {
    seed('saved', 'a');
    seed('foreign', 'private', {}, 'other');
    for (const updates of [{ boardIds: ['missing'] }, { addBoardIds: ['private'] }, { removeBoardIds: ['private'] }, { boardIds: 'a' }, { boardIds: [1] }, { boardIds: [' '] }, { boardIds: Array(501).fill('a') }, { boardId: 1 }]) {
      expect((await invoke('/api/inspirations/saved', 'PUT', updates)).status).toBe(400);
      expect((await invoke('/api/inspirations/bulk-update', 'POST', { ids: ['saved'], updates })).status).toBe(400);
      expect((await invoke('/api/inspirations', 'POST', { id: 'saved', ...updates })).status).toBe(400);
    }
    expect((await invoke('/api/inspirations', 'POST', { id: 'foreign', boardIds: ['a'] })).status).toBe(403);
    expect((await invoke('/api/inspirations/saved', 'PUT', { boardIds: ['b'] }, 'owner', 'guest')).status).toBe(403);
    expect((await item('saved')).boardIds).toEqual(['a']);
    expect(sqlite.prepare("SELECT board_id FROM inspirations WHERE id='foreign'").get()?.board_id).toBe('private');
  } finally { sqlite.close(); }
});
