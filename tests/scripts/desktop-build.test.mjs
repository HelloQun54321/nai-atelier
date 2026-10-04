import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { builtinModules } from 'node:module';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { RUNTIME_FILES, DESKTOP_FILES, RUNTIME_DEPENDENCIES, createRuntimePackage, isPrivateDistributionPath, isDistributionMetadata, pruneRuntimeMetadata } from '../../scripts/build-desktop.mjs';
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
  for (const name of ['react', 'react-dom', 'lucide-react', 'jszip']) assert.equal(runtime.dependencies[name], undefined);
  // 公开 Node 脚本新增外部 import 时，必须同步安装版直接依赖白名单。
  for (const file of RUNTIME_FILES.filter(name => name.endsWith('.mjs'))) {
    const source = await readFile(new URL('../../' + file, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const name of imports.filter(name => !/^(?:[./]|node:)/.test(name))) {
      const dependency = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (builtinModules.includes(dependency)) continue;
      assert.ok(RUNTIME_DEPENDENCIES.includes(dependency), `${file} 缺少运行依赖 ${dependency}`);
    }
  }
});

test('精简只删除映射和类型声明，保留可执行文件、资源与许可证', async () => {
  const root = createWorkspace('desktop-prune-');
  const deps = join(root, 'node_modules');
  try {
    await mkdir(deps);
    const removed = ['index.js.map', 'module.mjs.map', 'types.d.ts', 'types.d.mts', 'types.d.cts.map'];
    const retained = ['index.js', 'module.mjs', 'native.node', 'library.dll', 'model.onnx', 'LICENSE', 'NOTICE', 'README.md', 'data.map', 'source.ts'];
    for (const file of [...removed, ...retained]) await writeFile(join(deps, file), 'synthetic');
    const report = await pruneRuntimeMetadata(deps);
    assert.equal(report.removedFiles, removed.length);
    assert.equal(report.removedBytes, removed.length * 9);
    for (const file of removed) { assert.equal(isDistributionMetadata(file), true); await assert.rejects(readFile(join(deps, file)), { code: 'ENOENT' }); }
    for (const file of retained) { assert.equal(isDistributionMetadata(file), false); assert.equal(await readFile(join(deps, file), 'utf8'), 'synthetic'); }
    assert.deepEqual(builder.electronLanguages, ['zh-CN', 'en-US']);
  } finally { removeWorkspace(root); }
});

test('安装向导允许选择目录、保留用户数据，原生检查在解包前执行且无下载执行脚本', async () => {
  assert.equal(builder.nsis.oneClick, false);
  assert.equal(builder.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(builder.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(builder.publish, null);
  const installer = await readFile(new URL('../../desktop/installer.nsh', import.meta.url), 'utf8');
  for (const name of ['install-prerequisites.ps1', 'uninstall-integration.ps1']) {
    assert.equal(builder.extraResources.some(entry => entry.from === `desktop/${name}`), false);
    await assert.rejects(readFile(new URL(`../../desktop/${name}`, import.meta.url)), { code: 'ENOENT' });
  }
  assert.doesNotMatch(installer, /powershell|ExecutionPolicy|nsExec/i);
  assert.match(installer, /!macro customInit[\s\S]*Call AtelierCheckRuntime[\s\S]*SetErrorLevel 2/);
  assert.match(installer, /ExecShell "open" "https:\/\/learn\.microsoft\.com\//);
  assert.match(installer, /!insertmacro AtelierUnregisterPixiv/);
});
