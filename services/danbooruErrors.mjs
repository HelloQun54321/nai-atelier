/** Retry-After 同时支持秒数和 HTTP 日期；无效值不制造等待。 */
export const readDanbooruRetryAfter = (value, now = Date.now()) => {
  const text = String(value ?? '').trim();
  if (!text || /^-\d/.test(text)) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : (Date.parse(text) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
};

/** 网页验证只按官方响应头识别，不把普通 HTML 或所有 403 都猜成验证码。 */
export const createDanbooruResponseFailure = (status, headers, body) => {
  const retryAfter = readDanbooruRetryAfter(headers.get('retry-after'));
  const details = { upstreamStatus: status, ...(retryAfter ? { retryAfter } : {}) };
  if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
    return { status: 403, code: 'DANBOORU_CHALLENGE', error: 'Danbooru 要求网站验证，后台暂时无法读取数据', ...details, retryAfter: Math.max(300, retryAfter) };
  }
  if (status === 403) return { status, code: 'DANBOORU_FORBIDDEN', error: 'Danbooru 拒绝了后台访问', ...details, retryAfter: Math.max(300, retryAfter) };
  if (status === 429) return { status, code: 'DANBOORU_RATE_LIMIT', error: 'Danbooru 请求过于频繁', ...details, retryAfter: Math.max(30, retryAfter) };
  const isJson = (headers.get('content-type') || '').toLowerCase().includes('json');
  if (status >= 200 && status < 300 && isJson) return null;
  if (status >= 400) {
    let message = '';
    if (isJson) {
      try { const data = JSON.parse(body); message = data?.message || data?.error || ''; } catch { /* 无效 JSON 不向界面回传网页。 */ }
    }
    return { status, code: 'DANBOORU_UPSTREAM_ERROR', error: typeof message === 'string' && message ? `Danbooru ${status}：${message.slice(0, 240)}` : `Danbooru 返回 HTTP ${status}`, ...details };
  }
  return { status: 502, code: 'DANBOORU_INVALID_RESPONSE', error: 'Danbooru 返回了非 JSON 数据', ...details };
};

const transientCodes = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const networkCode = error => error?.causeCode || error?.cause?.code || error?.code;

/** 只重试已确认的临时网络错误；拒绝、验证、限流、证书错误与主动取消均不重试。 */
export const isRetryableDanbooruNetworkError = error => {
  if (error?.name === 'AbortError' || (error?.status && error.status < 500)) return false;
  return error?.name === 'TimeoutError' || error?.code === 'DANBOORU_TIMEOUT' || transientCodes.has(networkCode(error));
};

export const createDanbooruNetworkFailure = error => {
  const causeCode = networkCode(error);
  const timeout = error?.name === 'TimeoutError' || /TIMEOUT|TIMEDOUT/.test(causeCode || '');
  return {
    status: timeout ? 504 : 502,
    code: timeout ? 'DANBOORU_TIMEOUT' : 'DANBOORU_NETWORK_ERROR',
    error: timeout ? '连接 Danbooru 超时，请稍后重试' : '连接 Danbooru 失败，请稍后重试',
    ...(typeof causeCode === 'string' ? { causeCode } : {}),
  };
};
