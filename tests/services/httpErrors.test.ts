import { describe, expect, it } from 'vitest';
import { parseHttpError } from '../../services/httpErrors.mjs';

describe('parseHttpError 展开上游错误', () => {
  it('字符串错误原样保留', () => {
    expect(parseHttpError(JSON.stringify({ message: 'prompt 过长' }), 400).message).toBe('prompt 过长');
    expect(parseHttpError(JSON.stringify({ error: 'invalid token' }), 401).message).toBe('invalid token');
  });

  it('NovelAI 的数组 message 不再退化成 HTTP 400', () => {
    const body = JSON.stringify({ statusCode: 400, message: ['prompt: String must contain at most 5000 character(s)', 'negative_prompt: Required'] });
    const result = parseHttpError(body, 400, 'NovelAI HTTP 400');
    expect(result.message).toContain('prompt: String must contain');
    expect(result.message).toContain('negative_prompt: Required');
  });

  it('对象形态的 message / errors 展开成可读文本', () => {
    expect(parseHttpError(JSON.stringify({ message: { prompt: '格式错误', steps: '超出范围' } }), 400).message).toContain('格式错误');
    expect(parseHttpError(JSON.stringify({ errors: { prompt: ['权重语法错误'] } }), 400).message).toContain('权重语法错误');
    const nested = parseHttpError(JSON.stringify({ error: { code: 'BAD_INPUT', message: '种子不合法' } }), 400);
    expect(nested.message).toBe('种子不合法');
  });

  it('仍保留 code、retryAfter 与 HTML 页面降级、超长截断', () => {
    const parsed = parseHttpError(JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 12.4 }), 429);
    expect(parsed.code).toBe('RATE_LIMITED');
    expect(parsed.retryAfter).toBe(13);
    expect(parseHttpError('<html><body>oops</body></html>', 502).message).toContain('服务暂时不可用');
    expect(parseHttpError(JSON.stringify({ message: 'x'.repeat(800) }), 400).message.length).toBe(501);
  });
});
