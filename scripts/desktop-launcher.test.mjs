import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import {
  generateLauncherBatContent,
  getDesktopLauncherStatus,
  createDesktopLauncher,
  getDesktopDir,
  IS_WINDOWS,
} from './desktop-launcher.mjs';

describe('desktop-launcher service', () => {
  let tempDesktop;
  let tempProject;

  before(async () => {
    tempDesktop = await mkdtemp(join(tmpdir(), 'desktop-test-'));
    tempProject = await mkdtemp(join(tmpdir(), 'project-test-'));
  });

  after(async () => {
    if (tempDesktop) await rm(tempDesktop, { recursive: true, force: true }).catch(() => {});
    if (tempProject) await rm(tempProject, { recursive: true, force: true }).catch(() => {});
  });

  test('getDesktopDir returns a valid path string', () => {
    const desktop = getDesktopDir();
    assert.ok(typeof desktop === 'string' && desktop.length > 0);
  });

  test('generateLauncherBatContent injects normalized projectDir', () => {
    const bat = generateLauncherBatContent({ projectDir: 'D:\\TestProject' });
    assert.match(bat, /set "PROJECT_DIR=D:\\TestProject"/);
    assert.match(bat, /npm run dev:local/);
    assert.match(bat, /title NAI Atelier Launcher/);
  });

  test('getDesktopLauncherStatus reflects empty state accurately', () => {
    const status = getDesktopLauncherStatus({
      projectDir: tempProject,
      desktopDir: tempDesktop,
    });
    assert.equal(status.batExists, false);
    assert.equal(status.shortcutExists, false);
    assert.equal(status.desktopExists, true);
    assert.ok(status.batPath.endsWith('NaiPromptManager.bat'));
  });

  test('createDesktopLauncher creates bat file in target desktopDir', async () => {
    const result = await createDesktopLauncher({
      projectDir: tempProject,
      desktopDir: tempDesktop,
      createShortcut: false,
    });
    assert.equal(result.success, true);
    assert.equal(result.batCreated, true);

    const batFile = join(tempDesktop, 'NaiPromptManager.bat');
    assert.equal(existsSync(batFile), true);

    const content = await readFile(batFile, 'utf8');
    assert.match(content, /title NAI Atelier Launcher/);
    assert.match(content, /npm run dev:local/);

    const statusAfter = getDesktopLauncherStatus({
      projectDir: tempProject,
      desktopDir: tempDesktop,
    });
    assert.equal(statusAfter.batExists, true);
    assert.ok(statusAfter.batMtime);
  });
});
