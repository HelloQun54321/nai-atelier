import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComicBook } from '../../../services/comic/comicBookshelf';
import { createInitialComicDraft } from '../../../services/comic/comicGeometry';
import { handleComicAssetRoute, detectAndSanitizeComicAsset } from '../../../worker/routes/comicAssetRoutes';
import { handleComicBookshelfRoute } from '../../../worker/routes/comicBookshelfRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

const makePngBytes = () => new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const makeWebpBytes = () => new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
]);

const makeGifBytes = () => new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function createFixture() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(INIT_SQL);

  const r2Store = new Map<string, { body: ArrayBuffer; contentType?: string }>();
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
    put: vi.fn(async (key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      r2Store.set(key, { body, contentType: opts?.httpMetadata?.contentType });
    }),
    get: vi.fn(async (key: string) => r2Store.get(key) || null),
    delete: vi.fn(async (key: string) => {
      r2Store.delete(key);
    }),
  };

  const env = { DB: db, BUCKET: bucket } as unknown as Env;

  const invoke = async (
    path: string,
    method = 'GET',
    options: {
      body?: BodyInit;
      headers?: Record<string, string>;
      role?: 'admin' | 'guest';
    } = {},
  ) => {
    const request = new Request(`http://localhost${path}`, {
      method,
      headers: options.headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    const ctx = {
      request,
      url: new URL(request.url),
      path: path.split('?')[0],
      method,
      db,
      env,
      currentUser: { id: 'owner', role: options.role || 'admin' },
    } as RouteContext;
    if (path.startsWith('/api/comic-books')) {
      return (await handleComicBookshelfRoute(ctx))!;
    }
    return (await handleComicAssetRoute(ctx))!;
  };

  return { invoke, bucket, r2Store };
}

describe('comicAssetRoutes D1+R2 custom bubbles & transparent image assets', () => {
  it('validates binary image headers and strips active scripts/handlers from SVGs', () => {
    expect(() => detectAndSanitizeComicAsset(new Uint8Array(24), 'bad.exe', 'application/octet-stream')).toThrow(/仅支持/);

    const dirtySvg = new TextEncoder().encode(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>alert(2)</script><path d="M0 0h10" onclick="evil()"/><a href="javascript:alert(3)"><rect width="10" height="10"/></a></svg>',
    );
    const cleaned = detectAndSanitizeComicAsset(dirtySvg, 'bubble.svg', 'image/svg+xml');
    expect(cleaned.mimeType).toBe('image/svg+xml');
    const text = new TextDecoder().decode(cleaned.bytes);
    expect(text).not.toContain('<script');
    expect(text).not.toContain('onload=');
    expect(text).not.toContain('onclick=');
    expect(text).not.toContain('javascript:');
    expect(text).toContain('<path');
  });

  it('supports upload, list filtering, rename, delete, and preserves R2 objects still referenced by saved comic books', async () => {
    const f = createFixture();

    // 访客禁止访问
    expect((await f.invoke('/api/comic-assets', 'GET', { role: 'guest' })).status).toBe(403);

    // 1. 上传透明底 PNG 自定义气泡
    const bubbleRes = await f.invoke('/api/comic-assets', 'POST', {
      body: makePngBytes(),
      headers: {
        'Content-Type': 'image/png',
        'X-Asset-Kind': 'bubble',
        'X-Asset-Filename': encodeURIComponent('日漫手绘气泡.png'),
        'X-Asset-Width': '640',
        'X-Asset-Height': '420',
      },
    });
    expect(bubbleRes.status).toBe(200);
    const bubbleJson = await bubbleRes.json() as { asset: { id: string; kind: string; name: string; url: string; mimeType: string; r2Key: string } };
    expect(bubbleJson.asset.kind).toBe('bubble');
    expect(bubbleJson.asset.name).toBe('日漫手绘气泡');
    expect(bubbleJson.asset.mimeType).toBe('image/png');
    expect(f.r2Store.has(bubbleJson.asset.r2Key)).toBe(true);

    // 2. 上传透明底 WebP 与 GIF 自定义图片
    const webpRes = await f.invoke('/api/comic-assets', 'POST', {
      body: makeWebpBytes(),
      headers: {
        'Content-Type': 'image/webp',
        'X-Asset-Kind': 'image',
        'X-Asset-Filename': encodeURIComponent('速度网点.webp'),
      },
    });
    expect(webpRes.status).toBe(200);
    const webpJson = await webpRes.json() as { asset: { id: string; r2Key: string; url: string; mimeType: string } };
    expect(webpJson.asset.mimeType).toBe('image/webp');

    const gifRes = await f.invoke('/api/comic-assets', 'POST', {
      body: makeGifBytes(),
      headers: {
        'Content-Type': 'image/gif',
        'X-Asset-Kind': 'image',
        'X-Asset-Filename': encodeURIComponent('闪光特效.gif'),
      },
    });
    expect(gifRes.status).toBe(200);

    // 3. 分类查询
    const onlyBubbles = await (await f.invoke('/api/comic-assets?kind=bubble')).json() as { assets: Array<{ id: string }> };
    expect(onlyBubbles.assets.map(a => a.id)).toEqual([bubbleJson.asset.id]);

    // 4. 重命名素材
    const renameRes = await f.invoke(`/api/comic-assets/${bubbleJson.asset.id}`, 'PATCH', {
      body: JSON.stringify({ name: '主角专用云朵泡', textPadding: { top: 0.18, right: 0.15, bottom: 0.2, left: 0.15 } }),
    });
    expect(renameRes.status).toBe(200);
    const renamed = await renameRes.json() as { asset: { name: string; textPadding?: { top: number } } };
    expect(renamed.asset.name).toBe('主角专用云朵泡');
    expect(renamed.asset.textPadding?.top).toBe(0.18);

    // 5. 将 bubbleJson.asset 写入已保存的漫画书架，再删除素材库记录：R2 文件必须受保护不被删
    const page = createInitialComicDraft('classic-4-121');
    page.bubbles.push({
      id: 'b-custom-1',
      shape: 'soft',
      customAssetId: bubbleJson.asset.id,
      customImageUrl: bubbleJson.asset.url,
      x: 0.5,
      y: 0.5,
      width: 0.3,
      height: 0.2,
      hasTail: false,
      tailX: 0.5,
      tailY: 0.6,
      text: '测试',
      writingMode: 'vertical',
      fontSize: 22,
      textColor: '#111827',
      fillColor: '#ffffff',
      strokeColor: '#111827',
      strokeWidth: 3,
      rotation: 0,
    });
    const book = createComicBook('自定义气泡引用测试', [page], { id: 'book-asset-ref' });
    expect((await f.invoke('/api/comic-books/book-asset-ref', 'PUT', { body: JSON.stringify(book) })).status).toBe(200);

    const delRefRes = await f.invoke(`/api/comic-assets/${bubbleJson.asset.id}`, 'DELETE');
    expect(delRefRes.status).toBe(200);
    const delRefJson = await delRefRes.json() as { keptReferencedFile: boolean };
    expect(delRefJson.keptReferencedFile).toBe(true);
    expect(f.r2Store.has(bubbleJson.asset.r2Key)).toBe(true);

    // 6. 未被引用的 webp 素材删除时，同步释放 R2 对象
    const delFreeRes = await f.invoke(`/api/comic-assets/${webpJson.asset.id}`, 'DELETE');
    expect(delFreeRes.status).toBe(200);
    const delFreeJson = await delFreeRes.json() as { keptReferencedFile: boolean };
    expect(delFreeJson.keptReferencedFile).toBe(false);
    expect(f.r2Store.has(webpJson.asset.r2Key)).toBe(false);
  });
});
