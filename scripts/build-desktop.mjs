import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, chmod, copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { runtimeNodeName } from './desktop-runtime.mjs';

export const NODE_RUNTIME_VERSION = '24.19.0';
// 发布目标按构建机原生架构决定：Windows 只出 x64 安装包；macOS 出未签名（ad-hoc）App，Apple Silicon 为主，Intel Mac 本机构建亦可。
export const DESKTOP_TARGETS = {
  'win32-x64': { label: 'Windows 10/11 x64', node: 'win-x64', archive: 'zip' },
  'darwin-arm64': { label: 'macOS Apple Silicon (arm64)', node: 'darwin-arm64', archive: 'tar.gz' },
  'darwin-x64': { label: 'macOS Intel (x64)', node: 'darwin-x64', archive: 'tar.gz' },
};
export function resolveDesktopTarget(platform = process.platform, arch = process.arch) {
  const target = DESKTOP_TARGETS[`${platform}-${arch}`];
  if (!target) throw new Error('当前发布脚本需要 Windows x64 或 macOS（arm64／x64）构建环境');
  return { ...target, platform, arch };
}
export const PUBLIC_ICONS = ['nai-atelier.ico', 'app-icon.ico', 'app-icon.png', 'artist-palette-3d.ico', 'artist-palette-3d.png'];
// 明确列出公开运行文件，禁止将开发目录中的新增文件自动带入分发包。
export const RUNTIME_FILES = [
  ...['agent-web', 'agent-ui-bridge', 'agent-runtime', 'agent-page-tools', 'agent-local-images', 'artist-samples', 'collector-download', 'danbooru-loading', 'desktop-launcher', 'export-locations', 'storage-locations', 'generation-gateway', 'generation-output', 'image-tagger', 'local-backup', 'local-server', 'local-server-runtime', 'media-gateway', 'media-memory-cache', 'novelai-agent-knowledge', 'pixiv-local', 'pixiv-scheme-handler', 'pixiv-web-login', 'prompt-agent', 'st-chatu8-bridge', 'style-collector', 'tag-update-server', 'tagger-model-download', 'update-tag-dictionary'].map(name => `scripts/${name}.mjs`),
  'scripts/style-collector-window.ps1', 'scripts/style-collector-window.cs', 'scripts/pixiv-edge-callback-watcher.ps1', 'scripts/pixiv-login-complete.html',
  ...['agentOperation', 'agentLabSync', 'agentConnection', 'danbooruErrors', 'httpErrors', 'agentThinking', 'imageTaggerModels', 'transparentBackground', 'pngMetadata'].map(name => `services/${name}.mjs`),
  ...['stChatu8Policy', 'sharedWhitelist', 'imageDimensions', 'cloudQueueNumbers', 'cloudQueueTarget', 'naiBilling', 'generationTasks', 'generationJobs', 'codexRemote'].map(name => `worker/${name}.mjs`),
  'LICENSE', 'PROJECT_AGENT.md', 'wrangler.toml', 'data/novelai-v45-tags.json',
  'locales/index.mjs', 'locales/messages.json',
  ...['index.js', 'style.css', 'manifest.json', 'README.md'].map(name => `sillytavern-extension/npm-bridge/${name}`),
  ...PUBLIC_ICONS.map(name => `public/${name}`),
];
export const DESKTOP_FILES = ['main.mjs', 'preload.cjs', 'startup.html', 'startup.js', 'app-updater.mjs'];
export const DESKTOP_SCRIPT_FILES = ['desktop-runtime.mjs', 'storage-locations.mjs', 'export-locations.mjs'];
export async function copyDesktopScripts(appRoot) {
  await mkdir(join(appRoot, 'scripts'), { recursive: true });
  for (const file of DESKTOP_SCRIPT_FILES) await copyFile(new URL(file, import.meta.url), join(appRoot, 'scripts', file));
}
// 前端依赖已经编译到 dist；只为实际运行的 Node 脚本安装这些直接依赖。
export const RUNTIME_DEPENDENCIES = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'fast-png', 'jszip', 'onnxruntime-node', 'sharp', 'undici'];
export const sameDependencies = (left, right) => Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([name, version]) => right[name] === version);
export function createRuntimePackage(pkg, overrides) {
  const dependencies = Object.fromEntries(RUNTIME_DEPENDENCIES.map(name => {
    if (!pkg.dependencies[name]) throw new Error(`根包未声明所需运行依赖：${name}`);
    return [name, pkg.dependencies[name]];
  }));
  return { name: 'nai-atelier-runtime', private: true, version: pkg.version, type: 'module', scripts: {}, dependencies: { ...dependencies, ...overrides } };
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(root, '.desktop-build');
const runtime = join(buildRoot, 'runtime');
const appRoot = join(buildRoot, 'app');

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function isPrivateDistributionPath(file) {
  return /(^|\/)(?:local-data|local-cache|tag-data|\.git|\.wrangler(?:-logs)?|logs|tests|\.env(?:\.[^/]*)?|\.dev\.vars(?:\.[^/]*)?)(\/|$)/i.test(file.replaceAll('\\', '/'));
}

async function cleanBuildDirectory(directory) {
  const target = resolve(directory);
  if (dirname(target) !== buildRoot || !['runtime', 'app', 'public'].includes(relative(buildRoot, target))) throw new Error('拒绝清理打包边界外的目录');
  if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw new Error('打包目录不能是符号链接');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

const run = (command, args, options = {}) => new Promise((done, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? done() : reject(new Error(`打包命令失败（${code}）：${command}`)));
});

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(150_000) });
  if (!response.ok) throw new Error(`下载失败：${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareNode(target) {
  const filename = `node-v${NODE_RUNTIME_VERSION}-${target.node}.${target.archive}`;
  const origin = `https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}`;
  const sums = (await download(`${origin}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split('\n').find(line => line.trim().endsWith(`  ${filename}`))?.split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('官方 Node 校验清单未包含所需运行环境');
  const cache = join(buildRoot, 'downloads', filename);
  await mkdir(dirname(cache), { recursive: true });
  let bytes = await readFile(cache).catch(() => null);
  if (!bytes || sha256(bytes) !== expected) { bytes = await download(`${origin}/${filename}`); await writeFile(cache, bytes); }
  if (sha256(bytes) !== expected) throw new Error('Node 运行环境 SHA-256 校验失败');
  const folder = filename.replace(/\.(?:zip|tar\.gz)$/, '');
  if (target.archive === 'zip') {
    const zip = await JSZip.loadAsync(bytes);
    for (const [source, destination] of [['node.exe', 'node.exe'], ['LICENSE', 'NODE-LICENSE.txt']]) {
      const entry = zip.file(`${folder}/${source}`);
      if (!entry) throw new Error(`官方运行环境缺少 ${source}`);
      await writeFile(join(runtime, destination), await entry.async('nodebuffer'));
    }
  } else {
    // macOS 官方包是 tar.gz；只解出已校验压缩包中的 node 与许可证，保留官方签名和可执行权限。
    const extracted = join(buildRoot, 'downloads', folder);
    await rm(extracted, { recursive: true, force: true });
    await mkdir(extracted, { recursive: true });
    await run('tar', ['-xzf', cache, '-C', extracted, '--strip-components=1', `${folder}/bin/node`, `${folder}/LICENSE`]);
    for (const [source, destination] of [['bin/node', 'node'], ['LICENSE', 'NODE-LICENSE.txt']]) {
      await copyFile(join(extracted, source), join(runtime, destination)).catch(() => { throw new Error(`官方运行环境缺少 ${source}`); });
    }
    await chmod(join(runtime, 'node'), 0o755);
    await rm(extracted, { recursive: true, force: true });
  }
  await writeFile(join(runtime, 'node-runtime.json'), JSON.stringify({ version: NODE_RUNTIME_VERSION, source: `${origin}/${filename}`, sha256: expected }, null, 2) + '\n');
}

async function copyProgramFiles() {
  for (const filename of RUNTIME_FILES) {
    const source = join(root, filename);
    if (!(await lstat(source)).isFile()) throw new Error(`公开运行文件不允许链接：${filename}`);
    await mkdir(dirname(join(runtime, filename)), { recursive: true });
    await copyFile(source, join(runtime, filename));
  }
}

async function pruneRuntimeDirectory(target) {
  const boundary = join(runtime, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
  const resolved = resolve(target);
  if (!resolved.startsWith(boundary + sep) || (await lstat(resolved)).isSymbolicLink()) throw new Error('拒绝清理运行依赖边界外的目录');
  await rm(resolved, { recursive: true, force: true });
}

async function inventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`分发资源不允许符号链接：${name}`);
    if (entry.isDirectory()) files.push(...await inventory(join(directory, entry.name), name + '/'));
    else files.push(name);
  }
  return files;
}

export const isDistributionMetadata = file => /\.(?:[cm]?js|css)\.map$|\.d\.[cm]?ts(?:\.map)?$/i.test(file);
export async function pruneRuntimeMetadata(nodeModules) {
  const boundary = resolve(nodeModules);
  const files = await inventory(boundary); // 先完整核对没有符号链接，再清理该目录内的单个元数据文件。
  let removedBytes = 0, removedFiles = 0;
  for (const file of files.filter(isDistributionMetadata)) {
    const target = resolve(boundary, file);
    if (!target.startsWith(boundary + sep)) throw new Error('拒绝清理依赖目录外的文件');
    removedBytes += (await lstat(target)).size;
    await rm(target);
    removedFiles++;
  }
  return { removedFiles, removedBytes };
}

/** 桌面壳只捆绑更新器及其实际依赖，仍不复制开发 node_modules。 */
export async function bundleDesktopUpdater(destination) {
  const { build } = await import('esbuild');
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, 'node_modules/electron-updater/out/main.js')], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], outfile: join(destination, 'desktop/updater.cjs'), metafile: true, legalComments: 'eof' });
  const packages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll('\\', '/').match(/^(.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(resolve(root, (match[1] || '') + 'node_modules/' + match[2]));
  }
  for (const directory of packages) {
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    for (const file of (await readdir(directory)).filter(name => /^(?:licen[sc]e|notice|copyright)(?:\.|$)/i.test(name))) {
      const target = join(destination, 'desktop/updater-licenses', pkg.name.replaceAll('/', '_'), file);
      await mkdir(dirname(target), { recursive: true }); await copyFile(join(directory, file), target);
    }
  }
  return [...packages];
}

export async function buildDesktop({ unpacked = false, skipInstall = false } = {}) {
  const target = resolveDesktopTarget();
  const mac = target.platform === 'darwin';
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await mkdir(buildRoot, { recursive: true });
  if (!skipInstall) await cleanBuildDirectory(runtime);
  else await access(join(runtime, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js'));
  await cleanBuildDirectory(appRoot);
  const publicRoot = join(buildRoot, 'public');
  await cleanBuildDirectory(publicRoot);
  for (const icon of PUBLIC_ICONS) await copyFile(join(root, 'public', icon), join(publicRoot, icon));
  console.log('构建干净前端（仅包含公开图标，不复制本机词库或数据）…');
  const { build: viteBuild } = await import('vite');
  const viteEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')));
  for (const key of Object.keys(viteEnvironment)) delete process.env[key];
  try { await viteBuild({ root, envDir: false, publicDir: publicRoot, build: { outDir: join(runtime, 'dist'), emptyOutDir: true } }); }
  finally { Object.assign(process.env, viteEnvironment); }
  const { build: workerBuild } = await import('esbuild');
  await workerBuild({ entryPoints: [join(root, 'worker/index.ts')], bundle: true, format: 'esm', outfile: join(runtime, 'dist', '_worker.js'), platform: 'browser' });
  await copyProgramFiles();
  // 新建依赖目录只使用锁文件；不从开发机复制 node_modules 或任何配置／凭据。
  const overrides = JSON.parse(await readFile(join(root, 'desktop', 'runtime-dependencies.json'), 'utf8'));
  const runtimePkg = createRuntimePackage(pkg, overrides);
  const lock = JSON.parse(await readFile(join(root, 'desktop', 'runtime-package-lock.json'), 'utf8'));
  if (!sameDependencies(lock.packages[''].dependencies, runtimePkg.dependencies)) throw new Error('桌面运行锁文件已过期，请按 Windows 发布文档同步');
  lock.version = pkg.version;
  lock.packages[''].version = pkg.version;
  if (skipInstall) {
    const previous = JSON.parse(await readFile(join(runtime, 'package-lock.json'), 'utf8'));
    previous.packages[''].version = pkg.version;
    if (JSON.stringify(previous.packages) !== JSON.stringify(lock.packages)) throw new Error('分发依赖已变化，不能复用旧依赖');
  }
  await writeFile(join(runtime, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n');
  await writeFile(join(runtime, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  if (!skipInstall) {
    console.log('安装分发运行依赖…');
    // Windows 的 npm 与 node.exe 同目录；macOS／Linux 位于安装前缀的 lib/node_modules。
    const npmCli = target.platform === 'win32' ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await access(npmCli);
    // macOS 的 .bin 是符号链接，分发审计不接受；运行时直接调用各包入口，不需要 .bin。
    await run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...(mac ? ['--no-bin-links'] : [])], { cwd: runtime });
    // ONNX npm 包包含各平台二进制；本安装包只保留目标平台与架构（sharp、workerd 由 npm 按本机平台安装）。
    const ortRoot = join(runtime, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
    for (const platform of await readdir(ortRoot)) {
      if (platform !== target.platform) await pruneRuntimeDirectory(join(ortRoot, platform));
    }
    for (const architecture of await readdir(join(ortRoot, target.platform))) {
      if (architecture !== target.arch) await pruneRuntimeDirectory(join(ortRoot, target.platform, architecture));
    }
  }
  const metadata = await pruneRuntimeMetadata(join(runtime, 'node_modules'));
  console.log(`精简依赖元数据：移除 ${metadata.removedFiles} 个文件，${(metadata.removedBytes / 1024 / 1024).toFixed(1)} MiB；保留执行文件与许可材料。`);
  console.log('校验并准备内置 Node.js…');
  await prepareNode(target);
  await run(join(runtime, runtimeNodeName(target.platform)), ['--no-warnings', '--input-type=module', '-e', "const sharp=(await import('sharp')).default; const ort=await import('onnxruntime-node'); await import('@earendil-works/pi-agent-core'); for(const api of ['openai-completions','openai-responses','anthropic-messages']) await import('@earendil-works/pi-ai/api/'+api); await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer(); console.log('运行依赖验证通过：Node '+process.version+', sharp, ONNX, Agent 与模型提供方');"], { cwd: runtime });
  await mkdir(join(appRoot, 'desktop'), { recursive: true });
  for (const file of DESKTOP_FILES) await copyFile(join(root, 'desktop', file), join(appRoot, 'desktop', file));
  await copyDesktopScripts(appRoot);
  await mkdir(join(appRoot, 'services'), { recursive: true });
  await copyFile(join(root, 'services/appReleases.mjs'), join(appRoot, 'services/appReleases.mjs'));
  await mkdir(join(appRoot, 'locales'), { recursive: true });
  for (const file of ['index.mjs', 'messages.json']) await copyFile(join(root, 'locales', file), join(appRoot, 'locales', file));
  await bundleDesktopUpdater(appRoot);
  await writeFile(join(appRoot, 'package.json'), JSON.stringify({ name: 'nai-atelier-desktop', productName: 'NAI Atelier', version: pkg.version, description: 'NovelAI 个人本地创作工坊', author: 'NAI Atelier contributors', license: 'MIT', main: 'desktop/main.mjs', type: 'module', private: true }, null, 2) + '\n');
  const files = await inventory(runtime);
  const ownFiles = files.filter(file => !file.startsWith('node_modules/'));
  if (ownFiles.some(isPrivateDistributionPath)) throw new Error('分发资源包含禁止打包的目录或配置');
  if (files.some(file => file.startsWith('dist/tag-data/') || file.startsWith('public/tag-data/'))) throw new Error('分发资源意外包含本机词库');
  if (files.some(isDistributionMetadata)) throw new Error('分发资源仍包含调试映射或类型声明');
  await writeFile(join(buildRoot, 'distribution-audit.json'), JSON.stringify({ version: pkg.version, target: target.label, ownFiles, runtimeFileCount: files.length, metadataPruned: metadata, personalDataIncluded: false }, null, 2) + '\n');
  console.log(`分发审计通过，${ownFiles.length} 个公开工程文件；生成 ${unpacked ? '解包应用' : '安装包'}…`);
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  delete process.env.CSC_LINK;
  delete process.env.WIN_CSC_LINK;
  const { build, Platform, Arch } = await import('electron-builder');
  const config = (await import('../desktop/builder.config.mjs')).default;
  const icon = mac ? await (await import('./generate-mac-icon.mjs')).generateMacIcon(join(buildRoot, 'icon', 'NAI Atelier.icns')) : '';
  const artifacts = await build({ projectDir: appRoot, publish: 'never', config: { ...config, directories: { app: '.', output: join(root, 'release'), buildResources: join(root, 'desktop') }, extraResources: config.extraResources.map(entry => ({ ...entry, from: join(root, entry.from) })), win: { ...config.win, icon: join(root, 'public/nai-atelier.ico') }, nsis: { ...config.nsis, license: join(root, 'LICENSE'), include: join(root, 'desktop/installer.nsh') }, mac: { ...config.mac, icon }, dmg: { ...config.dmg, icon }, afterPack: async context => {
    const resourceRoot = mac ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(context.appOutDir, 'resources');
    const shipped = join(resourceRoot, 'runtime');
    const resources = await readdir(resourceRoot);
    for (const retired of ['install-prerequisites.ps1', 'uninstall-integration.ps1']) {
      if (resources.includes(retired)) throw new Error(`分发资源仍包含已移除的安装脚本：${retired}`);
    }
    await access(join(shipped, runtimeNodeName(target.platform)));
    await access(join(shipped, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js'));
    await access(join(shipped, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', target.platform, target.arch, 'onnxruntime_binding.node'));
    if (mac) {
      // Apple Silicon 必须全部为原生二进制，避免任何一环落到 Rosetta 转译。
      await access(join(shipped, 'node_modules', '@cloudflare', `workerd-${target.platform}-${target.arch}`, 'bin', 'workerd'));
      await access(join(shipped, 'node_modules', '@img', `sharp-${target.platform}-${target.arch}`));
    }
    const { listPackage } = await import('@electron/asar');
    const appFiles = listPackage(join(resourceRoot, 'app.asar')).filter(file => !file.endsWith('/'));
    if (appFiles.some(file => file.includes('node_modules') || isPrivateDistributionPath(file))) throw new Error('桌面壳包含额外运行依赖或私人文件');
  } }, targets: mac ? Platform.MAC.createTarget(unpacked ? 'dir' : ['dmg', 'zip'], Arch[target.arch]) : Platform.WINDOWS.createTarget(unpacked ? 'dir' : 'nsis') });
  for (const artifact of artifacts.filter(file => /\.(?:exe|dmg|zip)$/.test(file))) {
    await writeFile(`${artifact}.sha256`, `${sha256(await readFile(artifact))}  ${relative(dirname(artifact), artifact)}\n`);
  }
  console.log(`${target.label} 分发构建完成。`);
  return artifacts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildDesktop({ unpacked: process.argv.includes('--dir'), skipInstall: process.argv.includes('--reuse-deps') }).catch(error => { console.error(error); process.exitCode = 1; });
}
