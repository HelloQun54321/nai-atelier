import { Buffer } from 'buffer';

/** 只适配现有网关处理器实际使用的请求／响应方法，网络由 nativeFetch 执行。 */
export async function runHandler(request: Request, handle: (req: any, res: any) => Promise<any>) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const emitter = {
    on(name: string, listener: (...args: any[]) => void) { const group = listeners.get(name) || new Set(); group.add(listener); listeners.set(name, group); return this; },
    once(name: string, listener: (...args: any[]) => void) { const wrapped = (...args: any[]) => { this.off(name, wrapped); listener(...args); }; return this.on(name, wrapped); },
    off(name: string, listener: (...args: any[]) => void) { listeners.get(name)?.delete(listener); return this; },
    emit(name: string, ...args: any[]) { for (const listener of listeners.get(name) || []) listener(...args); },
  };
  const buffer = Buffer.from(await request.arrayBuffer());
  const req = { ...emitter, method: request.method, headers: Object.fromEntries(request.headers), socket: { remoteAddress: '127.0.0.1' }, body: buffer, setTimeout() {}, destroy(error: Error) { emitter.emit('error', error); } };
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { res.destroyed = true; emitter.emit('close'); } });
    const headers = new Headers();
    const res = { ...emitter, headersSent: false, writableEnded: false, destroyed: false,
      setHeader(name: string, value: string) { headers.set(name, String(value)); },
      writeHead(status: number, nextHeaders: Record<string, string>) { for (const [key, value] of Object.entries(nextHeaders || {})) headers.set(key, String(value)); this.headersSent = true; resolve(new Response(stream, { status, headers })); },
      write(chunk: any) { if (!this.headersSent) this.writeHead(200, {}); if (!this.destroyed) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)); return true; },
      end(chunk?: any) { if (chunk !== undefined) this.write(chunk); if (!this.headersSent) this.writeHead(200, {}); this.writableEnded = true; if (!this.destroyed) controller.close(); request.signal.removeEventListener('abort', abort); },
      destroy(error: Error) { this.destroyed = true; controller.error(error); reject(error); request.signal.removeEventListener('abort', abort); },
    };
    const abort = () => { emitter.emit('aborted'); res.destroyed = true; controller.error(request.signal.reason); reject(request.signal.reason); };
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) { abort(); return; }
    handle(req, res).catch(error => res.destroy(error));
  });
}
export const readRequestBody = async (req: { body: Buffer }, limit: number) => {
  if (req.body.byteLength > limit) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  return req.body;
};
export const requestWorkerJson = async (path: string, req: { headers: Record<string, string> }, _port: number, { method = 'GET', body, headers = {}, signal }: any = {}) => {
  const response = await fetch(new URL(path, location.origin), { method, headers: { 'Content-Type': 'application/json', authorization: req.headers.authorization || '', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '手机资料请求失败'), { status: response.status });
  return data;
};
export const requestWorkerBuffer = async (path: string, req: { headers: Record<string, string> }, _port: number, signal?: AbortSignal) => {
  const response = await fetch(new URL(path, location.origin), { headers: { authorization: req.headers.authorization || '' }, signal });
  return { status: response.status, headers: Object.fromEntries(response.headers), buffer: Buffer.from(await response.arrayBuffer()) };
};
