import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

// Android 也从此分支抽取路由；直接执行公共分支，不启动服务或读取私人配置。
const source = ts.createSourceFile('gateway.mjs', await readFile(new URL('../../scripts/media-gateway.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let branch;
const find = node => {
  if (ts.isIfStatement(node) && node.expression.getText(source) === "url.pathname.startsWith('/api/prompt-agent/')") branch = node.getText(source);
  ts.forEachChild(node, find);
};
find(source);
assert.ok(branch);
const route = new (Object.getPrototypeOf(async () => {}).constructor)('req', 'res', 'url', 'promptAgent', 'readRequestBody', 'sendJson', 'hasValidLanCookie', 'lanSecret', branch);

const request = (service, { method = 'POST', authorized = true, language = 'en' } = {}) => {
  const req = Object.assign(new EventEmitter(), { method, body: Buffer.from(JSON.stringify({ language })) });
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false });
  const result = route(req, res, new URL('http://localhost/api/prompt-agent/sessions/session%20one/compact'), service,
    async value => value.body, (reply, status, body) => { Object.assign(reply, { status, body, writableEnded: true }); }, () => authorized, 'synthetic-only');
  return { req, res, result };
};

test('电脑与 Android 公共路由将压缩 POST 交给正确会话并传递语言及取消信号', async () => {
  let received;
  const reply = { compacted: true, context: { beforeTokens: 1000, afterTokens: 100, retainedMessages: 2, contextWindow: 32768 } };
  const call = request({ compactSession: async (...args) => { received = args; return reply; } });
  await call.result;
  assert.equal(received[0], 'session one');
  assert.equal(received[1].language, 'en');
  assert.ok(received[1].signal instanceof AbortSignal);
  assert.equal(call.res.status, 200);
  assert.deepEqual(call.res.body, reply);
  assert.equal(call.req.listenerCount('aborted'), 0);
  assert.equal(call.res.listenerCount('close'), 0);
});

test('压缩接口沿用局域网鉴权、POST 限制和会话忙时 409', async () => {
  let calls = 0;
  const service = { compactSession: async () => { calls++; throw Object.assign(new Error('请先停止这个会话'), { status: 409 }); } };
  for (const [options, status] of [[{ authorized: false }, 401], [{ method: 'GET' }, 405], [{}, 409]]) {
    const call = request(service, options);
    await call.result;
    assert.equal(call.res.status, status);
  }
  assert.equal(calls, 1);
});

test('压缩请求或响应断开会取消摘要并释放监听器', async () => {
  for (const target of ['req', 'res']) {
    let started, signal;
    const ready = new Promise(resolve => { started = resolve; });
    const call = request({ compactSession: async (_id, options) => {
      signal = options.signal;
      started();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    await ready;
    call[target].emit(target === 'req' ? 'aborted' : 'close');
    await call.result;
    assert.equal(signal.aborted, true);
    assert.equal(call.req.listenerCount('aborted'), 0);
    assert.equal(call.res.listenerCount('close'), 0);
  }
});
