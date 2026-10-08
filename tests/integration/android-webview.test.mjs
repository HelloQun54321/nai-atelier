import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {projectRoot} from '../support/workspace.mjs';
import {createServer} from 'node:http';

// 仅在专用模拟器执行，不能访问连接着的真实手机。
test('Android 独立工坊真实 WebView：登录、图库、触摸、资料与重启持久化',{skip:process.env.ATELIER_ANDROID_TEST!=='1',timeout:90000},async()=>{
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
    socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}};
    socket.onclose=()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Android WebView 调试连接已关闭'));}pending.clear();};
  }
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Android WebView 无响应：'+method));},method==='Runtime.evaluate'?45000:8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async expression=>{for(let attempt=0;attempt<40;attempt++){if(await evaluate(expression))return;await wait(150);}assert.fail('手机界面未就绪：'+expression);};
  try{
    await connect();
    let ready=false;for(let attempt=0;attempt<60&&!ready;attempt++){ready=await evaluate("!!window.__atelierRequest && !!document.querySelector('button')");if(!ready)await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(ready);
    // 只模拟打开浏览器，真实执行手机 PKCE 与登录状态路由；不提交账号或交换令牌。
    const pixivLogin=await evaluate(`(async()=>{const cap=window.Capacitor,original=cap.nativePromise;let opened='';cap.nativePromise=function(plugin,method,options,...rest){if(plugin==='Atelier'&&method==='openUrl'){opened=options.url;return Promise.resolve();}return original.call(this,plugin,method,options,...rest);};try{const r=await fetch('/api/pixiv/login/start',{method:'POST'});const data=await r.json();if(!r.ok)return{status:r.status,error:data.error};const url=new URL(opened);await fetch('/api/pixiv/login?id='+encodeURIComponent(data.id),{method:'DELETE'});return{status:r.status,id:data.id,origin:url.origin,challenge:url.searchParams.get('code_challenge'),method:url.searchParams.get('code_challenge_method')};}finally{cap.nativePromise=original;}})()`);
    assert.equal(pixivLogin.status,200,JSON.stringify(pixivLogin));assert.match(pixivLogin.id,/^[\w-]{16}$/);assert.match(pixivLogin.challenge,/^[\w-]{43}$/);assert.equal(pixivLogin.method,'S256');assert.equal(pixivLogin.origin,'https://app-api.pixiv.net');
    if(process.env.ATELIER_ANDROID_LIVE==='1'){
      const remote=await evaluate(`(async()=>{const config=await fetch('/__internal/aitag-fetch?url='+encodeURIComponent('https://aitag.win/api/config?v=260528a'));const text=await config.text();const search=await fetch('/api/aitag/search?page=1&page_size=60');const data=await search.json();const item=data.items?.[0],source=item?.remote_cover_url||item?.remoteFirstImageUrl;let image,detail;if(item){const r=await fetch('/__internal/aitag-fetch?url='+encodeURIComponent('https://aitag.win/api/work/'+item.id));detail={status:r.status,json:(await r.text()).trim().startsWith('{')};}if(source){const r=await fetch('/api/media?source='+encodeURIComponent(source)+'&variant=thumb-160');image={status:r.status,type:r.headers.get('content-type')};if(r.ok){const bitmap=await createImageBitmap(await r.blob());image.width=bitmap.width;bitmap.close();}}return{config:config.status,type:config.headers.get('content-type'),json:text.trim().startsWith('{'),status:search.status,keys:Object.keys(data),items:data.items?.length,error:data.error,source:data.source,image,detail};})()`);
      assert.equal(remote.config,200,JSON.stringify(remote));assert.ok(remote.json,JSON.stringify(remote));assert.match(remote.type,/json/);assert.equal(remote.status,200,JSON.stringify(remote));assert.ok(remote.items>0,JSON.stringify(remote));assert.notEqual(remote.source,'cache',JSON.stringify(remote));assert.equal(remote.detail?.status,200,JSON.stringify(remote));assert.ok(remote.detail.json);assert.equal(remote.image?.status,200,JSON.stringify(remote));assert.ok(remote.image.width>0);console.log('Android AITAG 实际接口：配置、在线列表、详情与图片通过');
    }
    let marker='synthetic-'+crypto.randomUUID();
    const created=await evaluate(`(async()=>{const r=await fetch('/api/chains',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:${JSON.stringify(marker)},name:'Android synthetic',tags:['测试'],positivePrompt:'safe test'})});return {status:r.status,data:await r.json()};})()`);
    assert.ok(created.status<300,JSON.stringify(created));
    marker=created.data.id;
    const checks=await evaluate(`(async()=>{const read=async p=>{const r=await fetch(p);return {status:r.status,data:await r.json()};};await fetch('/api/prompt-agent/custom-providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'custom-android-test',name:'Synthetic',baseUrl:'https://android-test.invalid/v1',api:'openai-completions',apiKey:'synthetic-only',models:[{id:'synthetic',contextWindow:32768,maxTokens:1024}],select:true})});return {chain:await read('/api/chains/${marker}'),agent:await read('/api/prompt-agent/config'),providers:await read('/api/prompt-agent/providers'),session:await(await fetch('/api/prompt-agent/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Synthetic phone session'})})).json(),tagger:await read('/api/image-tagger/status')};})()`);
    assert.equal(checks.chain.status,200,JSON.stringify(checks.chain));assert.equal(checks.agent.status,200,JSON.stringify(checks.agent));assert.ok(checks.providers.data.items.length>0);assert.ok(checks.session.id,JSON.stringify(checks.session));assert.equal(checks.tagger.data.downloaded,false);
    const images=await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;canvas.getContext('2d').fillRect(0,0,512,768);const png=canvas.toDataURL('image/png');const r=await fetch('/api/local-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'${marker}',prompt:'synthetic',params:{model:'nai-diffusion-4-5-full',width:512,height:768},imageUrl:png})});const saved=await r.json();if(!r.ok)return {error:saved};const original=await fetch('/api/local-history/${marker}/image');const thumbnail=await fetch('/api/media?source='+encodeURIComponent('/api/local-history/${marker}/image')+'&variant=thumb-160');const bitmap=await createImageBitmap(await thumbnail.blob());const result={original:original.status,mime:original.headers.get('content-type'),width:bitmap.width,height:bitmap.height};bitmap.close();return result;})()`);
    assert.equal(images.original,200,JSON.stringify(images));assert.equal(images.mime,'image/png');assert.equal(images.width,160);assert.equal(images.height,240);
    // 联网检查与视口模拟分开，避免调试器同时改变后台站点 WebView 的渲染环境。
    if(process.env.ATELIER_ANDROID_LIVE!=='1'){
    // 真实 Chromium 排版与触摸事件，不能只靠 jsdom 断言 CSS 类名。
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:720,deviceScaleFactor:1,mobile:true});
    await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.textContent==='实验室'&&b.getBoundingClientRect().width>0).at(-1).click()`);
    await until(`!!document.querySelector('.generation-mode-nav')`);
    for(const width of [320,360]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor:1,mobile:true});await wait(100);
      const layout=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,modes:[...document.querySelectorAll('.generation-mode-nav button')].map(b=>({text:b.textContent,width:b.clientWidth,scroll:b.scrollWidth,nowrap:getComputedStyle(b).whiteSpace,height:b.clientHeight}))})`);
      assert.equal(layout.overflow,false,JSON.stringify(layout));assert.equal(layout.modes.length,4);
      for(const mode of layout.modes){assert.equal(mode.nowrap,'nowrap');assert.ok(mode.scroll<=mode.width,JSON.stringify(mode));assert.ok(mode.height>=44);}
    }
    console.log('Android 手机界面：320／360px 四模式排版通过');
    await evaluate(`document.querySelector('button[aria-label="退出实验室，返回上一页面"]').click()`);await wait(100);
    await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.textContent==='历史'&&b.getBoundingClientRect().width>0).at(-1).click()`);
    const cardSelector=`[data-history-id="${marker}"]`;
    await until(`!!document.querySelector(${JSON.stringify(cardSelector)})?.querySelector('img')?.naturalWidth`);
    const card=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(cardSelector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);await wait(100);
    const touch=async(type,points)=>{await send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:1,radiusY:1,force:1}))});await wait(40);};
    await touch('touchStart',[[1,card.x,card.y]]);await wait(550);await touch('touchEnd',[]);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cardSelector)}).getAttribute('data-press-revealed')`),'true');
    assert.equal(await evaluate(`!!document.querySelector('.history-viewer-stage')`),false,'长按释放不能打开详情');
    await touch('touchStart',[[1,card.x,card.y]]);await touch('touchEnd',[]);await until(`!!document.querySelector('.history-viewer-stage img')?.naturalWidth`);
    const stage=await evaluate(`(()=>{const r=document.querySelector('.history-viewer-stage').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const scale=()=>evaluate(`Number(document.querySelector('.history-viewer-stage img').style.transform.match(/scale\\(([^)]+)\\)/)[1])`);
    for(let i=0;i<2;i++){await touch('touchStart',[[1,stage.x,stage.y]]);await touch('touchEnd',[]);}
    assert.ok(await scale()>1,'双击必须放大');
    for(let i=0;i<2;i++){await touch('touchStart',[[1,stage.x,stage.y]]);await touch('touchEnd',[]);}
    assert.equal(await scale(),1,'再次双击复原');
    await touch('touchStart',[[1,stage.x-35,stage.y],[2,stage.x+35,stage.y]]);
    await touch('touchMove',[[1,stage.x-80,stage.y],[2,stage.x+80,stage.y]]);
    assert.ok(await scale()>2,'双指必须连续放大');
    await touch('touchEnd',[[1,stage.x-80,stage.y]]);
    const before=await evaluate(`document.querySelector('.history-viewer-stage img').style.transform`);
    await touch('touchMove',[[2,stage.x+50,stage.y+20]]);await touch('touchEnd',[]);
    assert.notEqual(await evaluate(`document.querySelector('.history-viewer-stage img').style.transform`),before,'抬起一指后继续平移');
    assert.equal(await evaluate(`document.querySelector('.history-viewer-stage').getAttribute('data-press-revealed')`),null,'缩放不能触发长按');
    await evaluate(`document.querySelector('button[aria-label="返回历史列表"]').click()`);
    console.log('Android 手机界面：320／360px 四模式、长按及双击／双指／连续平移通过');
    }
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


