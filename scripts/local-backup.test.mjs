import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatBackupTimestamp,
  parseBackupNameDate,
  collectFilesRecursive,
  scanDirStats,
  listBackups,
  LocalBackupService,
  saveBackupConfig,
} from './local-backup.mjs';

test('formatBackupTimestamp 格式化时间戳', () => {
  const date = new Date(2026, 7, 27, 21, 30, 45); // 2026-08-27 21:30:45
  const formatted = formatBackupTimestamp(date);
  assert.equal(formatted, '20260827-213045');
});

test('parseBackupNameDate 支持多种历史命名格式', () => {
  const iso1 = parseBackupNameDate('20260827-211945');
  const d1 = new Date(iso1);
  assert.equal(d1.getFullYear(), 2026);
  assert.equal(d1.getMonth(), 7); // 8月
  assert.equal(d1.getDate(), 27);
  assert.equal(d1.getHours(), 21);
  assert.equal(d1.getMinutes(), 19);

  const iso2 = parseBackupNameDate('2026-07-14-015703');
  const d2 = new Date(iso2);
  assert.equal(d2.getFullYear(), 2026);
  assert.equal(d2.getMonth(), 6); // 7月
  assert.equal(d2.getDate(), 14);

  const iso3 = parseBackupNameDate('2026-08-20-attribution-cleanup');
  const d3 = new Date(iso3);
  assert.equal(d3.getFullYear(), 2026);
  assert.equal(d3.getMonth(), 7); // 8月
  assert.equal(d3.getDate(), 20);
});

test('collectFilesRecursive 与 scanDirStats 递归扫描统计', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'nai-backup-test-'));
  try {
    await mkdir(join(tempDir, 'sub'), { recursive: true });
    await writeFile(join(tempDir, 'file1.txt'), 'hello');
    await writeFile(join(tempDir, 'sub', 'file2.txt'), 'world!!!');

    const files = await collectFilesRecursive(tempDir);
    assert.equal(files.length, 2);

    const stats = await scanDirStats(tempDir);
    assert.equal(stats.fileCount, 2);
    assert.equal(stats.totalBytes, 5 + 8);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('listBackups 扫描历史备份并按时间倒序排列', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'nai-backup-list-test-'));
  try {
    const b1 = join(tempDir, '20260627-041244');
    const b2 = join(tempDir, '20260827-211945');
    const bZip = join(tempDir, 'NaiPromptManager-full-20260731-051444.zip');

    await mkdir(join(b1, 'local-data'), { recursive: true });
    await writeFile(join(b1, 'local-data', 'test.db'), 'data1');

    await mkdir(join(b2, 'local-data'), { recursive: true });
    await writeFile(join(b2, 'local-data', 'test.db'), 'data2');
    await writeFile(join(b2, 'backup-metadata.json'), JSON.stringify({
      createdAt: '2026-08-27T21:19:45.000Z',
      fileCount: 1,
      totalBytes: 5,
      label: '手动测试',
      appVersion: '0.1.0',
    }));

    await writeFile(bZip, 'zip-content');

    const list = await listBackups(tempDir);
    assert.equal(list.length, 3);
    assert.equal(list[0].name, '20260827-211945');
    assert.equal(list[0].hasLocalData, true);
    assert.equal(list[0].label, '手动测试');
    assert.equal(list[1].name, 'NaiPromptManager-full-20260731-051444.zip');
    assert.equal(list[1].type, 'zip');
    assert.equal(list[2].name, '20260627-041244');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('LocalBackupService 执行备份并生成完整副本与元数据', async () => {
  const sourceTemp = await mkdtemp(join(tmpdir(), 'nai-backup-src-'));
  const targetTemp = await mkdtemp(join(tmpdir(), 'nai-backup-dst-'));
  try {
    // 准备模拟 sourceDir
    await mkdir(join(sourceTemp, 'v3', 'd1'), { recursive: true });
    await writeFile(join(sourceTemp, 'v3', 'd1', 'nai.sqlite'), 'sqlite-test-data');
    await writeFile(join(sourceTemp, 'cloud-queue.json'), '{"enabled":true}');

    const service = new LocalBackupService({ sourceDir: sourceTemp });
    assert.equal(service.status.running, false);

    const result = await service.startBackup({
      targetDir: targetTemp,
      label: '单元测试',
      appVersion: '1.0.0',
    });

    assert.equal(result.status, 'started');
    assert.equal(service.status.running, true);

    // 尝试在运行中再次启动，应抛出 409
    await assert.rejects(
      async () => service.startBackup({ targetDir: targetTemp }),
      { status: 409 }
    );

    // 等待备份完成
    while (service.status.running) {
      await new Promise(r => setTimeout(r, 20));
    }

    assert.equal(service.status.phase, 'completed');
    assert.equal(service.status.error, null);
    assert.equal(service.status.progress.copiedFiles, 2);

    // 验证目标目录结构
    const backupFolder = service.status.currentBackup.path;
    const copiedSqlite = await readFile(join(backupFolder, 'local-data', 'v3', 'd1', 'nai.sqlite'), 'utf8');
    assert.equal(copiedSqlite, 'sqlite-test-data');

    const metadata = JSON.parse(await readFile(join(backupFolder, 'backup-metadata.json'), 'utf8'));
    assert.equal(metadata.label, '单元测试');
    assert.equal(metadata.appVersion, '1.0.0');
    assert.equal(metadata.fileCount, 2);
  } finally {
    await rm(sourceTemp, { recursive: true, force: true });
    await rm(targetTemp, { recursive: true, force: true });
  }
});
