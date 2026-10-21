import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, translate } from '../../locales/index.mjs';

// 自测不注册系统剪贴板，使用独立合成事件；不读取、覆盖或备份真实剪贴板内容。
test('native collector: fixed modes, automatic text intake, file copies and both builtin themes', { skip: process.platform !== 'win32', timeout: 30_000 }, async t => {
  const defaults = { themeMode: 'dark', isDark: true, accentColor: '#0ea5e9', motion: 'full', surfaces: 'solid', corners: 'standard' };
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../../scripts/style-collector-window.ps1', import.meta.url)), '-SelfTest', '-AppearanceJson', JSON.stringify(defaults)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const events = []; let errors = '', nextId = 0;
  child.stderr.on('data', chunk => { errors += chunk; });
  createInterface({ input: child.stdout }).on('line', line => { try { events.push(JSON.parse(line)); } catch { /* PowerShell 编译输出。 */ } });
  const until = async predicate => {
    for (let i = 0; i < 700; i++) { if (predicate()) return; if (child.exitCode !== null) throw new Error(errors || 'Native helper exited'); await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error(errors || JSON.stringify(events.at(-1)) || 'Native protocol timeout');
  };
  const send = async (command, extra = {}) => {
    const id = String(++nextId); child.stdin.write(JSON.stringify({ command, session: 'synthetic-session', ...extra, id }) + '\n');
    await until(() => events.some(e => e.id === id));
  };
  const window = () => events.filter(e => e.type === 'window').at(-1);
  const base = { saved: 0, paused: false, stage: '等待复制图片或图片链接', pending: 0, skipped: 0, failed: 0, detail: '' };
  const setState = (state = {}) => send('state', { state: { ...base, ...state } });
  await until(() => events.some(e => e.type === 'ready'));
  await send('inject', { session: '', text: 'https://example.com/preexisting.png' });
  await send('start', { position: { x: 999999, y: -999999, collapsed: false } }); await setState();
  assert.equal(window().noActivate, true); assert.equal(window().topMost, true); assert.equal(window().foreground, false);
  assert.equal(window().visiblePosition, true); assert.equal(window().rounded, true); assert.equal(window().labelsFit, true);
  assert.equal(window().width, 384); assert.equal(window().height, 232); assert.equal(window().editableFields, 0);
  assert.equal(window().title, '收集中'); assert.equal(window().mode, 'style');
  await send('inject', { text: 'ordinary text' }); await send('inject', { text: 'https://example.com/first.png?signature=keep' });
  await send('pause'); await send('inject', { text: 'https://example.com/paused.png' });
  await send('resume'); await send('inject', { text: 'https://example.com/new.png' });
  assert.deepEqual(events.filter(e => e.type === 'link').map(e => e.url), ['https://example.com/first.png?signature=keep', 'https://example.com/new.png']);
  assert.equal(events.filter(e => e.type === 'text').length, 0);
  await send('inject-image', { image: 'AQID' }); await send('mode', { mode: 'collection' });
  assert.equal(window().height, 232); assert.equal(window().width, 384);
  await send('inject-image', { image: 'AQID' }); await send('inject', { text: 'https://example.com/collection.png' });
  assert.deepEqual(events.filter(e => e.type === 'image').map(e => e.mode), ['style', 'collection']);
  assert.equal(events.filter(e => e.type === 'link').at(-1).mode, 'collection');
  const files = ['C:\\synthetic\\桌面 原图.PNG', 'C:\\synthetic\\second.webp'];
  await send('inject-files', { paths: [...files, 'C:\\synthetic\\notes.txt', 'C:\\synthetic\\folder', 'relative.png'] });
  assert.deepEqual(events.filter(e => e.type === 'file').map(e => ({ path: e.path, mode: e.mode })), files.map(path => ({ path, mode: 'collection' })));
  await send('pause'); await send('inject-files', { paths: files }); await send('inject-image', { image: 'AQID' });
  assert.equal(events.filter(e => e.type === 'file').length, 2); assert.equal(events.filter(e => e.type === 'image').length, 2);

  await send('mode', { mode: 'content' });
  assert.equal(window().height, 232); assert.equal(window().width, 384); assert.equal(window().editableFields, 0);
  await send('inject', { text: 'ignored while paused' }); assert.equal(events.filter(e => e.type === 'text').length, 0);
  await send('resume');
  const original = '  {snow}, 1.2::blue hair::\r\n[smile]  ';
  await send('inject', { text: original }); await send('category', { category: 'appearance' }); await send('inject', { text: 'second prompt' });
  assert.deepEqual(events.filter(e => e.type === 'text').map(e => [e.text, e.category]), [[original, ''], ['second prompt', 'appearance']]);
  await send('inject-image', { image: 'AQID' }); await send('inject-files', { paths: files }); await send('inject', { text: '   ' });
  assert.equal(events.filter(e => e.type === 'image').length, 2); assert.equal(events.filter(e => e.type === 'file').length, 2); assert.equal(events.filter(e => e.type === 'text').length, 2);
  await send('mode', { mode: 'style' }); await send('inject', { text: 'ignored in style mode' }); await send('inject-files', { paths: files });
  assert.equal(events.filter(e => e.type === 'text').length, 2); assert.deepEqual(events.filter(e => e.type === 'file').slice(2).map(e => e.mode), ['style', 'style']);
  await send('mode', { mode: 'content' }); assert.equal(window().category, 'appearance');

  const longDetail = '失败：连接中断，' + '请检查网络后重新复制。'.repeat(10);
  await setState({ failed: 1, detail: longDetail }); assert.equal(window().detailTooltip, longDetail); assert.equal(window().foreground, false);
  await send('collapse'); assert.equal(window().height, 44); assert.equal(window().detailVisible, false); assert.match(window().titleTooltip, /失败：连接中断/); assert.equal(window().title, '收集中 · 内容库');
  await send('collapse'); assert.equal(window().height, 232); assert.equal(window().visiblePosition, true);
  await setState({ saved: 4, pending: 2, skipped: 1, failed: 1, stage: '正在收录提示词', detail: '已收录：雪天' });
  assert.equal(window().processing, true); assert.deepEqual(window().counters, { pending: 2, saved: 4, skipped: 1, failed: 1 });
  await setState({ paused: true, stage: '正在收录提示词' }); assert.equal(window().processing, false); assert.equal(window().breathing, false);

  const cupertino = JSON.parse(await readFile(new URL('../../public/themes/cupertino-liquid-glass.json', import.meta.url), 'utf8')).presets[0];
  const themes = [defaults, { ...cupertino, accents: { light: cupertino.details.light.accentColor, dark: cupertino.details.dark.accentColor } }];
  const luminance = hex => { const rgb = hex.slice(1).match(/../g).map(h => parseInt(h, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
  for (const [index, theme] of themes.entries()) for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    await setState({ appearance: { ...theme, themeMode: mode, isDark: dark } });
    const a = window().appearance;
    assert.equal(a.dark, dark); assert.equal(a.surfaces, theme.surfaces); assert.equal(a.radius, index ? 18 : 16);
    assert.equal(a.background, (theme.palette?.[mode].panel || (dark ? '#171b24' : '#ffffff')).toUpperCase());
    assert.equal(a.accent, (theme.accents?.[mode] || theme.accentColor).toUpperCase());
    const levels = [luminance(a.selectedFill), luminance(a.selectedText)].sort((x, y) => y - x);
    assert.ok((levels[0] + .05) / (levels[1] + .05) >= 4.5, 'selected text contrast');
    assert.equal(window().height, 232); assert.equal(window().width, 384); assert.equal(window().labelsFit, true); assert.equal(window().foreground, false);
  }
  await setState({ appearance: { ...themes[1], themeMode: 'system', isDark: false } });
  for (const dark of [true, false]) { await send('system-theme', { dark }); assert.equal(window().appearance.dark, dark); assert.equal(window().appearance.accent, dark ? '#0A84FF' : '#007AFF'); }
  await setState({ appearance: { ...defaults, themeMode: 'light', isDark: false, motion: 'off' }, stage: '正在收录提示词' });
  await send('system-theme', { dark: true }); assert.equal(window().appearance.dark, false); assert.equal(window().appearance.background, '#FFFFFF'); assert.equal(window().breathing, false);
  for (const language of LANGUAGES) {
    const labels = Object.fromEntries(['收集中', '已暂停', ' · 已保存 ', '失败：', '暂停', '继续', '待处理', '已保存', '跳过', '失败', '风格串', '收藏库', '内容库', '存入', '组合库'].map(message => [message, translate(language.code, message)]));
    const failure = translate(language.code, '失败：保存失败，请重新复制');
    await setState({ failed: 1, detail: failure, rawStage: '正在收录提示词', stage: translate(language.code, '正在收录提示词'), appearance: { ...defaults, labels } });
    assert.equal(window().title, translate(language.code, '收集中')); assert.equal(window().processing, true); assert.equal(window().labelsFit, true, language.code + ' labels'); assert.equal(window().foreground, false);
    const width = window().width;
    for (const mode of ['style', 'collection', 'content']) { await send('mode', { mode }); assert.equal(window().width, width); assert.equal(window().height, 232); }
    await send('collapse'); assert.ok(window().titleTooltip.includes(failure)); await send('collapse');
  }
  child.stdin.write(JSON.stringify({ command: 'stop', session: 'synthetic-session' }) + '\n');
  await until(() => child.exitCode !== null); assert.equal(child.exitCode, 0); assert.ok(events.some(e => e.type === 'stop'));
});
