import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { discoverGatewayTests, nodeTestArguments, runLoggedCommand } from './run.mjs';
import { createWorkspace, projectRoot, removeWorkspace, temporaryRoot } from './support/workspace.mjs';

test('Node 入口只发现集中目录的模块与跨模块测试，临时目录不参与发现', () => {
  const root = createWorkspace('discovery-');
  try {
    for (const path of ['scripts', 'tests/scripts', 'tests/integration', 'tests/.tmp']) mkdirSync(join(root, path), { recursive: true });
    for (const path of ['scripts/outside.test.mjs', 'tests/scripts/one.test.mjs', 'tests/integration/two.test.mjs', 'tests/.tmp/ignored.test.mjs']) writeFileSync(join(root, path), '');
    assert.deepEqual(discoverGatewayTests(root), [join(root, 'tests/integration/two.test.mjs'), join(root, 'tests/scripts/one.test.mjs')]);
  } finally { removeWorkspace(root); }
});

test('默认入口包含此前遗漏的密钥保管箱回归，定向参数与隔离预加载一起保留', () => {
  const files = discoverGatewayTests();
  const vault = join(projectRoot, 'tests/integration/nai-key-vault.test.mjs');
  assert.ok(files.includes(vault));
  assert.ok(files.includes(join(projectRoot, 'tests/integration/media-gateway.test.mjs')));
  assert.ok(files.includes(join(projectRoot, 'tests/scripts/local-server-runtime.test.mjs')));
  const args = nodeTestArguments(['--test-name-pattern=保存', 'tests/integration/nai-key-vault.test.mjs'], files);
  assert.ok(args.includes('--import')); assert.ok(args.includes('--test-name-pattern=保存'));
  assert.equal(args.filter(value => value.endsWith('.test.mjs')).length, 1); assert.equal(args.at(-1), vault);
  assert.throws(() => nodeTestArguments(['outside.test.mjs'], files), /不在已发现/);
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

test('临时工作区拒绝路径前缀、越界删除与删除父目录', () => {
  assert.throws(() => createWorkspace('../outside-'), /前缀/);
  assert.throws(() => createWorkspace('outside-', projectRoot), /tests\/\.tmp/);
  assert.throws(() => removeWorkspace(join(projectRoot, 'tests'), projectRoot), /tests\/\.tmp/);
  const root = createWorkspace('cleanup-');
  assert.throws(() => removeWorkspace(projectRoot), /父目录以外/);
  assert.throws(() => removeWorkspace(temporaryRoot), /父目录以外/);
  assert.ok(existsSync(root)); removeWorkspace(root); assert.equal(existsSync(root), false);
});
