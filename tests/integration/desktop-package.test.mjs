import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import sharp from 'sharp';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { desktopServerOptions, findDesktopPorts, prepareDesktopWorkspace, isPortFree } from '../../scripts/desktop-runtime.mjs';

// 显式指定已构建应用时才执行，不把耗时发布验收带入普通离线测试。
const executable = process.env.NAI_DESKTOP_TEST_EXE;
test('Windows 安装资源独立启动、D1/R2 持久化、词库可写与退出回收', { skip: !executable, timeout: 100_000 }, async () => {
  const root = createWorkspace('desktop-package-');
  const exe = resolve(executable), runtime = join(dirname(exe), 'resources', 'runtime');
  const data = join(root, '数据 中文 空格'), documents = join(root, '文档');
  const occupied = createServer(socket => socket.destroy());
  let child, ports;
  const logs = [];
  try {
    // 精简后的真实安装依赖验证，不联网调用模型或下载反推权重。
    const native = execFileSync(join(runtime, 'node.exe'), ['--no-warnings', '--input-type=module', '-e', "import assert from 'node:assert/strict'; const sharp=(await import('sharp')).default; const {decode}=await import('fast-png'); const ort=await import('onnxruntime-node'); const image=decode(await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer()); assert.equal(image.width,2); assert.equal(image.height,2); assert.deepEqual(Array.from(new ort.Tensor('float32',Float32Array.from([1,2]),[1,2]).data),[1,2]); await import('@earendil-works/pi-agent-core'); for(const api of ['openai-completions','openai-responses','anthropic-messages']) await import('@earendil-works/pi-ai/api/'+api); console.log('native-and-providers-ok');"], { cwd: runtime, env: { ...process.env, PATH: join(process.env.SystemRoot, 'System32') }, windowsHide: true, encoding: 'utf8', timeout: 20_000 });
    assert.match(native, /native-and-providers-ok/);
    await new Promise(done => occupied.listen({ port: 0, host: '127.0.0.1' }, done));
    const base = occupied.address().port;
    ports = await findDesktopPorts({ preferred: base });
    assert.notEqual(ports.gateway, base);
    const { workspace } = await prepareDesktopWorkspace(runtime, data);
    const spec = desktopServerOptions({ runtimeRoot: runtime, workspace, executable: exe, ports, documents, env: { ...process.env, PATH: join(process.env.SystemRoot, 'System32') } });
    const start = async () => {
      child = spawn(spec.command, spec.args, spec.options);
      child.stdout.on('data', chunk => logs.push(String(chunk))); child.stderr.on('data', chunk => logs.push(String(chunk)));
      const deadline = Date.now() + 35_000;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, logs.join(''));
        const identity = await fetch(`http://127.0.0.1:${ports.launcher}/__atelier/launcher`).then(r => r.json()).catch(() => null);
        if (identity?.phase === 'running') { assert.equal(identity.projectDir, workspace); assert.equal(identity.pid, child.pid); return; }
        await new Promise(done => setTimeout(done, 250));
      }
      throw new Error('安装资源启动超时：' + logs.join(''));
    };
    const stop = async () => { const closed = once(child, 'close'); child.send({ type: 'atelier-shutdown' }); await closed; child = null; };
    const api = async (path, body) => {
      const res = await fetch(`http://127.0.0.1:${ports.gateway}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json(); assert.equal(res.ok, true, JSON.stringify(result)); return result;
    };
    await start();
    assert.match(await (await fetch(`http://127.0.0.1:${ports.gateway}/`)).text(), /NAI Atelier/);
    assert.deepEqual(await api('/api/chains'), []);
    assert.equal((await api('/api/lan/status')).authorized, true);
    const state = await api('/api/prompt-agent/config');
    assert.equal(state.configured, false);
    assert.deepEqual(state.configuredProviders, []);
    const chain = await api('/api/chains', { name: '合成部署验证', basePrompt: 'synthetic test', previewImage: null });
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const saved = await api('/api/local-history', { id: 'synthetic-desktop-history', imageUrl: 'data:image/png;base64,' + png.toString('base64'), prompt: 'synthetic test' });
    const image = await fetch(`http://127.0.0.1:${ports.gateway}${saved.item.imageUrl}`);
    assert.equal(image.ok, true); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    await mkdir(join(workspace, 'public', 'tag-data'), { recursive: true });
    await writeFile(join(workspace, 'public', 'tag-data', 'synthetic.json'), '{"synthetic":true}');
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${ports.gateway}/tag-data/synthetic.json`)).json(), { synthetic: true });
    assert.equal((await api('/api/local-maintenance/desktop-launcher/status')).batPath, exe);
    assert.equal((await fetch(`http://127.0.0.1:${ports.gateway}/api/local-maintenance/desktop-launcher/download`)).status, 409);
    const dictionary = await api('/api/tag-dictionary');
    assert.equal(dictionary.available, true);
    assert.equal(dictionary.manifest.count, 0);
    await stop();
    for (const port of [ports.gateway, ports.worker, ports.tagUpdate, ports.launcher]) assert.equal(await isPortFree(port), true, `未释放 ${port}`);
    await start();
    assert.equal((await api('/api/chains')).find(entry => entry.id === chain.id).name, '合成部署验证');
    const history = await api('/api/local-history');
    assert.equal(history.items.some(entry => entry.id === saved.item.id), true);
    // 模拟桌面父进程意外结束：IPC 断开同样应清理后台整棵进程树。
    const exited = once(child, 'exit'); child.disconnect(); await exited;
    child.stdout.destroy(); child.stderr.destroy(); child = null;
    for (const port of [ports.gateway, ports.worker, ports.tagUpdate, ports.launcher]) assert.equal(await isPortFree(port), true);
    assert.equal(occupied.listening, true);
    await writeFile(join(root, 'verified.json'), JSON.stringify({ exe, ports, persisted: true }));
  } finally {
    if (child && child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* 已退出 */ } }
    await new Promise(done => occupied.close(done));
    removeWorkspace(root);
  }
});
