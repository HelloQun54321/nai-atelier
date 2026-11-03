import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const temporaryRoot = join(projectRoot, 'tests', '.tmp');

/**
 * 清掉上次运行被中断后留下的工作区。
 *
 * 只动 tests/.tmp 下、超过一小时的目录：正在并行运行的测试刚创建，不会被误删。
 */
export const cleanupStaleWorkspaces = (maxAgeMs = 60 * 60 * 1000) => {
  if (!existsSync(temporaryRoot)) return 0;
  let removed = 0;
  for (const entry of readdirSync(temporaryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = join(temporaryRoot, entry.name);
    try {
      if (Date.now() - statSync(target).mtimeMs < maxAgeMs) continue;
      removeWorkspace(target);
      removed += 1;
    } catch { /* 仍在被占用或权限不足：留给下一次。 */ }
  }
  return removed;
};

/** 只清理由本次测试创建、且仍位于指定临时父目录下的目录。 */
export const removeWorkspace = (root, parent = temporaryRoot) => {
  const target = resolve(root), base = resolve(parent);
  const allowed = resolve(temporaryRoot);
  if (base !== allowed && !base.startsWith(allowed + sep)) throw new Error('清理父目录必须位于 tests/.tmp 内');
  if (dirname(target) !== base || !relative(base, target)) throw new Error('拒绝清理测试父目录以外的位置');
  if (!existsSync(target)) return;
  if (realpathSync(target) !== target || realpathSync(base) !== base) throw new Error('测试临时目录位置已变化，停止清理');
  // Windows 上 wrangler/workerd 退出后句柄通常要几百毫秒才释放，重试窗口给足 5 秒。
  rmSync(target, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
};

export const createWorkspace = (prefix = 'case-', parent = temporaryRoot) => {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) throw new Error('测试目录前缀不能包含路径');
  const base = resolve(parent), allowed = resolve(temporaryRoot);
  if (base !== allowed && !base.startsWith(allowed + sep)) throw new Error('测试目录必须位于 tests/.tmp 内');
  mkdirSync(base, { recursive: true });
  if (realpathSync(base) !== base) throw new Error('测试临时父目录不能使用链接');
  return mkdtempSync(join(base, prefix));
};

/** 只复制公开的工程文件，绝不复制部署数据、缓存或凭据。 */
export const copyPublicFixtures = root => {
  for (const path of ['package.json', 'sillytavern-extension/npm-bridge']) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(projectRoot, path), target, { recursive: true });
  }
};
