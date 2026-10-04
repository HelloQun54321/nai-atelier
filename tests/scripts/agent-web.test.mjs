import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAgentWebPage, validateAgentWebTarget } from '../../scripts/agent-web.mjs';

const lookupHost = async () => [{ address: '93.184.216.34', family: 4 }];
test('网页连接固定 DNS 结果，文本与响应体规模均有界', async () => {
  let lookups = 0, calls = 0;
  const result = await fetchAgentWebPage('https://example.com', {
    lookupHost: async () => { lookups++; return lookupHost(); },
    request: async (_url, options) => { calls++; assert.ok(options.dispatcher); assert.equal(options.redirect, 'manual'); return new Response('hello', { headers: { 'content-type': 'text/plain' } }); },
  });
  assert.equal(result.text, 'hello'); assert.equal(lookups, 1); assert.equal(calls, 1);
  for (const response of [new Response('abcdef', { headers: { 'content-type': 'text/plain' } }), new Response('pdf', { headers: { 'content-type': 'application/pdf' } })]) {
    await assert.rejects(fetchAgentWebPage('https://example.com', { lookupHost, maxBytes: 5, request: async () => response }), /上限|内容类型/);
  }
});
test('逐跳拒绝内网、映射 IPv6 和保留网段，不进入第二次连接', async () => {
  for (const url of ['https://[::ffff:7f00:1]/', 'https://[::ffff:192.168.1.1]/', 'https://198.18.0.1/', 'https://[ff02::1]/']) await assert.rejects(validateAgentWebTarget(url), /内网|保留/);
  let calls = 0;
  await assert.rejects(fetchAgentWebPage('https://example.com', { lookupHost, request: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); } }), /内网|保留/);
  assert.equal(calls, 1);
});
test('DNS 等待可取消，重定向整体受限', async () => {
  const controller = new AbortController();
  const pending = fetchAgentWebPage('https://example.com', { signal: controller.signal, lookupHost: () => new Promise(() => {}) });
  controller.abort(new Error('synthetic stop'));
  await assert.rejects(pending, /synthetic stop/);
  let calls = 0;
  await assert.rejects(fetchAgentWebPage('https://example.com', { lookupHost, request: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/again' } }); } }), /次数过多/);
  assert.equal(calls, 6);
});
