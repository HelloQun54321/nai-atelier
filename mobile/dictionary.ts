import { native, writeBlob } from './native';
import { db } from './storage';
import { json } from '../worker/routes/types';
import { generate } from 'mobile:dictionary-generator';
import naiConfig from '../data/novelai-v45-tags.json';

export const mkdir = async (path: string) => native.file({ action: 'mkdir', path, cache: true });
export const writeFile = async (path: string, value: string) => writeBlob(new Blob([value]), path, true);
const source = 'https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/main/tag.sqlite';
let state: any = { available: true, running: false, phase: 'idle', message: '', startedAt: null, finishedAt: null, manifest: null };
export async function mobileDictionary(request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/tag-dictionary') return null;
  if (!state.manifest) {
    try { state.manifest = await (await fetch('/tag-data/manifest.json')).json(); } catch { /* 第一次使用尚未下载词库。 */ }
  }
  if (request.method === 'POST' && !state.running) { state = { ...state, running: true, phase: 'downloading', message: '正在下载手机词库…', startedAt: new Date().toISOString(), finishedAt: null }; update().catch(error => { state = { ...state, running: false, phase: 'error', message: error.message, finishedAt: new Date().toISOString() }; }); }
  return json(state);
}
async function update() {
  const base = 'dictionary/builds/' + crypto.randomUUID();
  let switched=false;
  try{
  const download = await native.http({ id: crypto.randomUUID(), url: source, file: base + '/source.sqlite', maxBytes: 536870912 });
  if (download.status !== 200) throw new Error(`词库下载失败 (${download.status})`);
  state = { ...state, phase: 'generating', message: '正在建立手机补全索引…' };
  const rows: any[] = [];
  for (let offset=0;;offset+=2000) {
    const page = await native.sql({ database: base + '/source.sqlite', sql: `SELECT name,category,cn_name,post_count FROM tags WHERE name IS NOT NULL AND cn_name IS NOT NULL AND TRIM(cn_name)<>'' AND post_count>=10 ORDER BY rowid LIMIT 2000 OFFSET ${offset}` });
    rows.push(...page.results); if(page.results.length<2000)break;
  }
  const directory=base+'/tag-data';
  const manifest=await generate(rows,naiConfig,{downloadUrl:source,validators:{[source]:{etag:download.headers.etag||'',lastModified:download.headers['last-modified']||''}}},directory);
  // 所有分片写入成功后一次切换索引；失败不覆盖正在使用的词库。
  const old=await db.prepare("SELECT value FROM settings WHERE key='mobile_dictionary_path'").first<{value:string}>();
  await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('mobile_dictionary_path',?)").bind(directory).run();
  switched=true;
  await native.file({action:'delete',path:base+'/source.sqlite',cache:true}).catch(console.warn);
  if(old?.value&&/^dictionary\/builds\/[0-9a-f-]+\/tag-data$/.test(old.value))await native.file({action:'deleteTree',path:old.value.split('/tag-data')[0],cache:true}).catch(console.warn);
  state={...state,running:false,phase:'completed',message:'手机词库已更新',finishedAt:new Date().toISOString(),manifest};
  }finally{if(!switched)await native.file({action:'deleteTree',path:base,cache:true}).catch(console.warn);}
}
