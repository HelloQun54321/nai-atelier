import { CUPERTINO_WALLPAPERS, normalizeThemeBackground } from '../../services/themeBackgroundData.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadCollectorWallpapers } from '../../scripts/style-collector.mjs';
import { createWorkspace, removeWorkspace, projectRoot } from '../support/workspace.mjs';
const backgrounds = Object.fromEntries(Object.entries(CUPERTINO_WALLPAPERS).map(([mode, image]) => [mode, normalizeThemeBackground({ image })]));


test('wallpaper display copies are moderately compressed and cached without changing original files', async () => {
  const images = await loadCollectorWallpapers(backgrounds);
  assert.deepEqual(await loadCollectorWallpapers(backgrounds), images);
  for (const mode of ['light', 'dark']) {
    const meta = await sharp(Buffer.from(images[mode], 'base64')).metadata();
    assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 1280); assert.equal(meta.height, Math.round(941 * 1280 / 1672));
    assert.ok(Buffer.from(images[mode], 'base64').length < 200_000);
  }
  assert.notEqual(images.light, images.dark);
});

test('custom images keep their pixels and aspect ratio; removal and invalid sources cannot retain old images', async () => {
  const bytes = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#a34c25' } }).png().toBuffer();
  const image = 'data:image/png;base64,' + bytes.toString('base64');
  const images = await loadCollectorWallpapers({ light: { image, fit: 'contain', opacity: 0, tileSize: 128 }, dark: null });
  const result = await sharp(Buffer.from(images.light, 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.equal(result.info.width, 40); assert.equal(result.info.height, 20);
  assert.deepEqual([...result.data.subarray(0, 4)], [163, 76, 37, 255]);
  assert.equal(images.dark, '');
  for (const invalid of ['https://example.invalid/private', 'file:///private.png', '/themes/wallpapers/../../private', 'data:image/png;base64,YmFk']) {
    assert.deepEqual(await loadCollectorWallpapers({ light: { image: invalid } }), { light: '', dark: '' });
  }
  assert.deepEqual(await loadCollectorWallpapers({}), { light: '', dark: '' });
});

test('large transparent uploads are resized moderately while preserving alpha and source bytes', async () => {
  const bytes = await sharp({ create: { width: 2560, height: 1280, channels: 4, background: { r: 160, g: 90, b: 40, alpha: .5 } } }).png().toBuffer();
  const original = Buffer.from(bytes);
  const images = await loadCollectorWallpapers({ light: { image: 'data:image/png;base64,' + bytes.toString('base64') } });
  const decoded = sharp(Buffer.from(images.light, 'base64'));
  const meta = await decoded.metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.width, 1280); assert.equal(meta.height, 640); assert.equal(meta.hasAlpha, true);
  const pixel = await decoded.extract({ left: 640, top: 320, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(pixel[3] >= 127 && pixel[3] <= 128);
  assert.deepEqual(bytes, original);
});

test('hidden wallpaper window follows system theme, collapse and controls without a desktop backdrop', { skip: process.platform !== 'win32', timeout: 25_000 }, async t => {
  const root = createWorkspace('collector-wallpaper-'); t.after(() => removeWorkspace(root));
  const preset = JSON.parse(await readFile(new URL('../../public/themes/cupertino-liquid-glass.json', import.meta.url), 'utf8')).presets[0];
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = "$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n$assembly=& " + quote(join(projectRoot, 'scripts/style-collector-window.ps1')) + " -LoadOnly | ConvertFrom-Json\nAdd-Type -Path " + quote(join(projectRoot, 'tests/fixtures/collector-wallpaper-window.cs')) + " -ReferencedAssemblies @($assembly.assembly,'System.Xaml','System.Web.Extensions',[System.Windows.Window].Assembly.Location,[System.Windows.Media.Brush].Assembly.Location,[System.Windows.Threading.Dispatcher].Assembly.Location)\n[CollectorWallpaperWindow]::Run([Console]::In.ReadToEnd())";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, cwd: root, env: { ...process.env, NAI_RESOURCE_ROOT: root }, input: JSON.stringify({ appearance: { ...preset, backgrounds }, wallpapers: await loadCollectorWallpapers(backgrounds) }), encoding: 'utf8', timeout: 22_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stdout, /hidden wallpaper window passed/);
});
