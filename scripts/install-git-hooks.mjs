#!/usr/bin/env node
// 把质量门禁安装到 .git/hooks/pre-commit（npm install 时经 prepare 脚本自动执行）。
// 手动执行：node scripts/install-git-hooks.mjs
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, '.git'))) {
  console.error('未找到 .git 目录（非 git 仓库），跳过 git hooks 安装');
  process.exit(0);
}

const HOOK = `#!/bin/sh
# 由 scripts/install-git-hooks.mjs 生成：提交前质量门禁，任一失败即阻止提交
cd "$(dirname "$0")/../.." || exit 1

echo "[pre-commit] eslint（0 错误才放行；警告用 npm run lint 查看）..."
npx eslint . --quiet || exit 1

echo "[pre-commit] TypeScript 类型检查..."
npx tsc -b || exit 1

echo "[pre-commit] 单元测试..."
out=$(mktemp) || exit 1
if ! npm run --silent test:gateway >"$out" 2>&1; then
  tail -40 "$out"
  rm -f "$out"
  exit 1
fi
rm -f "$out"

echo "[pre-commit] 全部通过"
`;

const hooksDir = path.join(root, '.git', 'hooks');
mkdirSync(hooksDir, { recursive: true });
const target = path.join(hooksDir, 'pre-commit');
writeFileSync(target, HOOK);
chmodSync(target, 0o755);
console.log('pre-commit hook 已安装到 .git/hooks/pre-commit');
