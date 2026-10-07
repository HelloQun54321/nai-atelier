import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { isOfficialRemote, verifyUpdateTarget, updateLocal } from '../../scripts/update-local.mjs';

test('源码更新拒绝降级、跨主要版本、迁移与存储定位变化，不接受自定义远端', () => {
  assert.equal(isOfficialRemote('https://github.com/HelloQun54321/nai-atelier.git'), true);
  assert.equal(isOfficialRemote('https://evil.test/nai-atelier.git'), false);
  for (const args of [['1.2.0', '1.1.0', []], ['1.2.0', '2.0.0', []], ['1.2.0', '1.3.0', ['schema.sql']], ['1.2.0', '1.3.0', ['migration_foo.sql']], ['1.2.0', '1.3.0', ['wrangler.toml']], ['1.2.0', '1.3.0', ['local-data/asset']]]) assert.throws(() => verifyUpdateTarget(...args));
  verifyUpdateTarget('1.2.0', '1.3.0', ['components/App.tsx']);
  for (const file of ['local-data', 'local-cache', 'public/tag-data']) assert.throws(() => verifyUpdateTarget('1.2.0', '1.3.0', [file]));
});

test('真实合成 Git 更新到发行提交，重装锁定依赖并构建，不修改合成数据／缓存／词库', async () => {
  const root = createWorkspace('source-update-');
  const repo = join(root, 'repo'), remote = join(root, 'remote.git'), calls = [];
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    await mkdir(repo);
    git(['init', '-b', 'main']); git(['config', 'user.name', 'Synthetic']); git(['config', 'user.email', 'test@example.invalid']);
    await writeFile(join(repo, '.gitignore'), 'local-data/\nlocal-cache/\npublic/tag-data/\n');
    await writeFile(join(repo, 'package.json'), '{"version":"1.0.0"}'); git(['add', '.']); git(['commit', '-m', 'initial']);
    const old = git(['rev-parse', 'HEAD']);
    await writeFile(join(repo, 'package.json'), '{"version":"1.1.0"}'); git(['add', '.']); git(['commit', '-m', 'release']); git(['tag', 'v1.1.0']);
    execFileSync('git', ['clone', '--bare', repo, remote], { windowsHide: true, stdio: 'ignore' });
    // 只回到本次合成仓库的旧提交，真实工作区不执行重置。
    git(['checkout', '-B', 'main', old]);
    for (const path of ['local-data', 'local-cache', 'public/tag-data']) {
      await mkdir(join(repo, path), { recursive: true }); await writeFile(join(repo, path, 'synthetic.txt'), '保留');
    }
    const wrappedGit = args => args[0] === 'remote' ? 'https://github.com/HelloQun54321/nai-atelier.git' : git(args[0] === 'fetch' ? ['fetch', '--no-tags', remote, args[3]] : args);
    await updateLocal({ root: repo, git: wrappedGit, published: async () => ({ tag_name: 'v1.1.0' }), portBusy: async () => false, reserve: async () => ({ close: async () => calls.push('close') }), run: async (_command, args) => calls.push(args), log: () => {}, start: false });
    assert.equal(JSON.parse(await readFile(join(repo, 'package.json'))).version, '1.1.0');
    assert.ok(calls.some(args => Array.isArray(args) && args.includes('ci')));
    assert.ok(calls.some(args => Array.isArray(args) && args.includes('build:local')));
    assert.equal(calls.at(-1), 'close');
    for (const path of ['local-data', 'local-cache', 'public/tag-data']) assert.equal(await readFile(join(repo, path, 'synthetic.txt'), 'utf8'), '保留');
    await writeFile(join(repo, 'untracked.txt'), 'custom');
    await assert.rejects(updateLocal({ root: repo, git: wrappedGit, published: async () => { throw new Error('不应联网'); } }), /本地修改/);
  } finally { removeWorkspace(root); }
});
