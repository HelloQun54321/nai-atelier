import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FILE = path.join(ROOT, 'public', 'tag-data', 'manifest.json');
const UPDATE_SCRIPT = path.join(ROOT, 'scripts', 'update-tag-dictionary.mjs');
const HOST = '127.0.0.1';
const PORT = 3001;
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

const updateState = {
  running: false,
  phase: 'idle',
  message: '可以检查更新',
  startedAt: null,
  finishedAt: null
};

async function readManifestSummary() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
    return {
      count: Number(manifest.count) || 0,
      generatedAt: manifest.generatedAt || null,
      sourceLastModified: manifest.sourceLastModified || null
    };
  } catch {
    return { count: 0, generatedAt: null, sourceLastModified: null };
  }
}

function runCommand(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const forward = (stream, writer) => {
      const lines = createInterface({ input: stream });
      lines.on('line', line => {
        if (!line.startsWith('TAG_UPDATE_')) writer(`[Tag 更新] ${line}\n`);
        onLine?.(line);
      });
    };
    forward(child.stdout, text => process.stdout.write(text));
    forward(child.stderr, text => process.stderr.write(text));

    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`命令执行失败，退出码 ${code ?? '未知'}`));
    });
  });
}

async function runTagUpdate() {
  updateState.running = true;
  updateState.phase = 'checking';
  updateState.message = '正在检查上游数据库…';
  updateState.startedAt = new Date().toISOString();
  updateState.finishedAt = null;
  let updateResult = '';

  try {
    await runCommand(process.execPath, ['--no-warnings', UPDATE_SCRIPT], line => {
      const phase = line.match(/^TAG_UPDATE_PHASE=(\w+)$/)?.[1];
      if (phase === 'checking') {
        updateState.phase = 'checking';
        updateState.message = '正在检查上游数据库…';
      } else if (phase === 'downloading') {
        updateState.phase = 'downloading';
        updateState.message = '正在下载最新数据库（约 30 MB）…';
      } else if (phase === 'generating') {
        updateState.phase = 'generating';
        updateState.message = '正在生成中英文 Tag 分片…';
      }

      const result = line.match(/^TAG_UPDATE_RESULT=(\w+)$/)?.[1];
      if (result) updateResult = result;
    });

    if (updateResult === 'unchanged') {
      updateState.phase = 'unchanged';
      updateState.message = '已经是最新版本';
      return;
    }
    if (updateResult !== 'updated') throw new Error('更新脚本没有返回有效结果');

    updateState.phase = 'building';
    updateState.message = '正在应用新词库…';
    if (process.platform === 'win32') {
      await runCommand(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build']);
    } else {
      await runCommand('npm', ['run', 'build']);
    }

    updateState.phase = 'completed';
    updateState.message = 'Tag 词库更新完成';
  } catch (error) {
    updateState.phase = 'error';
    updateState.message = error instanceof Error ? error.message : '更新失败';
    console.error('[Tag 更新]', error);
  } finally {
    updateState.running = false;
    updateState.finishedAt = new Date().toISOString();
  }
}

function writeJson(response, status, body, origin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Nai-Local-Control',
      'Vary': 'Origin'
    } : {})
  });
  response.end(JSON.stringify(body));
}

export function startTagUpdateServer() {
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin || '';
    const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) return writeJson(response, 403, { error: 'Forbidden' });
      return writeJson(response, 204, {}, allowedOrigin);
    }
    if (!allowedOrigin || request.headers['x-nai-local-control'] !== 'true') {
      return writeJson(response, 403, { error: '仅允许本地 NaiPromptManager 页面访问' });
    }
    if (url.pathname !== '/tag-dictionary') {
      return writeJson(response, 404, { error: 'Not Found' }, allowedOrigin);
    }

    if (request.method === 'GET') {
      return writeJson(response, 200, {
        available: true,
        ...updateState,
        manifest: await readManifestSummary()
      }, allowedOrigin);
    }

    if (request.method === 'POST') {
      if (!updateState.running) void runTagUpdate();
      return writeJson(response, updateState.running ? 202 : 200, {
        available: true,
        ...updateState,
        manifest: await readManifestSummary()
      }, allowedOrigin);
    }

    return writeJson(response, 405, { error: 'Method Not Allowed' }, allowedOrigin);
  });

  server.on('error', error => {
    console.error(`\x1b[33mTag 更新服务未启动（端口 ${PORT}）：${error.message}\x1b[0m`);
  });
  server.listen(PORT, HOST, () => {
    console.log(`\x1b[90mTag 更新服务: http://${HOST}:${PORT}\x1b[0m`);
  });
  return server;
}
