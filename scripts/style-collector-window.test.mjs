import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// 自测不注册系统剪贴板，使用独立合成事件；不读取、覆盖或备份真实剪贴板内容。
test('Windows native window protocol, pause baselines, screen clamp, topmost and no activation', { skip: process.platform !== 'win32', timeout: 20_000 }, async t => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./style-collector-window.ps1', import.meta.url)), '-SelfTest'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const events = []; let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  createInterface({ input: child.stdout }).on('line', line => { try { events.push(JSON.parse(line)); } catch { /* PowerShell 编译输出。 */ } });
  const until = async predicate => {
    for (let i = 0; i < 500; i++) { if (predicate()) return; if (child.exitCode !== null) throw new Error(errors || 'Native helper exited'); await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error(errors || 'Native protocol timeout');
  };
  const send = (command, extra = {}) => child.stdin.write(JSON.stringify({ command, session: 'synthetic-session', ...extra }) + '\n');
  await until(() => events.some(e => e.type === 'ready'));
  send('inject', { session: '', text: 'https://example.com/preexisting.png', id: 'before' });
  await until(() => events.some(e => e.id === 'before'));
  send('start', { position: { x: 999999, y: -999999, collapsed: false } });
  await until(() => events.some(e => e.type === 'window'));
  assert.deepEqual(events.find(e => e.type === 'window'), { type: 'window', session: 'synthetic-session', noActivate: true, topMost: true, foreground: false, visiblePosition: true, collapsed: false, height: 122, detail: '', detailVisible: true, detailEllipsis: true });
  const detail = '失败：图片访问被拒绝 (403)，链接可能过期，请重新复制';
  send('state', { state: { saved: 0, paused: false, stage: '等待复制图片链接', pending: 0, skipped: 0, failed: 1, detail }, id: 'detail' });
  await until(() => events.some(e => e.id === 'detail'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).detail, detail);
  assert.equal(events.filter(e => e.type === 'window').at(-1).foreground, false);
  send('inject', { text: 'ordinary copied text' });
  send('inject', { text: 'https://example.com/first.png?signature=keep' });
  send('pause', { id: 'paused' }); await until(() => events.some(e => e.id === 'paused'));
  send('inject', { text: 'https://example.com/paused.png' });
  send('resume', { id: 'resumed' }); await until(() => events.some(e => e.id === 'resumed'));
  send('inject', { text: 'https://example.com/new.png' }); send('collapse', { id: 'collapsed' });
  await until(() => events.some(e => e.id === 'collapsed'));
  assert.deepEqual(events.filter(e => e.type === 'link').map(e => e.url), ['https://example.com/first.png?signature=keep', 'https://example.com/new.png']);
  assert.equal(events.filter(e => e.type === 'window').at(-1).height, 43);
  assert.equal(events.filter(e => e.type === 'window').at(-1).detailVisible, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).foreground, false);
  send('stop'); await until(() => child.exitCode !== null);
  assert.equal(child.exitCode, 0); assert.ok(events.some(e => e.type === 'stop'));
});
