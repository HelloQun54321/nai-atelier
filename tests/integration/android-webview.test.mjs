import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {projectRoot} from '../support/workspace.mjs';
import {createServer} from 'node:http';

// 仅在专用模拟器执行，不能访问连接着的真实手机。
test('Android 独立工坊真实 WebView：资料、原图、小图、Agent 与重启持久化',{skip:process.env.ATELIER_ANDROID_TEST!=='1',timeout:90000},async()=>{
  const adb=join(process.env.ANDROID_HOME||join(projectRoot,'.android-build/sdk'),'platform-tools','adb.exe');
  const serial=process.env.ANDROID_SERIAL||'emulator-5556',app='io.github.helloqun54321.naiatelier';
  const shell=(...args)=>{const result=spawnSync(adb,['-s',serial,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  assert.match(serial,/^emulator-\d+$/);assert.equal(shell('shell','getprop','ro.kernel.qemu'),'1');
  shell('shell','am','force-stop',app);shell('shell','am','start','-W','-n',app+'/.MainActivity');
  let socket,seq=0;const pending=new Map();
  async function connect(){
    shell('forward','tcp:9222','localabstract:webview_devtools_remote_'+shell('shell','pidof',app));
    let tabs=[];for(let attempt=0;attempt<40&&!tabs.length;attempt++){try{tabs=await(await fetch('http://127.0.0.1:9222/json/list')).json();}catch{}if(!tabs.length)await new Promise(resolve=>setTimeout(resolve,250));}
    assert.ok(tabs.length,'工坊 WebView 必须存在');socket=new WebSocket(tabs.find(tab=>tab.url.startsWith('https://localhost')).webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}};
  }
  const evaluate=async expression=>{const id=++seq;const result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
  try{
    await connect();
    let ready=false;for(let attempt=0;attempt<60&&!ready;attempt++){ready=await evaluate("!!window.__atelierRequest && !!document.querySelector('button')");if(!ready)await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(ready);
    let marker='synthetic-'+crypto.randomUUID();
    const created=await evaluate(`(async()=>{const r=await fetch('/api/chains',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:${JSON.stringify(marker)},name:'Android synthetic',tags:['测试'],positivePrompt:'safe test'})});return {status:r.status,data:await r.json()};})()`);
    assert.ok(created.status<300,JSON.stringify(created));
    marker=created.data.id;
    const checks=await evaluate(`(async()=>{const read=async p=>{const r=await fetch(p);return {status:r.status,data:await r.json()};};await fetch('/api/prompt-agent/custom-providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'custom-android-test',name:'Synthetic',baseUrl:'https://android-test.invalid/v1',api:'openai-completions',apiKey:'synthetic-only',models:[{id:'synthetic',contextWindow:32768,maxTokens:1024}],select:true})});return {chain:await read('/api/chains/${marker}'),agent:await read('/api/prompt-agent/config'),providers:await read('/api/prompt-agent/providers'),session:await(await fetch('/api/prompt-agent/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Synthetic phone session'})})).json(),tagger:await read('/api/image-tagger/status')};})()`);
    assert.equal(checks.chain.status,200,JSON.stringify(checks.chain));assert.equal(checks.agent.status,200,JSON.stringify(checks.agent));assert.ok(checks.providers.data.items.length>0);assert.ok(checks.session.id,JSON.stringify(checks.session));assert.equal(checks.tagger.data.downloaded,false);
    const images=await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;canvas.getContext('2d').fillRect(0,0,512,768);const png=canvas.toDataURL('image/png');const r=await fetch('/api/local-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'${marker}',prompt:'synthetic',params:{model:'nai-diffusion-4-5-full',width:512,height:768},imageUrl:png})});const saved=await r.json();if(!r.ok)return {error:saved};const original=await fetch('/api/local-history/${marker}/image');const thumbnail=await fetch('/api/media?source='+encodeURIComponent('/api/local-history/${marker}/image')+'&variant=thumb-160');const bitmap=await createImageBitmap(await thumbnail.blob());const result={original:original.status,mime:original.headers.get('content-type'),width:bitmap.width,height:bitmap.height};bitmap.close();return result;})()`);
    assert.equal(images.original,200,JSON.stringify(images));assert.equal(images.mime,'image/png');assert.equal(images.width,160);assert.equal(images.height,240);
    const server=createServer((req,res)=>{res.setHeader('content-type','text/event-stream');res.write('event: preview\ndata: one\n\n');setTimeout(()=>res.end('event: final\ndata: two\n\n'),30);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{assert.equal(await evaluate(`fetch('http://10.0.2.2:${server.address().port}/sse').then(r=>r.text())`),'event: preview\ndata: one\n\nevent: final\ndata: two\n\n');}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    const simulated=await evaluate(`(async()=>{
      const original=window.fetch;let generated=0,agentCalls=0;
      window.fetch=async(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input),location.origin);if(url.hostname==='image.novelai.net'){if(url.pathname.includes('subscription'))return Response.json({tier:3,active:true,usage:{percent:100,isNegative:false},trainingStepsLeft:{fixedTrainingStepsLeft:5000,purchasedTrainingSteps:0}});generated++;return url.pathname.includes('stream')?new Response('event: final\\ndata: {"image":"synthetic"}\\n\\n',{headers:{'content-type':'text/event-stream'}}):new Response('PK synthetic',{headers:{'content-type':'application/zip'}});}if(url.hostname==='android-test.invalid'){agentCalls++;const chunk={id:'synthetic',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:{role:'assistant',content:'完成'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}};return new Response('data: '+JSON.stringify(chunk)+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});}if(url.hostname!=='localhost'&&(options?.method==='POST'||input instanceof Request&&input.method==='POST'))throw new Error('测试禁止实际付费请求');return original(input,options);};
      try{
        await fetch('/api/novelai-subscription',{headers:{authorization:'Bearer synthetic-android-test'}});const modes=[];
        for(const action of ['generate','img2img','infill','outpaint'])for(const streaming of [false,true]){const r=await fetch('/api/generate'+(streaming?'-stream':''),{method:'POST',headers:{authorization:'Bearer synthetic-android-test','content-type':'application/json'},body:JSON.stringify({input:'synthetic',model:'nai-diffusion-4-5-full',action:action==='outpaint'?'infill':action,parameters:{width:512,height:768,steps:28,n_samples:1,strength:0.7,...(action==='outpaint'?{_local_edit_operation:'outpaint'}:{})}})});modes.push({status:r.status,text:await r.text(),cost:r.headers.get('x-nai-anlas-estimated-spent'),failed:r.headers.get('x-nai-anlas-accounting-failed')});}
        const agent=await fetch('/api/prompt-agent/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'${checks.session.id}',message:'hello',draft:{params:{},target:{chainId:'${marker}',mode:'text-to-image',fingerprint:'synthetic'}}})});const agentText=await agent.text();return {generated,agentCalls,modes,agent:agentText};
      }finally{window.fetch=original;}
    })()`);
    assert.equal(simulated.generated,8,JSON.stringify(simulated));for(const result of simulated.modes){assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.failed,null);assert.ok(result.text.startsWith('PK')||result.text.includes('event: final'),JSON.stringify(result));}
    assert.equal(simulated.agentCalls,1,simulated.agent);assert.match(simulated.agent,/"type":"done"/);assert.doesNotMatch(simulated.agent,/"type":"error"/);
    socket.close();shell('shell','am','force-stop',app);shell('shell','am','start','-W','-n',app+'/.MainActivity');await connect();
    let persisted;for(let attempt=0;attempt<60;attempt++){if(await evaluate('!!window.__atelierRequest')){persisted=await evaluate(`(async()=>{const chain=await(await fetch('/api/chains/${marker}')).json();const sessions=await(await fetch('/api/prompt-agent/sessions')).json();return {chain,sessions};})()`);break;}await new Promise(resolve=>setTimeout(resolve,250));}
    assert.equal(persisted.chain.name,'Android synthetic');assert.ok(persisted.sessions.items.some(session=>session.id===checks.session.id));
    await evaluate(`Promise.all([fetch('/api/chains/${marker}',{method:'DELETE'}),fetch('/api/local-history/${marker}',{method:'DELETE'}),fetch('/api/prompt-agent/sessions/${checks.session.id}',{method:'DELETE'}),fetch('/api/prompt-agent/custom-providers/custom-android-test',{method:'DELETE'})]).then(()=>true)`);
  }finally{socket?.close();shell('forward','--remove','tcp:9222');}
});


