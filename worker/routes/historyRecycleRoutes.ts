import { json, error, clampInt, parseStoredJson, type D1Database, type RouteContext } from './types';
import { HISTORY_COLUMNS, HISTORY_ALL, ensureHistoryRecycleSchema, claimHistoryWrite, liveRollHistoryReference } from './historyRecycleSchema';
import { deactivateArtistHistory } from './artistUsageIndex';
import { deletePromptLibraryLinksByHistory, ensurePromptLibraryLinkSchema } from './promptLibraryLinkRoutes';
import { deleteR2File } from './settingsRoutes';
import { mapLocalHistoryRow } from './historyRoutes';
import { parseImageData, exactArrayBuffer, ensureVibeSchema, ensureCharacterReferenceSchema } from './vibeRoutes';

const digest = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
type Issue = { id: string; reasons: string[] };
const columns = HISTORY_COLUMNS.split(',');
const version = (alias: string) => `json_array(${columns.map(column => `${alias}.${column}`).join(',')})`;
const rowVersion = (row: any) => JSON.stringify(columns.map(column => row[column] ?? null));
const protectedFrom = (value: unknown): string[] | null => value === undefined ? [] : Array.isArray(value) && value.length <= 100000 && value.every(id=>typeof id==='string' && id.length>0 && id.length<=200) ? [...new Set(value)] : null;
const idsFrom = (value: unknown): string[] | null => Array.isArray(value) && value.length <= 500 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200) ? [...new Set(value)] : null;

/** 预览与原子移入共用引用谓词。D1 限制复合 SELECT 的分支数，按来源用 EXISTS，不展开大 UNION。 */
const referenceContext = (target: string) => `WITH target AS (${target}), urls AS (
 SELECT u.value AS url FROM target t, json_each(json_array(
  '/api/local-history/' || t.id || '/image',
  '/api/integrations/st-chatu8/history/' || t.external_id || '/image',
  '/api/assets/' || NULLIF(t.image_key,''),
  CASE WHEN t.image_key <> '' THEN ? END,
  CASE WHEN t.image_key <> '' THEN ? END
 )) u WHERE u.value IS NOT NULL
)`;
const documentSources = {
 chain: { from: 'chains d', value: 'd.params', where: '1' },
 collection: { from: 'inspirations d, json_each(json_array(d.params,d.analysis)) document', value: 'document.value', where: '1' },
 history: { from: 'local_generation_history d', value: 'd.params', where: 'd.id <> t.id' },
 recycle_bin: { from: 'local_generation_recycle_bin d', value: 'd.params', where: '1' },
 artist: { from: 'artists d', value: 'd.benchmarks', where: '1' },
 settings: { from: 'settings d', value: 'd.value', where: `d.key NOT GLOB 'artist_usage_v1:*' AND d.key NOT GLOB 'history_write_v1:*'
  AND d.key NOT GLOB 'history_preview_v1:*' AND d.key NOT GLOB 'history_import_v1:*' AND substr(ltrim(d.value),1,1) IN ('{','[')` },
};
const documentReference = ({from,value,where}: (typeof documentSources)[keyof typeof documentSources]) => `EXISTS(
 SELECT 1 FROM ${from}, json_tree(CASE WHEN json_valid(${value}) THEN ${value} ELSE '{}' END) n
 WHERE ${where} AND n.type = 'text' AND (
  EXISTS(SELECT 1 FROM urls WHERE n.atom = url OR (substr(n.atom,1,length(url)) = url AND substr(n.atom,length(url)+1,1) IN ('?','#')))
  OR n.atom = NULLIF(t.image_key,'') OR (n.key IN ('historyId','history_id','sourceHistoryId') AND n.atom = t.id)
 ))`;
const referenceAsset = (table: string) => `EXISTS(SELECT 1 FROM ${table} a WHERE a.original_key = NULLIF(t.image_key,'') OR a.thumbnail_key = NULLIF(t.image_key,''))`;
const referenceChecks = Object.entries({
 favorite: 't.is_favorite = 1',
 prompt_library: 'EXISTS(SELECT 1 FROM prompt_library_links WHERE history_id = t.id)',
 collection: `EXISTS(SELECT 1 FROM inspirations i WHERE i.image_key = NULLIF(t.image_key,'') OR i.image_url IN (SELECT url FROM urls)
  OR i.source_url IN (SELECT url FROM urls) OR (i.source_type IN ('history','local-history') AND i.source_id = t.id)) OR ${documentReference(documentSources.collection)}`,
 chain: `EXISTS(SELECT 1 FROM chains WHERE preview_image IN (SELECT url FROM urls)) OR ${documentReference(documentSources.chain)}`,
 artist: `EXISTS(SELECT 1 FROM artists WHERE image_url IN (SELECT url FROM urls) OR preview_url IN (SELECT url FROM urls)) OR ${documentReference(documentSources.artist)}`,
 roll: liveRollHistoryReference('t'),
 shared_image: `EXISTS(SELECT 1 FROM ${HISTORY_ALL} other WHERE other.id <> t.id AND other.image_key = NULLIF(t.image_key,''))`,
 reference_check_failed: Object.values(documentSources).map(({from,value,where}) => `EXISTS(
  SELECT 1 FROM ${from} WHERE ${where} AND ${value} IS NOT NULL AND trim(${value}) <> '' AND NOT json_valid(${value})
 )`).join(' OR '),
 history: documentReference(documentSources.history),
 recycle_bin: documentReference(documentSources.recycle_bin),
 settings: documentReference(documentSources.settings),
 reference_asset: `${referenceAsset('vibe_assets')} OR ${referenceAsset('character_reference_assets')}`,
});
const referenceColumns = 'id,is_favorite,image_key,external_id,user_id,source_chain_id,structure_version,params,modules,created_at';
// CASE 保持各来源条件同层。串联 OR 会让内嵌移入语句在 D1 超过表达式深度限制。
const referenceQuery = `${referenceContext(`SELECT ${referenceColumns.split(',').map(column => `h.${column}`).join(',')}`)}
 SELECT 1 FROM target t WHERE CASE ${referenceChecks.map(([,check]) => `WHEN (${check}) THEN 1`).join(' ')} ELSE 0 END`;
const referenceDetailsQuery = `${referenceContext(`SELECT ${referenceColumns} FROM local_generation_history WHERE id = ? AND user_id = ?`)}
 SELECT ${referenceChecks.map(([reason,check]) => `(${check}) AS ${reason}`).join(',')} FROM target t`;
const referenceArgs = (row: any) => [`/api/assets/${encodeURIComponent(row.image_key)}`, `/api/assets/${String(row.image_key).split('/').map(encodeURIComponent).join('/')}`];
async function referenceReasons(db: D1Database, row: any): Promise<string[]> {
 const flags = await db.prepare(referenceDetailsQuery).bind(row.id,row.user_id,...referenceArgs(row)).first<Record<string, number>>();
 if (!flags) return ['not_found'];
 return referenceChecks.filter(([reason]) => flags[reason] === 1).map(([reason]) => reason);
}
export function recycleResult(operation: 'move'|'restore'|'purge', requestedCount: number, completedIds: string[], skipped: Issue[] = [], failed: Issue[] = [], warnings: Issue[] = []) {
 const completedCount = completedIds.length, skippedCount = skipped.length, failedCount = failed.length;
 const outcome = !requestedCount ? 'noop' : completedCount === requestedCount ? 'success' : completedCount ? 'partial' : failedCount ? 'failed' : 'blocked';
 return { operation,requestedCount,completedCount,skippedCount,failedCount,movedCount:operation==='move'?completedCount:0,restoredCount:operation==='restore'?completedCount:0,purgedCount:operation==='purge'?completedCount:0,completedIds,skipped,failed,warnings,success:outcome==='success'||outcome==='noop',ok:outcome==='success'||outcome==='noop',outcome,partial:outcome==='partial',deletedCount:completedCount };
}
export async function moveHistoryRows(ctx: RouteContext, rows: any[], protectedIds: string[] = []) {
 const {db,currentUser} = ctx; await ensurePromptLibraryLinkSchema(db); await ensureVibeSchema(db); await ensureCharacterReferenceSchema(db);
 const completed: string[] = [], skipped: Issue[] = [], failed: Issue[] = [];
 for (const input of rows) {
  if(input._missing){skipped.push({id:input.id,reasons:['not_found']});continue;}
  if (protectedIds.includes(input.id)) { skipped.push({id:input.id,reasons:['favorite']}); continue; }
  const release = await claimHistoryWrite(db,input.id,currentUser.id,input.external_source,input.external_id);
  if (!release) { skipped.push({id:input.id,reasons:['write_conflict']}); continue; }
  try {
   const row = await db.prepare('SELECT * FROM local_generation_history WHERE id = ? AND user_id = ?').bind(input.id,currentUser.id).first<any>();
   if (!row || (input._version ? await digest(rowVersion(row))!==input._version : rowVersion(row)!==rowVersion(input))) { skipped.push({id:input.id,reasons:['source_changed']}); continue; }
   let protectedBy: string[];
   try { protectedBy = await referenceReasons(db,row); } catch { protectedBy = ['reference_check_failed']; }
   if (protectedBy.length) { skipped.push({id:row.id,reasons:protectedBy}); continue; }
   const result = await db.batch([
    db.prepare(`INSERT INTO local_generation_recycle_bin (${HISTORY_COLUMNS},moved_at,move_nonce) SELECT ${columns.map(c=>'h.'+c).join(',')},?,? FROM local_generation_history h WHERE h.id = ? AND h.user_id = ? AND ${version('h')} = ? AND NOT EXISTS(${referenceQuery})`).bind(Date.now(),crypto.randomUUID(),row.id,currentUser.id,rowVersion(row),...referenceArgs(row)),
    db.prepare('DELETE FROM local_generation_history WHERE id = ? AND user_id = ? AND changes() = 1').bind(row.id,currentUser.id),
   ]);
   if (Number(result[1].meta?.changes)) completed.push(row.id); else skipped.push({id:row.id,reasons:['source_changed_or_referenced']});
  } catch { failed.push({id:input.id,reasons:['move_conflict_or_failed']}); }
  finally { await release(); }
 }
 return recycleResult('move',rows.length,completed,skipped,failed);
}
export async function selectRecycleCandidates(ctx: RouteContext, body: any) {
 const ids = body.ids === undefined ? null : idsFrom(body.ids);
 if (body.ids !== undefined && !ids) throw new Error('Invalid history IDs');
 const rows = (await ctx.db.prepare('SELECT * FROM local_generation_history WHERE user_id = ? ORDER BY created_at DESC,id DESC').bind(ctx.currentUser.id).all<any>()).results;
 if (ids) { const byId=new Map(rows.map(row=>[row.id,row])); return ids.map(id=>byId.get(id)||{id,_missing:true}); }
 if (body.clear === true) return rows;
 if (Number.isFinite(body.days)) return rows.filter(row=>row.created_at < Date.now()-Math.max(1,Math.floor(body.days))*86400000);
 if (body.keepCount !== undefined && ['string','number'].includes(typeof body.keepCount) && Number.isFinite(Number(body.keepCount))) return rows.slice(Math.max(1,Math.floor(Number(body.keepCount))));
 throw new Error('Invalid history selector');
}
const binVersion = (row:any) => digest(rowVersion(row)+':'+row.moved_at+':'+(row.move_nonce||''));
const mapBin = async (row: any) => ({version:await binVersion(row),...mapLocalHistoryRow(row), imageUrl:row.external_source==='st-chatu8' ? `/api/integrations/st-chatu8/history/${encodeURIComponent(row.external_id)}/image` : `/api/local-history/recycle-bin/${encodeURIComponent(row.id)}/image`, movedAt:Number(row.moved_at)});
export async function handleRecycleRoute(ctx: RouteContext): Promise<Response|null> {
 const {db,path,method,request,currentUser,url,env}=ctx; const root='/api/local-history/recycle-bin';
 if (!path.startsWith(root)) return null;
 await ensureHistoryRecycleSchema(db); await ensurePromptLibraryLinkSchema(db); await ensureVibeSchema(db); await ensureCharacterReferenceSchema(db);
 if (method!=='GET' && currentUser.role==='guest') return error('Forbidden',403);
 if (path===root+'/preview' && method==='POST') {
  const body=await request.json() as any;
  if (protectedFrom(body.protectedIds) === null) return error('Invalid protected history IDs',400);
  let rows: any[]; try {rows=await selectRecycleCandidates(ctx,body);} catch {return error('Invalid history selector',400);}
  const allowed:any[]=[], skipped:Issue[]=[];
  for(const row of rows) {let why:string[];try{why=row._missing?['not_found']:body.protectedIds?.includes(row.id)?['favorite']:await referenceReasons(db,row);}catch{why=['reference_check_failed'];} if(why.length)skipped.push({id:row.id,reasons:why});else allowed.push({id:row.id,external_source:row.external_source,external_id:row.external_id,_version:await digest(rowVersion(row))});}
  await db.prepare("DELETE FROM settings WHERE key LIKE 'history_preview_v1:%' AND json_valid(value) AND json_extract(value,'$.expiresAt') < ?").bind(Date.now()).run();
  const previewToken=crypto.randomUUID(),expiresAt=Date.now()+300000;
  await db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').bind(`history_preview_v1:${currentUser.id}:${previewToken}`,JSON.stringify({expiresAt,requestedCount:rows.length,allowed,skipped})).run();
  return json({previewToken,expiresAt,requestedCount:rows.length,movableCount:allowed.length,skippedCount:skipped.length,skipped});
 }
 if(path===root+'/move' && method==='POST') {
  const body=await request.json() as any;
  if (protectedFrom(body.protectedIds) === null) return error('Invalid protected history IDs',400);
  if(body.previewToken) {
   const key=`history_preview_v1:${currentUser.id}:${body.previewToken}`,saved=await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{value:string}>();
   const preview=parseStoredJson(saved?.value,null);if(!preview||preview.expiresAt<Date.now())return error('History preview expired',409);
   const consumed=await db.prepare('DELETE FROM settings WHERE key = ? AND value = ?').bind(key,saved!.value).run();if(!Number(consumed.meta?.changes))return error('History preview already consumed',409);
   const result=await moveHistoryRows(ctx,preview.allowed,protectedFrom(body.protectedIds)!);return json(recycleResult('move',preview.requestedCount,result.completedIds,[...preview.skipped,...result.skipped],result.failed));
  }
  if(!idsFrom(body.ids))return error('Invalid history IDs',400);
  return json(await moveHistoryRows(ctx,await selectRecycleCandidates(ctx,body),protectedFrom(body.protectedIds)!));
 }
 if((path===root+'/restore'||path===root+'/purge')&&method==='POST') {
  const body=await request.json() as any,ids=idsFrom(body.ids);if(!ids)return error('Invalid history IDs',400);
   if(!body.expectedVersions || typeof body.expectedVersions!=='object' || Array.isArray(body.expectedVersions) || ids.some(id=>typeof body.expectedVersions[id]!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedVersions[id])))return error('Expected recycle bin versions are required',400);
  const operation=path.endsWith('/restore')?'restore':'purge',completed:string[]=[],skipped:Issue[]=[],failed:Issue[]=[],warnings:Issue[]=[];
  for(const id of ids) {
   let row=await db.prepare('SELECT * FROM local_generation_recycle_bin WHERE id = ? AND user_id = ?').bind(id,currentUser.id).first<any>();
   if(!row){skipped.push({id,reasons:['not_in_recycle_bin']});continue;}
   if(body.expectedVersions?.[id] !== undefined && body.expectedVersions[id] !== await binVersion(row)){skipped.push({id,reasons:['source_changed']});continue;}
   const release=await claimHistoryWrite(db,id,currentUser.id,row.external_source,row.external_id);if(!release){skipped.push({id,reasons:['write_conflict']});continue;}
   try {
    const lockedRow=await db.prepare('SELECT * FROM local_generation_recycle_bin WHERE id = ? AND user_id = ?').bind(id,currentUser.id).first<any>();
    if(!lockedRow || rowVersion(lockedRow)!==rowVersion(row) || (lockedRow.moved_at!==row.moved_at || lockedRow.move_nonce!==row.move_nonce) || (body.expectedVersions?.[id] !== undefined && body.expectedVersions[id] !== await binVersion(lockedRow))){skipped.push({id,reasons:['source_changed']});continue;}
    row=lockedRow;
    if(operation==='restore') {
     const result=await db.batch([
      db.prepare(`INSERT INTO local_generation_history (${HISTORY_COLUMNS}) SELECT ${HISTORY_COLUMNS} FROM local_generation_recycle_bin h WHERE id = ? AND user_id = ? AND ${version('h')} = ? AND moved_at = ?`).bind(id,currentUser.id,rowVersion(row),row.moved_at),
      db.prepare('DELETE FROM local_generation_recycle_bin WHERE id = ? AND user_id = ? AND changes() = 1').bind(id,currentUser.id),
     ]);if(Number(result[1].meta?.changes))completed.push(id);else skipped.push({id,reasons:['source_changed']});
    }else {
     if(await db.prepare('SELECT id FROM local_generation_history WHERE id = ?').bind(id).first()){skipped.push({id,reasons:['active_id_conflict']});continue;}
     const deleted=await deactivateArtistHistory(db,currentUser.id,[row],env,'bin');if(!deleted.includes(id)){skipped.push({id,reasons:['source_changed']});continue;}
     completed.push(id);
     try{await deletePromptLibraryLinksByHistory(db,id);}catch{warnings.push({id,reasons:['link_cleanup_failed']});}
     try{if(row.image_key){const cleaned=await deleteR2File(env,`/api/assets/${encodeURIComponent(row.image_key)}`,db);if(cleaned==='retained')warnings.push({id,reasons:['image_retained_reference']});}}catch{warnings.push({id,reasons:['image_cleanup_failed']});}
     try{await env.BUCKET!.delete(`local-history/${currentUser.id}/${id}.edit-mask`);}catch{warnings.push({id,reasons:['mask_cleanup_failed']});}
    }
   }catch{failed.push({id,reasons:[operation==='restore'?'restore_conflict_or_failed':'purge_failed']});}finally{await release();}
  }
  return json(recycleResult(operation,ids.length,completed,skipped,failed,warnings));
 }
 const media=path.match(/^\/api\/local-history\/recycle-bin\/([^/]+)\/(image|edit-mask)$/);
 if(media&&method==='GET') {
  const id=decodeURIComponent(media[1]),row=await db.prepare('SELECT * FROM local_generation_recycle_bin WHERE id = ? AND user_id = ?').bind(id,currentUser.id).first<any>();if(!row)return error('Recycle bin item not found',404);
  const object=await env.BUCKET!.get(media[2]==='image'?row.image_key:`local-history/${currentUser.id}/${id}.edit-mask`);
  if(object){const headers=new Headers();object.writeHttpMetadata(headers);headers.set('etag',object.httpEtag);return new Response(object.body,{headers});}
  const mask=parseStoredJson(row.params,{})._local_edit?.maskData;
  if(media[2]==='edit-mask'&&typeof mask==='string'){try{const parsed=parseImageData(mask);return new Response(exactArrayBuffer(parsed.bytes),{headers:{'Content-Type':parsed.contentType}});}catch{ /* 保留损坏旧资料。 */ }}
  return error('Recycle bin media not found',404);
 }
 if((path===root||path===root+'/count')&&method==='GET') {
  const where=['user_id = ?'],values:any[]=[currentUser.id];for(const [name,op]of [['from','>='],['to','<=']] as const){const n=Number(url.searchParams.get(name));if(Number.isFinite(n)&&n>0){where.push(`created_at ${op} ?`);values.push(n);}}
  const count=await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_recycle_bin WHERE ${where.join(' AND ')}`).bind(...values).first<{count:number}>();if(path.endsWith('/count'))return json({count:Number(count?.count||0)});
  const page=clampInt(url.searchParams.get('page'),0,0,1000000),size=clampInt(url.searchParams.get('pageSize'),20,1,100);
  const rows=await db.prepare(`SELECT * FROM local_generation_recycle_bin WHERE ${where.join(' AND ')} ORDER BY moved_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...values,size,page*size).all<any>();return json({items:await Promise.all(rows.results.map(mapBin)),count:Number(count?.count||0)});
 }
 const detail=path.match(/^\/api\/local-history\/recycle-bin\/([^/]+)$/);
 if(detail&&method==='GET'){const row=await db.prepare('SELECT * FROM local_generation_recycle_bin WHERE id = ? AND user_id = ?').bind(decodeURIComponent(detail[1]),currentUser.id).first<any>();return row?json({item:await mapBin(row)}):error('Recycle bin item not found',404);}
 return error('Recycle bin endpoint not found',404);
}
