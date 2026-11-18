import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
/** 显式外置运行数据时拒绝工程目录、根目录和任何已存在的链接父路径。 */
export const resolveExternalTestRoot = (value, fallback) => {
  if (!value) return fallback;
  if (!isAbsolute(value)) throw new Error('外部测试目录必须是绝对路径');
  const target = resolve(value), project = resolve(projectRoot);
  if (target === parse(target).root || target === project || project.startsWith(target + sep) || target.startsWith(project + sep)) {
    throw new Error('外部测试目录不能是根目录、工程目录或工程父目录');
  }
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  if (realpathSync(existing) !== existing) throw new Error('外部测试目录不能使用链接');
  return target;
};
export const temporaryRoot = resolveExternalTestRoot(process.env.NAI_TEST_TEMP_ROOT, join(projectRoot, 'tests', '.tmp'));
const ownedWorkspaces = new Set();

/**
 * 清掉上次运行被中断后留下的工作区。
 *
 * 只动 tests/.tmp 下、超过一小时的目录：正在并行运行的测试刚创建，不会被误删。
 */
export const cleanupStaleWorkspaces = (maxAgeMs = 60 * 60 * 1000) => {
  // 外置目录可能和其他会话共用：只清本次创建的工作区，不扫描历史目录。
  if (process.env.NAI_TEST_TEMP_ROOT || !existsSync(temporaryRoot)) return 0;
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
  if (base !== allowed && !base.startsWith(allowed + sep)) throw new Error('清理父目录必须位于测试临时根目录 tests/.tmp 或显式外部根内');
  if (dirname(target) !== base || !relative(base, target)) throw new Error('拒绝清理测试父目录以外的位置');
  if (process.env.NAI_TEST_TEMP_ROOT && !ownedWorkspaces.has(target)) throw new Error('拒绝清理非本次创建的外部测试工作区');
  if (!existsSync(target)) return;
  if (realpathSync(target) !== target || realpathSync(base) !== base) throw new Error('测试临时目录位置已变化，停止清理');
  // Windows 上 wrangler/workerd 退出后句柄通常要几百毫秒才释放，重试窗口给足 5 秒。
  rmSync(target, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
  for (const owned of ownedWorkspaces) if (owned === target || owned.startsWith(target + sep)) ownedWorkspaces.delete(owned);
};

export const createWorkspace = (prefix = 'case-', parent = temporaryRoot) => {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) throw new Error('测试目录前缀不能包含路径');
  const base = resolve(parent), allowed = resolve(temporaryRoot);
  if (base !== allowed && !base.startsWith(allowed + sep)) throw new Error('测试目录必须位于测试临时根目录 tests/.tmp 或显式外部根内');
  mkdirSync(base, { recursive: true });
  if (realpathSync(base) !== base) throw new Error('测试临时父目录不能使用链接');
  const root = mkdtempSync(join(base, prefix));
  ownedWorkspaces.add(root);
  return root;
};

/** 只复制公开的工程文件，绝不复制部署数据、缓存或凭据。 */
export const copyPublicFixtures = root => {
  for (const path of ['package.json', 'sillytavern-extension/npm-bridge']) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(projectRoot, path), target, { recursive: true });
  }
};
