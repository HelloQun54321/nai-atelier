import {
  COMIC_BOOK_MAX_CHARS,
  comicBookKeyPrefix,
  comicBookStorageKey,
  validateComicBook,
  type ComicBook,
} from '../../services/comic/comicBookshelf';
import { ensureHistoryRecycleSchema } from './historyRecycleSchema';
import { error, json, type RouteContext } from './types';

/**
 * 漫画两级书架（作品/话 → 页序列表）D1 持久化路由。
 * 复用私人 settings 表（键前缀 comic_book_v1:<userId>:<bookId>），零破坏性表结构迁移，
 * 并自动受历史回收站引用保护（historyRecycleRoutes 的 comic 引用检查与 SQL 触发器）。
 */
export async function handleComicBookshelfRoute({
  path,
  method,
  request,
  db,
  currentUser,
}: RouteContext): Promise<Response | null> {
  const isCollection = path === '/api/comic-books';
  const itemMatch = path.match(/^\/api\/comic-books\/([^/]+)$/);
  if (!isCollection && !itemMatch) return null;
  if (currentUser.role === 'guest') return error('访客无法访问漫画书架', 403);

  const prefix = comicBookKeyPrefix(currentUser.id);

  if (isCollection) {
    if (method !== 'GET') return error('Method not allowed', 405);
    const rows = await db
      .prepare('SELECT value FROM settings WHERE key >= ? AND key < ?')
      .bind(prefix, prefix + '\uffff')
      .all<{ value: string }>();
    const books: ComicBook[] = [];
    for (const row of rows.results || []) {
      try {
        const parsed: unknown = JSON.parse(row.value);
        validateComicBook(parsed);
        books.push(parsed);
      } catch {
        // 跳过单条损坏记录，避免阻塞其余作品加载
      }
    }
    books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json({ books });
  }

  const bookId = decodeURIComponent(itemMatch![1]);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(bookId)) {
    return error('漫画作品 ID 无效', 400);
  }
  const key = comicBookStorageKey(currentUser.id, bookId);

  if (method === 'GET') {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row) return error('漫画作品不存在', 404);
    try {
      const parsed: unknown = JSON.parse(row.value);
      validateComicBook(parsed);
      return json({ book: parsed });
    } catch {
      return error('漫画作品资料读取失败', 500);
    }
  }

  if (method === 'DELETE') {
    const row = await db.prepare('SELECT key FROM settings WHERE key = ?').bind(key).first<{ key: string }>();
    if (!row) return error('漫画作品不存在', 404);
    await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
    return json({ deleted: bookId });
  }

  if (method !== 'PUT') return error('Method not allowed', 405);

  const raw = await request.text();
  if (raw.length > COMIC_BOOK_MAX_CHARS) {
    return error('单部漫画作品资料过大，请拆分新话保存', 413);
  }

  let incoming: ComicBook;
  try {
    const parsed: unknown = JSON.parse(raw);
    validateComicBook(parsed);
    if (parsed.id !== bookId) {
      throw new Error('作品 ID 与请求路径不一致');
    }
    incoming = parsed;
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : '漫画作品资料无效', 400);
  }

  await ensureHistoryRecycleSchema(db);
  const existingRow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let previous: ComicBook | undefined;
  if (existingRow) {
    try {
      const parsed: unknown = JSON.parse(existingRow.value);
      validateComicBook(parsed);
      previous = parsed;
    } catch {
      previous = undefined;
    }
  }

  const now = Date.now();
  const saved: ComicBook = {
    id: bookId,
    title: incoming.title.trim(),
    description: (incoming.description || '').trim(),
    pages: incoming.pages,
    revision: (previous?.revision ?? incoming.revision ?? 0) + 1,
    createdAt: previous?.createdAt ?? incoming.createdAt ?? now,
    updatedAt: now,
  };

  try {
    await db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, JSON.stringify(saved))
      .run();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('history_reference_target_recycled')) {
      return error('该漫画页引用了已移入回收站的历史原图，请先从回收站恢复该图后再保存', 409);
    }
    throw cause;
  }

  return json({ book: saved });
}
