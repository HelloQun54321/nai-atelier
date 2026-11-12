import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createWorkspace, projectRoot, removeWorkspace } from '../support/workspace.mjs';
import '../support/node-environment.mjs';

const script = join(projectRoot, 'scripts/update-tag-dictionary.mjs');

const runGenerator = env => new Promise(resolve => {
  const child = spawn(process.execPath, ['--no-warnings', script], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', code => resolve({ code, stdout, stderr }));
});

const writeSourceDatabase = file => {
  const database = new DatabaseSync(file);
  try {
    database.exec('CREATE TABLE tags (name TEXT, category INTEGER, cn_name TEXT, post_count INTEGER)');
    const insert = database.prepare('INSERT INTO tags (name, category, cn_name, post_count) VALUES (?, ?, ?, ?)');
    insert.run('1girl', 0, '一个女孩', 9000);
    insert.run('artist_synthetic', 1, '合成画师', 1200);
    insert.run('hatsune_miku', 4, '初音未来', 7000);
    insert.run('low_post_tag', 0, '热度不足', 3);
    insert.run('missing_chinese', 0, null, 500);
  } finally {
    database.close();
  }
};

test('手动导入的 tag.sqlite 跳过网络下载，按同一格式生成词库与清单', async () => {
  const root = createWorkspace('tag-import-generate-');
  try {
    const source = join(root, 'tag.sqlite'), output = join(root, 'tag-data');
    writeSourceDatabase(source);
    const result = await runGenerator({ NAI_TAG_LOCAL_SOURCE: source, NAI_TAG_DATA_DIR: output });
    assert.equal(result.code, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, 7);
    assert.equal(manifest.sourceDownloadUrl, 'manual-import');
    assert.deepEqual(manifest.sourceValidators, {});
    assert.equal(manifest.count, 3 + Number(manifest.categoryCounts.novelai), '只接受有中文译名且热度达标的条目');
    assert.equal(manifest.categoryCounts.artist, 1);
    assert.equal(manifest.categoryCounts.character, 1);
    assert.equal(manifest.categoryCounts.novelai > 0, true);
    assert.equal(Array.isArray(manifest.characterSearchShards) && manifest.characterSearchShards.length, 128);
    const shard = JSON.parse(await readFile(join(output, 'shards', manifest.shards.ha), 'utf8'));
    assert.equal(shard.some(entry => entry[0] === 'hatsune miku'), true);
  } finally {
    removeWorkspace(root);
  }
});

test('导入无效文件时保留现有词库并返回可读原因', async () => {
  const root = createWorkspace('tag-import-invalid-');
  try {
    const source = join(root, 'tag.sqlite'), broken = join(root, 'broken.sqlite'), output = join(root, 'tag-data');
    await mkdir(output, { recursive: true });
    const previous = { generatedAt: '2026-01-01T00:00:00.000Z', sourceDownloadUrl: 'https://previous.invalid/tag.sqlite', version: 7, count: 12 };
    await writeFile(join(output, 'manifest.json'), JSON.stringify(previous));
    writeSourceDatabase(source);
    assert.equal((await runGenerator({ NAI_TAG_LOCAL_SOURCE: source, NAI_TAG_DATA_DIR: output })).code, 0);
    const applied = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    await writeFile(broken, 'not-a-sqlite-database');
    const result = await runGenerator({ NAI_TAG_LOCAL_SOURCE: broken, NAI_TAG_DATA_DIR: output });
    assert.notEqual(result.code, 0);
    const reported = result.stderr.match(/^TAG_UPDATE_ERROR=(.+)$/m)?.[1];
    assert.ok(reported, result.stderr);
    assert.match(decodeURIComponent(reported), /不是有效的 SQLite 词库/);
    const unchanged = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.equal(unchanged.generatedAt, applied.generatedAt);
    assert.equal(unchanged.count, applied.count);
  } finally {
    removeWorkspace(root);
  }
});

test('导入文件不存在时报告读取失败，不开始生成', async () => {
  const root = createWorkspace('tag-import-missing-');
  try {
    const output = join(root, 'tag-data');
    const result = await runGenerator({ NAI_TAG_LOCAL_SOURCE: join(root, 'missing.sqlite'), NAI_TAG_DATA_DIR: output });
    assert.notEqual(result.code, 0);
    const reported = result.stderr.match(/^TAG_UPDATE_ERROR=(.+)$/m)?.[1];
    assert.ok(reported, result.stderr);
    assert.match(decodeURIComponent(reported), /读取失败/);
    assert.equal(await readFile(join(output, 'manifest.json'), 'utf8').then(() => true, () => false), false);
  } finally {
    removeWorkspace(root);
  }
});
