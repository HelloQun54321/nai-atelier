import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';
import { mkdtemp, writeFile, readdir, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { inspectExistingLocalServer, restartOwnedLocalServer, reserveLocalLauncher, prepareLocalServerLaunch, isLocalPortBusy } from '../../scripts/local-server-runtime.mjs';

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
    portBusy: async () => false,
    fetchImpl: async url => { if (url.endsWith('/status') && url.includes('desktop-launcher')) return response({ projectDir }); throw new Error('stopped'); },
    execFile: (binary, args, options) => {
      calls++;
      assert.equal(binary, 'powershell.exe');
      assert.equal(options.env.NAI_RESTART_PROJECT_DIR, projectDir);
      assert.equal(options.env.NAI_RESTART_PORT, '3000');
      assert.equal(options.env.NAI_RESTART_STATUS_URL, 'http://127.0.0.1:3000/api/local-maintenance/desktop-launcher/status');
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

test('真实启动入口在启动中或身份不符时自然退出，不崩溃或创建第二份服务', async t => {
  const script = fileURLToPath(new URL('../../scripts/local-server.mjs', import.meta.url));
  for (const scenario of [
    { name: '启动中', phase: 'starting', code: 0, message: /已在启动中/ },
    { name: '启动中且兼容旧参数', phase: 'starting', restart: true, code: 0, message: /已在启动中/ },
    { name: '其他项目', phase: 'running', differentProject: true, code: 1, message: /启动检查端口被其他程序/ },
    { name: '无关监听器', unrelated: true, code: 1, message: /启动检查端口被其他程序/ },
  ]) await t.test(scenario.name, async () => {
    const root = await mkdtemp(join(tmpdir(), 'nai-launcher-exit-'));
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(scenario.unrelated ? { unrelated: true } : { app: 'nai-atelier-local-launcher', projectDir: scenario.differentProject ? resolve(root, 'another-project') : root, pid: process.pid, phase: scenario.phase }));
    });
    try {
      await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
      const port = server.address().port;
      // 使用独立端口的真实启动检查，不接触真实服务或用户数据。
      const runtimePath = join(root, 'local-server-runtime.mjs');
      const runtime = await readFile(new URL('../../scripts/local-server-runtime.mjs', import.meta.url), 'utf8');
      await writeFile(runtimePath, runtime.replace('LOCAL_LAUNCHER_PORT = 3003', `LOCAL_LAUNCHER_PORT = ${port}`));
      const entry = join(root, 'local-server.mjs');
      const source = await readFile(script, 'utf8');
      await writeFile(entry, source.replace(/from '(\.\/[^']+)'/g, (_match, relative) => `from '${relative === './local-server-runtime.mjs' ? pathToFileURL(runtimePath).href : new URL(relative, pathToFileURL(script)).href}'`));
      await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'synthetic' }));
      const result = await new Promise((resolveChild, reject) => {
        const child = spawn(process.execPath, [entry, ...(scenario.restart ? ['--restart'] : [])], { cwd: root, env: { ...process.env, NAI_NO_BROWSER: '1', NAI_NO_DESKTOP_SHORTCUT: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
      assert.deepEqual(requests, ['/__atelier/launcher']);
      assert.deepEqual((await readdir(root)).sort(), ['local-server-runtime.mjs', 'local-server.mjs', 'package.json']);
    } finally {
      await new Promise(resolveClosed => { server.close(resolveClosed); server.closeAllConnections(); });
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'nai-launcher-exit-'));
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('启动占位覆盖启动期与运行期，原子拒绝重复监听，退出后自动可重用', async () => {
  const guard = await reserveLocalLauncher(projectDir, 0);
  try {
    assert.equal(await isLocalPortBusy(guard.port), true);
    let identity = await (await fetch(`http://127.0.0.1:${guard.port}/__atelier/launcher`)).json();
    assert.equal(identity.phase, 'starting'); assert.equal(identity.pid, process.pid); assert.equal(identity.projectDir, projectDir);
    await assert.rejects(reserveLocalLauncher(projectDir, guard.port), { code: 'EADDRINUSE' });
    guard.markRunning();
    identity = await (await fetch(`http://127.0.0.1:${guard.port}/__atelier/launcher`)).json(); assert.equal(identity.phase, 'running');
    assert.equal((await fetch(`http://127.0.0.1:${guard.port}/__atelier/launcher`, { method: 'POST' })).status, 404);
  } finally { await guard.close(); }
  assert.equal(await isLocalPortBusy(guard.port), false);
  const next = await reserveLocalLauncher(projectDir, guard.port); await next.close();
});

const ownedIdentity = { app: 'nai-atelier-local-launcher', projectDir, pid: 1234, phase: 'running' };
const occupied = () => { throw Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }); };
test('启动中合并点击，其他目录／未知身份／无法响应的监听器均不停止任何进程', async () => {
  let stops = 0;
  const options = { reserve: occupied, restart: async () => { stops++; }, log: () => {} };
  assert.equal(await prepareLocalServerLaunch(projectDir, { ...options, fetchImpl: async () => response({ ...ownedIdentity, phase: 'starting' }) }), null);
  for (const identity of [{}, { ...ownedIdentity, projectDir: resolve('other') }, { ...ownedIdentity, pid: 0 }, { ...ownedIdentity, phase: 'unknown' }]) {
    await assert.rejects(prepareLocalServerLaunch(projectDir, { ...options, fetchImpl: async () => response(identity) }));
  }
  await assert.rejects(prepareLocalServerLaunch(projectDir, { ...options, fetchImpl: async () => { throw new Error('timeout'); } }));
  assert.equal(stops, 0);
});
test('已运行默认定向重启，两个启动器竞逐时仅获得占位者继续', async () => {
  for (const race of [false, true]) {
    let reserves = 0, stops = 0;
    const guard = { close: async () => {} };
    const result = await prepareLocalServerLaunch(projectDir, {
      reserve: () => { reserves++; if (reserves === 1 || race) return occupied(); return guard; },
      fetchImpl: async () => response(ownedIdentity), portBusy: async () => false, log: () => {},
      restart: async (project, options) => { stops++; assert.equal(project, projectDir); assert.equal(options.expectedPid, 1234); assert.equal(options.port, 3003); assert.equal(options.identityPath, '/__atelier/launcher'); return 1234; },
    });
    assert.equal(result, race ? null : guard); assert.equal(stops, 1); assert.equal(reserves, 2);
  }
});
test('无启动占位的旧服务同样自动重启，失败或端口仍占用时释放新占位', async () => {
  for (const mode of ['legacy', 'failed', 'busy']) {
    let closed = 0, stops = 0, probes = 0;
    const guard = { close: async () => { closed++; } };
    const promise = prepareLocalServerLaunch(projectDir, {
      reserve: async () => guard, portBusy: async port => { assert.equal(port, 3000); return ++probes === 1 || mode === 'busy'; }, log: () => {},
      restart: async (project, options) => { stops++; assert.equal(project, projectDir); assert.equal(options.expectedPid, undefined); if (mode === 'failed') throw new Error('unrelated'); return 1234; },
    });
    if (mode === 'legacy') { assert.equal(await promise, guard); assert.equal(closed, 0); }
    else { await assert.rejects(promise); assert.equal(closed, 1); }
    assert.equal(stops, 1);
  }
});
test('重启重新验证占位的 PID 和运行阶段，身份变化或未释放端口不会继续', async () => {
  let stops = 0;
  const options = { os: 'win32', expectedPid: 1234, port: 3003, identityPath: '/__atelier/launcher', execFile: (_binary, _args, opts) => { stops++; assert.equal(opts.env.NAI_RESTART_EXPECTED_PID, '1234'); assert.equal(opts.env.NAI_RESTART_PORT, '3003'); return '1234'; }, portBusy: async () => false };
  for (const identity of [{ ...ownedIdentity, pid: 2345 }, { ...ownedIdentity, app: 'other' }, { ...ownedIdentity, phase: 'starting' }]) {
    await assert.rejects(restartOwnedLocalServer(projectDir, { ...options, fetchImpl: async () => response(identity) }), /身份已变化/);
  }
  assert.equal(stops, 0);
  assert.equal(await restartOwnedLocalServer(projectDir, { ...options, fetchImpl: async () => response(ownedIdentity) }), 1234);
  await assert.rejects(restartOwnedLocalServer(projectDir, { ...options, waitMs: 1, fetchImpl: async () => response(ownedIdentity), portBusy: async () => true }), /端口尚未释放/);
});

test('Windows 真实定向重启停止整棵服务树，释放占位且保留无关监听器', { skip: platform() !== 'win32', timeout: 25_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nai-launcher-tree-'));
  const entry = join(root, 'scripts', 'local-server.mjs');
  const moduleUrl = new URL('../../scripts/local-server-runtime.mjs', import.meta.url).href;
  const unrelated = createServer((_req, res) => res.end('unrelated'));
  let child;
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(entry, `import { reserveLocalLauncher } from ${JSON.stringify(moduleUrl)};
import { spawn } from 'node:child_process';
const guard = await reserveLocalLauncher(process.cwd(), 0); guard.markRunning();
const worker = spawn(process.execPath, ['--input-type=module', '-e', "import {createServer} from 'node:http'; const server=createServer((req,res)=>res.end('fixture')); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"], {stdio:['ignore','pipe','ignore'], windowsHide:true});
worker.stdout.once('data', data => console.log(JSON.stringify({port:guard.port, workerPort:Number(String(data).trim()), workerPid:worker.pid})));
`);
    await new Promise(ready => unrelated.listen(0, '127.0.0.1', ready));
    child = spawn(process.execPath, [entry], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const identity = await new Promise((ready, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('合成服务没有就绪')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timer); ready(JSON.parse(output.trim())); } });
    });
    assert.equal(await isLocalPortBusy(identity.workerPort), true);
    const stopped = await restartOwnedLocalServer(root, { port: identity.port, identityPath: '/__atelier/launcher', expectedPid: child.pid });
    assert.equal(stopped, child.pid);
    assert.equal(await isLocalPortBusy(identity.port), false);
    assert.equal(await isLocalPortBusy(identity.workerPort), false);
    assert.throws(() => process.kill(identity.workerPid, 0));
    assert.equal(await (await fetch(`http://127.0.0.1:${unrelated.address().port}`)).text(), 'unrelated');
    const replacement = await reserveLocalLauncher(root, identity.port); await replacement.close();
  } finally {
    if (child && child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* 合成服务已退出 */ } }
    await new Promise(done => { unrelated.close(done); unrelated.closeAllConnections(); });
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'nai-launcher-tree-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('真实构建期间可快速合并第二次启动，构建失败释放占位且不启动 Worker', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nai-launcher-build-'));
  const script = new URL('../../scripts/local-server.mjs', import.meta.url);
  const temporaryListener = createServer();
  let first;
  try {
    await new Promise(ready => temporaryListener.listen(0, '127.0.0.1', ready));
    const port = temporaryListener.address().port;
    await new Promise(done => temporaryListener.close(done));
    await new Promise(ready => temporaryListener.listen(0, '127.0.0.1', ready));
    const gatewayPort = temporaryListener.address().port;
    await new Promise(done => temporaryListener.close(done));
    const runtimePath = join(root, 'local-server-runtime.mjs');
    const runtime = await readFile(new URL('../../scripts/local-server-runtime.mjs', import.meta.url), 'utf8');
    // 不连接真实 3000；其他检查与子进程编排使用真实实现。
    await writeFile(runtimePath, runtime.replace('LOCAL_LAUNCHER_PORT = 3003', `LOCAL_LAUNCHER_PORT = ${port}`));
    const entry = join(root, 'local-server.mjs');
    const source = await readFile(script, 'utf8');
    await writeFile(entry, source.replace(/from '(\.\/[^']+)'/g, (_match, relative) => `from '${relative === './local-server-runtime.mjs' ? pathToFileURL(runtimePath).href : new URL(relative, script).href}'`));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'synthetic', scripts: { 'build:local': 'node -e "setTimeout(()=>process.exit(1),3000)"' } }));
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(root, 'node_modules', '.bin', platform() === 'win32' ? 'wrangler.cmd' : 'wrangler'), '');
    const options = { cwd: root, env: { ...process.env, NAI_NO_BROWSER: '1', NAI_NO_DESKTOP_SHORTCUT: '1', NAI_GATEWAY_PORT: String(gatewayPort) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
    first = spawn(process.execPath, [entry], options);
    let firstOutput = '';
    const completion = new Promise((done, reject) => { first.once('error', reject); first.once('close', code => done(code)); });
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(new Error(`合成构建没有开始：${firstOutput}`)), 5000);
      first.stdout.on('data', data => { firstOutput += data; if (firstOutput.includes('正在构建')) { clearTimeout(timer); ready(); } });
      first.stderr.on('data', data => { firstOutput += data; });
    });
    const identity = await (await fetch(`http://127.0.0.1:${port}/__atelier/launcher`)).json(); assert.equal(identity.phase, 'starting');
    const second = spawn(process.execPath, [entry], options);
    let secondOutput = '';
    second.stdout.on('data', data => { secondOutput += data; }); second.stderr.on('data', data => { secondOutput += data; });
    const secondCode = await new Promise((done, reject) => { second.once('error', reject); second.once('close', code => done(code)); });
    assert.equal(secondCode, 0, secondOutput); assert.match(secondOutput, /已在启动中/);
    assert.doesNotMatch(secondOutput, /正在构建|启动本地服务|Assertion failed/);
    assert.equal(await completion, 1); assert.match(firstOutput, /构建失败/); assert.doesNotMatch(firstOutput, /启动本地服务|Assertion failed/);
    assert.equal(await isLocalPortBusy(port), false); assert.ok(!(await readdir(root)).includes('local-data'));
  } finally {
    if (first && first.exitCode === null) first.kill();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'nai-launcher-build-'));
    await rm(root, { recursive: true, force: true });
  }
});
