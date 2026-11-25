import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { isOfficialRemote, verifyUpdateTarget, updateLocal } from '../../scripts/update-local.mjs';

test('源码更新验证官方远端（含大小写与后缀），允许 schema.sql 与同版本提交，拒绝降级、跨主版本、迁移与受保护路径', () => {
  assert.equal(isOfficialRemote('https://github.com/HelloQun54321/nai-atelier.git'), true);
  assert.equal(isOfficialRemote('https://github.com/helloqun54321/NAI-Atelier'), true);
  assert.equal(isOfficialRemote('git@github.com:HelloQun54321/nai-atelier.git'), true);
  assert.equal(isOfficialRemote('git@github.com:HelloQun54321/nai-atelier'), true);
  assert.equal(isOfficialRemote('https://evil.test/nai-atelier.git'), false);

  for (const args of [
    ['1.2.0', '1.1.0', []],
    ['1.2.0', '2.0.0', []],
    ['1.2.0', '1.3.0', ['migration_foo.sql']],
    ['1.2.0', '1.3.0', ['wrangler.toml']],
    ['1.2.0', '1.3.0', ['local-data/asset']],
  ]) {
    assert.throws(() => verifyUpdateTarget(...args));
  }
  for (const file of ['local-data', 'local-cache', 'public/tag-data']) {
    assert.throws(() => verifyUpdateTarget('1.2.0', '1.3.0', [file]));
  }
  verifyUpdateTarget('1.2.0', '1.3.0', ['components/App.tsx', 'schema.sql']);
  verifyUpdateTarget('1.2.0', '1.2.0', ['scripts/update-local.mjs']);
});

test('真实合成 Git 从官方 main 分支更新：保留数据、按依赖变化决定 npm ci、支持领先/最新/分叉与脏工作区拦截', async () => {
  const root = createWorkspace('source-update-');
  const upstream = join(root, 'upstream');
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');

  const gitIn = dir => args => execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  try {
    await mkdir(upstream);
    const gitUp = gitIn(upstream);
    gitUp(['init', '-b', 'main']);
    gitUp(['config', 'user.name', 'Synthetic']);
    gitUp(['config', 'user.email', 'test@example.invalid']);
    await writeFile(join(upstream, '.gitignore'), 'local-data/\nlocal-cache/\npublic/tag-data/\nnode_modules/\n');
    await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '1.0.0', dependencies: { a: '1.0.0' } }, null, 2));
    await writeFile(join(upstream, 'package-lock.json'), JSON.stringify({ name: 'nai-atelier', version: '1.0.0', lockfileVersion: 3, packages: { '': { version: '1.0.0', dependencies: { a: '1.0.0' } } } }, null, 2));
    await writeFile(join(upstream, 'schema.sql'), 'CREATE TABLE t1(id TEXT);\n');
    gitUp(['add', '.']);
    gitUp(['commit', '-m', 'initial']);
    const initialCommit = gitUp(['rev-parse', 'HEAD']);

    // 1. 远端推进到 1.1.0（含 schema.sql 与依赖变化）
    await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '1.1.0', dependencies: { a: '1.1.0' } }, null, 2));
    await writeFile(join(upstream, 'package-lock.json'), JSON.stringify({ name: 'nai-atelier', version: '1.1.0', lockfileVersion: 3, packages: { '': { version: '1.1.0', dependencies: { a: '1.1.0' } } } }, null, 2));
    await writeFile(join(upstream, 'schema.sql'), 'CREATE TABLE t1(id TEXT);\nCREATE TABLE t2(id TEXT);\n');
    gitUp(['add', '.']);
    gitUp(['commit', '-m', 'feat: bump to 1.1.0 with schema and dep change']);

    execFileSync('git', ['clone', '--bare', upstream, remote], { windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['clone', remote, repo], { windowsHide: true, stdio: 'ignore' });
    const gitRepo = gitIn(repo);
    gitRepo(['config', 'user.name', 'Synthetic']);
    gitRepo(['config', 'user.email', 'test@example.invalid']);
    gitRepo(['checkout', '-B', 'main', initialCommit]);

    for (const path of ['local-data', 'local-cache', 'public/tag-data']) {
      await mkdir(join(repo, path), { recursive: true });
      await writeFile(join(repo, path, 'synthetic.txt'), '保留');
    }

    const wrappedGit = args => args[0] === 'remote' && args[1] === 'get-url'
      ? 'https://github.com/HelloQun54321/nai-atelier.git'
      : gitRepo(args);

    const calls1 = [];
    const target1 = await updateLocal({
      root: repo,
      git: wrappedGit,
      portBusy: async () => false,
      reserve: async () => ({ close: async () => calls1.push('close') }),
      run: async (_command, args) => calls1.push(args),
      log: () => {},
      start: false,
    });
    assert.equal(target1, '1.1.0');
    assert.equal(JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version, '1.1.0');
    assert.ok(calls1.some(args => Array.isArray(args) && args.includes('ci')));
    assert.ok(calls1.some(args => Array.isArray(args) && args.includes('build:local')));
    assert.equal(calls1.at(-1), 'close');
    for (const path of ['local-data', 'local-cache', 'public/tag-data']) {
      assert.equal(await readFile(join(repo, path, 'synthetic.txt'), 'utf8'), '保留');
    }

    // 2. 已在最新提交时再次调用：输出「已是最新」并跳过占位
    const logsLatest = [];
    assert.equal(await updateLocal({
      root: repo,
      git: wrappedGit,
      reserve: async () => { throw new Error('不应占位'); },
      log: message => logsLatest.push(message),
      start: false,
    }), null);
    assert.match(logsLatest.at(-1), /已是最新/);

    // 3. 仅版本递增且 node_modules 已存在：跳过 npm ci，仅 build:local
    await mkdir(join(repo, 'node_modules'), { recursive: true });
    await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '1.1.1', dependencies: { a: '1.1.0' } }, null, 2));
    await writeFile(join(upstream, 'package-lock.json'), JSON.stringify({ name: 'nai-atelier', version: '1.1.1', lockfileVersion: 3, packages: { '': { version: '1.1.1', dependencies: { a: '1.1.0' } } } }, null, 2));
    gitUp(['add', '.']);
    gitUp(['commit', '-m', 'chore: version bump only']);
    gitUp(['push', remote, 'main']);

    const calls2 = [];
    const logsNoCi = [];
    const target2 = await updateLocal({
      root: repo,
      git: wrappedGit,
      portBusy: async () => false,
      reserve: async () => ({ close: async () => calls2.push('close') }),
      run: async (_command, args) => calls2.push(args),
      log: message => logsNoCi.push(message),
      start: false,
    });
    assert.equal(target2, '1.1.1');
    assert.equal(calls2.some(args => Array.isArray(args) && args.includes('ci')), false);
    assert.ok(calls2.some(args => Array.isArray(args) && args.includes('build:local')));
    assert.ok(logsNoCi.some(message => /跳过重装依赖/.test(message)));

    // 4. package-lock.json 实际依赖变化且 node_modules 已存在：必须执行 npm ci
    await writeFile(join(upstream, 'package-lock.json'), JSON.stringify({ name: 'nai-atelier', version: '1.1.2', lockfileVersion: 3, packages: { '': { version: '1.1.2', dependencies: { a: '1.1.0' } }, 'node_modules/a': { version: '1.1.1' } } }, null, 2));
    await writeFile(join(upstream, 'package.json'), JSON.stringify({ version: '1.1.2', dependencies: { a: '1.1.0' } }, null, 2));
    gitUp(['add', '.']);
    gitUp(['commit', '-m', 'chore: lockfile dep change']);
    gitUp(['push', remote, 'main']);

    const calls3 = [];
    const target3 = await updateLocal({
      root: repo,
      git: wrappedGit,
      portBusy: async () => false,
      reserve: async () => ({ close: async () => calls3.push('close') }),
      run: async (_command, args) => calls3.push(args),
      log: () => {},
      start: false,
    });
    assert.equal(target3, '1.1.2');
    assert.ok(calls3.some(args => Array.isArray(args) && args.includes('ci')));
    assert.ok(calls3.some(args => Array.isArray(args) && args.includes('build:local')));

    // 5. 本地领先于 origin/main：返回 null 并提示领先
    await writeFile(join(repo, 'local-ahead.txt'), 'ahead');
    gitRepo(['add', 'local-ahead.txt']);
    gitRepo(['commit', '-m', 'local ahead commit']);
    const logsAhead = [];
    assert.equal(await updateLocal({
      root: repo,
      git: wrappedGit,
      reserve: async () => { throw new Error('不应占位'); },
      log: message => logsAhead.push(message),
      start: false,
    }), null);
    assert.match(logsAhead.at(-1), /领先/);

    // 6. 本地与 origin/main 分叉：报错并阻止更新
    await writeFile(join(upstream, 'remote-diverge.txt'), 'diverge');
    gitUp(['add', 'remote-diverge.txt']);
    gitUp(['commit', '-m', 'remote diverge commit']);
    gitUp(['push', remote, 'main']);
    await assert.rejects(updateLocal({ root: repo, git: wrappedGit, start: false }), /分叉/);

    // 7. 工作区存在未跟踪文件：在拉取前报错
    await writeFile(join(repo, 'untracked.txt'), 'custom');
    await assert.rejects(updateLocal({ root: repo, git: wrappedGit, start: false }), /本地修改/);
  } finally {
    removeWorkspace(root);
  }
});
