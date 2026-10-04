import test from 'node:test';
import assert from 'node:assert/strict';
import { readDanbooruRetryAfter, createDanbooruResponseFailure, createDanbooruNetworkFailure, isRetryableDanbooruNetworkError } from '../../services/danbooruErrors.mjs';

test('Retry-After 支持秒数、日期与失效值', () => {
  assert.equal(readDanbooruRetryAfter('90.2'), 91);
  assert.equal(readDanbooruRetryAfter('Thu, 01 Jan 1970 00:02:00 GMT', 30_000), 90);
  for (const value of [null, '', 'invalid', '-1', 'Infinity']) assert.equal(readDanbooruRetryAfter(value), 0);
});

test('仅官方验证标记识别 challenge，403／429／非 JSON 各自保留语义', () => {
  const challenge = createDanbooruResponseFailure(200, new Headers({ 'cf-mitigated': 'challenge', 'content-type': 'text/html' }), '<html>verify</html>');
  assert.deepEqual(challenge, { status: 403, code: 'DANBOORU_CHALLENGE', error: 'Danbooru 要求网站验证，后台暂时无法读取数据', upstreamStatus: 200, retryAfter: 300 });
  assert.equal(createDanbooruResponseFailure(403, new Headers(), 'verify').code, 'DANBOORU_FORBIDDEN');
  const limited = createDanbooruResponseFailure(429, new Headers({ 'retry-after': '120', 'content-type': 'text/html' }), '<html>busy</html>');
  assert.equal(limited.status, 429); assert.equal(limited.retryAfter, 120); assert.equal(limited.code, 'DANBOORU_RATE_LIMIT');
  assert.equal(createDanbooruResponseFailure(200, new Headers(), '<html>verify</html>').code, 'DANBOORU_INVALID_RESPONSE');
  assert.equal(createDanbooruResponseFailure(200, new Headers({ 'content-type': 'application/json' }), '[]'), null);
  const upstream = createDanbooruResponseFailure(500, new Headers({ 'content-type': 'application/json' }), '{"message":"time-out: timed out"}');
  assert.equal(upstream.status, 500); assert.match(upstream.error, /timed out/);
});

test('临时连接断开／超时可重试，验证、限流、证书与主动取消不重试', () => {
  for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
    const error = Object.assign(new Error('fetch failed'), { cause: { code } });
    const failure = createDanbooruNetworkFailure(error);
    assert.equal(failure.causeCode, code);
    assert.equal(isRetryableDanbooruNetworkError(error), true);
    assert.equal(isRetryableDanbooruNetworkError(failure), true);
  }
  for (const error of [{ status: 403, causeCode: 'ECONNRESET' }, { status: 429 }, { name: 'AbortError', cause: { code: 'ECONNRESET' } }, { cause: { code: 'CERT_HAS_EXPIRED' } }, { status: 502, code: 'DANBOORU_INVALID_RESPONSE' }]) {
    assert.equal(isRetryableDanbooruNetworkError(error), false);
  }
  assert.equal(isRetryableDanbooruNetworkError(createDanbooruNetworkFailure({ name: 'TimeoutError' })), true);
});
