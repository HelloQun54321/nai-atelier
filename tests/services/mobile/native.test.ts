import { beforeEach, expect, it, vi } from 'vitest';

const { plugin, listeners } = vi.hoisted(() => ({ plugin:{http:vi.fn(),cancel:vi.fn(),file:vi.fn(),addListener:vi.fn()},listeners:new Map<string,(event:any)=>void>() }));
vi.mock('@capacitor/core',()=>({Capacitor:{convertFileSrc:(value:string)=>value},registerPlugin:()=>plugin}));
import { nativeFetch,initNativeNetwork,writeBlob } from '../../../mobile/native';

beforeEach(async()=>{vi.clearAllMocks();plugin.cancel.mockResolvedValue(undefined);plugin.addListener.mockImplementation(async(name,callback)=>{listeners.set(name,callback);return{remove:async()=>{}};});await initNativeNetwork();});
it('原生流保持逐块输出，完成后关闭，取消传递至原生请求',async()=>{
  plugin.http.mockImplementation(async options=>{const emit=listeners.get('http')!;emit({id:options.id,type:'head',status:200,headers:{'content-type':'text/event-stream'},url:options.url});emit({id:options.id,type:'data',data:btoa('event: final\n')});emit({id:options.id,type:'data',data:btoa('data: {}\n\n')});emit({id:options.id,type:'end'});});
  const response=await nativeFetch('https://example.invalid/stream');expect(await response.text()).toBe('event: final\ndata: {}\n\n');
  plugin.http.mockImplementation(async options=>listeners.get('http')!({id:options.id,type:'head',status:200,headers:{},url:options.url}));
  const controller=new AbortController(),stream=await nativeFetch('https://example.invalid/slow',{signal:controller.signal});controller.abort();await expect(stream.text()).rejects.toThrow();expect(plugin.cancel).toHaveBeenCalledOnce();
});
it('原图按块写入，每张重新写入，后续块追加；写入失败不给成功收据',async()=>{
  plugin.file.mockResolvedValue({});await writeBlob(new Blob([new Uint8Array(300000)]),'synthetic/image');
  expect(plugin.file.mock.calls.map(([value])=>value.append)).toEqual([false,true]);
  plugin.file.mockRejectedValue(new Error('disk full'));await expect(writeBlob(new Blob(['image']),'synthetic/error')).rejects.toThrow('disk full');
});
