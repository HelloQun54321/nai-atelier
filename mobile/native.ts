import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

type Reply = Record<string, any>;
export const native = registerPlugin<{
  sql(options: Reply): Promise<Reply>;
  file(options: Reply): Promise<Reply>;
  object(options: Reply): Promise<Reply>;
  secure(options: Reply): Promise<Reply>;
  http(options: Reply): Promise<Reply>;
  browserHttp(options: Reply): Promise<Reply>;
  cancel(options: Reply): Promise<void>;
  tagger(options: Reply): Promise<Reply>;
  share(options: Reply): Promise<void>;
  clipboard(options: Reply): Promise<Reply>;
  openUrl(options: Reply): Promise<void>;
  saveFile(options: Reply): Promise<void>;
  backup(options: Reply): Promise<Reply>;
  respond(options: Reply): Promise<void>;
  addListener(event: string, callback: (event: Reply) => void): Promise<PluginListenerHandle>;
}>('Atelier');
export const webFetch = globalThis.fetch.bind(globalThis);
export const bytesToBase64 = (bytes: Uint8Array) => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
};
export const base64ToBytes = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));
export async function writeBlob(blob: Blob, path = `transfer/${crypto.randomUUID()}`, cache = true) {
  for (let offset = 0; offset < blob.size || offset === 0; offset += 262144) {
    await native.file({ action: 'write', path, cache, append: offset > 0, data: bytesToBase64(new Uint8Array(await blob.slice(offset, offset + 262144).arrayBuffer())) });
  }
  return path;
}

const requests = new Map<string, { event: (event: Reply) => void }>();
export async function initNativeNetwork() {
  await native.addListener('http', event => requests.get(event.id)?.event(event));
}
export async function nativeFetch(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const request = input instanceof Request && !options ? input : new Request(input, options);
  request.signal.throwIfAborted();
  const id = crypto.randomUUID();
  // Chromium 的 Request 会剥离 Referer／User-Agent，原生传输从调用参数保留原始请求头。
  const headers = Object.fromEntries(new Headers(options?.headers || request.headers));
  const url = new URL(request.url);
  // JSON 图库接口使用 Chromium，和 NovelAI／大文件的原生流传输分别适配。
  if (url.hostname === 'aitag.win' && url.pathname.startsWith('/api/') && request.method === 'GET') {
    const abort=()=>{void native.cancel({id}).catch(()=>{});};
    request.signal.addEventListener('abort',abort,{once:true});
    try {
      const result=await native.browserHttp({id,url:request.url,headers});
      request.signal.throwIfAborted();
      const response=new Response(result.body,{status:result.status,headers:{'content-type':result.type}});
      Object.defineProperty(response,'url',{value:result.url});return response;
    } finally {request.signal.removeEventListener('abort',abort);}
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : bytesToBase64(new Uint8Array(await request.arrayBuffer()));
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let ended = false;
    const finish = () => { ended = true; requests.delete(id); request.signal.removeEventListener('abort', abort); };
    const abort = () => { native.cancel({ id }).catch(() => {}); const reason = request.signal.reason || new DOMException('已取消', 'AbortError'); controller?.error(reason); reject(reason); finish(); };
    const stream = new ReadableStream<Uint8Array>({ start: value => { controller = value; }, cancel: () => { native.cancel({ id }).catch(() => {}); finish(); } });
    requests.set(id, { event(event) {
      if (ended) return;
      if (event.type === 'head') {
        const response = new Response([204, 205, 304].includes(event.status) || request.method === 'HEAD' ? null : stream, { status: event.status, headers: event.headers });
        Object.defineProperty(response, 'url', { value: event.url }); resolve(response);
      } else if (event.type === 'data') controller.enqueue(base64ToBytes(event.data));
      else if (event.type === 'end') { controller.close(); finish(); }
      else if (event.type === 'error') { const error = new Error(event.error || '手机网络请求失败'); controller.error(error); reject(error); finish(); }
    } });
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) { abort(); return; }
    native.http({ id, url: request.url, method: request.method, headers, body, manual: request.redirect === 'manual', background:request.method==='POST'&&Boolean(request.headers.get('content-type')?.startsWith('application/json')) }).catch(error => {
      if (!ended) { controller.error(error); reject(error); finish(); }
    });
  });
}
export const fetchFile = (path: string) => webFetch(Capacitor.convertFileSrc(path));
