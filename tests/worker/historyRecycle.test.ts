import { encode } from 'fast-png';
import { deleteR2File } from '../../worker/routes/settingsRoutes';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { handleHistoryRoute } from '../../worker/routes/historyRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';
import { recordArtistHistory } from '../../worker/routes/artistUsageIndex';
import { handleStyleRollRoute } from '../../worker/routes/styleRollRoutes';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
const databases: DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();vi.restoreAllMocks();});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);sqlite.exec(INIT_SQL);
 let beforeMove: (() => void) | undefined;
 const db={prepare(query:string){let values:any[]=[];return {query,bind(...next:any[]){values=next;return this;},async first(){return sqlite.prepare(query).get(...values)||null;},async all(){return {results:sqlite.prepare(query).all(...values)};},async run(){return {meta:sqlite.prepare(query).run(...values),success:true};}};},async batch(statements:{query:string;run():Promise<any>}[]){if(statements[0]?.query.startsWith('INSERT INTO local_generation_recycle_bin')){beforeMove?.();beforeMove=undefined;}sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(cause){sqlite.exec('ROLLBACK');throw cause;}}} as unknown as D1Database;
 const files=new Map<string,ArrayBuffer>();const bucket={delete:vi.fn(async(key:string)=>{files.delete(key);}),get:vi.fn(async(key:string)=>files.has(key)?{body:files.get(key),httpEtag:'synthetic',writeHttpMetadata(){}}:null),put:vi.fn(async(key:string,value:ArrayBuffer)=>{files.set(key,value);})},env={DB:db,BUCKET:bucket,LOCAL_HISTORY_ENABLED:'true'} as unknown as Env;
 const invoke=async(path:string,method='POST',body?:unknown)=>{if(path.match(/recycle-bin\/(restore|purge)$/)&&body&&!(body as any).expectedVersions){const versions:Record<string,string>={};for(const id of (body as any).ids){const row=sqlite.prepare('SELECT * FROM local_generation_recycle_bin WHERE id=?').get(id) as any;if(row){const keys='id,user_id,image_key,image_type,prompt,negative_prompt,params,base_prompt,subject_prompt,modules,structure_version,source_chain_id,source_chain_name,source_chain_type,external_source,external_id,is_favorite,favorite_at,created_at'.split(',');versions[id]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(keys.map(k=>row[k]??null))+':'+row.moved_at+':'+(row.move_nonce||'')))),n=>n.toString(16).padStart(2,'0')).join('');}else versions[id]='0'.repeat(64);}body={...(body as any),expectedVersions:versions};}const request=new Request('http://localhost'+path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});return (await handleHistoryRoute({request,url:new URL(request.url),path:path.split('?')[0],method,db,env,currentUser:{id:'owner',role:'admin'}} as RouteContext))!;};
 const add=(id='h',extra:Record<string,unknown>={})=>{const row={id,user_id:'owner',image_key:id+'.png',created_at:123,prompt:'artist:synthetic',...extra};sqlite.prepare(`INSERT INTO local_generation_history (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row) as any[]);};
 return {sqlite,db,bucket,env,invoke,add,beforeMove:(fn:()=>void)=>{beforeMove=fn;}};
}
it('完整行原子移入恢复，保留时间、结构、蒙版、回执及统计',async()=>{
 const f=fixture();f.add('h',{params:'{"_local_edit":{"operation":"inpaint","maskAvailable":true},"model":"synthetic"}',base_prompt:'base',subject_prompt:'subject',modules:'[{"id":"m"}]',structure_version:1,external_source:'external',external_id:'e'});
 const original=f.sqlite.prepare('SELECT * FROM local_generation_history').get();await recordArtistHistory(f.db,'owner',{id:'h'},new Set());
 const settings=f.sqlite.prepare("SELECT * FROM settings WHERE key LIKE 'artist_usage_v1:%'").all();
 const before=await(await f.invoke('/api/local-history/stats?days=all&to=999999','GET')).json();
 expect(await(await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']})).json()).toMatchObject({movedCount:1,completedIds:['h']});
 expect(f.sqlite.prepare('SELECT * FROM local_generation_history').get()).toBeUndefined();
 const binned=await(await f.invoke('/api/local-history/stats?days=all&to=999999','GET')).json();expect(binned).toEqual(before);
 expect(await(await f.invoke('/api/local-history/recycle-bin/restore','POST',{ids:['h']})).json()).toMatchObject({restoredCount:1});
 expect(f.sqlite.prepare('SELECT * FROM local_generation_history').get()).toEqual(original);expect(f.sqlite.prepare("SELECT * FROM settings WHERE key LIKE 'artist_usage_v1:%'").all()).toEqual(settings);expect(f.bucket.delete).not.toHaveBeenCalled();
});
it.each([
 ['favorite',"UPDATE local_generation_history SET is_favorite=1 WHERE id='h'"],
 ['prompt_library',"INSERT INTO prompt_library_links(history_id,chain_id,kind,created_at) VALUES('h','c','appearance',1)"],
 ['collection',"INSERT INTO inspirations(id,title,source_type,source_id) VALUES('i','s','history','h')"],
 ['chain',"INSERT INTO chains(id,name,params) VALUES('c','s','{\"reference\":\"/api/local-history/h/image\"}')"],
 ['shared_image',"INSERT INTO local_generation_history(id,user_id,image_key,created_at) VALUES('other','another-user','h.png',1)"],
 ['reference_check_failed',"INSERT INTO chains(id,name,params) VALUES('c','s','damaged')"],
])('引用 %s 阻止移入，其余批量继续',async(reason,sql)=>{
 const f=fixture();f.add();f.add('safe');f.sqlite.exec(sql);const result=await(await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h','safe']})).json();expect(result).toMatchObject({movedCount:reason==='reference_check_failed'?0:1,skippedCount:reason==='reference_check_failed'?2:1});expect(result.skipped).toContainEqual({id:'h',reasons:expect.arrayContaining([reason])});expect(f.bucket.delete).not.toHaveBeenCalled();
});
it('Roll 只保护仍被使用的首次原图，删除记录不删除历史', async () => {
 const f = fixture();
 const candidate = candidateFixture('used');
 const archived = { ...candidateFixture('archived'), archived: true };
 const experiment = { ...rollFixture(), candidates: [candidate, archived] };
 const addRoll = (id: string, target = candidate, extra: Record<string, unknown> = {}) => {
  const image = rollImageFixture(experiment, target, id);
  f.add(id, { structure_version: 1, source_chain_id: image.sourceChainId, modules: JSON.stringify(image.modules), ...extra });
 };
 f.sqlite.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(`style_roll_v1:owner:${experiment.id}`, JSON.stringify(experiment));
 addRoll('original', candidate, { created_at: 20 });
 addRoll('later-duplicate', candidate, { created_at: 30 });
 addRoll('edited', candidate, { created_at: 10, params: JSON.stringify({ _local_edit: { operation: 'inpaint' } }) });
 addRoll('archived', archived);
 addRoll('provenance-only', candidate, { modules: '[]' });
 addRoll('orphan', candidate, { source_chain_id: 'style-roll:deleted-record' });
 const movePath = '/api/local-history/recycle-bin/move';
 const ids = ['original', 'later-duplicate', 'edited', 'archived', 'provenance-only', 'orphan'];
 const preview = await (await f.invoke('/api/local-history/recycle-bin/preview', 'POST', { ids })).json();
 expect(preview).toMatchObject({ movableCount: 5, skipped: [{ id: 'original', reasons: ['roll'] }] });
 const moved = await (await f.invoke(movePath, 'POST', { ids })).json();
 expect(moved).toMatchObject({ completedIds: ids.slice(1), skipped: preview.skipped });
 const path = `/api/style-roll/${experiment.id}`;
 const request = new Request(`http://localhost${path}?revision=${experiment.revision}`, { method: 'DELETE' });
 const deleted = await handleStyleRollRoute({ request, path, method: 'DELETE', db: f.db, currentUser: { id: 'owner', role: 'admin' } } as RouteContext);
 expect(await deleted!.json()).toEqual({ deleted: experiment.id });
 expect(f.sqlite.prepare('SELECT id FROM local_generation_history').get()?.id).toBe('original');
 expect(await (await f.invoke(movePath, 'POST', { ids: ['original'] })).json()).toMatchObject({ completedIds: ['original'] });
 expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('Roll 引用在移入事务前到达时，原子检查保留原图', async () => {
 const f = fixture();
 const candidate = candidateFixture('used');
 const experiment = { ...rollFixture(), candidates: [candidate] };
 const image = rollImageFixture(experiment, candidate);
 f.add(image.id, { structure_version: 1, source_chain_id: image.sourceChainId, modules: JSON.stringify(image.modules) });
 f.beforeMove(() => f.sqlite.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(`style_roll_v1:owner:${experiment.id}`, JSON.stringify(experiment)));
 const result = await (await f.invoke('/api/local-history/recycle-bin/move', 'POST', { ids: [image.id] })).json();
 expect(result).toMatchObject({ movedCount: 0, skipped: [{ id: image.id, reasons: ['source_changed_or_referenced'] }] });
 expect(f.sqlite.prepare('SELECT id FROM local_generation_history').get()?.id).toBe(image.id);
 expect(f.sqlite.prepare('SELECT id FROM local_generation_recycle_bin').get()).toBeUndefined();
});

it('迁移DELETE失败整体回滚，恢复普通ID与外部身份冲突均保留两份',async()=>{
 const f=fixture();f.add();f.sqlite.exec("CREATE TRIGGER block_move BEFORE DELETE ON local_generation_history BEGIN SELECT RAISE(ABORT,'synthetic');END");expect(await(await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']})).json()).toMatchObject({failedCount:1});expect(f.sqlite.prepare('SELECT id FROM local_generation_recycle_bin').get()).toBeUndefined();f.sqlite.exec('DROP TRIGGER block_move');await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});f.add('h',{image_key:'new.png'});expect(await(await f.invoke('/api/local-history/recycle-bin/restore','POST',{ids:['h']})).json()).toMatchObject({failedCount:1});expect(f.sqlite.prepare('SELECT image_key FROM local_generation_history').get()?.image_key).toBe('new.png');expect(f.sqlite.prepare('SELECT id FROM local_generation_recycle_bin').get()?.id).toBe('h');
});
it('冻结预览不会扩大范围，新收藏使执行缩小',async()=>{
 const f=fixture();f.add();const preview=await(await f.invoke('/api/local-history/recycle-bin/preview','POST',{clear:true})).json();f.add('later');f.sqlite.exec("UPDATE local_generation_history SET is_favorite=1 WHERE id='h'");const result=await(await f.invoke('/api/local-history/recycle-bin/move','POST',{previewToken:preview.previewToken})).json();expect(result).toMatchObject({requestedCount:1,movedCount:0,skippedCount:1});expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM local_generation_history').get()?.n).toBe(2);
});

it.each([
 { selection: { days: 7 }, keepsNewestOld: false },
 { selection: { keepCount: 3 }, keepsNewestOld: true },
])('清理条件 $selection 按完整范围预览并只移动已确认的记录', async ({ selection, keepsNewestOld }) => {
 const f = fixture();
 const now = Date.now();
 const oldTime = now - 8 * 86_400_000;
 const oldIds = Array.from({ length: 36 }, (_, i) => `old-${String(i).padStart(2, '0')}`);
 oldIds.forEach(id => f.add(id, { created_at: oldTime, is_favorite: id === 'old-01' ? 1 : 0 }));
 f.add('new-1', { created_at: now - 1000 });
 f.add('new-2', { created_at: now });
 f.add('other-account', { user_id: 'other', created_at: oldTime });

 const preview = await (await f.invoke('/api/local-history/recycle-bin/preview', 'POST', selection)).json();
 const candidates = keepsNewestOld ? oldIds.slice(0, -1) : oldIds;
 expect(preview).toMatchObject({
  requestedCount: candidates.length, movableCount: candidates.length - 1,
  skipped: [{ id: 'old-01', reasons: ['favorite'] }],
 });
 f.add('added-after-preview', { created_at: oldTime });
 f.sqlite.prepare('UPDATE local_generation_history SET params = ? WHERE id = ?').run('{"steps": 31}', 'old-02');
 const moved = await (await f.invoke('/api/local-history/recycle-bin/move', 'POST', { previewToken: preview.previewToken })).json();
 expect(moved.completedIds).toEqual(candidates.filter(id => id !== 'old-01' && id !== 'old-02').reverse());
 expect(moved.skipped).toContainEqual({ id: 'old-02', reasons: ['source_changed'] });
 expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('批量预览区分每张图的引用，识别旧 JSON 中转义的路径及自身引用', async () => {
 const f = fixture();
 f.add('escaped');
 f.add('encoded-key', { image_key: 'synthetic/cover space.png' });
 f.add('own-ref', { params: '{"historyId":"own-ref"}' });
 f.add('referencing', { params: String.raw`{"url":"\u002fapi/local-history/escaped/image?full=1","asset":"/api/assets/synthetic%2Fcover%20space.png"}` });
 const preview = await (await f.invoke('/api/local-history/recycle-bin/preview', 'POST', {
  ids: ['escaped', 'encoded-key', 'own-ref'],
 })).json();
 expect(preview).toMatchObject({ movableCount: 1, skipped: [
  { id: 'escaped', reasons: ['history'] },
  { id: 'encoded-key', reasons: ['history'] },
 ] });
 const moved = await (await f.invoke('/api/local-history/recycle-bin/move', 'POST', { previewToken: preview.previewToken })).json();
 expect(moved.completedIds).toEqual(['own-ref']);
});

it.each([200, 404])('词库返回 %s 时保存原图，装好词库后回填画师统计', async status => {
 const f = fixture();
 let dictionaryInstalled = false;
 f.env.ASSETS = { fetch: async request => {
  if (!dictionaryInstalled) return new Response('<!doctype html><title>synthetic</title>', { status, headers: { 'Content-Type': 'text/html' } });
  if (new URL(request.url).pathname.endsWith('/manifest.json')) return Response.json({ artistPages: ['0000.json'] });
  return Response.json([['synthetic_artist']]);
 } };
 const png = encode({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(255) });
 const saved = await f.invoke('/api/local-history', 'POST', {
  id: 'saved-without-dictionary', prompt: 'synthetic_artist', imageUrl: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
 });
 expect(saved.ok).toBe(true);
 expect((await f.invoke('/api/local-history/saved-without-dictionary/image', 'GET')).ok).toBe(true);
 expect((await f.invoke('/api/artist-usage', 'GET')).status).toBe(503);
 expect(f.sqlite.prepare("SELECT key FROM settings WHERE key LIKE 'artist_usage_v1:%'").all()).toEqual([]);

 dictionaryInstalled = true;
 const usage = await f.invoke('/api/artist-usage', 'GET');
 expect(usage.ok).toBe(true);
 expect(await usage.json()).toMatchObject({ artists: [{ name: 'synthetic artist', images: 1 }], complete: true });
});
it.each([false,true])('purge只删bin，receipt=%s沿用旧扣减且R2故障单独告警',async(receipt)=>{
 const f=fixture();f.add();if(receipt)await recordArtistHistory(f.db,'owner',{id:'h'},new Set());await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});f.add('safe');f.bucket.delete.mockRejectedValueOnce(new Error('synthetic R2'));const result=await(await f.invoke('/api/local-history/recycle-bin/purge','POST',{ids:['h','safe']})).json();expect(result).toMatchObject({purgedCount:1,skippedCount:1,warnings:[{id:'h',reasons:['image_cleanup_failed']}]});expect(f.sqlite.prepare('SELECT id FROM local_generation_history').get()?.id).toBe('safe');expect(f.sqlite.prepare("SELECT value FROM settings WHERE key='artist_usage_v1:owner:history:h'").get()).toBeUndefined();expect(f.bucket.delete).toHaveBeenCalledWith('local-history/owner/h.edit-mask');
});

it('move后迟到收藏和提示词库引用在SQL写入边界拒绝',async()=>{
 const f=fixture();f.add();await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});
 expect(()=>f.sqlite.exec("INSERT INTO inspirations(id,title,source_type,source_id) VALUES('late','s','history','h')")).toThrow('history_reference_target_recycled');
 expect(()=>f.sqlite.exec(`INSERT INTO chains(id,name,params) VALUES('late','s','{"reference":"/api/local-history/h/image"}')`)).toThrow('history_reference_target_recycled');
 expect(f.sqlite.prepare('SELECT id FROM local_generation_recycle_bin').get()?.id).toBe('h');
});
it('显式缺失ID如实skip，预览只保存版本摘要；客户端保护只能减小执行',async()=>{
 const f=fixture();f.add();expect(await(await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['missing']})).json()).toMatchObject({requestedCount:1,skippedCount:1,outcome:'blocked'});
 const preview=await(await f.invoke('/api/local-history/recycle-bin/preview','POST',{clear:true})).json();
 const manifest=f.sqlite.prepare("SELECT value FROM settings WHERE key LIKE 'history_preview_v1:%'").get()?.value as string;expect(manifest).not.toContain('artist:synthetic');expect(manifest).not.toContain('params');
 expect(await(await f.invoke('/api/local-history/recycle-bin/move','POST',{previewToken:preview.previewToken,protectedIds:['h']})).json()).toMatchObject({requestedCount:1,movedCount:0,skippedCount:1});
});
it('恢复外部身份冲突保留双方；异常双记录统计拒绝默选',async()=>{
 const f=fixture();f.add('h',{external_source:'st-chatu8',external_id:'external'});await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});f.add('other',{external_source:'st-chatu8',external_id:'external'});
 expect(await(await f.invoke('/api/local-history/recycle-bin/restore','POST',{ids:['h']})).json()).toMatchObject({failedCount:1});
 f.add('h');await expect(f.invoke('/api/local-history/stats?days=all','GET')).rejects.toThrow('历史与回收站身份冲突');
});
it('purge保留后来共享的原图并报告warning，不回退独立用量事件',async()=>{
 const f=fixture();f.add();await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});f.add('other',{image_key:'h.png'});
 f.sqlite.exec("INSERT INTO local_usage_events(id,user_id,category,action,created_at) VALUES('e','owner','nai','generation',1)");
 const result=await(await f.invoke('/api/local-history/recycle-bin/purge','POST',{ids:['h']})).json();expect(result).toMatchObject({purgedCount:1,warnings:[{id:'h',reasons:['image_retained_reference']}]});expect(f.bucket.delete).not.toHaveBeenCalledWith('h.png');expect(f.sqlite.prepare('SELECT id FROM local_usage_events').get()?.id).toBe('e');
});

it('确认版本防ABA，保护ID格式错误不静默取消保护',async()=>{
 const f=fixture();vi.spyOn(Date,'now').mockReturnValue(500);f.add();await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});const detail=await(await f.invoke('/api/local-history/recycle-bin/h','GET')).json();
 await f.invoke('/api/local-history/recycle-bin/restore','POST',{ids:['h']});await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});
 expect(await(await f.invoke('/api/local-history/recycle-bin/purge','POST',{ids:['h'],expectedVersions:{h:detail.item.version}})).json()).toMatchObject({purgedCount:0,skipped:[{id:'h',reasons:['source_changed']}]});
 expect((await f.invoke('/api/local-history/recycle-bin/preview','POST',{clear:true,protectedIds:'bad'})).status).toBe(400);
 expect((await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h'],protectedIds:'bad'})).status).toBe(400);
});

it('active/bin导入拒绝覆盖，同请求凭据可重试，保存不覆盖bin原图',async()=>{
 const f=fixture();const png=encode({width:2,height:2,channels:4,data:new Uint8Array(16).fill(255)});const body={id:'imported',prompt:'original',createdAt:123,imageUrl:'data:image/png;base64,'+Buffer.from(png).toString('base64')};
 expect((await f.invoke('/api/local-history/import','POST',body)).status).toBe(200);expect((await f.invoke('/api/local-history/import','POST',body)).status).toBe(200);expect((await f.invoke('/api/local-history/import','POST',{...body,prompt:'changed'})).status).toBe(409);
 await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['imported']});const puts=f.bucket.put.mock.calls.length;expect((await f.invoke('/api/local-history','POST',body)).status).toBe(409);expect(f.bucket.put.mock.calls.length).toBe(puts);
 const binBody={...body,id:'bin-only',movedAt:321};expect((await f.invoke('/api/local-history/recycle-bin/import','POST',binBody)).status).toBe(200);expect((await f.invoke('/api/local-history/recycle-bin/import','POST',binBody)).status).toBe(200);expect(f.sqlite.prepare("SELECT id FROM local_generation_history WHERE id='bin-only'").get()).toBeUndefined();
});
it('deleteR2File保留bin.params输入引用与损坏参数未知',async()=>{
 const f=fixture();f.add('h',{params:'{"input":"/api/assets/input.png"}'});await f.invoke('/api/local-history/recycle-bin/move','POST',{ids:['h']});expect(await deleteR2File(f.env,'/api/assets/input.png',f.db)).toBe('retained');expect(f.bucket.delete).not.toHaveBeenCalled();
 f.sqlite.exec("UPDATE local_generation_recycle_bin SET params='damaged' WHERE id='h'");expect(await deleteR2File(f.env,'/api/assets/unknown.png',f.db)).toBe('retained');expect(f.bucket.delete).not.toHaveBeenCalled();
});

it('同ID新像素和内联旧蒙版不得丢失，import重试核验当前事实',async()=>{
 const f=fixture(),png=encode({width:2,height:2,channels:4,data:new Uint8Array(16).fill(255)}),body={id:'safe-import',prompt:'original',createdAt:1,imageUrl:'data:image/png;base64,'+Buffer.from(png).toString('base64')};
 expect((await f.invoke('/api/local-history/import','POST',body)).status).toBe(200);
 expect((await f.invoke('/api/local-history','POST',{...body,prompt:'edited'})).status).toBe(200);
 expect((await f.invoke('/api/local-history/import','POST',body)).status).toBe(409);
 const other=encode({width:2,height:2,channels:4,data:new Uint8Array(16).fill(10)});const puts=f.bucket.put.mock.calls.length;
 expect((await f.invoke('/api/local-history','POST',{...body,imageUrl:'data:image/png;base64,'+Buffer.from(other).toString('base64')})).status).toBe(409);expect(f.bucket.put.mock.calls.length).toBe(puts);
});
