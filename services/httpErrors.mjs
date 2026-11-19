/** 错误正文可来自上游网页或包在 JSON 内；不把网页源码交给界面和后台任务回执。 */

/** 把上游错误的字符串／数组／对象统一转成可读文本：NovelAI 的 400 常把原因放在 message 数组或 errors 对象里。 */
const describeValue = (value, depth = 0) => {
  if (depth > 3 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => describeValue(item, depth + 1)).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const record = value;
    for (const key of ['message', 'error', 'detail', 'description', 'reason', 'issue', 'msg', 'errors']) {
      const text = describeValue(record[key], depth + 1);
      if (text) return text;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return '';
    }
  }
  return '';
};

export function parseHttpError(body, status, fallback = status ? `请求失败 (${status})` : '请求失败') {
  if (typeof body !== 'string') body = '';
  let message = fallback, code, retryAfter;
  try {
    const value = JSON.parse(body);
    if (value && typeof value === 'object') {
      if (typeof value.code === 'string' && value.code) code = value.code;
      if (typeof value.retryAfter === 'number' && Number.isFinite(value.retryAfter) && value.retryAfter > 0) retryAfter = Math.ceil(value.retryAfter);
      // 只认字符串会丢掉 NovelAI 的数组／对象报错，退化成泛化的 HTTP 400；这里统一展开成可读文本。
      const described = describeValue(value.error)
        || describeValue(value.message)
        || describeValue(value.errors)
        || describeValue(value.detail)
        || code || fallback;
      message = described;
    } else if (typeof value === 'string' && value.trim()) message = value;
  } catch { message = body.trim() || fallback; }
  if (/<!doctype\s+html\b|<\/?(?:html|head|body|title|script|style)\b/i.test(message)) {
    message = status >= 500 && status <= 599 ? `服务暂时不可用 (HTTP ${status})，请稍后重试`
      : status >= 400 && status <= 499 ? `服务返回了错误页面 (HTTP ${status})，请检查网络或代理后重试`
      : '服务返回了错误页面，请稍后重试';
  }
  return { message: message.length > 500 ? `${message.slice(0, 500)}…` : message, ...(code ? { code } : {}), ...(retryAfter ? { retryAfter } : {}) };
}
