const CALLBACK_ORIGIN = 'https://app-api.pixiv.net';
const CALLBACK_PATH = '/web/v1/users/auth/pixiv/callback';
const ALLOWED_NPM_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

chrome.runtime.onMessage.addListener(message => {
  if (!message || message.type !== 'set-session') return;
  const id = String(message.id || '');
  const origin = String(message.origin || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || !ALLOWED_NPM_ORIGINS.has(origin)) return;
  void chrome.storage.session.set({ pixivLoginSession: { id, origin, expiresAt: Date.now() + 5 * 60 * 1000 } });
});

chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  if (details.frameId !== 0) return;
  let callback;
  try { callback = new URL(details.url); } catch { return; }
  if (callback.origin !== CALLBACK_ORIGIN || callback.pathname !== CALLBACK_PATH || !callback.searchParams.get('code')) return;

  const { pixivLoginSession } = await chrome.storage.session.get('pixivLoginSession');
  if (!pixivLoginSession || pixivLoginSession.expiresAt < Date.now() || !ALLOWED_NPM_ORIGINS.has(pixivLoginSession.origin)) return;

  try {
    const response = await fetch(`${pixivLoginSession.origin}/api/pixiv/login/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pixivLoginSession.id, callbackUrl: callback.href }),
    });
    if (!response.ok) return;
    await chrome.storage.session.remove('pixivLoginSession');
    await chrome.tabs.update(details.tabId, { url: `${pixivLoginSession.origin}/?pixiv=connected` });
  } catch {
    // NPM 未运行或网络暂时不可用时保留白页，用户可回到 NPM 重试。
  }
}, {
  url: [{ hostEquals: 'app-api.pixiv.net', pathEquals: CALLBACK_PATH }],
});
