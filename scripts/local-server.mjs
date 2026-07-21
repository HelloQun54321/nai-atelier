import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { randomBytes, randomInt } from 'crypto';
import { networkInterfaces, platform } from 'os';
import { startTagUpdateServer } from './tag-update-server.mjs';
import { createMediaGateway } from './media-gateway.mjs';

const IS_WINDOWS = platform() === 'win32';
const IS_TERMUX = process.env.TERMUX_VERSION || existsSync('/data/data/com.termux');
const LOCAL_URL = 'http://127.0.0.1:3000';
const DISPLAY_URL = 'http://localhost:3000';
const LAN_CONFIG_FILE = 'local-data/lan-access.json';

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

function getLanUrls() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (/^(169\.254|0\.)/.test(entry.address)) continue;
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

function buildLatest() {
  if (!needsBuild()) {
    console.log('\x1b[90m代码未变化，跳过构建。\x1b[0m');
    return;
  }
  console.log('\x1b[33m正在构建最新版本...\x1b[0m');
  const buildCmd = IS_WINDOWS ? 'npm.cmd' : 'npm';
  try {
    execSync(`${buildCmd} run build`, { stdio: 'inherit', shell: IS_WINDOWS });
  } catch {
    console.error('\x1b[31m构建失败\x1b[0m');
    process.exit(1);
  }
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
    console.log('\x1b[33mNaiPromptManager 已经在运行，直接打开现有页面。\x1b[0m');
    if (process.env.NAI_NO_BROWSER !== '1') openBrowser(DISPLAY_URL);
    return true;
  } catch {
    return false;
  }
}

async function waitForWorker(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/lan/status`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (response.ok && typeof payload?.authorized === 'boolean') return;
    } catch {
      // Worker is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('内部服务启动超时');
}

async function startServer() {
  const lanAccess = loadLanAccessConfig();
  const outboundProxyUrl = getOutboundProxyUrl();
  const lanUrls = getLanUrls();
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
    '--ip', '127.0.0.1',
    '--port', '3001',
    '--compatibility-date', '2024-04-01',
    '--show-interactive-dev-session=false'
  ];
  
  const spawnOpts = IS_WINDOWS ? { stdio: 'inherit' } : { stdio: 'inherit', shell: false };
  const cmd = IS_WINDOWS ? process.env.comspec || 'cmd.exe' : './node_modules/.bin/wrangler';
  const cmdArgs = IS_WINDOWS ? ['/c', 'node_modules\\.bin\\wrangler.cmd', ...args] : args;
  
  const tagUpdateServer = startTagUpdateServer();
  const child = spawn(cmd, cmdArgs, spawnOpts);
  let mediaGateway = null;
  
  child.on('error', (err) => {
    console.error('\x1b[31m启动失败:\x1b[0m', err.message);
    process.exit(1);
  });
  
  child.on('exit', (code) => {
    mediaGateway?.close();
    tagUpdateServer.close();
    if (code !== 0 && code !== null) {
      console.error(`\x1b[31m服务异常退出，退出码: ${code}\x1b[0m`);
    }
    process.exit(code || 0);
  });

  try {
    await waitForWorker(3001);
    mediaGateway = await createMediaGateway({ port: 3000, workerPort: 3001, lanSecret: lanAccess.secret, outboundProxyUrl });
    console.log('\x1b[32m图片网关已就绪，手机列表将按需使用缩略图。\x1b[0m');
    openWhenReady();
  } catch (error) {
    console.error(`\x1b[31m本地服务启动失败: ${error.message}\x1b[0m`);
    mediaGateway?.close();
    tagUpdateServer.close();
    child.kill();
    process.exit(1);
  }
}

console.log('\x1b[36m=== NaiPromptManager 本地部署 ===\x1b[0m');

if (await reuseExistingServer()) process.exit(0);
ensureDependencies();
buildLatest();
await startServer();
