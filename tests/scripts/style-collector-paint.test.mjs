import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, translate } from '../../locales/index.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';

// 无 Show、无窗口句柄、无消息循环；只编译与验证内存中的 WPF 合成。
test('native collector material: real alpha, light/dark parameters, four themes and solid fallback', { skip: process.platform !== 'win32', timeout: 25_000 }, async t => {
  const root = createWorkspace('collector-paint-');t.after(() => removeWorkspace(root));
  const cupertino = JSON.parse(await readFile(new URL('../../public/themes/cupertino-liquid-glass.json', import.meta.url), 'utf8')).presets[0];
  const materials = Object.fromEntries(['light', 'dark'].map(mode => {
    const d = { ...cupertino.details, ...cupertino.details[mode] };
    return [mode, { kind: d.material, opacity: d.sidebarOpacity, highlight: d.highlight, borderOpacity: d.borderOpacity, controlRadius: d.controlRadius, panelRadius: d.panelRadius, blur: d.blur, saturation: d.saturation, refraction: d.refraction }];
  }));
  const themes = [{ accentColor: '#0ea5e9', surfaces: 'solid', corners: 'standard' }, { ...cupertino, materials, accents: { light: '#007aff', dark: '#0a84ff' } }]
    .flatMap(theme => [false, true].flatMap(isDark => LANGUAGES.map(language => ({ ...theme, isDark, themeMode: isDark ? 'dark' : 'light', motion: 'off', labels: Object.fromEntries(['风格串', '收藏库', '内容库', '待处理', '已保存', '跳过', '失败'].map(label => [label, translate(language.code, label)])) }))));
  const paths = ['../../scripts/style-collector-window.ps1', '../fixtures/collector-view-regression.cs'].map(path => "'" + fileURLToPath(new URL(path, import.meta.url)).replaceAll("'", "''") + "'");
  const script = "$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)\n$assembly=& " + paths[0] + " -LoadOnly | ConvertFrom-Json\n$refs=@($assembly.assembly,'System.Windows.Forms','System.Drawing','System.Web.Extensions','System.Xaml',[System.Windows.Window].Assembly.Location,[System.Windows.Media.Brush].Assembly.Location,[System.Windows.Threading.Dispatcher].Assembly.Location)\nAdd-Type -Path " + paths[1] + " -ReferencedAssemblies $refs\n[CollectorViewRegression]::Run([Console]::In.ReadToEnd())";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, cwd: root, env: { ...process.env, NAI_RESOURCE_ROOT: root }, input: JSON.stringify(themes), encoding: 'utf8', timeout: 22_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stdout, /collector material passed without opening windows: 20/);
});
