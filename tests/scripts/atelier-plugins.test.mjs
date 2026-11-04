import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { AtelierPluginManager, inspectPlugin } from '../../scripts/atelier-plugins.mjs';
import { validatePromptBlocks } from '../../scripts/atelier-prompt-blocks.mjs';

const zipPlugin = async (name, code, extra = {}) => {
  const zip = new JSZip();
  zip.file('sample/package.json', JSON.stringify({ name, version:'1.0.0', type:'module', main:'index.js', ...extra }));
  zip.file('sample/index.js', code);
  return zip.generateAsync({type:'nodebuffer'});
};
const workspace = async t => {
  const root = await mkdtemp(join(tmpdir(), 'atelier-plugin-test-'));
  const manager = new AtelierPluginManager({root});
  t.after(async () => {
    for (const runtime of manager.runtimes.values()) { runtime.state='stopped'; runtime.child?.kill(); }
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/'));
    await rm(root, {recursive:true,force:true});
  });
  return manager;
};

test('install is inert; Cordis plugin tool starts, executes, stops and removes', async t => {
  const manager = await workspace(t);
  const item = await manager.installZip(await zipPlugin('atelier-test-echo', `export const inject=['atelier']; export function apply(ctx){ ctx.atelier.registerTool({name:'echo',description:'测试回声',parameters:{type:'object',properties:{text:{type:'string'}}},execute:args=>({echo:args.text})}); }`));
  assert.equal((await manager.list()).items[0].state,'installed');
  assert.equal(manager.runtimes.size,0);
  assert.deepEqual(await manager.agentTools(),[]);
  await manager.enable(item.id,true,{});
  assert.equal((await manager.list()).items[0].state,'running');
  const tools = await manager.agentTools();
  assert.equal(tools.length,1);
  assert.deepEqual(JSON.parse((await tools[0].execute('call',{text:'hello'})).content[0].text),{echo:'hello'});
  await manager.enable(item.id,false);
  assert.equal((await manager.agentTools()).length,0);
  await manager.remove(item.id);
  assert.equal((await manager.list()).items.length,0);
});

test('DSH-only features are listed and cannot be silently enabled', async t => {
  const manager = await workspace(t);
  const item = await manager.installZip(await zipPlugin('test-dsh-only','export function apply(){}',{dsh:{bundle:{patch:'cordis.patch.yml'},client:{platform:'web'}},engines:{dsh:'>=0.2.0'}}));
  assert.equal((await manager.list()).items[0].state,'unsupported');
  assert.equal(item.unsupported.length,2);
  await assert.rejects(manager.enable(item.id,true,{}),/尚不支持/);
  assert.equal((await manager.registry()).items[0].enabled,false);
});

test('invalid entry and ZIP traversal are rejected', async t => {
  for (const exports of ['./index.js', { '.': './index.js' }, { '.': { import: './index.js' } }, { '.': { default: './index.js' } }]) assert.equal(inspectPlugin({exports}).entry, 'index.js');
  assert.throws(()=>inspectPlugin({main:'../escape.js'}),/有效/);
  const manager = await workspace(t); const zip = new JSZip();
  zip.file('package.json',JSON.stringify({name:'unsafe',main:'index.js'})); zip.file('../outside','no');
  await assert.rejects(manager.installZip(await zip.generateAsync({type:'nodebuffer'})),/路径/);
  assert.equal((await manager.list()).items.length,0);
});

test('failed plugin startup reports error and does not leave enabled state', async t => {
  const manager = await workspace(t);
  const item = await manager.installZip(await zipPlugin('test-fail',`export function apply(){throw new Error('synthetic startup error')}`));
  await assert.rejects(manager.enable(item.id,true,{}),/synthetic startup error/);
  assert.equal((await manager.registry()).items[0].enabled,false);
  assert.equal((await manager.list()).items[0].state,'error');
  assert.ok((await readFile(join(manager.root,'registry.json'),'utf8')).includes('test-fail'));
});

test('静态片段预览不执行代码；启动后返回快照，停用及失败不再贡献片段', async t => {
  const manager = await workspace(t);
  const text = 'SYNTHETIC_ORIGINAL_BLOCK\n保留空白与原文。\n';
  const declared = { id:'delivery', title:'合成片段', text };
  const item = await manager.installZip(await zipPlugin('atelier-static', `export const inject=['atelier']; export function apply(ctx){ctx.atelier.registerPromptBlock(${JSON.stringify(declared)});}`, { atelier:{entry:'index.js',promptBlocks:[declared]} }));
  const preview = await manager.preview(item.id);
  assert.equal(preview.active,false); assert.equal(preview.kind,'declared'); assert.equal(preview.blocks[0].text,text);
  assert.equal(manager.runtimes.size,0); assert.deepEqual(await manager.promptBlocks(),[]);
  await manager.enable(item.id,true);
  const snapshot = await manager.promptBlocks();
  assert.equal(snapshot.length,1); assert.equal(snapshot[0].text,text); assert.ok(snapshot[0].id.startsWith(`plugin_${item.id}_`));
  const shown = (await manager.list()).items[0].promptBlocks[0];
  assert.equal(shown.chars,text.length); assert.match(shown.sha256,/^[a-f0-9]{64}$/); assert.equal(shown.text,undefined);
  assert.equal((await manager.preview(item.id)).kind,'runtime');
  await manager.enable(item.id,false);
  assert.deepEqual(await manager.promptBlocks(),[]); assert.equal(snapshot[0].text,text);
  snapshot[0].text='mutated'; assert.equal((await manager.preview(item.id)).blocks[0].text,text);
  const fail = await manager.installZip(await zipPlugin('atelier-static-fail', `export function apply(ctx){ctx.atelier.registerPromptBlock({id:'failed',text:'NEVER_ACTIVE'});throw Error('synthetic fail');}`));
  await assert.rejects(manager.enable(fail.id,true),/synthetic fail/);
  assert.deepEqual(await manager.promptBlocks(),[]);
});

test('片段协议拒绝重复 ID、无效类型与超限正文，不偷偷截断', async t => {
  const block = { id:'text', text:'synthetic' };
  for (const blocks of [[block,block], [{id:'../bad',text:'x'}], [{id:'x',text:3}], [{id:'x',text:'x'.repeat(20001)}], Array.from({length:9},(_,i)=>({id:'a'+i,text:'x'}))]) assert.throws(()=>validatePromptBlocks(blocks));
  const manager = await workspace(t);
  const item = await manager.installZip(await zipPlugin('atelier-invalid', `export function apply(ctx){ctx.atelier.registerPromptBlock({id:'a',text:'x'});ctx.atelier.registerPromptBlock({id:'a',text:'y'});}`));
  await assert.rejects(manager.enable(item.id,true),/重复/); assert.deepEqual(await manager.promptBlocks(),[]);
});
