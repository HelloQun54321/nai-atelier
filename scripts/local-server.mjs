import { spawn, execSync, spawnSync } from 'child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { connect as connectNet, createServer as createNetServer } from 'net';
import { randomBytes, randomInt } from 'crypto';
import { networkInterfaces, platform } from 'os';
import { startTagUpdateServer } from './tag-update-server.mjs';
import { createMediaGateway } from './media-gateway.mjs';

const IS_WINDOWS = platform() === 'win32';
const IS_TERMUX = process.env.TERMUX_VERSION || existsSync('/data/data/com.termux');
const LOCAL_URL = 'http://127.0.0.1:3000';
const DISPLAY_URL = 'http://localhost:3000';
const LAN_CONFIG_FILE = 'local-data/lan-access.json';
const BOOT_T0 = Date.now();

/** 启动至今的秒数，用于各阶段耗时提示。 */
const bootElapsedSec = () => ((Date.now() - BOOT_T0) / 1000).toFixed(1);

function loadLanAccessConfig() {
  try {
    const saved = JSON.parse(readFileSync(LAN_CONFIG_FILE, 'utf8'));
    if (/^\d{4}$/.test(saved.pin) && typeof saved.secret === 'string' && saved.secret.length >= 32) return saved;
  } catch {
    // Generate the local-only config below.
  }
  mkdirSync('local-data', { recursive: true });
  const config = {
    pin: String(randomInt(0, 10_000)).padStart(4, '0'),
    secret: randomBytes(32).toString('base64url'),
  };
  writeFileSync(LAN_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

/** 虚拟网卡特征名（WSL/Hyper-V、虚拟机、隧道类）：手机无法经它们访问电脑。 */
const VIRTUAL_ADAPTER_PATTERN = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|tailscale|zerotier|utun|tun|tap/i;

function getLanUrls() {
  const addresses = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    // Windows 上 networkInterfaces 的键即适配器名，虚拟网卡直接跳过。
    if (VIRTUAL_ADAPTER_PATTERN.test(name)) continue;
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // 169.254/0.x 是链路本地；198.18.0.0/15 是保留测试段（TUN 代理虚拟网卡常用），均非真实局域网。
      if (/^(169\.254|0\.|198\.1[89]\.)/.test(entry.address)) continue;
      addresses.push(entry.address);
    }
  }
  const unique = [...new Set(addresses)];
  unique.sort((a, b) => Number(!/^192\.168\./.test(a)) - Number(!/^192\.168\./.test(b)));
  return unique.map(address => `http://${address}:3000`);
}

function checkCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe', shell: IS_WINDOWS });
    return true;
  } catch {
    return false;
  }
}

function normalizeProxyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const entries = Object.fromEntries(raw.split(';').map(part => {
    const separator = part.indexOf('=');
    return separator > 0
      ? [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()]
      : ['default', part.trim()];
  }).filter(([, target]) => target));
  const target = entries.https || entries.http || entries.default || '';
  if (!target) return '';
  return /^[a-z][a-z\d+.-]*:\/\//i.test(target) ? target : `http://${target}`;
}

function getOutboundProxyUrl() {
  const environmentProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (environmentProxy) return normalizeProxyUrl(environmentProxy);
  if (!IS_WINDOWS) return '';
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled = execSync(`reg query "${key}" /v ProxyEnable`, { encoding: 'utf8', windowsHide: true });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) return '';
    const result = execSync(`reg query "${key}" /v ProxyServer`, { encoding: 'utf8', windowsHide: true });
    return normalizeProxyUrl(result.match(/ProxyServer\s+REG_SZ\s+(.+)/i)?.[1]);
  } catch {
    return '';
  }
}
/** 常见本机代理软件（Clash Verge / mihomo / v2rayN 等）的混合端口。 */
const LOCAL_PROXY_PORTS = [7897, 7890, 10809, 10808, 2080, 8888, 1080, 6152, 7891, 10801];

/**
 * wrangler 启动时会外连做版本检查；Windows 系统代理若指向失效的 TUN 网关
 * （198.18.0.0/15 保留网段，mihomo/Clash 常见），该请求会被黑洞挂起近两分钟，
 * 表现为启动窗口长时间停在“核心页面服务正在启动”且无 wrangler 输出。
 * 这里统一注入指向本地空端口的快速失败代理，强制外连检查毫秒级失败跳过——
 * 无论代理软件健康与否，本地 pages dev 启动都不应依赖出站网络。
 */
function resolveWranglerProxyEnv() {
  const noProxy = [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
  // ALL_PROXY 一并注入：覆盖更多客户端解析路径，统一把 wrangler 出站请求短路到本地空端口。
  return { HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', all_proxy: 'http://127.0.0.1:1', NO_PROXY: noProxy };
}

async function findLocalProxyPort() {
  return Promise.any(
    LOCAL_PROXY_PORTS.map(port => new Promise((resolve, reject) => {
      const socket = connectNet({ host: '127.0.0.1', port });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 300);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(port); });
      socket.once('error', () => { clearTimeout(timer); reject(new Error('refused')); });
    }))
  ).catch(() => null);
}

/** 系统代理指向 TUN 网关时优先换用本机真实代理端口，避免网关出站请求被黑洞。 */
async function resolveGatewayProxyUrl(systemProxyUrl) {
  if (!systemProxyUrl || !/^[a-z][a-z\d+.-]*:\/\/(?:198\.1[89]\.)/i.test(systemProxyUrl)) return systemProxyUrl;
  const port = await findLocalProxyPort();
  return port ? `http://127.0.0.1:${port}` : systemProxyUrl;
}

function ensureDependencies() {
  if (IS_TERMUX && !process.env.SKIP_TERMUX_SETUP) {
    console.log('\x1b[36m[Termux]\x1b[0m 检测到 Termux 环境');
    if (!checkCommand('node')) {
      console.log('\x1b[33m[Termux]\x1b[0m 正在安装 nodejs-lts...');
      try {
        execSync('pkg install nodejs-lts -y', { stdio: 'inherit', shell: '/bin/sh' });
      } catch {
        console.error('\x1b[31m[Termux]\x1b[0m 安装失败，请手动执行: pkg install nodejs-lts');
        process.exit(1);
      }
    }
  }
  
  const localWrangler = IS_WINDOWS ? 'node_modules/.bin/wrangler.cmd' : 'node_modules/.bin/wrangler';
  if (!existsSync(localWrangler)) {
    console.log('\x1b[33mwrangler 未安装，正在安装...\x1b[0m');
    const installCmd = IS_WINDOWS ? 'npm.cmd' : 'npm';
    execSync(`${installCmd} install wrangler --save-dev`, { stdio: 'inherit', shell: IS_WINDOWS });
  }
}

const BUILD_OUTPUTS = ['dist/index.html', 'dist/_worker.js'];
const BUILD_INPUTS = [
  'App.tsx', 'index.tsx', 'index.html', 'index.css', 'types.ts',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'components', 'config', 'services', 'worker', 'public'
];

function getNewestMtime(path) {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return readdirSync(path, { withFileTypes: true }).reduce((latest, entry) => {
    return Math.max(latest, getNewestMtime(`${path}/${entry.name}`));
  }, stats.mtimeMs);
}

function needsBuild() {
  if (BUILD_OUTPUTS.some(path => !existsSync(path))) return true;
  const oldestOutput = Math.min(...BUILD_OUTPUTS.map(path => statSync(path).mtimeMs));
  const newestInput = Math.max(...BUILD_INPUTS.map(getNewestMtime));
  return newestInput > oldestOutput;
}
/** 清理历史 wrangler pages dev 临时产物：每次 pages dev 都会新建一个 tmp 目录，旧目录不再使用。 */
function cleanupStaleWranglerTmp() {
  const tmpDir = '.wrangler/tmp';
  if (!existsSync(tmpDir)) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of readdirSync(tmpDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = `${tmpDir}/${entry.name}`;
    try {
      if (statSync(dirPath).mtimeMs < cutoff) rmSync(dirPath, { recursive: true, force: true });
    } catch { /* 清理失败不阻塞启动 */ }
  }
}

/**
 * 隐藏 wrangler 高频请求日志（[wrangler:info] GET/POST/...），保留横幅、Ready 与错误。
 */
function quietWranglerRequests(stream, seen = {}) {
  const rl = createInterface({ input: stream });
  rl.on('line', line => {
    // 看门狗据此判断 wrangler 是否活过启动期：黑洞特征是长时间零输出，
    // 因此任意一行输出（含 Proxy 提示、banner、Ready）都视为进程活着。
    seen.value = true;
    if (/^\[wrangler:info\] (GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD) /.test(line)) return;
    process.stdout.write(`${line}\n`);
  });
}

function buildLatest() {
  if (!needsBuild()) {
    console.log('\x1b[90m代码未变化，跳过构建。\x1b[0m');
    return;
  }
  console.log('\x1b[33m正在构建最新版本（本地快速构建，跳过类型检查）...\x1b[0m');
  const startedAt = Date.now();
  const buildCmd = IS_WINDOWS ? 'npm.cmd' : 'npm';
  try {
    execSync(`${buildCmd} run build:local`, { stdio: 'inherit', shell: IS_WINDOWS });
  } catch {
    console.error('\x1b[31m构建失败\x1b[0m');
    process.exit(1);
  }
  console.log(`\x1b[90m构建完成，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒。\x1b[0m`);
}

function openBrowser(url) {
  try {
    if (IS_WINDOWS) {
      const child = spawn(process.env.comspec || 'cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return;
    }

    const command = IS_TERMUX ? 'termux-open-url' : platform() === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch {
    console.log(`Please open manually: ${DISPLAY_URL}`);
  }
}

async function openWhenReady() {
  if (process.env.NAI_NO_BROWSER === '1') return;

  for (let i = 0; i < 60; i++) {
    try {
      await fetch(LOCAL_URL, { cache: 'no-store' });
      console.log(`Opening browser: ${DISPLAY_URL}`);
      openBrowser(DISPLAY_URL);
      return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`Please open manually: ${DISPLAY_URL}`);
}

async function reuseExistingServer() {
  try {
    const response = await fetch(`${LOCAL_URL}/api/lan/status`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || typeof payload?.authorized !== 'boolean') return false;
    console.log('\x1b[33mNAI Atelier 已经在运行，直接打开现有页面。\x1b[0m');
    if (process.env.NAI_NO_BROWSER !== '1') openBrowser(DISPLAY_URL);
    return true;
  } catch {
    return false;
  }
}

async function waitForWorker(port, { outputSeen = () => true, onWranglerRestart = null } = {}) {
  const startedAt = Date.now();
  // A large local R2 store can take longer to recover after an interrupted
  // workerd process. Do not kill a healthy recovery just because the usual
  // fast-start window has elapsed.
  const timeoutMs = 180_000;
  const notices = [8_000, 20_000, 35_000, 60_000, 90_000, 120_000, 150_000];
  let noticeIndex = 0;
  let restartAttempted = false;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/lan/status`, { cache: 'no-store', signal: AbortSignal.timeout(1500) });
      const payload = await response.json().catch(() => null);
      if (response.ok && typeof payload?.authorized === 'boolean') return;
    } catch {
      // Worker is still starting.
    }
    const elapsed = Date.now() - startedAt;
    // 看门狗：wrangler 启动期被 TUN 代理黑洞时长时间零输出（此前 130s 卡死即此形态）。
    // 25 秒无任何输出视为黑洞，自动杀进程重启一次，避免无限静默。
    if (onWranglerRestart && !restartAttempted && elapsed > 25_000 && !outputSeen()) {
      restartAttempted = true;
      await onWranglerRestart();
      continue;
    }
    if (noticeIndex < notices.length && elapsed >= notices[noticeIndex]) {
      console.log(`\x1b[33m核心页面服务仍在启动（已等待 ${Math.round(elapsed / 1000)} 秒）...\x1b[0m`);
      noticeIndex += 1;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('核心页面服务启动超过 3 分钟，请关闭此窗口后重新启动；若再次出现，请保留本窗口中的红色错误信息');
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (IS_WINDOWS) {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* Already stopped. */ }
}

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailableWorkerPort(preferredPort = 3001) {
  for (let port = preferredPort; port < preferredPort + 50; port++) {
    if (port === 3000 || port === 3002) continue;
    if (await isPortAvailable(port)) return port;
  }
  return preferredPort;
}

async function startServer() {
  const lanAccess = loadLanAccessConfig();
  const outboundProxyUrl = getOutboundProxyUrl();
  const lanUrls = getLanUrls();
  const workerPort = await findAvailableWorkerPort(3001);
  console.log('\x1b[32m启动本地服务 (端口 3000)...\x1b[0m');
  console.log('\x1b[90m数据存储位置: ./local-data/\x1b[0m');
  console.log('\x1b[90m电脑访问地址: http://localhost:3000\x1b[0m');
  if (lanUrls.length > 0) {
    console.log('\x1b[36m手机访问地址:\x1b[0m');
    lanUrls.forEach(url => console.log(`  ${url}`));
    console.log(`\x1b[33m局域网四位密码: ${lanAccess.pin}\x1b[0m`);
  } else {
    console.log('\x1b[33m未检测到可用的家庭网络地址。\x1b[0m');
  }
  console.log('');
  
  const args = [
    'pages', 'dev', 'dist',
    '--persist-to', './local-data',
    '--binding', 'LOCAL_HISTORY_ENABLED=true',
    '--binding', 'PERSONAL_MODE_ENABLED=true',
    '--binding', `LAN_ACCESS_PIN=${lanAccess.pin}`,
    '--binding', `LAN_ACCESS_SECRET=${lanAccess.secret}`,
    '--binding', 'AITAG_LOCAL_PROXY_URL=http://127.0.0.1:3000/__internal/aitag-fetch',
    '--binding', 'DANBOORU_LOCAL_PROXY_URL=http://127.0.0.1:3000/__internal/danbooru-fetch',
    '--ip', '127.0.0.1',
    '--port', String(workerPort),
    '--compatibility-date', '2024-04-01',
    '--show-interactive-dev-session=false'
  ];
  
  const tagUpdateServer = startTagUpdateServer();
  const wranglerEnv = resolveWranglerProxyEnv();
  const gatewayOutboundProxy = await resolveGatewayProxyUrl(outboundProxyUrl);
  console.log(`\x1b[90mWrangler 出站代理: ${wranglerEnv.HTTPS_PROXY}（快速失败，跳过启动期外连检查）\x1b[0m`);
  // Tag 数据不再随仓库分发（上游未声明许可）：缺失时提示用户自行安装。
  try {
    if (!existsSync('public/tag-data/manifest.json')) {
      const notice = '\x1b[33m未检测到 Tag 词库数据（public/tag-data）\x1b[0m\n'
        + '\x1b[33m  Tag 自动补全、画师/角色目录将不可用。请运行 npm run update:tags 下载并生成（数据来自 ffdkj 的中英 Tag 数据库，仅本地使用）。\x1b[0m';
      console.log(notice);
    }
  } catch { /* 检测失败不阻断启动 */ }
  // Launch Wrangler's actual CLI process directly. The old cmd -> .cmd wrapper
  // chain left Miniflare descendants behind when startup failed on Windows.
  const wranglerCli = 'node_modules/wrangler/wrangler-dist/cli.js';
  console.log('\x1b[36m核心页面服务正在启动，请稍候（需恢复本地 D1/R2 存储，数据量越大耗时越长）...\x1b[0m');
  const wranglerSeen = { value: false };
  const spawnWrangler = () => {
    const child = spawn(process.execPath, ['--no-warnings', '--experimental-vm-modules', wranglerCli, ...args], { stdio: ['inherit', 'pipe', 'inherit'], shell: false, env: { ...process.env, ...wranglerEnv } });
    // 默认过滤高频请求日志；需要完整输出时设置 NAI_WRANGLER_LOG=all
    if (process.env.NAI_WRANGLER_LOG !== 'all') quietWranglerRequests(child.stdout, wranglerSeen);
    child.on('error', (err) => {
      console.error('\x1b[31m启动失败:\x1b[0m', err.message);
      cleanup();
      process.exit(1);
    });
    child.on('exit', (code) => {
      // 被看门狗淘汰的旧实例：其 exit 事件可能在重启标志复位后才触发，必须静默。
      if (child.isRetired) return;
      mediaGateway?.close();
      tagUpdateServer.close();
      if (shuttingDown) return;
      if (code !== 0 && code !== null) {
        console.error(`\x1b[31m服务异常退出，退出码: ${code}\x1b[0m`);
      }
      process.exit(code || 0);
    });
    return child;
  };
  let child = spawnWrangler();
  let mediaGateway = null;
  let shuttingDown = false;
  let wranglerRestarting = false;

  const cleanup = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    mediaGateway?.close();
    tagUpdateServer.close();
    terminateProcessTree(child.pid);
  };

  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });

  try {
    await waitForWorker(workerPort, {
      outputSeen: () => wranglerSeen.value,
      onWranglerRestart: async () => {
        console.log('\x1b[33mwrangler 启动 25 秒无输出（疑似代理出口黑洞），自动重启 wrangler 一次...\x1b[0m');
        wranglerRestarting = true;
        child.isRetired = true;
        terminateProcessTree(child.pid);
        child = spawnWrangler();
        wranglerRestarting = false;
        // 等待端口与进程彻底释放，避免重启后抢端口失败。
        await new Promise(resolve => setTimeout(resolve, 1500));
      },
    });
    console.log(`\x1b[32m核心页面服务已就绪（耗时 ${bootElapsedSec()} 秒，含本地 D1/R2 存储恢复）。\x1b[0m`);
    // 网关初始化以本地轻量步骤为主，偶发环境卡顿不应让窗口无限静默：90 秒未就绪即报错退出。
    console.log('\x1b[36m图片网关初始化中（缩略图缓存、Agent、Pixiv、桥接）...\x1b[0m');
    const gatewayStartedAt = Date.now();
    mediaGateway = await Promise.race([
      createMediaGateway({ port: 3000, workerPort, lanSecret: lanAccess.secret, outboundProxyUrl: gatewayOutboundProxy }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('图片网关初始化超过 90 秒（可能为系统繁忙或磁盘异常），请关闭窗口后重试')), 90_000)),
    ]);
    console.log(`\x1b[32m图片网关已就绪（耗时 ${((Date.now() - gatewayStartedAt) / 1000).toFixed(1)} 秒），手机列表将按需使用缩略图。\x1b[0m`);
    console.log(`\x1b[32m全部就绪，总耗时 ${bootElapsedSec()} 秒。\x1b[0m`);
    openWhenReady();
  } catch (error) {
    console.error(`\x1b[31m本地服务启动失败: ${error.message}\x1b[0m`);
    cleanup();
    process.exit(1);
  }
}

console.log('\x1b[36m=== NAI Atelier 本地部署 ===\x1b[0m');

if (await reuseExistingServer()) process.exit(0);
ensureDependencies();
buildLatest();
cleanupStaleWranglerTmp();
await startServer();
