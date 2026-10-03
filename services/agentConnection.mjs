/** 统一连接地址：允许粘贴根地址或完整端点，保留中转站路径，避免重复追加 /v1。 */
export const normalizeAgentConnectionUrl = (raw, api = 'openai-completions') => {
  const url = new URL(String(raw || '').trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须是 HTTP/HTTPS 地址，不能包含账号、查询参数或片段');
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:chat\/completions|responses|messages)$/, '');
  // Pi 的 Messages 适配器固定追加 /v1/messages。
  if (api === 'anthropic-messages') path = path.replace(/\/v1$/, '');
  url.pathname = path;
  return url.href.replace(/\/$/, '');
};

export const agentConnectionEndpoint = (raw, api = 'openai-completions', models = false) => {
  const base = normalizeAgentConnectionUrl(raw, api);
  return base + (models ? api === 'anthropic-messages' ? '/v1/models' : '/models' : api === 'anthropic-messages' ? '/v1/messages' : api === 'openai-responses' ? '/responses' : '/chat/completions');
};
