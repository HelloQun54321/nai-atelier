import { execFileSync, spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_REPOSITORY, compareReleaseVersions, releaseVersion } from '../services/appReleases.mjs';
import { isLocalPortBusy, reserveLocalLauncher } from './local-server-runtime.mjs';

const officialRemotes = new Set([
  `https://github.com/${RELEASE_REPOSITORY}.git`,
  `https://github.com/${RELEASE_REPOSITORY}`,
  `git@github.com:${RELEASE_REPOSITORY}.git`,
  `git@github.com:${RELEASE_REPOSITORY}`,
].map(item => item.toLowerCase()));

export const isOfficialRemote = value => officialRemotes.has(String(value).trim().toLowerCase());

export function verifyUpdateTarget(current, target, files) {
  if (!releaseVersion(target) || compareReleaseVersions(target, current) < 0) throw new Error('目标版本无效或低于当前版本');
  if (releaseVersion(target)[0] !== releaseVersion(current)?.[0]) throw new Error('跨主要版本更新需要先完整备份，再按发行说明手动升级');
  if (files.some(file => /(^|\/)migration[^/]*\.sql$|^wrangler\.toml$|^(?:local-data|local-cache|public\/tag-data)(?:\/|$)/i.test(file))) {
    throw new Error('此更新改变数据结构或存储定位，请先完整备份并按发行说明手动升级');
  }
}

const stripLockVersion = text => {
  const data = JSON.parse(text);
  delete data.version;
  if (data.packages?.['']) delete data.packages[''].version;
  return JSON.stringify(data);
};

const pickDependencyFields = text => {
  const data = JSON.parse(text);
  return JSON.stringify({
    dependencies: data.dependencies ?? null,
    devDependencies: data.devDependencies ?? null,
    optionalDependencies: data.optionalDependencies ?? null,
    peerDependencies: data.peerDependencies ?? null,
    overrides: data.overrides ?? null,
  });
};

async function needsDependencyInstall(root, git, currentCommit, targetCommit, changed) {
  try {
    await access(join(root, 'node_modules'));
  } catch {
    return true;
  }
  if (!changed.includes('package-lock.json') && !changed.includes('package.json')) return false;
  if (changed.includes('package-lock.json')) {
    try {
      const before = stripLockVersion(git(['show', `${currentCommit}:package-lock.json`]));
      const after = stripLockVersion(git(['show', `${targetCommit}:package-lock.json`]));
      if (before !== after) return true;
    } catch {
      return true;
    }
  }
  if (changed.includes('package.json')) {
    try {
      const before = pickDependencyFields(git(['show', `${currentCommit}:package.json`]));
      const after = pickDependencyFields(git(['show', `${targetCommit}:package.json`]));
      if (before !== after) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** 只操作公开源码和依赖；不清理、不迁移、不读取私人数据目录。 */
export async function updateLocal({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  portBusy = isLocalPortBusy,
  reserve = reserveLocalLauncher,
  run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`更新步骤失败（${code}），保留当前文件，可重新运行更新入口重试`)));
  }),
  log = console.log,
  start = true,
} = {}) {
  if (resolve(git(['rev-parse', '--show-toplevel'])) !== resolve(root)) throw new Error('请在 NAI Atelier 仓库根目录运行更新；ZIP 源码请从发行页取得新版');
  if (!isOfficialRemote(git(['remote', 'get-url', 'origin']))) throw new Error('当前 origin 不是 NAI Atelier 官方仓库，已保留自定义仓库');
  if (git(['branch', '--show-current']) !== 'main') throw new Error('当前不在 main 分支，请自行维护定制分支');
  if (git(['status', '--porcelain'])) throw new Error('源码存在本地修改或未跟踪文件，已停止更新；请先保存自己的修改');

  log('正在检查官方 main 分支更新…');
  try {
    git(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  } catch {
    throw new Error('无法连接官方仓库获取更新，请检查网络或代理后重试');
  }

  const currentCommit = git(['rev-parse', 'HEAD']);
  const targetCommit = git(['rev-parse', 'FETCH_HEAD^{commit}']);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const targetPackage = JSON.parse(git(['show', `${targetCommit}:package.json`]));
  const target = targetPackage.version;

  if (currentCommit === targetCommit) {
    log(`已是最新：当前 main 分支版本 ${pkg.version}（${currentCommit.slice(0, 7)}），无需更新`);
    return null;
  }

  let ahead = false;
  try {
    git(['merge-base', '--is-ancestor', targetCommit, 'HEAD']);
    ahead = true;
  } catch { /* 本地未领先于官方 main */ }
  if (ahead) {
    log(`已是最新：本地 main（${pkg.version}，${currentCommit.slice(0, 7)}）领先于官方 main（${target}，${targetCommit.slice(0, 7)}），无需更新`);
    return null;
  }

  try {
    git(['merge-base', '--is-ancestor', 'HEAD', targetCommit]);
  } catch {
    throw new Error('本地提交与官方 main 分叉，已停止更新；请自行维护定制源码');
  }

  const changed = git(['diff', '--name-only', 'HEAD', targetCommit]).split(/\r?\n/).filter(Boolean);
  verifyUpdateTarget(pkg.version, target, changed);
  const tracked = git(['ls-tree', '-r', '--name-only', targetCommit]).split(/\r?\n/);
  if (tracked.some(file => /^(?:local-data|local-cache|public\/tag-data)(?:\/|$)/i.test(file))) {
    throw new Error('官方源码包含受保护目录，已停止更新');
  }

  // 更新占位与现有启动器共用，阻止依赖安装期间启动另一实例。
  let guard;
  try {
    try {
      guard = await reserve(root);
    } catch (error) {
      if (error.code === 'EADDRINUSE') throw new Error('工坊仍在运行或启动中，请先关闭源码服务窗口再更新');
      throw error;
    }
    if (await portBusy(3000) || await portBusy(3002)) throw new Error('请先关闭源码工坊服务窗口，完成手机上的任务后再双击更新');
    if (git(['status', '--porcelain'])) throw new Error('更新准备期间源码已发生修改，已停止更新');

    const installDeps = await needsDependencyInstall(root, git, currentCommit, targetCommit, changed);
    log(`正在更新到 ${target}（${targetCommit.slice(0, 7)}）；私人数据与词库保留…`);
    git(['merge', '--ff-only', targetCommit]);

    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    let npmCommand = 'npm';
    let npmArgs = [];
    if (process.platform === 'win32') {
      try {
        await access(npmCli);
        npmCommand = process.execPath;
        npmArgs = [npmCli];
      } catch {
        npmCommand = process.env.ComSpec || 'cmd.exe';
        npmArgs = ['/d', '/s', '/c', 'npm'];
      }
    }

    if (installDeps) {
      await run(npmCommand, [...npmArgs, 'ci', '--no-audit', '--no-fund']);
    } else {
      log('依赖未变化，跳过重装依赖，直接重新构建…');
    }
    await run(npmCommand, [...npmArgs, 'run', 'build:local']);
    log(`更新完成：${target}（${targetCommit.slice(0, 7)}）`);
  } finally {
    await guard?.close();
  }

  if (start) await run(process.execPath, ['scripts/local-server.mjs']);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  updateLocal().catch(error => {
    console.error(`更新未完成：${error.message}\n数据未清理。请解决提示的问题后重试，或从 GitHub Releases 下载安装版。`);
    process.exitCode = 1;
  });
}
