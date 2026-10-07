import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchPublishedRelease, RELEASE_REPOSITORY, compareReleaseVersions, releaseVersion } from '../services/appReleases.mjs';
import { isLocalPortBusy, reserveLocalLauncher } from './local-server-runtime.mjs';

const officialRemote = `https://github.com/${RELEASE_REPOSITORY}.git`;
export const isOfficialRemote = value => [officialRemote, officialRemote.slice(0, -4), `git@github.com:${RELEASE_REPOSITORY}.git`].includes(value.trim());

export function verifyUpdateTarget(current, target, files) {
  if (!releaseVersion(target) || compareReleaseVersions(target, current) < 0) throw new Error('目标版本无效或低于当前版本');
  if (releaseVersion(target)[0] !== releaseVersion(current)?.[0]) throw new Error('跨主要版本更新需要先完整备份，再按发行说明手动升级');
  if (files.some(file => /(^|\/)(?:schema\.sql|migration[^/]*\.sql)$|^wrangler\.toml$|^(?:local-data|local-cache|public\/tag-data)(?:\/|$)/i.test(file))) {
    throw new Error('此更新改变数据结构或存储定位，请先完整备份并按发行说明手动升级');
  }
}

/** 只操作公开源码和依赖；不清理、不迁移、不读取私人数据目录。 */
export async function updateLocal({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), allowPrerelease = true,
  git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  published = fetchPublishedRelease, portBusy = isLocalPortBusy, reserve = reserveLocalLauncher,
  run = (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`更新步骤失败（${code}），保留当前文件，可重新运行更新入口重试`)));
  }), log = console.log, start = true } = {}) {
  if (resolve(git(['rev-parse', '--show-toplevel'])) !== resolve(root)) throw new Error('请在 NAI Atelier 仓库根目录运行更新；ZIP 源码请从发行页取得新版');
  if (!isOfficialRemote(git(['remote', 'get-url', 'origin']))) throw new Error('当前 origin 不是 NAI Atelier 官方仓库，已保留自定义仓库');
  if (git(['branch', '--show-current']) !== 'main') throw new Error('当前不在 main 分支，请自行维护定制分支');
  if (git(['status', '--porcelain'])) throw new Error('源码存在本地修改或未跟踪文件，已停止更新；请先保存自己的修改');
  log('正在检查已发布版本…');
  const release = await published(allowPrerelease);
  if (!release) throw new Error('当前渠道尚无可用发行版，请查看下载页');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const target = release.tag_name.replace(/^v/, '');
  verifyUpdateTarget(pkg.version, target, []);
  git(['fetch', '--no-tags', officialRemote, `refs/tags/${release.tag_name}`]);
  const targetCommit = git(['rev-parse', 'FETCH_HEAD^{commit}']);
  const targetPackage = JSON.parse(git(['show', `${targetCommit}:package.json`]));
  if (targetPackage.version !== target) throw new Error('发行标签和代码版本不一致，已停止更新');
  try { git(['merge-base', '--is-ancestor', 'HEAD', targetCommit]); }
  catch { throw new Error('本地提交与发行版本分叉，已停止更新；请自行维护定制源码'); }
  const changed = git(['diff', '--name-only', 'HEAD', targetCommit]).split(/\r?\n/).filter(Boolean);
  verifyUpdateTarget(pkg.version, target, changed);
  const tracked = git(['ls-tree', '-r', '--name-only', targetCommit]).split(/\r?\n/);
  if (tracked.some(file => /^(?:local-data|local-cache|public\/tag-data)(?:\/|$)/i.test(file))) throw new Error('发行代码包含受保护目录，已停止更新');
  // 更新占位与现有启动器共用，阻止依赖安装期间启动另一实例。
  let guard;
  try {
    try { guard = await reserve(root); }
    catch (error) { if (error.code === 'EADDRINUSE') throw new Error('工坊仍在运行或启动中，请先关闭源码服务窗口再更新'); throw error; }
    if (await portBusy(3000) || await portBusy(3002)) throw new Error('请先关闭源码工坊服务窗口，完成手机上的任务后再双击更新');
    if (git(['status', '--porcelain'])) throw new Error('更新准备期间源码已发生修改，已停止更新');
    log(`正在更新到 ${target}；私人数据与词库保留…`);
    git(['merge', '--ff-only', targetCommit]);
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
    const npmArgs = process.platform === 'win32' ? [npmCli] : [];
    if (process.platform === 'win32') await readFile(npmCli);
    // 锁文件确定整套依赖；prepare 只建立本项目入口和提交钩子。
    await run(npmCommand, [...npmArgs, 'ci', '--no-audit', '--no-fund']);
    await run(npmCommand, [...npmArgs, 'run', 'build:local']);
    log(`更新完成：${target}`);
  } finally { await guard?.close(); }
  if (start) await run(process.execPath, ['scripts/local-server.mjs']);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  updateLocal({ allowPrerelease: !process.argv.includes('--stable') }).catch(error => {
    console.error(`更新未完成：${error.message}\n数据未清理。请解决提示的问题后重试，或从 GitHub Releases 下载安装版。`);
    process.exitCode = 1;
  });
}
