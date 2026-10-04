import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { DESKTOP_APP_ID, prepareDesktopWorkspace, findDesktopPorts, desktopServerOptions, isDesktopNavigation, isExternalWebLink } from '../../scripts/desktop-runtime.mjs';

const fixture = async () => {
  const root = createWorkspace('desktop-runtime-');
  const runtime = join(root, '程序 中文 空格'), data = join(root, '个人数据');
  for (const folder of ['dist', 'public', 'sillytavern-extension/npm-bridge']) await mkdir(join(runtime, folder), { recursive: true });
  for (const [name, content] of Object.entries({ 'node.exe': 'synthetic', 'dist/_worker.js': 'synthetic', 'package.json': JSON.stringify({ version: 'synthetic' }), 'public/nai-atelier.ico': 'synthetic', 'sillytavern-extension/npm-bridge/index.js': 'synthetic', 'wrangler.toml': 'database_name = "nai-db"\ndatabase_id = "synthetic-storage-key"\nbucket_name = "nai-assets"\n' })) await writeFile(join(runtime, name), content);
  return { root, runtime, data };
};

test('安装版新建独立工作区，重复准备保留合成资产、缓存与词库，存储配置原样复制', async () => {
  const f = await fixture();
  try {
    const first = await prepareDesktopWorkspace(f.runtime, f.data);
    assert.equal(first.workspace, join(f.data, 'workspace'));
    assert.equal(await readFile(join(first.workspace, 'wrangler.toml'), 'utf8'), await readFile(join(f.runtime, 'wrangler.toml'), 'utf8'));
    assert.equal(JSON.parse(await readFile(join(first.workspace, 'desktop-workspace.json'))).appId, DESKTOP_APP_ID);
    assert.ok(!(await readdir(first.workspace)).includes('local-data'));
    for (const name of ['local-data', 'local-cache', 'public/tag-data']) {
      await mkdir(join(first.workspace, name), { recursive: true });
      await writeFile(join(first.workspace, name, 'synthetic.txt'), '保留');
    }
    await prepareDesktopWorkspace(f.runtime, f.data);
    for (const name of ['local-data', 'local-cache', 'public/tag-data']) assert.equal(await readFile(join(first.workspace, name, 'synthetic.txt'), 'utf8'), '保留');
  } finally { removeWorkspace(f.root); }
});

test('拒绝程序内数据目录、相对路径和已有未知工作区，不覆盖内容', async () => {
  const f = await fixture();
  try {
    await assert.rejects(prepareDesktopWorkspace(f.runtime, 'relative'), /绝对路径/);
    await assert.rejects(prepareDesktopWorkspace(f.runtime, join(f.runtime, 'data')), /程序运行目录/);
    const workspace = join(f.data, 'workspace');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'existing.txt'), '保留');
    await assert.rejects(prepareDesktopWorkspace(f.runtime, f.data), /未识别/);
    await writeFile(join(workspace, 'desktop-workspace.json'), '{invalid');
    await assert.rejects(prepareDesktopWorkspace(f.runtime, f.data), /标记损坏/);
    await writeFile(join(workspace, 'desktop-workspace.json'), JSON.stringify({ appId: 'other' }));
    await assert.rejects(prepareDesktopWorkspace(f.runtime, f.data), /其他应用/);
    assert.equal(await readFile(join(workspace, 'existing.txt'), 'utf8'), '保留');
  } finally { removeWorkspace(f.root); }
});

test('端口冲突重新选择一组端口，所有端口不可用时报告错误', async () => {
  const calls = [];
  const ports = await findDesktopPorts({ available: async port => { calls.push(port); return port !== 3002; } });
  assert.deepEqual(ports, { gateway: 3010, worker: 3011, tagUpdate: 3012, launcher: 3013 });
  assert.deepEqual(calls, [3000, 3002, 3003, 3010, 3012, 3013]);
  await assert.rejects(findDesktopPorts({ preferred: 65000, available: async () => false }), /可用/);
});

test('启动使用内置 Node 与绝对路径，清理继承的旧项目变量，动态端口一致', () => {
  const ports = { gateway: 3010, worker: 3011, tagUpdate: 3012, launcher: 3013 };
  const spec = desktopServerOptions({ runtimeRoot: 'D:\\安装 中文', workspace: 'D:\\数据 空格', executable: 'D:\\安装 中文\\NAI Atelier.exe', documents: 'D:\\文档', ports, env: { PATH: 'Windows-only', NAI_KEY: 'must-not-inherit', NODE_OPTIONS: 'bad', ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(spec.command, join('D:\\安装 中文', 'node.exe'));
  assert.deepEqual(spec.args, ['--no-warnings', join('D:\\安装 中文', 'scripts/local-server.mjs')]);
  assert.equal(spec.options.cwd, 'D:\\数据 空格');
  assert.equal(spec.options.windowsHide, true);
  assert.equal(spec.options.env.NAI_KEY, undefined);
  assert.equal(spec.options.env.NODE_OPTIONS, undefined);
  assert.equal(spec.options.env.NAI_GATEWAY_URL, 'http://127.0.0.1:3010');
  assert.equal(spec.options.env.NAI_PACKAGED, '1');
  assert.equal(spec.options.env.PATH, 'Windows-only');
});

test('桌面导航限制同源，外部打开只允许无凭据的网页地址', () => {
  const own = 'http://localhost:3010/';
  assert.equal(isDesktopNavigation(own + 'lab', own), true);
  for (const url of ['http://localhost:3000/', 'http://localhost:3010.evil.test/', 'http://user:pass@localhost:3010/', 'file:///C:/test', 'javascript:alert(1)', 'invalid']) assert.equal(isDesktopNavigation(url, own), false);
  for (const url of ['https://novelai.net/', own]) assert.equal(isExternalWebLink(url), true);
  for (const url of ['https://user:pass@example.test/', 'pixiv://account/login', 'file:///C:/test', 'javascript:alert(1)', 'invalid']) assert.equal(isExternalWebLink(url), false);
});
