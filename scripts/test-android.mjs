import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env,ANDROID_HOME:process.env.ANDROID_HOME||path.join(root,'.android-build/sdk'),JAVA_HOME:process.env.JAVA_HOME||'C:\\Program Files\\Zulu\\zulu-21',ANDROID_SERIAL:process.env.ANDROID_SERIAL||'emulator-5556',ATELIER_ANDROID_TEST:'1'};
if(!/^emulator-\d+$/.test(env.ANDROID_SERIAL))throw new Error('Android 回归只允许隔离模拟器');
mkdirSync(path.join(root,'logs/tests'),{recursive:true});
const log=createWriteStream(path.join(root,'logs/tests/android.log'));
async function run(command,args){await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,env,shell:process.platform==='win32',windowsHide:true});for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{process.stdout.write(chunk);log.write(chunk);});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(command+' 失败：'+code)));});}
try{
  await run(process.execPath,['scripts/build-android.mjs']);
  await run(path.join(root,'android/gradlew.bat'),['-p','android',':app:connectedDebugAndroidTest']);
  await run(path.join(env.ANDROID_HOME,'platform-tools/adb.exe'),['-s',env.ANDROID_SERIAL,'install','-r','android/app/build/outputs/apk/debug/app-debug.apk']);
  await run(process.execPath,['tests/run.mjs','gateway','tests/integration/android-webview.test.mjs']);
}finally{log.end();}
