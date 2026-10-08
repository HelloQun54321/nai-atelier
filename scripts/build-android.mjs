import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, mergeConfig, loadConfigFromFile } from 'vite';
import { extractAndroidShared } from './android-shared.mjs';
import { IMAGE_TAGGER_MODELS } from '../services/imageTaggerModels.mjs';
import ts from 'typescript';
import { androidDictionaryGenerator } from './android-dictionary.mjs';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {config}=await loadConfigFromFile({command:'build',mode:'production'},path.join(root,'vite.config.ts'));
const stage = path.join(root, '.android-build');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const release=process.argv.includes('--release');
await mkdir(path.join(stage, 'public'), { recursive: true });
// 分发只使用公开工程资源，不读取开发者词库、模型与 local-data。
await cp(path.join(root, 'public/app-icon.png'), path.join(stage, 'public/app-icon.png'));
const sources = {};
for (const name of ['scripts/prompt-agent.mjs', 'scripts/novelai-agent-knowledge.mjs', 'scripts/agent-runtime.mjs', 'scripts/agent-local-images.mjs', 'scripts/agent-ui-bridge.mjs', 'scripts/agent-page-tools.mjs', 'services/agentLabSync.mjs', 'services/agentOperation.mjs', 'services/agentThinking.mjs', 'services/agentConnection.mjs', 'PROJECT_AGENT.md', 'package.json']) sources[name] = await readFile(path.join(root, name), 'utf8');
const gatewayExports = ['getNaiRuntime','applyNaiRuntimeOverride','computeNaiRuntimeSync','fetchNaiRuntimeText','sanitizeNovelAiSubscription','cacheNovelAiSubscription','CloudQueueCoordinator','normalizeCloudQueuePreferences','keyHashFromAuthorization','handleGenerateRequest','handleGenerateStreamRequest','handleVibeEncodeRequest','selectPreciseReferenceCanvas','recoverPendingVibeEncodings','sendJson','hasValidLanCookie'];
const gatewaySource = extractAndroidShared(path.join(root, 'scripts/media-gateway.mjs'), gatewayExports,
  `import { createHash,createHmac,randomUUID,randomBytes,timingSafeEqual } from '/mobile/shims/crypto.mjs';
import { Buffer } from 'buffer';
import { dirname,join } from 'path-browserify';
import { mkdir,readFile,readdir,rename,unlink,writeFile } from '/mobile/shims/fs.mjs';
import { readRequestBody,requestWorkerJson,requestWorkerBuffer } from '/mobile/node-http';
import { DEFAULT_NAI_BILLING,estimateNaiBilling,isNaiBillingRules } from '/worker/naiBilling.mjs';
import { LAN_ACCESS_COOKIE } from '/worker/sharedWhitelist.mjs';
import { normalizeCloudQueueCount } from '/worker/cloudQueueNumbers.mjs';
import { getCloudQueueGenerationUrl } from '/worker/cloudQueueTarget.mjs';
import { prepareMobileReference } from '/mobile/image';`, {
    readRequestBody: '', requestWorkerJson: '', requestWorkerBuffer: '',
    preparePreciseReferenceImage: 'const preparePreciseReferenceImage = prepareMobileReference;',
  });
// 已导入的适配方法不能再次声明；保留所有业务处理器与计费函数原文。
const gateway = gatewaySource;
const gatewayTree = ts.createSourceFile('gateway.mjs', await readFile(path.join(root,'scripts/media-gateway.mjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let agentBranch='';
function findAgent(node) { if(ts.isIfStatement(node) && node.expression.getText(gatewayTree) === "url.pathname.startsWith('/api/prompt-agent/')") agentBranch=node.getText(gatewayTree);ts.forEachChild(node,findAgent); }
findAgent(gatewayTree);
if(!agentBranch)throw new Error('Android Agent 路由共用源码缺失');
const agentRoutes=`import {sendJson,hasValidLanCookie,getNaiRuntime,normalizeCloudQueuePreferences} from 'mobile:gateway';
import {readRequestBody,requestWorkerJson,requestWorkerBuffer} from '/mobile/node-http';
import {readSetting,writeSetting,queuePreferences} from '/mobile/gateway';
const lanSecret='',workerPort=0;
const requestTagDictionaryControl=method=>requestWorkerJson('/api/tag-dictionary',{headers:{}},0,{method});
const saveCloudQueuePreferences=async store=>{for(const [hash,prefs] of Object.entries(store.accounts))await writeSetting('mobile_queue_'+hash,prefs);};
export async function handleAgent(req,res,url,promptAgent,getCloudQueueScope) {
  const scope=await getCloudQueueScope(req); const cloudQueueStore={accounts:{[scope.keyHash]:scope.preferences}};
  ${agentBranch}
}`;
const remote=extractAndroidShared(path.join(root,'scripts/media-gateway.mjs'),['classifyAitagRemoteTarget','classifyDanbooruRemoteTarget','AITAG_BROWSER_HEADERS']);
const pixivLogin=extractAndroidShared(path.join(root,'scripts/pixiv-web-login.mjs'),['PixivWebLoginOrchestrator'],
`import {createHash,randomBytes} from '/mobile/shims/crypto.mjs';
import {PIXIV_APP_CLIENT_ID,PIXIV_APP_CLIENT_SECRET,PIXIV_HASH_SECRET,PIXIV_OAUTH_TOKEN_URL,PIXIV_USER_AGENT} from '/scripts/pixiv-local.mjs';
import {native} from '/mobile/native';
import {normalizeLanguage} from '/locales/index.mjs';`,{
  ensurePixivSchemeHandler:'const ensurePixivSchemeHandler=async()=>true;',
  launchInDefaultBrowser:'const launchInDefaultBrowser=url=>native.openUrl({url});',
  startPixivCallbackWatcher:'const startPixivCallbackWatcher=async({onCallback})=>{const handle=await native.addListener("urlOpen",event=>onCallback(event.url));return {exitCode:null,kill(){handle.remove();}};}',
});
const dictionaryGenerator=androidDictionaryGenerator(path.join(root,'scripts/update-tag-dictionary.mjs'));
const shim = name => path.join(root, 'mobile/shims', name + '.mjs');
const aliases = [
  { find: /^(node:)?crypto$/, replacement: shim('crypto') },
  { find: /^(node:)?fs(?:\/promises)?$/, replacement: shim('fs') },
  { find: /^(node:)?path$/, replacement: path.join(root, 'node_modules/path-browserify/index.js') },
  { find: /^undici$/, replacement: shim('undici') },
  { find: /.*\/agent-web\.mjs$/, replacement: path.join(root, 'mobile/agent-web.mjs') },
];
await build(mergeConfig(config, {
  configFile: false, publicDir: path.join(stage, 'public'),
  build: { target:'es2022', outDir: path.join(stage, 'web'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'index.html') } },
  resolve: { alias: aliases },
  define: { 'process.env': '{}', 'process.pid': '1', 'process.platform': '"android"' },
  plugins: [{
    name: 'atelier-android',
    transform(source,id) { if(!/\.(?:m?js)$/.test(id)&&!id.startsWith('\0mobile:'))return;return source.replaceAll('process.cwd()', '"/"').replaceAll("new URL('../PROJECT_AGENT.md', import.meta.url)", "'PROJECT_AGENT.md'").replaceAll("new URL('../package.json', import.meta.url)", "'package.json'"); },
    transformIndexHtml: { order: 'pre', handler: html => html.replace('/index.tsx', '/mobile/entry.ts') },
    resolveId(id) { if (id.startsWith('mobile:')) return '\0' + id; },
    load(id) {
      if (id === '\0mobile:gateway') return gateway;
      if (id === '\0mobile:agent-sources') return 'export default ' + JSON.stringify(sources);
      if (id === '\0mobile:agent-routes') return agentRoutes;
      if (id === '\0mobile:remote') return remote;
      if (id === '\0mobile:pixiv-login') return pixivLogin;
      if (id === '\0mobile:dictionary-generator') return dictionaryGenerator;
    },
  }],
}));
await mkdir(path.join(root, 'android/app/src/main/assets'), { recursive: true });
await writeFile(path.join(root, 'android/app/src/main/assets/tagger-models.json'), JSON.stringify(IMAGE_TAGGER_MODELS));
for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
  const directory=path.join(root,'android/app/src/main/res','mipmap-'+density);await mkdir(directory,{recursive:true});
  const icon=await sharp(path.join(root,'public/app-icon.png')).resize(size,size).png().toBuffer();
  for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(path.join(directory,name+'.png'),icon);
  await sharp(path.join(root,'public/app-icon.png')).resize(Math.round(size*108/48),Math.round(size*108/48),{fit:'contain',background:'#ffffff'}).png().toFile(path.join(directory,'ic_launcher_foreground.png'));
}
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) throw new Error(`${executable} 失败：${result.status}`);
}
command('npx', ['cap','sync','android'], { env: {...process.env,ATELIER_ANDROID_DEBUG:release?'0':'1'} });
if (!process.argv.includes('--web-only')) {
  const sdk = process.env.ANDROID_HOME || path.join(stage,'sdk');
  const java = process.env.JAVA_HOME || 'C:\\Program Files\\Zulu\\zulu-21';
  if(release){
    const keyfile=path.join(stage,'atelier-release.jks'),properties=path.join(stage,'signing.properties');
    try{await readFile(keyfile);await readFile(properties);}catch(error){
      if(error.code!=='ENOENT')throw error;
      // 首次生成后持续复用同一签名；两文件须一并备份，均不进入源码或 APK。
      const existing=await readFile(keyfile).then(()=>true,()=>false);if(existing)throw new Error('发布签名密码文件缺失，请恢复 .android-build/signing.properties');
      const password=randomBytes(32).toString('hex');await writeFile(properties,'password='+password+'\n',{mode:0o600}); // secret-scan: allow — password= 是属性键，密码仅由随机数生成
      command(path.join(java,'bin/keytool.exe'),['-genkeypair','-keystore',keyfile,'-storepass',password,'-keypass',password,'-alias','atelier','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=NAI Atelier'],{shell:false});
    }
  }
  command(path.join(root,'android/gradlew.bat'), ['-p','android', release?':app:assembleRelease':':app:assembleDebug'], { env: { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: java } });
  await mkdir(path.join(root,'release'),{recursive:true});
  const kind=release?'release':'debug';
  await cp(path.join(root,`android/app/build/outputs/apk/${kind}/app-${kind}.apk`), path.join(root,'release',`NAI-Atelier-${version}-android-${release?'arm64':'debug'}.apk`));
}
