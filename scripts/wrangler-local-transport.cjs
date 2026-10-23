/* eslint-disable @typescript-eslint/no-require-imports -- 该文件由 Node --require 预加载，必须保持 CommonJS。 */
const http = require('node:http');
const Module = require('node:module');
const { Agent, fetch, Headers, Response } = require('undici');

// workerd 会移除 Connection 请求头；改用本机 Node 通道明确禁用连接池复用。
const dispatcher = new Agent({ pipelining: 0 });
const forward = async request => {
  const response = await fetch(request.url, {
    method: request.method, headers: request.headers, body: request.body,
    duplex: 'half', signal: request.signal, redirect: 'manual', dispatcher,
  });
  if (!response.headers.has('content-encoding')) return response;
  // fetch 已解压正文；清除旧头，避免 Miniflare 再压缩后让原生 HTTP 调用方读到压缩字节。
  const headers = new Headers(response.headers);
  headers.delete('content-encoding'); headers.delete('content-length');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
const configureProxy = options => ({ ...options, workers: options.workers?.map(worker =>
  worker.name === 'ProxyWorker' ? { ...worker, outboundService: forward } : worker),
});

// 旧 Miniflare 的 Node 回环服务也有 5 秒回收边界；只调整它，不改变业务网关。
const createServer = http.createServer;
http.createServer = function (...args) {
  const server = createServer.apply(this, args);
  if (args.some(arg => typeof arg === 'function' && arg.name === '#handleLoopback')) server.keepAliveTimeout = 0;
  return server;
};
Module.syncBuiltinESMExports();

// shortcut: 沿用 Wrangler 的 CommonJS 加载入口和 ProxyWorker 名称；升级依赖时需复验连接回归。
const load = Module._load, wrapped = new WeakMap();
Module._load = function (name, parent, ...args) {
  const exported = load.call(this, name, parent, ...args);
  if (name !== 'miniflare' || !parent?.filename?.replaceAll('\\', '/').includes('/wrangler/')) return exported;
  if (!wrapped.has(exported)) {
    class LocalMiniflare extends exported.Miniflare {
      constructor(options) { super(configureProxy(options)); }
      setOptions(options) { return super.setOptions(configureProxy(options)); }
    }
    wrapped.set(exported, { ...exported, Miniflare: LocalMiniflare });
  }
  return wrapped.get(exported);
};
module.exports = { configureProxy };
