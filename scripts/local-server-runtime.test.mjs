import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
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
