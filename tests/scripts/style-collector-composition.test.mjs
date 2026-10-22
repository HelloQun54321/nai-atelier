import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace, projectRoot } from '../support/workspace.mjs';

test('native Composition preserves effects and attaches behind an alpha WPF foreground without showing windows', { skip: process.platform !== 'win32', timeout: 25_000 }, t => {
  const root = createWorkspace('collector-composition-');t.after(() => removeWorkspace(root));
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = "$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n$assembly=& " + quote(join(projectRoot, 'scripts/style-collector-window.ps1')) + " -LoadOnly | ConvertFrom-Json\nif($assembly.cacheError) {throw $assembly.cacheError}\nAdd-Type -Path " + quote(join(projectRoot, 'tests/fixtures/collector-composition-regression.cs')) + " -ReferencedAssemblies @($assembly.assembly,'System.Xaml','System.Web.Extensions',[System.Numerics.Vector2].Assembly.Location,[System.Windows.Window].Assembly.Location,[System.Windows.Media.Brush].Assembly.Location,[System.Windows.Threading.Dispatcher].Assembly.Location)\ntry { [CollectorCompositionRegression]::Run(); [CollectorCompositionRegression]::RunWindowAttachment() } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, cwd: root, env: { ...process.env, NAI_RESOURCE_ROOT: root }, encoding: 'utf8', timeout: 22_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stdout, /composition effects passed without a window or screen capture/);
  assert.match(result.stdout, /hidden native attachment passed without showing windows or capturing screen/);
});
