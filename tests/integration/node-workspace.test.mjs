import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace, projectRoot, removeWorkspace, temporaryRoot } from '../support/workspace.mjs';

test('真实 Node 子进程的默认数据路径与 tmpdir 均隔离，重复运行没有旧数据且自动清理', () => {
  const script = `import { readFileSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
    const path = join(process.cwd(), 'local-data', 'novelai-webapp-sync.json');
    const snapshot = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ syntheticMutation: true }));
    console.log(JSON.stringify({ cwd: process.cwd(), temp: tmpdir(), fresh: snapshot.syncedAt === 1 && snapshot.health.ok, version: JSON.parse(readFileSync('package.json', 'utf8')).version }));`;
  const roots = [];
  const env = { ...process.env };
  delete env.NAI_TEST_RUN_DIR;
  for (let index = 0; index < 2; index++) {
    const child = spawnSync(process.execPath, ['--import', pathToFileURL(join(projectRoot, 'tests/support/node-environment.mjs')).href, '--input-type=module', '-e', script], { cwd: projectRoot, env, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.ok(result.cwd.startsWith(temporaryRoot + sep)); assert.notEqual(result.cwd, projectRoot);
    assert.equal(result.temp, join(result.cwd, 'scratch')); assert.equal(result.fresh, true);
    assert.equal(existsSync(result.cwd), false); roots.push(result.cwd);
  }
  assert.notEqual(roots[0], roots[1]);
});

test('统一入口拥有临时根目录，子进程退出后交给入口清理而不抢先删除', () => {
  const owner = createWorkspace('owner-');
  let workspace;
  try {
    const child = spawnSync(process.execPath, ['--import', pathToFileURL(join(projectRoot, 'tests/support/node-environment.mjs')).href, '--input-type=module', '-e', 'console.log(process.cwd());'], {
      cwd: projectRoot, env: { ...process.env, NAI_TEST_RUN_DIR: owner }, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    });
    assert.equal(child.status, 0, child.stderr);
    workspace = child.stdout.trim();
    assert.ok(workspace.startsWith(owner + sep));
    assert.equal(existsSync(join(workspace, 'local-data/novelai-webapp-sync.json')), true);
  } finally { removeWorkspace(owner); }
  assert.equal(existsSync(workspace), false);
});
