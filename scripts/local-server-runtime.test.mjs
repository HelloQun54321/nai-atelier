import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { inspectExistingLocalServer, restartOwnedLocalServer } from './local-server-runtime.mjs';

const response = value => ({ ok: true, json: async () => value });
const projectDir = resolve('synthetic-project');
test('启动检查区别当前后端、旧后端、未加载代码与无关监听器', async () => {
  for (const [config, expected] of [[{ backendVersion: 'synthetic', restartRequired: false }, true], [{}, false], [{ backendVersion: 'old' }, false], [{ backendVersion: 'synthetic', restartRequired: true }, false]]) {
    const result = await inspectExistingLocalServer('synthetic', async url => response(url.endsWith('/config') ? config : { authorized: true }));
    assert.equal(result.current, expected);
  }
  assert.equal(await inspectExistingLocalServer('synthetic', async () => response({ unrelated: true })), null);
  assert.equal(await inspectExistingLocalServer('synthetic', async () => { throw new Error('offline'); }), null);
});
test('重启仅核对本项目，身份缺失或另一个项目不会执行终止', async () => {
  let calls = 0;
  for (const identity of [{}, { projectDir: resolve('another-project') }]) {
    await assert.rejects(restartOwnedLocalServer(projectDir, { fetchImpl: async () => response(identity), execFile: () => { calls++; } }), /不属于当前项目/);
  }
  assert.equal(calls, 0);
});
test('Windows 重启按唯一监听 PID、入口和目录二次校验，参数不插进命令字符串', async () => {
  let calls = 0;
  const pid = await restartOwnedLocalServer(projectDir, {
    os: 'win32',
    fetchImpl: async url => { if (url.endsWith('/status') && url.includes('desktop-launcher')) return response({ projectDir }); throw new Error('stopped'); },
    execFile: (binary, args, options) => {
      calls++;
      assert.equal(binary, 'powershell.exe');
      assert.equal(options.env.NAI_RESTART_PROJECT_DIR, projectDir);
      const script = args.at(-1);
      assert.ok(!script.includes(projectDir));
      assert.match(script, /taskListeners.Count -ne 1/);
      assert.match(script, /taskProcess.CommandLine -notmatch/);
      assert.match(script, /taskIdentity.projectDir/);
      assert.match(script, /taskCurrentListeners\[0\] -ne \$taskServerPid/);
      assert.match(script, /taskkill.exe \/PID \$taskServerPid \/T \/F/);
      return '1234\n';
    },
  });
  assert.equal(calls, 1); assert.equal(pid, 1234);
});
test('原服务端口不释放时阻止继续启动', async () => {
  await assert.rejects(restartOwnedLocalServer(projectDir, { os: 'win32', waitMs: 0, fetchImpl: async () => response({ projectDir }), execFile: () => '1234' }), /端口尚未释放/);
});
test('Unix 不会停止入口不符的进程', async () => {
  const calls = [];
  await assert.rejects(restartOwnedLocalServer(projectDir, { os: 'linux', fetchImpl: async () => response({ projectDir }), execFile: (binary, args) => { calls.push([binary, args]); return binary === 'lsof' ? '1234' : 'another-application'; } }), /不是工坊启动入口/);
  assert.ok(!calls.some(([binary]) => binary === 'kill'));
});

test('真实启动入口检查 HTTP 后自然退出，旧版／代码变更／复用／重启失败均不崩溃或继续启动', async t => {
  const script = fileURLToPath(new URL('./local-server.mjs', import.meta.url));
  for (const scenario of [
    { name: '旧后端', config: { backendVersion: 'old' }, code: 2, message: /已有服务仍运行 old/ },
    { name: '同版本但代码未加载', config: { backendVersion: 'synthetic', restartRequired: true }, code: 2, message: /已有服务仍运行 synthetic/ },
    { name: '同版本复用', config: { backendVersion: 'synthetic', restartRequired: false }, code: 0, message: /已经在运行/ },
    { name: '重启身份不匹配', config: { backendVersion: 'old' }, restart: true, code: 1, message: /重启未完成：.*不属于当前项目/ },
  ]) await t.test(scenario.name, async () => {
    const root = await mkdtemp(join(tmpdir(), 'nai-launcher-exit-'));
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url === '/api/lan/status' ? { authorized: true }
        : req.url === '/api/prompt-agent/config' ? scenario.config : { projectDir: resolve(root, 'another-project') }));
    });
    try {
      await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
      const port = server.address().port;
      const preload = join(root, 'local-fetch.mjs');
      // 保留真实 fetch／TCP 关闭，只把 3000 映射到合成服务，不读取真实用户配置。
      await writeFile(preload, `const nativeFetch = globalThis.fetch; globalThis.fetch = (url, options) => nativeFetch(String(url).replace('127.0.0.1:3000', '127.0.0.1:${port}'), options);\n`);
      await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'synthetic' }));
      const result = await new Promise((resolveChild, reject) => {
        const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, script, ...(scenario.restart ? ['--restart'] : [])], { cwd: root, env: { ...process.env, NAI_NO_BROWSER: '1', NAI_NO_DESKTOP_SHORTCUT: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const timeout = setTimeout(() => { child.kill(); reject(new Error('启动检查没有自然结束')); }, 10_000);
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('close', (code, signal) => { clearTimeout(timeout); resolveChild({ code, signal, output }); });
      });
      assert.equal(result.code, scenario.code, result.output);
      assert.equal(result.signal, null);
      assert.match(result.output, scenario.message);
      assert.doesNotMatch(result.output, /Assertion failed|UV_HANDLE_CLOSING|正在构建|启动本地服务/);
      assert.deepEqual(requests, ['/api/lan/status', '/api/prompt-agent/config', ...(scenario.restart ? ['/api/local-maintenance/desktop-launcher/status'] : [])]);
      assert.deepEqual((await readdir(root)).sort(), ['local-fetch.mjs', 'package.json']);
    } finally {
      await new Promise(resolveClosed => { server.close(resolveClosed); server.closeAllConnections(); });
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'nai-launcher-exit-'));
      await rm(root, { recursive: true, force: true });
    }
  });
});
