#!/usr/bin/env node
// 一键版本递增：node scripts/bump-version.mjs <major|minor|patch|set:X.Y.Z>
// 版本号唯一来源是 package.json；本脚本同步更新 package.json、package-lock.json
// 与 README 版本徽章。设置页等运行时展示通过 vite define 注入的 __APP_VERSION__
// 读取，不需要（也不允许）手动同步。规则见 AGENTS.md。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const readmePath = path.join(root, 'README.md');

const SEMVER = /^\d+\.\d+\.\d+$/;
const arg = process.argv[2] ?? 'patch';

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version ?? '';
if (!SEMVER.test(current)) {
  console.error(`package.json 中的版本号 "${current}" 不是标准 x.y.z，请先手工修正`);
  process.exit(1);
}

let next;
if (arg.startsWith('set:')) {
  next = arg.slice(4);
  if (!SEMVER.test(next)) {
    console.error(`set: 目标版本 "${next}" 不是标准 x.y.z`);
    process.exit(1);
  }
} else if (arg === 'major' || arg === 'minor' || arg === 'patch') {
  const [major, minor, patch] = current.split('.').map(Number);
  next =
    arg === 'major'
      ? `${major + 1}.0.0`
      : arg === 'minor'
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
} else {
  console.error('用法: node scripts/bump-version.mjs <major|minor|patch|set:X.Y.Z>');
  process.exit(1);
}

if (next === current) {
  console.error(`目标版本与当前版本相同 (${current})，无需更新`);
  process.exit(1);
}

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

const readme = readFileSync(readmePath, 'utf8');
const badgePattern = /version-\d+\.\d+\.\d+-/;
if (!badgePattern.test(readme)) {
  console.error('README.md 中未找到 version-x.y.z 形式的徽章，请检查版本徽章行');
  process.exit(1);
}
writeFileSync(readmePath, readme.replace(badgePattern, `version-${next}-`));

console.log(`${current} -> ${next} (${arg.startsWith('set:') ? 'set' : arg})`);
