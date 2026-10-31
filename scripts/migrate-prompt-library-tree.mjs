#!/usr/bin/env node
/**
 * 把本机已保存的提示词目录树换成当前预设，并按旧目录归类已有片段归属／缺省用途。
 * 用法：node scripts/migrate-prompt-library-tree.mjs [--dry-run]
 * 只改 settings 目录树与 chains.params 中的目录／用途字段，不改正文。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  createDefaultPromptLibraryTree,
  inferPurposesFromDirectoryIds,
  PROMPT_LIBRARY_DIRECTORY_IDS_KEY,
  readPromptLibraryTree,
  remapPromptLibraryDirectoryIds,
} from '../services/promptLibraryTree.mjs';

const dryRun = process.argv.includes('--dry-run');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(root, 'local-data/v3/d1/miniflare-D1DatabaseObject/d3e11673cb772c7bb9c99c8358981baea443d249d8350440647e2c51248ba1ac.sqlite');
const backupDir = join(root, 'tests/.tmp');
const PURPOSES_KEY = '_promptLibraryPurposes';

const db = new DatabaseSync(dbPath);
const keyRow = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'prompt_library_directories_v1:%'`).all();
if (keyRow.length !== 1) throw new Error(`期望恰好一把目录树，实际 ${keyRow.length}`);
const { key, value: raw } = keyRow[0];
const previous = readPromptLibraryTree(JSON.parse(raw));
const nextTree = { ...createDefaultPromptLibraryTree(), revision: previous.revision + 1 };
const known = new Set(nextTree.nodes.map(node => node.id));

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(backupDir, `prompt-library-tree-backup-${stamp}.json`);
writeFileSync(backupPath, JSON.stringify({ key, previous, nextTree }, null, 2));

const rows = db.prepare(`SELECT id, type, params FROM chains WHERE params LIKE '%_promptLibraryDirectoryIds%' OR params LIKE '%_promptLibraryPurposes%'`).all();
const changes = [];
for (const row of rows) {
  let params;
  try { params = JSON.parse(row.params || '{}'); } catch { continue; }
  if (!params || typeof params !== 'object' || Array.isArray(params)) continue;
  const oldDirs = Array.isArray(params[PROMPT_LIBRARY_DIRECTORY_IDS_KEY]) ? [...params[PROMPT_LIBRARY_DIRECTORY_IDS_KEY]] : null;
  const oldPurposes = Array.isArray(params[PURPOSES_KEY]) ? [...params[PURPOSES_KEY]] : null;
  let next = { ...params };
  let touched = false;
  if (oldDirs) {
    const remapped = remapPromptLibraryDirectoryIds(oldDirs, known);
    if (JSON.stringify(remapped) !== JSON.stringify(oldDirs)) {
      next[PROMPT_LIBRARY_DIRECTORY_IDS_KEY] = remapped;
      touched = true;
    }
    if (!oldPurposes?.length) {
      const inferred = inferPurposesFromDirectoryIds(oldDirs);
      if (inferred.length) {
        next[PURPOSES_KEY] = inferred;
        touched = true;
      }
    }
  }
  if (!touched) continue;
  changes.push({ id: row.id, type: row.type, fromDirs: oldDirs, toDirs: next[PROMPT_LIBRARY_DIRECTORY_IDS_KEY], fromPurposes: oldPurposes, toPurposes: next[PURPOSES_KEY] });
  if (!dryRun) {
    db.prepare(`UPDATE chains SET params = ?, updated_at = MAX(COALESCE(updated_at, 0) + 1, ?) WHERE id = ?`)
      .run(JSON.stringify(next), Date.now(), row.id);
  }
}

if (!dryRun) {
  const saved = JSON.stringify(nextTree);
  const result = db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').run(saved, key, raw);
  if (result.changes !== 1) throw new Error('目录树写入失败（可能被其他窗口改过），已备份未覆盖树；条目改动请对照备份核对');
}

console.log(JSON.stringify({
  dryRun,
  backupPath,
  key,
  previousRevision: previous.revision,
  nextRevision: nextTree.revision,
  previousRoots: previous.nodes.filter(n => n.parentId === null).map(n => n.name),
  nextRoots: nextTree.nodes.filter(n => n.parentId === null).map(n => n.name),
  entryChanges: changes.length,
  sample: changes.slice(0, 12),
}, null, 2));
