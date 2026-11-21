import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComicBook } from '../../../services/comic/comicBookshelf';
import { createInitialComicDraft } from '../../../services/comic/comicGeometry';
import { handleComicBookshelfRoute } from '../../../worker/routes/comicBookshelfRoutes';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

function createFixture() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(INIT_SQL);

  const db = {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        query,
        bind(...next: unknown[]) {
          values = next;
          return this;
        },
        async first() {
          return sqlite.prepare(query).get(...(values as never[])) || null;
        },
        async all() {
          return { results: sqlite.prepare(query).all(...(values as never[])) };
        },
        async run() {
          return { meta: sqlite.prepare(query).run(...(values as never[])), success: true };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const st of statements) out.push(await st.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (cause) {
        sqlite.exec('ROLLBACK');
        throw cause;
      }
    },
  } as unknown as D1Database;

  const bucket = {
    delete: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  };
  const env = { DB: db, BUCKET: bucket, LOCAL_HISTORY_ENABLED: 'true' } as unknown as Env;

  const invoke = async (path: string, method = 'GET', body?: unknown, role: 'admin' | 'guest' = 'admin') => {
    const request = new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const ctx = {
      request,
      url: new URL(request.url),
      path: path.split('?')[0],
      method,
      db,
      env,
      currentUser: { id: 'owner', role },
    } as RouteContext;
    if (path.startsWith('/api/comic-books')) {
      return (await handleComicBookshelfRoute(ctx))!;
    }
    return (await handleHistoryRoute(ctx))!;
  };

  const addHistory = (id: string) => {
    sqlite
      .prepare('INSERT INTO local_generation_history (id, user_id, image_key, created_at, prompt) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'owner', `local-history/owner/${id}.png`, 1000, 'comic test');
  };

  return { sqlite, invoke, addHistory };
}

describe('comicBookshelfRoutes D1 persistence & recycle-bin reference protection (Phase 4)', () => {
  it('supports creating, listing, updating, and deleting two-level comic books and rejects guests', async () => {
    const f = createFixture();
    const guestRes = await f.invoke('/api/comic-books', 'GET', undefined, 'guest');
    expect(guestRes.status).toBe(403);

    const page1 = createInitialComicDraft('classic-4-121');
    page1.title = '第 1 页';
    const book = createComicBook('雨夜物语 · 第 1 话', [page1], { id: 'ep-1' });

    const putRes = await f.invoke('/api/comic-books/ep-1', 'PUT', book);
    expect(putRes.status).toBe(200);
    const saved = (await putRes.json() as { book: { revision: number; title: string; pages: unknown[] } }).book;
    expect(saved.revision).toBe(1);
    expect(saved.title).toBe('雨夜物语 · 第 1 话');
    expect(saved.pages).toHaveLength(1);

    const listRes = await f.invoke('/api/comic-books', 'GET');
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json() as { books: Array<{ id: string }> }).books;
    expect(listed.map(b => b.id)).toEqual(['ep-1']);

    const delRes = await f.invoke('/api/comic-books/ep-1', 'DELETE');
    expect(delRes.status).toBe(200);
    const afterDel = (await (await f.invoke('/api/comic-books', 'GET')).json() as { books: unknown[] }).books;
    expect(afterDel).toHaveLength(0);
  });

  it('protects history images referenced by comic pages from recycle-bin move and releases protection upon book deletion', async () => {
    const f = createFixture();
    f.addHistory('h-panel');
    f.addHistory('h-aipage');
    f.addHistory('h-free');

    const page = createInitialComicDraft('classic-4-121');
    page.panels[0].image = {
      url: '/api/local-history/h-panel/image',
      historyId: 'h-panel',
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    };
    page.aiPage.generatedPageImage = {
      url: '/api/local-history/h-aipage/image',
      historyId: 'h-aipage',
      width: 832,
      height: 1216,
    };
    const book = createComicBook('引用保护测试集', [page], { id: 'book-ref' });
    expect((await f.invoke('/api/comic-books/book-ref', 'PUT', book)).status).toBe(200);

    // 批量移入回收站：被漫画引用的两张必须被 comic 理由拦截，未引用的 h-free 正常移入
    const moveRes = await f.invoke('/api/local-history/recycle-bin/move', 'POST', {
      ids: ['h-panel', 'h-aipage', 'h-free'],
    });
    const moved = await moveRes.json() as {
      movedCount: number;
      completedIds: string[];
      skipped: Array<{ id: string; reasons: string[] }>;
    };
    expect(moved.movedCount).toBe(1);
    expect(moved.completedIds).toEqual(['h-free']);
    expect(moved.skipped).toContainEqual({ id: 'h-panel', reasons: expect.arrayContaining(['comic']) });
    expect(moved.skipped).toContainEqual({ id: 'h-aipage', reasons: expect.arrayContaining(['comic']) });

    // 尝试把已经进回收站的 h-free 写入漫画书架，SQL 触发器必须拦截返回 409
    const badPage = createInitialComicDraft('single-splash');
    badPage.panels[0].image = {
      url: '/api/local-history/h-free/image',
      historyId: 'h-free',
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    };
    const conflictBook = createComicBook('冲突引用测试', [badPage], { id: 'book-conflict' });
    const conflictRes = await f.invoke('/api/comic-books/book-conflict', 'PUT', conflictBook);
    expect(conflictRes.status).toBe(409);

    // 删除该漫画作品后，原本受保护的 h-panel 与 h-aipage 即可正常移入回收站
    expect((await f.invoke('/api/comic-books/book-ref', 'DELETE')).status).toBe(200);
    const releaseMove = await (await f.invoke('/api/local-history/recycle-bin/move', 'POST', {
      ids: ['h-panel', 'h-aipage'],
    })).json() as { movedCount: number; completedIds: string[] };
    expect(releaseMove.movedCount).toBe(2);
    expect(releaseMove.completedIds).toEqual(['h-panel', 'h-aipage']);
  });
});
