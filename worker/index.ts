import { MEDIA_VARIANTS, validateMediaSource } from './mediaValidation';
import { LAN_ACCESS_COOKIE } from './sharedWhitelist.mjs';
import {
  corsHeaders, json, error, INIT_SQL,
  type Env, type WorkerContext, type RouteContext,
} from './routes/types';
import { handlePixivRoute } from './routes/pixivRoutes';
import { handleDanbooruRoute } from './routes/danbooruRoutes';
import { handleAitagRoute, ensureAitagCacheSchema } from './routes/aitagRoutes';
import { handleHistoryRoute, handleAgentRoute } from './routes/historyRoutes';
import { handleStBridgeRoute } from './routes/stBridgeRoutes';
import { handleVibeRoute } from './routes/vibeRoutes';
import {
  handleLanRoute, handleSettingsRoute, handleMediaRequest,
  isLoopbackHostname, hasValidLanAccess, lanAccessRequired,
  getLocalOwner, removeLegacyLoggingStorage, removeLegacyArtistLibrary,
} from './routes/settingsRoutes';

// Redirect for /api/media (LAN sessions are checked before this point).
export default {
  async fetch(request: Request, env: Env, ctx?: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const isLocalComputer = isLoopbackHostname(url.hostname);
    const isLanAuthorized = isLocalComputer || await hasValidLanAccess(request, env.LAN_ACCESS_SECRET || '');

    const lanResult = await handleLanRoute(request, env, url);
    if (lanResult) return lanResult;

    if (!isLanAuthorized && path.startsWith('/api/')) {
      return lanAccessRequired();
    }

    if (path === '/api/media') {
      try {
        return await handleMediaRequest(request, env, url);
      } catch (e) {
        console.error('media proxy failed', e);
        return error('Failed to load media', 500);
      }
    }

    // --- R2 Asset Proxy Route (LAN sessions are checked above) ---
    if (path.startsWith('/api/assets/') && method === 'GET') {
        if (!env.BUCKET) return error('Bucket not configured', 503);
        try {
          const rawKey = path.replace('/api/assets/', '');
          const key = decodeURIComponent(rawKey);
          const object = await env.BUCKET.get(key);
          if (!object) return error('File not found', 404);
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Cache-Control', 'private, max-age=31536000, immutable');
          headers.set('Access-Control-Allow-Origin', '*');
          return new Response(object.body, { headers });
        } catch (e) {
          console.error('asset proxy failed', e);
          return error('Failed to load asset', 500);
        }
    }

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.DB) {
       return error('Database not configured.', 503);
    }
    const db = env.DB!;

    // Auto Init DB
    const initDB = async () => {
      const statements = INIT_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const sql of statements) {
          try { await db.prepare(sql).run(); } catch(e) {}
      }
      try { await db.prepare("ALTER TABLE users ADD COLUMN storage_usage INTEGER DEFAULT 0").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE users ADD COLUMN last_login INTEGER").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE users ADD COLUMN max_storage INTEGER DEFAULT 314572800").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN negative_prompt TEXT DEFAULT ''").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN params TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN variable_values TEXT DEFAULT '{}'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE artists ADD COLUMN preview_url TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE artists ADD COLUMN benchmarks TEXT DEFAULT '[]'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN type TEXT DEFAULT 'style'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN guest_hidden INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
      try { await ensureAitagCacheSchema(db); } catch (e) { console.error('Aitag cache table init failed', e) }
    };

    try {
      if (path === '/api/init') { await initDB(); return json({ success: true }); }

      if (env.PERSONAL_MODE_ENABLED !== 'true') {
        return error('This personal build only supports local operation', 403);
      }

      try {
        await db.prepare('SELECT 1 FROM users LIMIT 1').first();
        await db.prepare('SELECT 1 FROM settings LIMIT 1').first();
      } catch {
        await initDB();
      }

      await removeLegacyLoggingStorage(db);
      await removeLegacyArtistLibrary(env, db);

      // Personal mode: no login, guest, logout, password, or account management.
      if (path.startsWith('/api/auth/')) {
        if (path === '/api/auth/me' && method === 'GET') {
          try { await db.prepare('SELECT 1 FROM users').first(); } catch { await initDB(); }
          const owner = await getLocalOwner(db);
          return json({
            id: owner.id,
            username: '本机用户',
            role: 'admin',
            storageUsage: owner.storage_usage || 0,
            maxStorage: owner.max_storage || null,
          });
        }
        return error('Account authentication is disabled in personal mode', 410);
      }

      // --- PUBLIC: Benchmark Config (Read) ---
      if (path === '/api/config/benchmarks' && method === 'GET') {
          const res = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('benchmark_config').first<{value: string}>();
          return json({ config: res ? JSON.parse(res.value) : null });
      }

      const agentResult = await handleAgentRoute({
        request, env, url, path, method, db,
        currentUser: null as any,
        initDB,
        ctx,
      });
      if (agentResult) return agentResult;

      // --- Authenticated Logic ---
      const currentUser = await getLocalOwner(db);

      if (
        path.startsWith('/api/users') ||
        path.startsWith('/api/admin/stats') ||
        path.startsWith('/api/admin/guest-setting') ||
        path.startsWith('/api/admin/logs') ||
        path.startsWith('/api/admin/clear-logs') ||
        path === '/api/client-logs'
      ) {
        return error('Account management is disabled in personal mode', 410);
      }

      const routeContext: RouteContext = {
        request, env, url, path, method, db,
        currentUser,
        initDB,
        ctx,
      };

      const settingsResult = await handleSettingsRoute(routeContext);
      if (settingsResult) return settingsResult;

      const vibeResult = await handleVibeRoute(routeContext);
      if (vibeResult) return vibeResult;

      const stBridgeResult = await handleStBridgeRoute(routeContext);
      if (stBridgeResult) return stBridgeResult;

      const historyResult = await handleHistoryRoute(routeContext);
      if (historyResult) return historyResult;

      const danbooruResult = await handleDanbooruRoute(routeContext);
      if (danbooruResult) return danbooruResult;

      const aitagResult = await handleAitagRoute(routeContext);
      if (aitagResult) return aitagResult;

      const pixivResult = await handlePixivRoute(routeContext);
      if (pixivResult) return pixivResult;

      if (path.startsWith('/api/')) return error('Not Found', 404);
      return env.ASSETS.fetch(request);

    } catch (e: any) {
      // 原始异常（D1/R2 报错可能含内部细节）只进服务端日志，客户端统一收简短文案；
      // 带业务语义的校验错误在各路由内就地捕获并返回对应状态码，不会走到这里。
      console.error('worker request failed:', path, method, e);
      return error('请求处理失败，请查看本地服务日志', 500);
    }
  }
};
