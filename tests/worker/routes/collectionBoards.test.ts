import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(INIT_SQL);
  const queries: string[] = [];
  let afterSaveRead: (() => Promise<void>) | undefined;
  let beforeBatch: (() => Promise<void>) | undefined;
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
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = undefined; await callback(); }
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
  return { sqlite, queries, invoke, seed, item, afterSaveRead(callback: () => Promise<void>) { afterSaveRead = callback; },
    beforeBatch(callback: () => Promise<void>) { beforeBatch = callback; } };
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

it('旧收藏夹只读投影为根，颜色排序与同名保留，不创建settings或结构', async () => {
  const { sqlite, queries, invoke } = await fixture();
  try {
    sqlite.exec("UPDATE inspiration_boards SET name='同名',color='#ec4899',sort_order=9 WHERE user_id='owner'");
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    queries.length = 0;
    const result = await (await invoke('/api/inspiration-boards')).json() as any;
    expect(result.items).toHaveLength(3);
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'a', parentId: null, name: '同名', color: '#ec4899', sortOrder: 9 })]));
    expect(queries).toHaveLength(1);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key LIKE 'collection_board_tree_v1:%'").all()).toEqual([]);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual(tables);
  } finally { sqlite.close(); }
});

it('收藏夹任意层级创建与移动，省略父级仅改名称颜色排序，删除提升直接子夹并保留后代作品多归属', async () => {
  const { sqlite, invoke, seed, item } = await fixture();
  const boards = async () => (await (await invoke('/api/inspiration-boards')).json() as any).items;
  try {
    expect((await invoke('/api/inspiration-boards/b', 'PUT', { parentId: 'a' })).status).toBe(200);
    expect((await invoke('/api/inspiration-boards/c', 'PUT', { parentId: 'b' })).status).toBe(200);
    expect((await invoke('/api/inspiration-boards', 'POST', { id: 'deep', name: '同名', parentId: 'c', color: '#ec4899', sortOrder: 8 })).status).toBe(200);
    expect((await invoke('/api/inspiration-boards', 'POST', { id: 'deeper', name: '同名', parentId: 'deep' })).status).toBe(200);
    await invoke('/api/inspiration-boards/deep', 'PUT', { name: '修改', color: '#10b981', sortOrder: 12 });
    expect(await boards()).toContainEqual(expect.objectContaining({ id: 'deep', parentId: 'c', name: '修改', color: '#10b981', sortOrder: 12 }));
    seed('multi', 'b', { collectionBoardIds: ['b', 'deep'], original: true });
    seed('child-only', 'c', { collectionBoardIds: ['c'] });
    expect((await invoke('/api/inspiration-boards/b', 'DELETE')).status).toBe(200);
    expect(await boards()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c', parentId: 'a' }),
      expect.objectContaining({ id: 'deep', parentId: 'c', color: '#10b981', sortOrder: 12 }),
      expect.objectContaining({ id: 'deeper', parentId: 'deep' }),
    ]));
    expect(await item('multi')).toMatchObject({ boardId: 'deep', boardIds: ['deep'], analysis: { original: true } });
    expect((await item('child-only')).boardIds).toEqual(['c']);
    await invoke('/api/inspiration-boards/c', 'PUT', { parentId: null });
    expect(await boards()).toContainEqual(expect.objectContaining({ id: 'c', parentId: null }));
  } finally { sqlite.close(); }
});

it('拒绝自父、环、悬空或跨用户父级，非法操作不写收藏夹及目录', async () => {
  const { sqlite, invoke } = await fixture();
  try {
    await invoke('/api/inspiration-boards/b', 'PUT', { parentId: 'a' });
    const original = sqlite.prepare("SELECT value FROM settings WHERE key='collection_board_tree_v1:owner'").get()?.value;
    for (const parentId of ['a', 'b', 'private', 'missing', '', 1, {}, []]) {
      expect((await invoke('/api/inspiration-boards/a', 'PUT', { parentId })).status).toBe(400);
    }
    for (const parentId of ['created', 'private', 'missing', 1]) {
      expect((await invoke('/api/inspiration-boards', 'POST', { id: 'created', name: '不会保存', parentId })).status).toBe(400);
    }
    expect((await invoke('/api/inspiration-boards', 'POST', { id: ' ', name: '无效ID' })).status).toBe(400);
    expect((await invoke('/api/inspiration-boards/private', 'PUT', { parentId: 'a' })).status).toBe(404);
    expect((await invoke('/api/inspiration-boards/a', 'PUT', { parentId: null }, 'owner', 'guest')).status).toBe(403);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key='collection_board_tree_v1:owner'").get()?.value).toBe(original);
    expect(sqlite.prepare("SELECT id FROM inspiration_boards WHERE id='created'").get()).toBeUndefined();
  } finally { sqlite.close(); }
});

it('损坏已存父图明确报错且不覆盖，按用户隔离父图和收藏夹', async () => {
  const { sqlite, invoke } = await fixture();
  try {
    const stored = sqlite.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');
    stored.run('collection_board_tree_v1:other', JSON.stringify({ revision: 4, parents: { private: null } }));
    for (const value of ['broken', 'null', JSON.stringify({ revision: 0, parents: [] }), JSON.stringify({ revision: 0, parents: { a: 'private' } }), JSON.stringify({ revision: 0, parents: { a: 'b', b: 'a' } })]) {
      stored.run('collection_board_tree_v1:owner', value);
      expect((await invoke('/api/inspiration-boards')).status).toBe(503);
      expect((await invoke('/api/inspiration-boards/a', 'PUT', { name: '不可覆盖' })).status).toBe(503);
      expect(sqlite.prepare("SELECT value FROM settings WHERE key='collection_board_tree_v1:owner'").get()?.value).toBe(value);
    }
    expect(await (await invoke('/api/inspiration-boards', 'GET', undefined, 'other')).json()).toMatchObject({ treeRevision: 4, items: [{ id: 'private', parentId: null }] });
  } finally { sqlite.close(); }
});

it('真实SQLite CAS冲突回滚创建、父级移动及删除，首次无父图也不会覆盖并发目录', async () => {
  const { sqlite, invoke, seed, item, beforeBatch } = await fixture();
  try {
    beforeBatch(async () => { expect((await invoke('/api/inspiration-boards', 'POST', { id: 'winner', name: '先保存', parentId: 'a' })).status).toBe(200); });
    expect((await invoke('/api/inspiration-boards', 'POST', { id: 'loser', name: '冲突创建', parentId: 'b' })).status).toBe(409);
    expect(sqlite.prepare("SELECT id FROM inspiration_boards WHERE id='loser'").get()).toBeUndefined();
    beforeBatch(async () => { expect((await invoke('/api/inspiration-boards/b', 'PUT', { parentId: 'a' })).status).toBe(200); });
    expect((await invoke('/api/inspiration-boards/a', 'PUT', { parentId: 'b', name: '不可保存' })).status).toBe(409);
    expect(sqlite.prepare("SELECT name FROM inspiration_boards WHERE id='a'").get()?.name).toBe('a');
    seed('protected', 'a', { collectionBoardIds: ['a', 'c'] });
    beforeBatch(async () => { await invoke('/api/inspiration-boards/c', 'PUT', { parentId: 'b' }); });
    expect((await invoke('/api/inspiration-boards/a', 'DELETE')).status).toBe(409);
    expect(sqlite.prepare("SELECT id FROM inspiration_boards WHERE id='a'").get()?.id).toBe('a');
    expect((await item('protected')).boardIds).toEqual(['a', 'c']);
    expect((await (await invoke('/api/inspiration-boards')).json() as any).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'b', parentId: 'a' }), expect.objectContaining({ id: 'c', parentId: 'b' }),
    ]));
  } finally { sqlite.close(); }
});
