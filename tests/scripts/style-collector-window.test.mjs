import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, translate } from '../../locales/index.mjs';

// 自测不注册系统剪贴板，使用独立合成事件；不读取、覆盖或备份真实剪贴板内容。
test('Windows native window protocol, pause baselines, screen clamp, topmost and no activation', { skip: process.platform !== 'win32', timeout: 20_000 }, async t => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../../scripts/style-collector-window.ps1', import.meta.url)), '-SelfTest', '-AppearanceJson', JSON.stringify({ themeMode: 'dark', isDark: true, accentColor: '#0ea5e9', motion: 'full' })], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
  assert.deepEqual(events.find(e => e.type === 'window'), { type: 'window', session: 'synthetic-session', noActivate: true, topMost: true, foreground: false, visiblePosition: true, collapsed: false, height: 122, detail: '', detailVisible: true, detailEllipsis: true,
    title: '收集中', breathing: false, processing: false, tooltipWhileInactive: true, failureHint: false, failureTooltip: '', rounded: true, counters: { pending: 0, saved: 0, skipped: 0, failed: 0 },
    pauseTextFits: true, metricLabelsFit: true,
    appearance: { themeMode: 'dark', dark: true, accent: '#0EA5E9', background: '#171B24', foreground: '#F0F2F8', muted: '#939DB5', failure: '#DE999D', motion: 'full' } });
  const detail = '失败：图片访问被拒绝 (403)，链接可能过期，请重新复制';
  send('state', { state: { saved: 0, paused: false, stage: '等待复制图片链接', pending: 0, skipped: 0, failed: 1, detail }, id: 'detail' });
  await until(() => events.some(e => e.id === 'detail'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).detail, detail);
  assert.equal(events.filter(e => e.type === 'window').at(-1).foreground, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).breathing, false);
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
  assert.equal(events.filter(e => e.type === 'window').at(-1).failureHint, true);
  assert.equal(events.filter(e => e.type === 'window').at(-1).failureTooltip, detail);
  assert.equal(events.filter(e => e.type === 'window').at(-1).title, '收集中 · 已保存 0');
  const appearance = { themeMode: 'light', isDark: false, accentColor: '#8b5cf6', motion: 'off' };
  send('state', { state: { saved: 0, paused: false, stage: '等待复制图片链接', pending: 0, skipped: 0, failed: 1, detail, appearance }, id: 'light-theme' });
  await until(() => events.some(e => e.id === 'light-theme'));
  const lightWindow = events.filter(e => e.type === 'window').at(-1);
  assert.deepEqual(lightWindow.appearance, { themeMode: 'light', dark: false, accent: '#8B5CF6', background: '#FFFFFF', foreground: '#171E2D', muted: '#6F7A90', failure: '#AF414D', motion: 'off' });
  assert.equal(lightWindow.failureHint, true); assert.equal(lightWindow.failureTooltip, detail); assert.equal(lightWindow.foreground, false);
  const base = { saved: 4, paused: false, stage: '正在下载图片', pending: 2, skipped: 1, failed: 1, detail: '处理：synthetic.png' };
  send('state', { state: base, id: 'busy' }); await until(() => events.some(e => e.id === 'busy'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).processing, true);
  assert.equal(events.filter(e => e.type === 'window').at(-1).breathing, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).failureHint, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).failureTooltip, '');
  assert.deepEqual(events.filter(e => e.type === 'window').at(-1).counters, { pending: 2, saved: 4, skipped: 1, failed: 1 });
  assert.equal(events.filter(e => e.type === 'window').at(-1).title, '收集中 · 已保存 4');
  send('state', { state: { ...base, paused: true }, id: 'paused-busy' }); await until(() => events.some(e => e.id === 'paused-busy'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).breathing, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).processing, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).title, '已暂停 · 已保存 4');
  send('collapse', { id: 'expanded' }); await until(() => events.some(e => e.id === 'expanded'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).height, 122);
  assert.equal(events.filter(e => e.type === 'window').at(-1).detailVisible, true);
  assert.equal(events.filter(e => e.type === 'window').at(-1).visiblePosition, true);
  send('state', { state: { ...base, stage: '等待复制图片链接' }, id: 'idle' }); await until(() => events.some(e => e.id === 'idle'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).breathing, false);
  assert.equal(events.filter(e => e.type === 'window').at(-1).foreground, false);
  send('state', { state: { ...base, appearance: { ...appearance, themeMode: 'system', motion: 'full' } }, id: 'system-mode' });
  await until(() => events.some(e => e.id === 'system-mode'));
  for (const dark of [false, true]) {
    send('system-theme', { dark, id: 'system-' + dark }); await until(() => events.some(e => e.id === 'system-' + dark));
    const current = events.filter(e => e.type === 'window').at(-1);
    assert.equal(current.appearance.dark, dark); assert.equal(current.appearance.accent, '#8B5CF6'); assert.equal(current.foreground, false);
    assert.deepEqual(current.counters, { pending: 2, saved: 4, skipped: 1, failed: 1 });
  }
  send('state', { state: { ...base, appearance }, id: 'explicit-light' }); await until(() => events.some(e => e.id === 'explicit-light'));
  send('system-theme', { dark: true, id: 'ignore-system' }); await until(() => events.some(e => e.id === 'ignore-system'));
  assert.equal(events.filter(e => e.type === 'window').at(-1).appearance.dark, false);
  for (const language of LANGUAGES) {
    const labels = Object.fromEntries(['收集中', '已暂停', ' · 已保存 ', '失败：', '暂停', '继续', '待处理', '已保存', '跳过', '失败'].map(message => [message, translate(language.code, message)]));
    send('state', { state: { ...base, rawStage: base.stage, stage: translate(language.code, base.stage), appearance: { ...appearance, language: language.code, labels } }, id: 'language-' + language.code });
    await until(() => events.some(e => e.id === 'language-' + language.code));
    const current = events.filter(e => e.type === 'window').at(-1);
    assert.equal(current.title, translate(language.code, '收集中'));
    assert.equal(current.processing, true);
    assert.deepEqual(current.counters, { pending: 2, saved: 4, skipped: 1, failed: 1 });
    assert.equal(current.foreground, false);
    assert.equal(current.pauseTextFits, true, language.code+' pause');
    assert.equal(current.metricLabelsFit, true, language.code+' metrics');
  }
  send('stop'); await until(() => child.exitCode !== null);
  assert.equal(child.exitCode, 0); assert.ok(events.some(e => e.type === 'stop'));
});
