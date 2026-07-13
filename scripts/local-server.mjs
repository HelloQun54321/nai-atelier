import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';

const IS_WINDOWS = platform() === 'win32';
const IS_TERMUX = process.env.TERMUX_VERSION || existsSync('/data/data/com.termux');
const LOCAL_URL = 'http://127.0.0.1:3000';
const DISPLAY_URL = 'http://localhost:3000';

function checkCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe', shell: IS_WINDOWS });
    return true;
  } catch {
    return false;
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
  
  try {
    execSync('npx wrangler --version', { stdio: 'pipe', shell: IS_WINDOWS });
  } catch {
    console.log('\x1b[33mwrangler 未安装，正在安装...\x1b[0m');
    const installCmd = IS_WINDOWS ? 'npm.cmd' : 'npm';
    execSync(`${installCmd} install wrangler --save-dev`, { stdio: 'inherit', shell: IS_WINDOWS });
  }
}

function buildLatest() {
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

function startServer() {
  console.log('\x1b[32m启动本地服务 (端口 3000)...\x1b[0m');
  console.log('\x1b[90m数据存储位置: ./local-data/\x1b[0m');
  console.log('\x1b[90m访问地址: http://localhost:3000\x1b[0m');
  console.log('');
  
  const args = [
    'pages', 'dev', 'dist',
    '--persist-to', './local-data',
    '--binding', 'LOCAL_HISTORY_ENABLED=true',
    '--port', '3000',
    '--compatibility-date', '2024-04-01'
  ];
  
  const spawnOpts = IS_WINDOWS ? { stdio: 'inherit' } : { stdio: 'inherit', shell: false };
  const cmd = IS_WINDOWS ? process.env.comspec || 'cmd.exe' : 'npx';
  const cmdArgs = IS_WINDOWS ? ['/c', 'npx', 'wrangler', ...args] : ['wrangler', ...args];
  
  const child = spawn(cmd, cmdArgs, spawnOpts);
  openWhenReady();
  
  child.on('error', (err) => {
    console.error('\x1b[31m启动失败:\x1b[0m', err.message);
    process.exit(1);
  });
  
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\x1b[31m服务异常退出，退出码: ${code}\x1b[0m`);
    }
    process.exit(code || 0);
  });
}

console.log('\x1b[36m=== NaiPromptManager 本地部署 ===\x1b[0m');

ensureDependencies();
buildLatest();
startServer();
