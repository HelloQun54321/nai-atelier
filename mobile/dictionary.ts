import { native, writeBlob } from './native';
import { db } from './storage';
import { json } from '../worker/routes/types';
import { generate } from 'mobile:dictionary-generator';
import naiConfig from '../data/novelai-v45-tags.json';

export const mkdir = async (path: string) => native.file({ action: 'mkdir', path, cache: true });
export const writeFile = async (path: string, value: string) => writeBlob(new Blob([value]), path, true);
const source = 'https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/main/tag.sqlite';
// 手动导入与电脑端共用同一上限；文件在手机本地生成，不经过内置下载线路。
const IMPORT_LIMIT_BYTES = 256 * 1024 * 1024;
const SQLITE_HEADER = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
let state: any = { available: true, running: false, phase: 'idle', message: '', startedAt: null, finishedAt: null, manifest: null };
const isSqliteDictionary = (bytes: Uint8Array) => bytes.length >= SQLITE_HEADER.length
  && SQLITE_HEADER.every((value, index) => bytes[index] === value);

async function readTagRows(databasePath: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 2000) {
    const page = await native.sql({ database: databasePath, sql: `SELECT name,category,cn_name,post_count FROM tags WHERE name IS NOT NULL AND cn_name IS NOT NULL AND TRIM(cn_name)<>'' AND post_count>=10 ORDER BY rowid LIMIT 2000 OFFSET ${offset}` });
    rows.push(...page.results);
    if (page.results.length < 2000) break;
  }
  return rows;
}

/** 所有分片写入成功后一次切换索引；失败不覆盖正在使用的词库。 */
async function commitBuild(base: string, rows: any[], sourceMetadata: any) {
  const directory = base + '/tag-data';
  const manifest = await generate(rows, naiConfig, sourceMetadata, directory);
  const old = await db.prepare("SELECT value FROM settings WHERE key='mobile_dictionary_path'").first<{value:string}>();
  await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('mobile_dictionary_path',?)").bind(directory).run();
  await native.file({action:'delete',path:base+'/source.sqlite',cache:true}).catch(console.warn);
  if (old?.value && /^dictionary\/builds\/[0-9a-f-]+\/tag-data$/.test(old.value)) await native.file({action:'deleteTree',path:old.value.split('/tag-data')[0],cache:true}).catch(console.warn);
  return manifest;
}

export async function mobileDictionary(request: Request): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/api/tag-dictionary' && pathname !== '/api/tag-dictionary/import' && pathname !== '/api/tag-dictionary/delete') return null;
  if (!state.manifest) {
    try { state.manifest = await (await fetch('/tag-data/manifest.json')).json(); } catch { /* 第一次使用尚未下载词库。 */ }
  }
  if (pathname === '/api/tag-dictionary/delete') {
    if (request.method !== 'POST') return json({ error: '仅支持 POST 请求' }, 405);
    if (state.running) return json({ error: 'Tag 词库正在更新，请完成后再删除' }, 409);
    const pointer = await db.prepare("SELECT value FROM settings WHERE key='mobile_dictionary_path'").first<{value:string}>();
    try {
      // 只删除词库构建目录；原图、历史与其他本地资料不在该目录。
      if (pointer?.value) {
        const build = pointer.value.split('/tag-data')[0];
        if (/^dictionary\/builds\/[0-9a-f-]+$/.test(build)) await native.file({ action: 'deleteTree', path: build, cache: true });
      }
      await db.prepare("DELETE FROM settings WHERE key='mobile_dictionary_path'").run();
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '删除词库失败' }, 500);
    }
    state = { ...state, running: false, phase: 'idle', message: '词库已删除', startedAt: null, finishedAt: new Date().toISOString(), manifest: { count: 0, generatedAt: null } };
    return json(state);
  }
  if (pathname === '/api/tag-dictionary/import') {
    if (request.method !== 'POST') return json({ error: '仅支持 POST 请求' }, 405);
    if (state.running) return json({ error: 'Tag 词库正在更新，请完成后再导入' }, 409);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await request.arrayBuffer()); } catch { return json({ error: '词库文件接收失败' }, 400); }
    if (!bytes.length) return json({ error: '没有收到词库文件，请重新选择' }, 400);
    if (bytes.length > IMPORT_LIMIT_BYTES) return json({ error: '词库文件超过 256 MB 上限，请确认选择的是 tag.sqlite' }, 413);
    if (!isSqliteDictionary(bytes)) return json({ error: '导入的文件不是有效的 SQLite 词库，请在词库来源下载 tag.sqlite 后重试' }, 400);
    state = { ...state, running: true, phase: 'generating', message: '正在建立手机补全索引…', startedAt: new Date().toISOString(), finishedAt: null };
    importDictionary(bytes).catch(error => { state = { ...state, running: false, phase: 'error', message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }; });
    return json(state);
  }
  if (request.method === 'POST' && !state.running) { state = { ...state, running: true, phase: 'downloading', message: '正在下载手机词库…', startedAt: new Date().toISOString(), finishedAt: null }; update().catch(error => { state = { ...state, running: false, phase: 'error', message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }; }); }
  return json(state);
}

async function update() {
  const base = 'dictionary/builds/' + crypto.randomUUID();
  let switched = false;
  try {
    const download = await native.http({ id: crypto.randomUUID(), url: source, file: base + '/source.sqlite', maxBytes: 536870912 });
    if (download.status !== 200) throw new Error(`词库下载失败 (${download.status})`);
    state = { ...state, phase: 'generating', message: '正在建立手机补全索引…' };
    const manifest = await commitBuild(base, await readTagRows(base + '/source.sqlite'), {
      downloadUrl: source,
      validators: { [source]: { etag: download.headers.etag || '', lastModified: download.headers['last-modified'] || '' } }
    });
    switched = true;
    state = { ...state, running: false, phase: 'completed', message: '手机词库已更新', finishedAt: new Date().toISOString(), manifest };
  } finally { if (!switched) await native.file({ action: 'deleteTree', path: base, cache: true }).catch(console.warn); }
}

/** 手动导入：内置下载不可用时，用户自备的 tag.sqlite 在手机本地生成同一套索引。 */
async function importDictionary(bytes: Uint8Array) {
  const base = 'dictionary/builds/' + crypto.randomUUID();
  let switched = false;
  try {
    await writeBlob(new Blob([bytes as unknown as BlobPart]), base + '/source.sqlite', true);
    state = { ...state, phase: 'generating', message: '正在建立手机补全索引…' };
    const manifest = await commitBuild(base, await readTagRows(base + '/source.sqlite'), { downloadUrl: 'manual-import', validators: {} });
    switched = true;
    state = { ...state, running: false, phase: 'completed', message: '手机词库已导入', finishedAt: new Date().toISOString(), manifest };
  } finally { if (!switched) await native.file({ action: 'deleteTree', path: base, cache: true }).catch(console.warn); }
}
