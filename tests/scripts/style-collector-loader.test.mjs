import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace, projectRoot } from '../support/workspace.mjs';

test('collector loader reuses assemblies, invalidates changed source and repairs bad cache without showing a window', { skip: process.platform !== 'win32', timeout: 25_000 }, t => {
  const root = createWorkspace('collector-loader-');
  t.after(() => removeWorkspace(root));
  for (const file of ['style-collector-window.ps1', 'style-collector-window.cs', 'style-collector-view.cs', 'style-collector-composition.cs']) copyFileSync(join(projectRoot, 'scripts', file), join(root, file));
  const load = resourceRoot => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'style-collector-window.ps1'), '-LoadOnly'], { windowsHide: true, cwd: root, env: { ...process.env, NAI_RESOURCE_ROOT: resourceRoot }, encoding: 'utf8', timeout: 8000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    return JSON.parse(result.stdout.trim());
  };
  const cold = load(root), warm = load(root);
  assert.equal(cold.cacheHit, false); assert.equal(warm.cacheHit, true); assert.equal(warm.assembly, cold.assembly);
  appendFileSync(join(root, 'style-collector-view.cs'), '\n// synthetic cache invalidation\n');
  const changed = load(root); assert.equal(changed.cacheHit, false); assert.notEqual(changed.assembly, cold.assembly);
  writeFileSync(changed.assembly, 'synthetic corrupt assembly');
  assert.equal(load(root).cacheHit, false); assert.equal(load(root).cacheHit, true);
  const blocked = join(root, 'not-a-directory'); writeFileSync(blocked, 'synthetic');
  assert.equal(load(blocked).cacheHit, false);
  t.diagnostic(`assembly loading only: cold ${cold.loadMs} ms, warm ${warm.loadMs} ms; no window or clipboard listener`);
});
