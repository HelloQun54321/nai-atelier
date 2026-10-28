#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, removeWorkspace } from '../tests/support/workspace.mjs';
import { scanRepository } from './secret-scan.mjs';

export const checkStaged = (root = fileURLToPath(new URL('../', import.meta.url))) => {
  console.log('[pre-commit] 暂存区密钥扫描...');
  const findings = scanRepository({ staged: true, cwd: root });
  if (findings.length) throw new Error('密钥扫描失败：\n' + findings.map(item => `${item.file}:${item.line} [${item.rule}]`).join('\n'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, windowsHide: true }).toString().split('\0');
  if (tracked.some(file => /^(?:local-data|local-cache)\//.test(file))) throw new Error('私人数据或缓存被 Git 跟踪，停止创建暂存快照');
  const snapshot = createWorkspace('commit-');
  const dependencyLink = join(snapshot, 'node_modules');
  let linked = false;
  try {
    execFileSync('git', ['checkout-index', '--all', `--prefix=${snapshot.replaceAll('\\', '/')}/`], { cwd: root, windowsHide: true });
    // 只复制 Git 暂存文件；依赖链接复用，工作区及私人资料不参与检查。
    symlinkSync(join(root, 'node_modules'), dependencyLink, 'junction');
    linked = true;
    for (const [name, script, args] of [
      ['ESLint', 'eslint/bin/eslint.js', ['.', '--quiet']],
      ['TypeScript', 'typescript/bin/tsc', ['-b']],
    ]) {
      console.log(`[pre-commit] ${name}（暂存快照）...`);
      const result = spawnSync(process.execPath, [join(root, 'node_modules', script), ...args], { cwd: snapshot, stdio: 'inherit', windowsHide: true });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${name} 检查失败：${result.status ?? result.signal}`);
    }
  } finally {
    if (linked) {
      if (!lstatSync(dependencyLink).isSymbolicLink()) throw new Error('暂存快照依赖链接已变化，停止清理');
      unlinkSync(dependencyLink);
      if (!existsSync(join(root, 'node_modules'))) throw new Error('主项目依赖目录不可用，停止清理');
    }
    removeWorkspace(snapshot);
  }
  console.log('[pre-commit] 全部通过');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkStaged(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
