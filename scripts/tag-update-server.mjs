import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED = process.env.NAI_PACKAGED === '1';
const WORKSPACE = PACKAGED ? process.cwd() : ROOT;
const MANIFEST_FILE = path.join(process.env.NAI_TAG_DATA_DIR || path.join(WORKSPACE, 'public', 'tag-data'), 'manifest.json');
const UPDATE_SCRIPT = path.join(ROOT, 'scripts', 'update-tag-dictionary.mjs');
const HOST = '127.0.0.1';
const PORT = Number(process.env.NAI_TAG_UPDATE_PORT || 3002);
const GATEWAY_PORT = Number(process.env.NAI_GATEWAY_PORT || 3000);
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${GATEWAY_PORT}`,
  `http://127.0.0.1:${GATEWAY_PORT}`
]);

const updateState = {
  running: false,
  phase: 'idle',
  message: '可以检查更新',
  startedAt: null,
  finishedAt: null
};
const updateChildren = new Set();
// 手动导入只在本地把用户自备的 tag.sqlite 交给生成脚本，最多接收 256 MB；
// 上游词库目前约 30 MB，上限留给后续增长，同时避免异常文件占满内存。
const IMPORT_LIMIT_BYTES = 256 * 1024 * 1024;
const SQLITE_HEADER = 'SQLite format 3\u0000';

function stopTagUpdates() {
  for (const child of updateChildren) {
    if (child.exitCode !== null) continue;
    child.stopping = true;
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}

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

function runCommand(command, args, onLine, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: WORKSPACE,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    updateChildren.add(child);

    const forward = (stream, writer) => {
      const lines = createInterface({ input: stream });
      lines.on('line', line => {
        if (!line.startsWith('TAG_UPDATE_')) writer(`[Tag 更新] ${line}\n`);
        onLine?.(line);
      });
    };
    forward(child.stdout, text => process.stdout.write(text));
    forward(child.stderr, text => process.stderr.write(text));

    child.once('error', error => { updateChildren.delete(child); reject(error); });
    child.once('exit', code => {
      updateChildren.delete(child);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`命令执行失败，退出码 ${code ?? '未知'}`), { code: child.stopping ? 'TAG_UPDATE_STOPPED' : 'TAG_UPDATE_FAILED' }));
    });
  });
}

function readUploadedDictionary(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };
    request.on('data', chunk => {
      size += chunk.length;
      if (size > IMPORT_LIMIT_BYTES) {
        fail(Object.assign(new Error(`词库文件超过 ${IMPORT_LIMIT_BYTES / 1024 / 1024} MB 上限，请确认选择的是 tag.sqlite`), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    request.on('error', fail);
  });
}

/** 接收手动导入的 tag.sqlite：校验 SQLite 头后落到独立临时目录，交给生成脚本使用。 */
async function receiveImportedDictionary(request) {
  const bytes = await readUploadedDictionary(request);
  if (!bytes.length) throw Object.assign(new Error('没有收到词库文件，请重新选择'), { status: 400 });
  if (bytes.length < 16 || bytes.toString('latin1', 0, 16) !== SQLITE_HEADER) {
    throw Object.assign(new Error('导入的文件不是有效的 SQLite 词库，请在词库来源下载 tag.sqlite 后重试'), { status: 400 });
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'nai-tag-import-'));
  const sourceFile = path.join(directory, 'source.sqlite');
  await writeFile(sourceFile, bytes);
  return { directory, sourceFile };
}

async function runTagUpdate(updateScript, outboundProxyUrl, { sourceFile = '', importDirectory = '' } = {}) {
  const importing = Boolean(sourceFile);
  updateState.running = true;
  updateState.phase = importing ? 'generating' : 'checking';
  updateState.message = importing ? '正在生成中英文 Tag 分片…' : '正在检查上游数据库…';
  updateState.startedAt = new Date().toISOString();
  updateState.finishedAt = null;
  let updateResult = '';
  let detailedError = '';

  try {
    await runCommand(process.execPath, ['--no-warnings', updateScript], line => {
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

      const message = line.match(/^TAG_UPDATE_MESSAGE=(.+)$/)?.[1];
      if (message) updateState.message = decodeURIComponent(message);

      const errorMessage = line.match(/^TAG_UPDATE_ERROR=(.+)$/)?.[1];
      if (errorMessage) detailedError = decodeURIComponent(errorMessage);
    }, { ...process.env, NAI_TAG_PROXY_URL: outboundProxyUrl, ...(importing ? { NAI_TAG_LOCAL_SOURCE: sourceFile } : {}) });

    if (updateResult === 'unchanged') {
      updateState.phase = 'unchanged';
      updateState.message = '已经是最新版本';
      return;
    }
    if (updateResult !== 'updated') throw new Error('更新脚本没有返回有效结果');

    updateState.phase = 'building';
    updateState.message = '正在应用新词库…';
    if (PACKAGED) {
      // 安装版由网关直接读取用户词库，无需 npm 或修改已安装的前端资源。
    } else if (process.platform === 'win32') {
      await runCommand(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build']);
    } else {
      await runCommand('npm', ['run', 'build']);
    }

    updateState.phase = 'completed';
    updateState.message = 'Tag 词库更新完成';
  } catch (error) {
    if (error.code === 'TAG_UPDATE_STOPPED') {
      updateState.phase = 'idle'; updateState.message = '更新已停止';
      return;
    }
    updateState.phase = 'error';
    updateState.message = detailedError || (error instanceof Error ? error.message : '更新失败');
    console.error('[Tag 更新]', error);
  } finally {
    updateState.running = false;
    updateState.finishedAt = new Date().toISOString();
    // 导入文件的临时副本只在本次生成期间需要，失败也一并清理，不留下大文件。
    if (importDirectory) await rm(importDirectory, { recursive: true, force: true }).catch(() => {});
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

export function startTagUpdateServer({ port = PORT, updateScript = UPDATE_SCRIPT, outboundProxyUrl = '' } = {}) {
  let appUpdating = false;
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin || '';
    const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) return writeJson(response, 403, { error: 'Forbidden' });
      return writeJson(response, 204, {}, allowedOrigin);
    }
    if (!allowedOrigin || request.headers['x-nai-local-control'] !== 'true') {
      return writeJson(response, 403, { error: '仅允许本地 NAI Atelier 页面访问' });
    }
    if (url.pathname === '/tag-dictionary/import') {
      if (request.method !== 'POST') {
        request.resume();
        return writeJson(response, 405, { error: '仅支持 POST 请求' }, allowedOrigin);
      }
      if (appUpdating) {
        request.resume();
        return writeJson(response, 503, { error: '工坊正在安装更新，请稍后重试' }, allowedOrigin);
      }
      if (updateState.running) {
        request.resume();
        return writeJson(response, 409, { error: 'Tag 词库正在更新，请完成后再导入' }, allowedOrigin);
      }
      let imported;
      try {
        imported = await receiveImportedDictionary(request);
      } catch (error) {
        return writeJson(response, Number(error.status) || 400, { error: error.message || '词库文件接收失败' }, allowedOrigin);
      }
      void runTagUpdate(updateScript, outboundProxyUrl, { sourceFile: imported.sourceFile, importDirectory: imported.directory });
      return writeJson(response, 202, {
        available: true,
        ...updateState,
        manifest: await readManifestSummary()
      }, allowedOrigin);
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
      // 消费并丢弃请求体：keep-alive 客户端下未读的 body 会污染同连接的下一个请求
      request.resume();
      if (appUpdating) return writeJson(response, 503, { error: '工坊正在安装更新，请稍后重试' }, allowedOrigin);
      if (!updateState.running) void runTagUpdate(updateScript, outboundProxyUrl);
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
  server.stopUpdates = stopTagUpdates;
  server.prepareUpdate = () => {
    if (updateState.running) throw new Error('Tag 词库正在更新，请完成后再安装');
    appUpdating = true;
  };
  server.cancelUpdate = () => { appUpdating = false; };
  server.listen(port, HOST, () => {
    console.log(`\x1b[90mTag 更新服务: http://${HOST}:${server.address().port}\x1b[0m`);
  });
  return server;
}
