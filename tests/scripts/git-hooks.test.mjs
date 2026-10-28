import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkStaged } from '../../scripts/check-staged.mjs';
import { installGitHooks } from '../../scripts/install-git-hooks.mjs';
import { createWorkspace, removeWorkspace, temporaryRoot } from '../support/workspace.mjs';

for (const [staged, working, failure] of [['lint-error', 'valid', 'ESLint'], ['type-error', 'valid', 'TypeScript'], ['valid', 'lint-error', null]]) {
  test(`门禁只检查暂存快照：暂存 ${staged}、工作区 ${working}`, () => {
    const root = createWorkspace('staged-check-');
    const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    try {
      git('init', '-q');
      writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
      writeFileSync(join(root, 'example.js'), staged);
      git('add', '.');
      writeFileSync(join(root, 'example.js'), working);
      writeFileSync(join(root, 'untracked.js'), 'lint-error');
      for (const [file, marker] of [['eslint/bin/eslint.js', 'lint-error'], ['typescript/bin/tsc', 'type-error']]) {
        const path = join(root, 'node_modules', file); mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, `const fs=require('node:fs');if(fs.readFileSync('example.js','utf8').includes('${marker}')||fs.existsSync('untracked.js'))process.exitCode=1;`);
      }
      const index = Buffer.from(git('diff', '--cached'));
      const snapshots = readdirSync(temporaryRoot).filter(name => name.startsWith('commit-')).sort();
      if (failure) assert.throws(() => checkStaged(root), new RegExp(failure));
      else assert.doesNotThrow(() => checkStaged(root));
      assert.equal(readFileSync(join(root, 'example.js'), 'utf8'), working);
      assert.deepEqual(git('diff', '--cached'), index);
      assert.ok(existsSync(join(root, 'node_modules/eslint/bin/eslint.js')));
      assert.ok(existsSync(join(root, 'node_modules/typescript/bin/tsc')));
      assert.deepEqual(readdirSync(temporaryRoot).filter(name => name.startsWith('commit-')).sort(), snapshots);
    } finally { removeWorkspace(root); }
  });
}

test('暂存快照不复制被误跟踪的私人数据或缓存', () => {
  for (const [directory, message] of [['local-data', '密钥扫描失败'], ['local-cache', '私人数据或缓存']]) {
    const root = createWorkspace('snapshot-boundary-');
    try {
      execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true, stdio: 'pipe' });
      mkdirSync(join(root, directory));
      writeFileSync(join(root, directory, 'synthetic.txt'), 'synthetic data');
      execFileSync('git', ['add', '.'], { cwd: root, windowsHide: true, stdio: 'pipe' });
      assert.throws(() => checkStaged(root), new RegExp(message));
      assert.equal(readFileSync(join(root, directory, 'synthetic.txt'), 'utf8'), 'synthetic data');
    } finally { removeWorkspace(root); }
  }
});

test('Git hook 安装支持普通仓库、worktree 文件及自定义 hooksPath，按调用仓库确定根目录', () => {
  const root = createWorkspace('hook-install-');
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
  try {
    git('init', '-q');
    writeFileSync(join(root, 'example.txt'), 'synthetic repository'); git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
    const first = installGitHooks(root);
    assert.equal(first.replaceAll('\\', '/'), join(root, '.git/hooks/pre-commit').replaceAll('\\', '/'));
    const worktree = join(root, 'checkout'); git('worktree', 'add', '--detach', worktree);
    assert.ok(readFileSync(join(worktree, '.git'), 'utf8').startsWith('gitdir:'));
    assert.equal(installGitHooks(worktree), first);
    const custom = join(root, 'custom-hooks'); git('config', 'core.hooksPath', custom);
    const hook = installGitHooks(worktree);
    assert.equal(hook.replaceAll('\\', '/'), join(custom, 'pre-commit').replaceAll('\\', '/'));
    const script = readFileSync(hook, 'utf8');
    assert.ok(script.includes('git rev-parse --show-toplevel'));
    assert.ok(script.includes('node scripts/check-staged.mjs'));
    assert.ok(!script.includes('dirname'));
    mkdirSync(join(worktree, 'scripts'));
    writeFileSync(join(worktree, 'scripts/check-staged.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('hook-root.txt',process.cwd());");
    execFileSync('git', ['hook', 'run', 'pre-commit'], { cwd: join(worktree, 'scripts'), windowsHide: true, stdio: 'pipe' });
    assert.equal(readFileSync(join(worktree, 'hook-root.txt'), 'utf8').replaceAll('\\', '/'), worktree.replaceAll('\\', '/'));
    git('config', 'core.hooksPath', 'relative-hooks');
    assert.equal(installGitHooks(worktree).replaceAll('\\', '/'), join(worktree, 'relative-hooks/pre-commit').replaceAll('\\', '/'));
    // ZIP 位于仓库内时也不能误安装到父仓库。
    const noGit = createWorkspace('zip-hook-');
    try {
      assert.equal(installGitHooks(noGit), undefined);
      writeFileSync(join(noGit, '.git'), 'invalid metadata');
      assert.throws(() => installGitHooks(noGit));
    }
    finally { removeWorkspace(noGit); }
  } finally { removeWorkspace(root); }
});
