import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { plugin, listeners } = vi.hoisted(() => ({ plugin:{http:vi.fn(),browserHttp:vi.fn(),cancel:vi.fn(),file:vi.fn(),addListener:vi.fn()},listeners:new Map<string,(event:any)=>void>() }));
vi.mock('@capacitor/core',()=>({Capacitor:{convertFileSrc:(value:string)=>value},registerPlugin:()=>plugin}));
import { nativeFetch,initNativeNetwork,writeBlob } from '../../../mobile/native';

beforeEach(async()=>{vi.clearAllMocks();plugin.cancel.mockResolvedValue(undefined);plugin.addListener.mockImplementation(async(name,callback)=>{listeners.set(name,callback);return{remove:async()=>{}};});await initNativeNetwork();});
afterEach(()=>vi.unstubAllGlobals());
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
it('AITAG 接口使用浏览器网络并保留防盗链头，HTTP 拒绝不伪装成 JSON 或连接成功',async()=>{
  plugin.browserHttp.mockResolvedValue({status:200,body:'{"items":[]}',type:'application/json',url:'https://aitag.win/api/config'});
  const response=await nativeFetch('https://aitag.win/api/config',{headers:{referer:'https://aitag.win/','user-agent':'synthetic-browser'}});
  expect(await response.json()).toEqual({items:[]});expect(response.url).toBe('https://aitag.win/api/config');
  expect(plugin.browserHttp.mock.calls[0][0].headers).toMatchObject({referer:'https://aitag.win/','user-agent':'synthetic-browser'});expect(plugin.http).not.toHaveBeenCalled();
  plugin.browserHttp.mockResolvedValue({status:403,body:'blocked',type:'text/html',url:'https://aitag.win/api/config'});
  const blocked=await nativeFetch('https://aitag.win/api/config');expect(blocked.ok).toBe(false);expect(blocked.status).toBe(403);expect(await blocked.text()).toBe('blocked');
});
it('取消 AITAG 浏览器请求传到实际任务，迟到响应不能变成成功',async()=>{
  let complete!:(value:any)=>void;plugin.browserHttp.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const controller=new AbortController(),request=nativeFetch('https://aitag.win/api/config',{signal:controller.signal});controller.abort();
  complete({status:200,body:'{}',type:'application/json',url:'https://aitag.win/api/config'});
  await expect(request).rejects.toThrow();expect(plugin.cancel).toHaveBeenCalledOnce();
});
it('Chromium 剥离受限请求头时，原生图库接口与图片仍保留调用方的防盗链头',async()=>{
  vi.stubGlobal('Request',class extends Request {
    constructor(input:RequestInfo|URL,options?:RequestInit){super(input,options);this.headers.delete('referer');this.headers.delete('user-agent');}
  });
  plugin.browserHttp.mockResolvedValue({status:200,body:'{}',type:'application/json',url:'https://aitag.win/api/config'});
  await nativeFetch('https://aitag.win/api/config',{headers:{referer:'https://aitag.win/','user-agent':'synthetic-browser'}});
  expect(plugin.browserHttp.mock.calls[0][0].headers).toMatchObject({referer:'https://aitag.win/','user-agent':'synthetic-browser'});
  plugin.http.mockImplementation(async options=>{const emit=listeners.get('http')!;emit({id:options.id,type:'head',status:200,headers:{},url:options.url});emit({id:options.id,type:'end'});});
  await nativeFetch('https://i.pximg.net/synthetic.png',{headers:{referer:'https://www.pixiv.net/'}});
  expect(plugin.http.mock.calls[0][0].headers.referer).toBe('https://www.pixiv.net/');
});
