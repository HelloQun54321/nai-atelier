import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';

test('真实本机插件预览接口只读，安装不启动、跨站拒绝、启停状态准确', async () => {
  const server=await createMediaGateway({port:0,workerPort:39999});
  const base=`http://127.0.0.1:${server.address().port}/api/prompt-agent/plugins`;
  let id;
  try {
    const zip=new JSZip(), block={id:'body',title:'合成原文',text:'SYNTHETIC_STATIC_TEXT'};
    zip.file('package.json',JSON.stringify({name:'gateway-static-test',version:'1',main:'index.js',atelier:{promptBlocks:[block]}}));
    zip.file('index.js',`export function apply(ctx){ctx.atelier.registerPromptBlock(${JSON.stringify(block)});}`);
    const installed=await fetch(base+'/install',{method:'POST',headers:{'content-type':'application/zip'},body:await zip.generateAsync({type:'nodebuffer'})});
    assert.equal(installed.status,201); id=(await installed.json()).id;
    const registry=join(process.cwd(),'local-plugins','registry.json'), before=await readFile(registry,'utf8');
    const preview=await (await fetch(`${base}/${id}/preview`)).json();
    assert.equal(preview.active,false); assert.equal(preview.blocks[0].text,block.text);
    assert.equal(await readFile(registry,'utf8'),before);
    assert.equal((await fetch(`${base}/${id}/preview`,{headers:{origin:'https://evil.test'}})).status,403);
    const enable=await fetch(`${base}/${id}`,{method:'PUT',body:JSON.stringify({enabled:true,config:{}})});
    assert.equal(enable.status,200); assert.equal((await enable.json()).items[0].state,'running');
    assert.equal((await (await fetch(`${base}/${id}/preview`)).json()).active,true);
    const disable=await fetch(`${base}/${id}`,{method:'PUT',body:JSON.stringify({enabled:false})}); assert.equal(disable.status,200);
    assert.equal((await (await fetch(`${base}/${id}/preview`)).json()).active,false);
  } finally {
    if(id)await fetch(`${base}/${id}`,{method:'DELETE'});
    server.closeAllConnections(); await new Promise(done=>server.close(done));
  }
});
