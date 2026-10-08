import { PromptAgentService } from '../scripts/prompt-agent.mjs';
import { PixivGalleryService } from '../scripts/pixiv-local.mjs';
import { handleAgent } from 'mobile:agent-routes';
import { keyHashFromAuthorization } from 'mobile:gateway';
import { queuePreferences } from './gateway';
import { runHandler } from './node-http';
import { json } from '../worker/routes/types';
import { PixivWebLoginOrchestrator } from 'mobile:pixiv-login';
import { native } from './native';

const agent = new PromptAgentService({ lanSecret: 'android-local', configFile: '/agent' });
// 手机磁盘工具只开放用户创作文件；项目资料仍通过现有项目工具读取。
agent.localImages.checkProtected = async (path: string) => {
  if (path !== '/documents' && !path.startsWith('/documents/')) throw new Error('手机文件工具仅访问 /documents；图库、历史和资料请使用项目工具');
};
const pixiv = new PixivGalleryService({ tokenDir: '/pixiv', fetch: (...args: any[]) => fetch(args[0], args[1]) });
const login = new PixivWebLoginOrchestrator({ fetch:(...args:any[])=>fetch(args[0],args[1]),getGeneration:()=>pixiv.store.generation,onTokens:(tokens:any,options:any)=>pixiv.importWebLoginTokens(tokens,options) });
let initialized: Promise<void> | undefined;
const init = () => initialized ||= Promise.all([agent.init(), pixiv.init(), native.file({action:'mkdir',path:'documents'})]).then(() => {});
export async function mobileAgent(request: Request): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith('/api/prompt-agent/') && !path.startsWith('/api/pixiv/')) return null;
  await init();
  if (path.startsWith('/api/prompt-agent/')) return runHandler(request, (req,res) => handleAgent(req,res,url,agent,async () => ({ keyHash: keyHashFromAuthorization(request.headers.get('authorization') || ''), preferences: await queuePreferences(request.headers.get('authorization') || '') })));
  if (path === '/api/pixiv/status') return json(pixiv.status());
  if (path === '/api/pixiv/login/start') return json(await login.start());
  if (path === '/api/pixiv/login/status') return json(login.status(url.searchParams.get('id')));
  if (path === '/api/pixiv/login/complete') {const body=await request.json();return json(await login.complete(body.id,body.callbackUrl));}
  if (path === '/api/pixiv/login' && request.method==='DELETE') return json(await login.cancel(url.searchParams.get('id')));
  if (path === '/api/pixiv/connect') return json(request.method === 'DELETE' ? await pixiv.disconnect() : await pixiv.connect((await request.json()).refreshToken));
  if (path === '/api/pixiv/feed') return json(await pixiv.feed({ mode: url.searchParams.get('mode') || '', cursor: url.searchParams.get('cursor') || '', params: Object.fromEntries(url.searchParams) }));
  if (path === '/api/pixiv/bookmark') { const body = request.method === 'POST' ? await request.json() : {}; const illustId = body.illustId || body.illust_id || url.searchParams.get('illustId') || url.searchParams.get('illust_id'); return json(request.method === 'POST' ? await pixiv.addBookmark({ illustId, restrict: body.restrict }) : await pixiv.deleteBookmark({ illustId })); }
  return json({ error: '请使用手机 Pixiv 登录或刷新令牌连接' }, 400);
}
