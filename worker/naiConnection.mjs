// 网关地址与 Key 一起保存；旧条目缺地址时仍使用官方服务。
export const normalizeNaiGatewayUrl = value => {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new Error('生图网关地址必须是字符串');
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('生图网关地址必须是完整的 HTTP(S) 地址'); }
  if (raw.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('生图网关地址不能包含凭据、查询参数或片段');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:ai\/(?:generate-image(?:-stream)?|encode-vibe)|user\/subscription)$/, '');
  return url.href.replace(/\/+$/, '');
};

/**
 * 按次渠道：用户自填 URL 的按调用计费中转，不提供官方点数/额度。
 * 生成请求仍按网关地址发送，只在前端跳过订阅查询、预算与额度显示。
 */
export const NAI_BILLING_PER_USE = 'per-use';
export const normalizeNaiBillingMode = value => value === NAI_BILLING_PER_USE ? NAI_BILLING_PER_USE : '';


export const validateNaiApiKey = (value, gatewayUrl = '') => {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) throw new Error('密钥不能为空');
  if (key.length > 4096 || !/^[\x21-\x7e]+$/.test(key)) throw new Error('密钥包含无效字符或过长');
  if (!gatewayUrl && !key.startsWith('pst-')) throw new Error('官方密钥应以 pst- 开头；成员 Key 请配置生图网关地址');
  return key;
};

export const resolveNaiGatewayUrl = (authorization, entries) => {
  const key = String(authorization || '').replace(/^Bearer /, '').trim();
  const entry = entries.find(item => item.key === key);
  // 未配置的成员 Key 不能回退官方，避免向错误服务发送凭据。
  try {
    const gatewayUrl = normalizeNaiGatewayUrl(entry?.gatewayUrl);
    validateNaiApiKey(key, gatewayUrl);
    return gatewayUrl;
  } catch (error) {
    throw Object.assign(error, { status: 400, code: 'nai_connection_invalid' });
  }
};
