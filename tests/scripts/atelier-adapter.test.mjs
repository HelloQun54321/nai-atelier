import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtelierPluginManager } from '../../scripts/atelier-plugins.mjs';
import { packageAtelierAdapter } from '../../scripts/package-atelier-adapter.mjs';
import { EXECUTION_MODE_BLOCK, APPEARANCE_TAG_BLOCK } from '../../plugins/dsh-unrestricted-atelier/rules.js';

test('交付 ZIP 在隔离工坊安装，预览与两段运行规则相同，停用完整恢复', async () => {
  const upstream=JSON.parse(await readFile(new URL('../../plugins/dsh-unrestricted-atelier/UPSTREAM.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(EXECUTION_MODE_BLOCK).digest('hex'),upstream.fragmentSha256);
  assert.equal(createHash('sha256').update(APPEARANCE_TAG_BLOCK).digest('hex'),upstream.appearanceSha256);
  assert.match(APPEARANCE_TAG_BLOCK, /loli，kid，child/);
  assert.match(APPEARANCE_TAG_BLOCK, /仅用于非性化/);
  assert.doesNotMatch(EXECUTION_MODE_BLOCK, /Disregard any age|force-defaulted to 18\+|canonically young-looking/);
  const root=await mkdtemp(join(tmpdir(),'nai-adapter-test-'));
  const manager=new AtelierPluginManager({root});
  try {
    const zip=await packageAtelierAdapter();
    assert.deepEqual(zip,await packageAtelierAdapter());
    const item=await manager.installZip(zip,{name:'synthetic-delivery.zip'});
    assert.equal(item.enabled,false); assert.deepEqual(item.unsupported,[]);
    assert.equal((await manager.preview(item.id)).blocks[0].text,EXECUTION_MODE_BLOCK);
    assert.equal((await manager.preview(item.id)).blocks[1].text,APPEARANCE_TAG_BLOCK);
    assert.equal(manager.runtimes.size,0);
    await manager.enable(item.id,true);
    assert.equal((await manager.promptBlocks())[0].text,EXECUTION_MODE_BLOCK);
    assert.equal((await manager.promptBlocks())[1].text,APPEARANCE_TAG_BLOCK);
    assert.deepEqual(await manager.agentTools(),[]);
    await manager.enable(item.id,false); assert.deepEqual(await manager.promptBlocks(),[]);
    await manager.remove(item.id); assert.deepEqual((await manager.list()).items,[]);
  } finally {
    for(const runtime of manager.runtimes.values())runtime.child?.kill();
    await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
});
