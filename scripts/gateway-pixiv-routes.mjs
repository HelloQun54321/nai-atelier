import { normalizeLanguage } from '../locales/index.mjs';

/** 构造 Pixiv 图库、登录与收藏 HTTP 路由处理器。 */
export const createPixivGalleryHandler = ({ sendJson, readRequestBody, isPixivConnectionMutationAllowed }) =>
  async (req, res, url, pixivGallery, pixivWebLogin, prewarmer) => {
    if (url.pathname === '/api/pixiv/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, pixivGallery.status());
    }
    if (url.pathname === '/api/pixiv/login/start') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!isPixivConnectionMutationAllowed(req)) {
        return sendJson(res, 403, { error: '请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
      }
      return sendJson(res, 200, await pixivWebLogin.start(normalizeLanguage(req.headers['x-atelier-language'])));
    }
    if (url.pathname === '/api/pixiv/login/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const state = pixivWebLogin.status(url.searchParams.get('id'));
      if (!state) return sendJson(res, 404, { error: '登录会话不存在', code: 'PIXIV_LOGIN_NOT_FOUND' });
      return sendJson(res, 200, state);
    }
    if (url.pathname === '/api/pixiv/login/complete') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!isPixivConnectionMutationAllowed(req)) {
        return sendJson(res, 403, { error: '请在运行 NAI Atelier 的电脑上完成登录', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
      }
      let body = {};
      try { body = JSON.parse((await readRequestBody(req, 8192)).toString('utf8') || '{}'); } catch {
        return sendJson(res, 400, { error: '请求体不是有效 JSON', code: 'PIXIV_INVALID_BODY' });
      }
      return sendJson(res, 200, await pixivWebLogin.complete(body.id, body.callbackUrl));
    }
    if (url.pathname === '/api/pixiv/login') {
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!isPixivConnectionMutationAllowed(req)) {
        return sendJson(res, 403, { error: '请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
      }
      return sendJson(res, 200, await pixivWebLogin.cancel(url.searchParams.get('id')));
    }
    if (url.pathname === '/api/pixiv/connect') {
      if (!isPixivConnectionMutationAllowed(req)) {
        return sendJson(res, 403, { error: 'Pixiv 连接信息只能在本机电脑上修改', code: 'PIXIV_CONNECT_LOCAL_ONLY' });
      }
      if (req.method === 'POST') {
        let body = {};
        try { body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}'); } catch {
          return sendJson(res, 400, { error: '请求体不是有效 JSON', code: 'PIXIV_INVALID_BODY' });
        }
        return sendJson(res, 200, await pixivGallery.connect(body.refreshToken || body.refresh_token));
      }
      if (req.method === 'DELETE') {
        return sendJson(res, 200, await pixivGallery.disconnect());
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/pixiv/feed') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await pixivGallery.feed({
        mode: url.searchParams.get('mode'),
        cursor: url.searchParams.get('cursor'),
        params: Object.fromEntries(url.searchParams),
      });
      // 后台预热该批缩略图：滚动时缓存命中，不再等待首次抓取。
      // 取源顺序必须与卡片请求一致（medium 优先），否则预热缓存键 miss。
      if (prewarmer && Array.isArray(result.items)) {
        const sources = result.items
          .map(item => item.urls?.medium || item.urls?.large || item.urls?.thumb || '')
          .filter(Boolean);
        prewarmer.enqueue(sources);
      }
      return sendJson(res, 200, result);
    }
    if (url.pathname === '/api/pixiv/bookmark') {
      if (req.method === 'POST') {
        let body = {};
        try { body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}'); } catch {
          return sendJson(res, 400, { error: '请求体不是有效 JSON', code: 'PIXIV_INVALID_BODY' });
        }
        return sendJson(res, 200, await pixivGallery.addBookmark({ illustId: body.illust_id || body.illustId, restrict: body.restrict }));
      }
      if (req.method === 'DELETE') {
        let body = {};
        try { body = JSON.parse((await readRequestBody(req, 4096)).toString('utf8') || '{}'); } catch {
          body = {};
        }
        const illustId = body.illust_id || body.illustId || url.searchParams.get('illust_id') || url.searchParams.get('illustId');
        return sendJson(res, 200, await pixivGallery.deleteBookmark({ illustId }));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    return sendJson(res, 404, { error: 'Pixiv 接口不存在', code: 'PIXIV_NOT_FOUND' });
  };
