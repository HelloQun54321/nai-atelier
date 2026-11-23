#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, removeWorkspace } from '../tests/support/workspace.mjs';
import { scanRepository } from './secret-scan.mjs';

/** 门禁范围：minimal 只扫密钥，code 加变化文件的 ESLint，full 再加全量类型检查。 */
const SCOPES = ['minimal', 'code', 'full'];
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;
const PACKAGE_META_FILE = /^(?:package\.json|package-lock\.json)$/i;
const STRICT_CONFIG_FILE = /^(?:tsconfig[^/]*\.json|vite\.config\.[^/]+|eslint\.config\.[^/]+|vitest\.config\.[^/]+|wrangler\.toml)$/i;

export const stripPackageVersion = (file, parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const copy = { ...parsed };
  delete copy.version;
  if (file === 'package-lock.json' && copy.packages && typeof copy.packages === 'object' && !Array.isArray(copy.packages) && copy.packages[''] && typeof copy.packages[''] === 'object') {
    const rootPkg = { ...copy.packages[''] };
    delete rootPkg.version;
    copy.packages = { ...copy.packages, '': rootPkg };
  }
  return copy;
};

const isVersionOnlyPackageChange = (root, file) => {
  if (!PACKAGE_META_FILE.test(file)) return false;
  try {
    const headRaw = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, windowsHide: true }).toString();
    const stagedRaw = execFileSync('git', ['show', `:${file}`], { cwd: root, windowsHide: true }).toString();
    return JSON.stringify(stripPackageVersion(file, JSON.parse(headRaw))) === JSON.stringify(stripPackageVersion(file, JSON.parse(stagedRaw)));
  } catch {
    return false;
  }
};

export const hasEngineeringConfigChange = (root, files) =>
  files.some(file => STRICT_CONFIG_FILE.test(file) || (PACKAGE_META_FILE.test(file) && !isVersionOnlyPackageChange(root, file)));

export const resolveCheckScope = (value = process.env.NAI_CHECK_SCOPE) =>
  SCOPES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'full';

export const stagedFiles = (root) => execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root, windowsHide: true })
  .toString().split('\0').filter(Boolean);

const run = (root, snapshot, script, args, label) => {
  console.log(`[pre-commit] ${label}（暂存快照）...`);
  const result = spawnSync(process.execPath, [join(root, 'node_modules', script), ...args], { cwd: snapshot, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} 检查失败：${result.status ?? result.signal}`);
};

export const checkStaged = (root = fileURLToPath(new URL('../', import.meta.url)), scope = resolveCheckScope()) => {
  const files = stagedFiles(root);
  const hasConfig = hasEngineeringConfigChange(root, files);
  // 工程配置改动会改变类型与构建规则，轻量模式一律升级为全量；仅升版本号的 package*.json 不触发升级。
  if (scope === 'code' && hasConfig) { console.log('[pre-commit] 暂存区含工程配置，升级为全量检查'); scope = 'full'; }
  console.log(`[pre-commit] 暂存区密钥扫描（范围：${scope}）...`);
  const findings = scanRepository({ staged: true, cwd: root });
  if (findings.length) throw new Error('密钥扫描失败：\n' + findings.map(item => `${item.file}:${item.line} [${item.rule}]`).join('\n'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, windowsHide: true }).toString().split('\0');
  if (tracked.some(file => /^(?:local-data|local-cache)\//.test(file))) throw new Error('私人数据或缓存被 Git 跟踪，停止创建暂存快照');
  if (scope === 'minimal') { console.log('[pre-commit] 本次只有文档／文案改动，已跳过 ESLint 与 TypeScript'); return; }
  const codeFiles = files.filter(file => CODE_FILE.test(file)).map(file => file.replaceAll('\\', '/'));
  if (scope === 'code' && !codeFiles.length) { console.log('[pre-commit] 没有需要检查的代码文件，已跳过 ESLint 与 TypeScript'); return; }
  const snapshot = createWorkspace('commit-');
  const dependencyLink = join(snapshot, 'node_modules');
  let linked = false;
  try {
    execFileSync('git', ['checkout-index', '--all', `--prefix=${snapshot.replaceAll('\\', '/')}/`], { cwd: root, windowsHide: true });
    // 只复制 Git 暂存文件；依赖链接复用，工作区及私人资料不参与检查。
    symlinkSync(join(root, 'node_modules'), dependencyLink, 'junction');
    linked = true;
    if (scope === 'code') {
      run(root, snapshot, 'eslint/bin/eslint.js', [...codeFiles, '--quiet'], 'ESLint（变化文件）');
      console.log('[pre-commit] 小型改动，已跳过全量 TypeScript 检查');
    } else {
      run(root, snapshot, 'eslint/bin/eslint.js', ['.', '--quiet'], 'ESLint');
      run(root, snapshot, 'typescript/bin/tsc', ['-b'], 'TypeScript');
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
