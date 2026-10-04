import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const temporaryRoot = join(projectRoot, 'tests', '.tmp');

/** 只清理由本次测试创建、且仍位于指定临时父目录下的目录。 */
export const removeWorkspace = (root, parent = temporaryRoot) => {
  const target = resolve(root), base = resolve(parent);
  const allowed = resolve(temporaryRoot);
  if (base !== allowed && !base.startsWith(allowed + sep)) throw new Error('清理父目录必须位于 tests/.tmp 内');
  if (dirname(target) !== base || !relative(base, target)) throw new Error('拒绝清理测试父目录以外的位置');
  if (!existsSync(target)) return;
  if (realpathSync(target) !== target || realpathSync(base) !== base) throw new Error('测试临时目录位置已变化，停止清理');
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
