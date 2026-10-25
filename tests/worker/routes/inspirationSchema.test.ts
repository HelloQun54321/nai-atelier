import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

function fixture(legacy = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(legacy
    ? 'CREATE TABLE inspirations (id TEXT PRIMARY KEY, user_id TEXT, username TEXT, title TEXT, image_url TEXT, prompt TEXT, negative_prompt TEXT, params TEXT, created_at INTEGER)'
    : INIT_SQL);
  sqlite.exec("INSERT INTO inspirations (id, user_id, title, prompt, created_at) VALUES ('saved', 'owner', '保留作品', 'original prompt', 1)");
  const queries: string[] = [];
  let failNext = '';
  const db = { prepare(query: string) {
    queries.push(query);
    let values: (string | number)[] = [];
    const execute = () => {
      if (failNext && query.includes(failNext)) { failNext = ''; throw new Error('synthetic storage failure'); }
      return sqlite.prepare(query);
    };
    return {
      bind(...next: (string | number)[]) { values = next; return this; },
      async all() { return { results: execute().all(...values) }; },
      async first() { return execute().get(...values) || null; },
      async run() { return execute().run(...values); },
    };
  } } as unknown as D1Database;
  const invoke = async (path = '/api/inspirations') => {
    const request = new Request(`http://localhost${path}`);
    return (await handleHistoryRoute({ request, url: new URL(request.url), path, method: 'GET', db, currentUser: { id: 'owner' }, env: {} } as RouteContext))!;
  };
  return { sqlite, queries, invoke, fail(query: string) { failNext = query; } };
}

it('完整库并发读取共用一次结构检查且不尝试已存在列的 ALTER，后续读取复用结果', async () => {
  const { sqlite, queries, invoke } = fixture();
  try {
    const [items, boards] = await Promise.all([invoke(), invoke('/api/inspiration-boards')]);
    expect(await items.json()).toEqual([expect.objectContaining({ id: 'saved', title: '保留作品', prompt: 'original prompt' })]);
    expect(await boards.json()).toEqual({ items: [] });
    expect(queries.filter(query => query.startsWith('PRAGMA'))).toHaveLength(1);
    expect(queries.filter(query => query.startsWith('ALTER'))).toHaveLength(0);
    expect(queries.filter(query => query.startsWith('CREATE'))).toHaveLength(4);
    queries.length = 0;
    await invoke();
    expect(queries).toEqual(['SELECT * FROM inspirations ORDER BY is_pinned DESC, created_at DESC']);
  } finally { sqlite.close(); }
});

it('不同数据库各自补齐旧结构，保留原有收藏内容与默认值', async () => {
  const complete = fixture();
  const legacy = fixture(true);
  try {
    await complete.invoke();
    const response = await legacy.invoke();
    expect(await response.json()).toEqual([expect.objectContaining({ id: 'saved', prompt: 'original prompt', tags: [], archived: false })]);
    expect(legacy.queries.filter(query => query.startsWith('ALTER'))).toHaveLength(16);
    expect(legacy.sqlite.prepare('PRAGMA table_info(inspirations)').all().map(column => column.name)).toContain('image_key');
  } finally { complete.sqlite.close(); legacy.sqlite.close(); }
});

it('部分初始化失败向并发调用者报错，下次仅补尚未完成的列并重试索引', async () => {
  const { sqlite, queries, invoke, fail } = fixture(true);
  try {
    fail('ADD COLUMN source_id');
    const results = await Promise.allSettled([invoke(), invoke('/api/inspiration-boards')]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    for (const result of results) if (result.status === 'rejected') expect(result.reason.message).toBe('synthetic storage failure');
    queries.length = 0;
    expect((await invoke()).status).toBe(200);
    expect(queries.filter(query => query.startsWith('ALTER')).some(query => query.includes('ADD COLUMN board_id'))).toBe(false);
    expect(queries.filter(query => query.startsWith('ALTER')).some(query => query.includes('ADD COLUMN source_id'))).toBe(true);
    expect(sqlite.prepare('SELECT prompt FROM inspirations WHERE id = ?').get('saved')?.prompt).toBe('original prompt');
  } finally { sqlite.close(); }
});
