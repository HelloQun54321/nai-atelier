import { Buffer } from 'buffer';
import { native, initNativeNetwork, nativeFetch, webFetch, bytesToBase64 } from './native';
import { db, bucket } from './storage';
import worker from '../worker';
import { mobileGateway, initMobileRuntime, assertMobileVibeNotBusy } from './gateway';
import { mobileAgent, assertMobileAgentVibeNotReferenced } from './agent';
import { error } from '../worker/routes/types';
import { initMobileClipboard } from './clipboard';
import { mobileDictionary } from './dictionary';
import { syncSystemBars } from './systemBars';

Object.assign(globalThis, { Buffer });
initMobileClipboard();
const env = { DB: db, BUCKET: bucket, PERSONAL_MODE_ENABLED: 'true', LOCAL_HISTORY_ENABLED: 'true', AITAG_LOCAL_PROXY_URL: 'https://localhost/__internal/aitag-fetch', DANBOORU_LOCAL_PROXY_URL: 'https://localhost/__internal/danbooru-fetch', ASSETS: { fetch: (request: Request) => {
  const url = new URL(request.url);
  // Worker 派生统计与页面共用本机已下载词库，不能把内部资源域名当外站请求。
  return url.pathname.startsWith('/tag-data/') ? phoneFetch(new Request(new URL(url.pathname + url.search, location.origin), request)) : webFetch(request);
} } };
await initNativeNetwork();
const activeWrites = new Set<Request>();
let deletingVibe = false;
async function phoneFetch(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const request = new Request(input instanceof Request ? input : new URL(String(input), location.origin), options);
  const url = new URL(request.url);
  if (!['http:','https:'].includes(url.protocol)) return webFetch(request);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return nativeFetch(request,{headers:options?.headers});
  const writing = url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const deletion = request.method === 'DELETE' && url.pathname.match(/^\/api\/vibes\/([^/]+)(?:\/encodings\/([^/]+))?$/);
  if (writing && deletingVibe) return error('正在删除 Vibe，请稍后再修改资料', 409);
  if (deletion && activeWrites.size) return error('资料正在写入，请稍后再删除 Vibe', 409);
  if (deletion) deletingVibe = true;
  if (writing) activeWrites.add(request);
  try {
    if (deletion) {
      const id = decodeURIComponent(deletion[1]);
      assertMobileVibeNotBusy(id);
      await assertMobileAgentVibeNotReferenced(id, deletion[2] ? decodeURIComponent(deletion[2]) : undefined);
      assertMobileVibeNotBusy(id);
    }
    if (url.pathname.startsWith('/tag-data/')) {
      const pointer = await db.prepare("SELECT value FROM settings WHERE key='mobile_dictionary_path'").first<{value:string}>();
      if (!pointer) return error('请在设置下载手机词库',404);
      const value=await native.file({ action:'read', path:pointer.value+'/'+url.pathname.slice('/tag-data/'.length), cache:true });
      return new Response(Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/json'}});
    }
    if (url.pathname.startsWith('/__internal/')) {
      const source=url.searchParams.get('url') || '';
      const { classifyAitagRemoteTarget, classifyDanbooruRemoteTarget, AITAG_BROWSER_HEADERS } = await import('mobile:remote');
      const aitag=url.pathname.endsWith('aitag-fetch');
      const targetType=(aitag?classifyAitagRemoteTarget:classifyDanbooruRemoteTarget)(source);
      if (!targetType) return error('不支持的图库来源',400);
      return nativeFetch(source,{headers:aitag?{...AITAG_BROWSER_HEADERS,...(targetType==='image'?{accept:'image/*'}:{})}:{'user-agent':'NAI-Atelier'},signal:request.signal});
    }
    if(!url.pathname.startsWith('/api/'))return webFetch(request);
    const gateway = await mobileGateway(request);
    if (gateway) return gateway;
    const dictionary = await mobileDictionary(request);
    if (dictionary) return dictionary;
    const agent = await mobileAgent(request);
    if (agent) return agent;
    return await worker.fetch(request,env,{waitUntil:task=>task.catch(console.warn)});
  } catch (cause: any) { if (request.signal.aborted) throw request.signal.reason; return error(cause.message || '手机工坊请求失败', Number(cause.status) || 500); }
  finally { activeWrites.delete(request); if (deletion) deletingVibe = false; }
}
globalThis.fetch = phoneFetch;
(window as any).__atelierRequest = async (id: string, url: string) => {
  try {
    const response = await phoneFetch(url);
    const path=response.headers.get('x-atelier-file');
    if(path){await response.body?.cancel();await native.respond({id,status:response.status,path,headers:Object.fromEntries(response.headers),mime:(response.headers.get('content-type')||'application/octet-stream').split(';')[0]});return;}
    await native.respond({ id,status:response.status,headers:Object.fromEntries(response.headers),mime:(response.headers.get('content-type') || 'application/octet-stream').split(';')[0],data:bytesToBase64(new Uint8Array(await response.arrayBuffer())) });
  } catch { await native.respond({id,status:500,mime:'text/plain',data:btoa('Resource failed')}); }
};
await worker.fetch(new Request('https://localhost/api/init'),env);
const remembered = await native.secure({ key:'nai_api_key' });
const storageGet=Storage.prototype.getItem,storageSet=Storage.prototype.setItem,storageRemove=Storage.prototype.removeItem;
let rememberedKey=remembered.value || storageGet.call(localStorage,'nai_api_key') || '';
if(rememberedKey&&!remembered.value)await native.secure({key:'nai_api_key',value:rememberedKey});
storageRemove.call(localStorage,'nai_api_key');
Storage.prototype.getItem=function(key){return this===localStorage&&key==='nai_api_key'?rememberedKey||null:storageGet.call(this,key);};
const credentialError=(cause:unknown)=>window.dispatchEvent(new CustomEvent('nai-generation-accounting-error',{detail:{message:'手机 Key 保存失败，请重新保存后再退出：'+String(cause)}}));
Storage.prototype.setItem=function(key,value){if(this===localStorage&&key==='nai_api_key'){rememberedKey=String(value);native.secure({key,value:rememberedKey}).catch(credentialError);}else storageSet.call(this,key,value);};
Storage.prototype.removeItem=function(key){if(this===localStorage&&key==='nai_api_key'){rememberedKey='';native.secure({key,value:''}).catch(credentialError);}else storageRemove.call(this,key);};
await initMobileRuntime();
await import('../index');
syncSystemBars();
