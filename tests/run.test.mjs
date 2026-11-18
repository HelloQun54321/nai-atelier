import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { discoverGatewayTests, discoverNodeTests, nodeTestArguments, runLoggedCommand, testLogPath } from './run.mjs';
import { createWorkspace, projectRoot, removeWorkspace, temporaryRoot, resolveExternalTestRoot } from './support/workspace.mjs';

test('Node 入口只发现集中目录的模块与跨模块测试，临时目录不参与发现', () => {
  const root = createWorkspace('discovery-');
  try {
    for (const path of ['scripts', 'tests/scripts', 'tests/integration', 'tests/.tmp']) mkdirSync(join(root, path), { recursive: true });
    for (const path of ['scripts/outside.test.mjs', 'tests/scripts/one.test.mjs', 'tests/integration/two.test.mjs', 'tests/.tmp/ignored.test.mjs']) writeFileSync(join(root, path), '');
    assert.deepEqual(discoverNodeTests(root), [join(root, 'tests/integration/two.test.mjs'), join(root, 'tests/scripts/one.test.mjs')]);
  } finally { removeWorkspace(root); }
});

test('默认入口包含此前遗漏的密钥保管箱回归，定向参数与隔离预加载一起保留', () => {
  const files = discoverNodeTests();
  const vault = join(projectRoot, 'tests/integration/nai-key-vault.test.mjs');
  assert.ok(files.includes(vault));
  assert.ok(files.includes(join(projectRoot, 'tests/integration/media-gateway.test.mjs')));
  assert.ok(files.includes(join(projectRoot, 'tests/scripts/local-server-runtime.test.mjs')));
  const args = nodeTestArguments(['--test-name-pattern=保存', 'tests/integration/nai-key-vault.test.mjs'], files);
  assert.ok(args.includes('--import')); assert.ok(args.includes('--test-name-pattern=保存'));
  assert.equal(args.filter(value => value.endsWith('.test.mjs')).length, 1); assert.equal(args.at(-1), vault);
  assert.throws(() => nodeTestArguments(['outside.test.mjs'], files), /不在已发现/);
});

test('后端入口保留网关与本地服务，桌面／Android／门禁测试仍由完整 Node 入口发现', () => {
  const all = discoverNodeTests(), gateway = discoverGatewayTests();
  for (const file of ['tests/integration/media-gateway.test.mjs', 'tests/integration/st-chatu8-bridge.test.mjs', 'tests/scripts/local-server-runtime.test.mjs', 'tests/scripts/pixiv-local.test.mjs']) {
    assert.ok(gateway.includes(join(projectRoot, file)), file);
  }
  for (const file of ['tests/integration/desktop-package.test.mjs', 'tests/integration/android-webview.test.mjs', 'tests/scripts/secret-scan.test.mjs', 'tests/run.test.mjs']) {
    assert.ok(all.includes(join(projectRoot, file)), file);
    assert.ok(!gateway.includes(join(projectRoot, file)), file);
  }
  assert.ok(nodeTestArguments(['tests/integration/desktop-package.test.mjs']).includes(join(projectRoot, 'tests/integration/desktop-package.test.mjs')));
});

test('正式测试集中存放，源码目录不能重新散落测试文件', () => {
  const misplaced = [];
  const isTest = entry => entry.isFile() && /\.test\.(?:ts|tsx|mjs)$/.test(entry.name);
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (isTest(entry)) misplaced.push(path);
    }
  };
  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) if (isTest(entry)) misplaced.push(join(projectRoot, entry.name));
  for (const directory of ['components', 'services', 'worker', 'scripts']) visit(join(projectRoot, directory));
  assert.deepEqual(misplaced, [], '正式测试应放到 tests/ 内对应模块目录');
});

test('测试输出同时进入终端与日志，失败退出码不会被日志转存掩盖', async () => {
  const root = createWorkspace('logging-'), logPath = join(root, 'logs/result.log');
  let output = '';
  const destination = new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } });
  try {
    const code = await runLoggedCommand(['-e', "console.log('synthetic stdout'); console.error('synthetic stderr'); process.exitCode = 7;"], { logPath, cwd: root, output: destination, errors: destination });
    assert.equal(code, 7);
    for (const message of ['synthetic stdout', 'synthetic stderr']) { assert.ok(output.includes(message)); assert.ok(readFileSync(logPath, 'utf8').includes(message)); }
  } finally { removeWorkspace(root); }
});

test('同类测试并行运行保留各自完整日志，后端两阶段不会覆盖前一阶段', async () => {
  const root = createWorkspace('parallel-logs-');
  const destination = new Writable({ write(_chunk, _encoding, done) { done(); } });
  try {
    const paths = await Promise.all([1, 2].map(async marker => {
      const output = [];
      const capture = new Writable({ write(chunk, _encoding, done) { output.push(chunk); done(); } });
      await runLoggedCommand(['--input-type=module', '-e', `import {testLogPath,runLoggedCommand} from ${JSON.stringify(new URL('./run.mjs', import.meta.url).href)}; console.log(testLogPath('unit'));`],
        { logPath: join(root, `${marker}.log`), cwd: root, output: capture, errors: capture });
      return Buffer.concat(output).toString().trim();
    }));
    assert.notEqual(paths[0], paths[1]);
    assert.ok(testLogPath('gateway').includes('gateway-'));
    await Promise.all(paths.map((path, index) => runLoggedCommand(['-e', `console.log('run ${index}');`],
      { logPath: join(root, path.split(/[\\/]/).at(-1)), cwd: root, output: destination, errors: destination })));
    for (const [index, path] of paths.entries()) {
      assert.equal(readFileSync(join(root, path.split(/[\\/]/).at(-1)), 'utf8').trim(), `run ${index}`);
    }
    const combined = join(root, 'combined.log');
    for (const [index, message] of ['Node phase', 'Worker phase'].entries()) await runLoggedCommand(['-e', `console.log('${message}')`],
      { logPath: combined, append: index > 0, cwd: root, output: destination, errors: destination });
    assert.equal(readFileSync(combined, 'utf8'), 'Node phase\nWorker phase\n');
  } finally { removeWorkspace(root); }
});

test('外置测试路径拒绝工程、根目录与相对路径，日志随显式目录走', () => {
  assert.throws(() => resolveExternalTestRoot('/'), /根目录/);
  assert.throws(() => resolveExternalTestRoot(projectRoot), /工程/);
  assert.throws(() => resolveExternalTestRoot('relative-test-output'), /绝对/);
  assert.equal(resolveExternalTestRoot(undefined, 'default-root'), 'default-root');
  if (process.env.NAI_TEST_LOG_ROOT) assert.equal(testLogPath('external').startsWith(process.env.NAI_TEST_LOG_ROOT + '/'), true);
});

test('临时工作区拒绝路径前缀、越界删除与删除父目录', () => {
  assert.throws(() => createWorkspace('../outside-'), /前缀/);
  assert.throws(() => createWorkspace('outside-', projectRoot), /tests\/\.tmp/);
  assert.throws(() => removeWorkspace(join(projectRoot, 'tests'), projectRoot), /tests\/\.tmp/);
  const root = createWorkspace('cleanup-');
  assert.throws(() => removeWorkspace(projectRoot), /父目录以外/);
  assert.throws(() => removeWorkspace(temporaryRoot), /父目录以外/);
  assert.ok(existsSync(root)); removeWorkspace(root); assert.equal(existsSync(root), false);
});
