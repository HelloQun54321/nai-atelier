import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile, stat, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  generateLauncherBatContent,
  getDesktopLauncherStatus,
  createDesktopLauncher,
  getDesktopDir,
  IS_WINDOWS,
  ensureDesktopLauncher,
} from './desktop-launcher.mjs';

describe('desktop-launcher service', () => {
  let tempDesktop;
  let tempProject;

  before(async () => {
    tempDesktop = await mkdtemp(join(tmpdir(), 'desktop-test-'));
    tempProject = await mkdtemp(join(tmpdir(), 'project-test-'));
    await copyFile(new URL('../NaiPromptManager.bat', import.meta.url), join(tempProject, 'NaiPromptManager.bat'));
    await mkdir(join(tempProject, 'public'));
    await copyFile(new URL('../public/nai-atelier.ico', import.meta.url), join(tempProject, 'public', 'nai-atelier.ico'));
  });

  after(async () => {
    for (const root of [tempDesktop, tempProject]) if (root) {
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
      await rm(root, { recursive: true, force: true });
    }
  });

  test('getDesktopDir returns a valid path string', () => {
    const desktop = getDesktopDir();
    assert.ok(typeof desktop === 'string' && desktop.length > 0);
  });

  test('root launcher delegates the same version check and restart arguments', async () => {
    const bat = await readFile(new URL('../NaiPromptManager.bat', import.meta.url), 'utf8');
    assert.match(bat, /call npm run dev:local -- %\*/);
    assert.doesNotMatch(bat, /api\/lan\/status/);
  });

  test('generateLauncherBatContent injects normalized projectDir', () => {
    const bat = generateLauncherBatContent({ projectDir: 'D:\\TestProject' });
    assert.match(bat, /set "PROJECT_DIR=D:\\TestProject"/);
    assert.match(bat, /npm run dev:local/);
    assert.match(bat, /call npm run dev:local -- %\*/);
    assert.doesNotMatch(bat, /api\/lan\/status/);
    assert.doesNotMatch(bat, /Opening the existing page/);
    assert.match(bat, /title NAI Atelier Launcher/);
  });

  test('getDesktopLauncherStatus reflects empty state accurately', () => {
    const status = getDesktopLauncherStatus({
      projectDir: tempProject,
      desktopDir: tempDesktop,
    });
    assert.equal(status.batExists, true);
    assert.equal(status.shortcutExists, false);
    assert.equal(status.desktopExists, true);
    assert.equal(status.batPath, join(tempProject, 'NaiPromptManager.bat'));
  });

  test('桌面只创建指向项目原文件的快捷方式，不写入或覆盖 BAT', async () => {
    const before = await readFile(join(tempProject, 'NaiPromptManager.bat'), 'utf8');
    const result = await createDesktopLauncher({
      projectDir: tempProject,
      desktopDir: tempDesktop,
      os: 'win32',
      execFile: (binary, args, options) => {
        assert.equal(binary, 'powershell.exe');
        assert.equal(options.windowsHide, true);
        assert.equal(options.env.NAI_SHORTCUT_TARGET, join(tempProject, 'NaiPromptManager.bat'));
        assert.equal(options.env.NAI_SHORTCUT_PROJECT, tempProject);
        assert.equal(options.env.NAI_SHORTCUT_ICON, join(tempProject, 'public', 'nai-atelier.ico'));
        assert.match(args.at(-1), /\$verified\.TargetPath/);
        assert.ok(!args.at(-1).includes(tempProject));
        return JSON.stringify({ changed: true, targetPath: options.env.NAI_SHORTCUT_TARGET });
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.batCreated, false);
    assert.equal(result.shortcutCreated, true);
    assert.equal(existsSync(join(tempDesktop, 'NaiPromptManager.bat')), false);
    assert.equal(await readFile(join(tempProject, 'NaiPromptManager.bat'), 'utf8'), before);

    const statusAfter = getDesktopLauncherStatus({
      projectDir: tempProject,
      desktopDir: tempDesktop,
    });
    assert.equal(statusAfter.batExists, true);
    assert.ok(statusAfter.batMtime);
  });

  test('先确认快捷方式目标，再迁移旧生成副本；其他项目或修改过的脚本保留', async () => {
    const legacy = join(tempDesktop, 'NaiPromptManager.bat');
    const generated = generateLauncherBatContent({ projectDir: tempProject });
    const options = { projectDir: tempProject, desktopDir: tempDesktop, os: 'win32', execFile: () => JSON.stringify({ changed: true, targetPath: join(tempProject, 'NaiPromptManager.bat') }) };
    await writeFile(legacy, generated.replace(/\n/g, '\r\n'));
    assert.equal((await createDesktopLauncher(options)).legacyBatRemoved, true);
    assert.equal(existsSync(legacy), false);
    for (const content of [generated + '\nrem user customization\n', generateLauncherBatContent({ projectDir: join(tempProject, 'another-project') })]) {
      await writeFile(legacy, content);
      assert.equal((await createDesktopLauncher(options)).legacyBatRemoved, false);
      assert.equal(await readFile(legacy, 'utf8'), content);
    }
    await writeFile(legacy, generated);
    await assert.rejects(createDesktopLauncher({ ...options, execFile: () => { throw new Error('shortcut failed'); } }), /shortcut failed/);
    await assert.rejects(createDesktopLauncher({ ...options, execFile: () => JSON.stringify({ targetPath: 'wrong-target' }) }), /目标校验失败/);
    assert.equal(await readFile(legacy, 'utf8'), generated);
    await createDesktopLauncher(options);
  });

  test('非 Windows 不创建文件，缺少项目入口或图标不生成无效快捷方式', async () => {
    const files = await readdir(tempDesktop);
    assert.equal((await createDesktopLauncher({ projectDir: tempProject, desktopDir: tempDesktop, os: 'linux' })).supported, false);
    assert.deepEqual(await readdir(tempDesktop), files);
    await assert.rejects(createDesktopLauncher({ projectDir: join(tempProject, 'missing'), desktopDir: tempDesktop, os: 'win32' }), /项目启动脚本或图标缺失/);
  });

  test('Windows 实际创建、复读并重复复用快捷方式，支持中文与命令字符路径', { skip: !IS_WINDOWS }, async () => {
    const project = join(tempProject, "工坊 空格 '&");
    const desktop = join(tempDesktop, "桌面 空格 '&");
    await mkdir(join(project, 'public'), { recursive: true });
    await mkdir(desktop);
    await copyFile(join(tempProject, 'NaiPromptManager.bat'), join(project, 'NaiPromptManager.bat'));
    await copyFile(join(tempProject, 'public', 'nai-atelier.ico'), join(project, 'public', 'nai-atelier.ico'));
    const first = await createDesktopLauncher({ projectDir: project, desktopDir: desktop });
    assert.equal(first.changed, true);
    assert.equal(existsSync(first.shortcutPath), true);
    const initialTime = (await stat(first.shortcutPath)).mtimeMs;
    const second = await createDesktopLauncher({ projectDir: project, desktopDir: desktop });
    assert.equal(second.changed, false);
    assert.equal((await stat(first.shortcutPath)).mtimeMs, initialTime);
    assert.equal(existsSync(join(desktop, 'NaiPromptManager.bat')), false);
    const ensured = await ensureDesktopLauncher({ projectDir: project, desktopDir: desktop });
    if (!process.env.CI && process.env.NAI_NO_DESKTOP_SHORTCUT !== '1') assert.equal(ensured.changed, false);
  });

  test('安装入口按脚本所在项目创建快捷方式，ZIP 部署没有 .git 也先完成入口设置', async () => {
    const installProject = join(tempProject, 'zip-install');
    const scripts = join(installProject, 'scripts');
    await mkdir(scripts, { recursive: true });
    await copyFile(new URL('./setup-local-install.mjs', import.meta.url), join(scripts, 'setup-local-install.mjs'));
    await copyFile(new URL('./install-git-hooks.mjs', import.meta.url), join(scripts, 'install-git-hooks.mjs'));
    await writeFile(join(scripts, 'desktop-launcher.mjs'), "import { writeFile } from 'node:fs/promises'; import { join } from 'node:path'; export const ensureDesktopLauncher = async ({ projectDir }) => writeFile(join(projectDir, 'shortcut-setup.json'), JSON.stringify({ projectDir }));");
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(packageJson.scripts.prepare, 'node scripts/setup-local-install.mjs');
    const result = spawnSync(process.execPath, [join(scripts, 'setup-local-install.mjs')], { cwd: tempDesktop, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /跳过 git hooks 安装/);
    assert.equal(JSON.parse(await readFile(join(installProject, 'shortcut-setup.json'), 'utf8')).projectDir, installProject);
  });
});
