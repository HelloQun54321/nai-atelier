import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, projectRoot, removeWorkspace } from '../support/workspace.mjs';

// 使用打包时已取得的编译器，不为普通离线测试联网下载 NSIS。
const findCompiler = () => {
  if (process.platform !== 'win32') return undefined;
  const cache = process.env.ELECTRON_BUILDER_CACHE || join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache');
  if (!existsSync(cache)) return undefined;
  for (const entry of readdirSync(cache, { recursive: true })) {
    if (entry.endsWith('makensis.exe') && !entry.includes('Bin')) return join(cache, entry);
  }
};
const compiler = findCompiler();

test('实际 NSIS 运行库分支与卸载协议归属：合成注册表、边界版本、缺失 DLL、他人注册', { skip: !compiler, timeout: 20_000 }, () => {
  const root = createWorkspace('desktop-nsis-');
  const key = `Software\\NAI Atelier\\Tests\\${randomUUID()}`;
  const executable = join(root, 'installer-test.exe');
  try {
    const args = ['/V2', '/INPUTCHARSET', 'UTF8', `/DATELIER_PROJECT=${projectRoot}`, `/DATELIER_TEST_EXE=${executable}`, `/DATELIER_TEST_KEY=${key}`, '/DATELIER_VC_HIVE=HKCU', `/DATELIER_VC_KEY=${key}\\vc`, `/DATELIER_PIXIV_KEY=${key}\\pixiv`, `/DATELIER_DLL_DIR=${join(root, '合成 DLL')}`, join(projectRoot, 'tests', 'fixtures', 'desktop-installer.nsi')];
    const compiled = spawnSync(compiler, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(executable, [], { windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0, `原生安装检查回归分支 ${result.status}：${result.error || ''}`);
    const missingDirectory = join(root, '尚未解包');
    const missingArgs = args.map(arg => arg.startsWith('/DATELIER_DLL_DIR=') ? `/DATELIER_DLL_DIR=${missingDirectory}` : arg);
    missingArgs.splice(-1, 0, '/DATELIER_TEST_MISSING=1');
    const missingCompiled = spawnSync(compiler, missingArgs, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(missingCompiled.status, 0, missingCompiled.stdout + missingCompiled.stderr);
    assert.equal(spawnSync(executable, [], { windowsHide: true, timeout: 10_000 }).status, 2, '缺失运行库在安装前明确退出');
    assert.equal(existsSync(missingDirectory), false, '检查失败不应执行安装节');
  } finally {
    // 只清理本次 GUID 的合成测试注册，不修改真实运行库／协议或用户资料。
    spawnSync(join(process.env.SystemRoot, 'System32', 'reg.exe'), ['delete', `HKCU\\${key}`, '/f', '/reg:64'], { windowsHide: true });
    removeWorkspace(root);
  }
});
