import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkspace, projectRoot, removeWorkspace } from '../support/workspace.mjs';

// 只复制公开规则，在独立 Git 仓库中验证；排除用户全局忽略设置的影响。
const withRepository = callback => {
  const root = createWorkspace('gitignore-');
  const git = (args, options = {}) => spawnSync('git', ['-c', `core.excludesFile=${join(root, 'unused-global-excludes')}`, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, ...options,
  });
  try {
    const initialized = git(['init', '--quiet']);
    assert.equal(initialized.status, 0, initialized.stderr);
    copyFileSync(join(projectRoot, '.gitignore'), join(root, '.gitignore'));
    return callback({ root, git });
  } finally { removeWorkspace(root); }
};

const assertIgnored = (git, paths, expected) => {
  for (const path of paths) {
    const result = git(['check-ignore', '--no-index', '--quiet', '--', path]);
    assert.equal(result.status, expected ? 0 : 1, `${path}: ${result.stderr}`);
  }
};

test('Git 忽略 Wrangler 本地变量及各环境文件，包括嵌套目录', () => withRepository(({ git }) => {
  assertIgnored(git, ['.dev.vars', '.dev.vars.production', '.dev.vars.local', 'config/.dev.vars', 'config/.dev.vars.staging'], true);
}));

test('Git 允许公开环境变量示例，但仍忽略真实环境文件', () => withRepository(({ git }) => {
  assertIgnored(git, ['.env.example', '.env.sample', '.dev.vars.example', '.dev.vars.sample', 'config/.env.example', 'config/.dev.vars.sample'], false);
  assertIgnored(git, ['.env', '.env.production', 'config/.env.local', '.dev.vars.example.local'], true);
}));

test('Git 忽略常见无扩展名 SSH 私钥，公钥仍可入库', () => withRepository(({ git }) => {
  for (const name of ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']) {
    assertIgnored(git, [name, `keys/${name}`], true);
    assertIgnored(git, [`${name}.pub`, `keys/${name}.pub`], false);
  }
}));

test('Git 保持私人数据、缓存、构建产物和测试输出的既有忽略边界', () => withRepository(({ git }) => {
  assertIgnored(git, [
    'local-data/lan-access.json', 'local-data/d1/synthetic.sqlite', 'local-data/r2/synthetic.png',
    'local-cache/models/synthetic.onnx', 'public/tag-data/manifest.json', 'node_modules/package/index.js',
    'dist/index.html', 'dist-ssr/index.js', 'tsconfig.tsbuildinfo', '.wrangler/state/synthetic.sqlite',
    '.wrangler-logs/synthetic.log', 'logs/tests/unit.log', 'tests/.tmp/synthetic.txt',
    'synthetic.log', 'synthetic.tmp', 'synthetic.bak', 'certs/synthetic.pem', 'certs/synthetic.key',
    'certs/synthetic.p12', 'certs/synthetic.pfx', 'credentials.json', 'secrets.json', 'cloud-queue.json',
  ], true);
}));

test('Git 不误忽略源码、数据库结构、合成夹具和正式测试', () => withRepository(({ git }) => {
  assertIgnored(git, [
    'env.d.ts', 'wrangler.toml', 'schema.sql', 'migration_synthetic.sql', 'README.md',
    'scripts/secret-scan.mjs', 'tests/scripts/gitignore.test.mjs', 'tests/fixtures/synthetic.json',
    '.vscode/extensions.json',
  ], false);
}));

test('强制暂存被忽略的变量文件后，提交密钥扫描仍按文件名拦截', () => withRepository(({ root, git }) => {
  mkdirSync(join(root, 'scripts'));
  copyFileSync(join(projectRoot, 'scripts/secret-scan.mjs'), join(root, 'scripts/secret-scan.mjs'));
  // 合成内容不匹配密钥值规则，确保阻止提交来自敏感文件名保护。
  writeFileSync(join(root, '.dev.vars'), 'SYNTHETIC_SETTING=value\n');
  const staged = git(['add', '--force', '--', '.dev.vars']);
  assert.equal(staged.status, 0, staged.stderr);
  const scanned = spawnSync(process.execPath, [join(root, 'scripts/secret-scan.mjs'), '--staged'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(scanned.status, 1, scanned.stderr);
  assert.match(scanned.stderr, /\.dev\.vars:1 \[sensitive filename\]/);
  assert.equal(scanned.stderr.includes('SYNTHETIC_SETTING'), false);
}));
