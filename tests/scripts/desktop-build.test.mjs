import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RUNTIME_FILES, DESKTOP_FILES, createRuntimePackage, isPrivateDistributionPath } from '../../scripts/build-desktop.mjs';
import builder from '../../desktop/builder.config.mjs';

test('分发边界识别数据、缓存、词库、环境变量与测试资料，公开运行文件均不落保护区', async () => {
  for (const name of ['local-data/prompt-agent.key', 'PUBLIC/TAG-DATA/tags.json', 'x\\local-cache\\model.onnx', '.env.local', '.dev.vars', '.git/config', 'logs/tests/gateway.log', 'tests/fixtures/synthetic.json', '.wrangler/tmp/test']) assert.equal(isPrivateDistributionPath(name), true, name);
  for (const name of RUNTIME_FILES) {
    assert.equal(isPrivateDistributionPath(name), false, name);
    await readFile(new URL('../../' + name, import.meta.url));
  }
  assert.deepEqual(DESKTOP_FILES, ['main.mjs', 'preload.cjs', 'startup.html', 'startup.js']);
});

test('桌面运行依赖锁文件单独维护，不带开发工具，版本跟随根包', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  const overrides = JSON.parse(await readFile(new URL('../../desktop/runtime-dependencies.json', import.meta.url)));
  const runtime = createRuntimePackage(pkg, overrides);
  const lock = JSON.parse(await readFile(new URL('../../desktop/runtime-package-lock.json', import.meta.url)));
  assert.deepEqual(runtime.dependencies, lock.packages[''].dependencies);
  assert.equal(runtime.version, pkg.version);
  assert.equal(runtime.devDependencies, undefined);
  assert.equal(runtime.dependencies.electron, undefined);
  assert.equal(runtime.dependencies.wrangler, overrides.wrangler);
  assert.deepEqual(runtime.scripts, {});
});

test('安装向导允许选择目录，卸载保留用户数据，辅助脚本来自稳定安装资源', async () => {
  assert.equal(builder.nsis.oneClick, false);
  assert.equal(builder.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(builder.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(builder.publish, null);
  const installer = await readFile(new URL('../../desktop/installer.nsh', import.meta.url), 'utf8');
  for (const name of ['install-prerequisites.ps1', 'uninstall-integration.ps1']) {
    assert.ok(builder.extraResources.some(entry => entry.from === `desktop/${name}` && entry.to === name));
    assert.ok(installer.includes(`$INSTDIR\\resources\\${name}`));
    const script = await readFile(new URL(`../../desktop/${name}`, import.meta.url));
    assert.deepEqual([...script.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5 需要 UTF-8 BOM');
  }
  assert.equal(installer.includes('$PLUGINSDIR'), false);
});
