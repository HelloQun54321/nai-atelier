import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ResEdit from 'resedit';
import { createWorkspace, projectRoot, removeWorkspace } from '../support/workspace.mjs';

test('应用 ICO 保留高清 PNG，小尺寸使用 Windows 可提取的 32 位位图，三个入口一致', async () => {
  const root = createWorkspace('app-icon-');
  try {
    await mkdir(join(root, 'public'));
    execFileSync(process.execPath, [join(projectRoot, 'scripts/generate-app-icon.mjs')], { cwd: root, windowsHide: true, stdio: 'pipe', timeout: 15_000 });
    const bytes = await readFile(join(root, 'public/nai-atelier.ico'));
    for (const name of ['nai-atelier.ico', 'app-icon.ico', 'artist-palette-3d.ico']) {
      assert.deepEqual(await readFile(join(root, 'public', name)), bytes);
      assert.deepEqual(await readFile(join(projectRoot, 'public', name)), bytes, `${name} 必须同步生成`);
    }
    const icon = ResEdit.Data.IconFile.from(bytes);
    assert.deepEqual(icon.icons.map(item => item.data.width), [256, 128, 64, 48, 32, 16]);
    assert.equal(icon.icons[0].data.isRaw(), true);
    for (const { data } of icon.icons.slice(1)) {
      assert.equal(data.isIcon(), true, `${data.width}px 必须是 Windows 原生位图`);
      assert.equal(data.bitmapInfo.bitCount, 32);
      assert.equal(data.bitmapInfo.height, data.height * 2);
      const pixels = new Uint8Array(data.pixels);
      // 图标中央是晴空蓝，透明角落同时保留 alpha 与传统 AND 蒙版。
      const center = (Math.floor(data.height / 2) * data.width + Math.floor(data.width / 2)) * 4;
      assert.ok(pixels[center] > pixels[center + 2]);
      assert.equal(pixels[center + 3], 255);
      assert.equal(pixels[3], 0);
      assert.ok(new Uint8Array(data.masks)[0] & 0x80);
    }
    if (process.platform === 'win32') {
      const file = join(root, 'public/nai-atelier.ico');
      const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class IconCheck {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern uint ExtractIconEx(string path, int index, out IntPtr large, out IntPtr small, uint count);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
$large = [IntPtr]::Zero; $small = [IntPtr]::Zero
$count = [IconCheck]::ExtractIconEx($env:NAI_TEST_ICON_PATH, 0, [ref]$large, [ref]$small, 1)
try { if ($count -ne 1 -or $large -eq [IntPtr]::Zero -or $small -eq [IntPtr]::Zero) { throw 'Windows 无法提取应用图标' } }
finally { if ($large -ne [IntPtr]::Zero) { [void][IconCheck]::DestroyIcon($large) }; if ($small -ne [IntPtr]::Zero) { [void][IconCheck]::DestroyIcon($small) } }`;
      execFileSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, NAI_TEST_ICON_PATH: file }, windowsHide: true, stdio: 'pipe', timeout: 15_000 });
    }
  } finally { removeWorkspace(root); }
});
