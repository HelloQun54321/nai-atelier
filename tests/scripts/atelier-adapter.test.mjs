import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import JSZip from 'jszip';
import { AtelierPluginManager } from '../../scripts/atelier-plugins.mjs';
import { packageAtelierAdapter, packageAtelierAdapterCli } from '../../scripts/package-atelier-adapter.mjs';
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

const sourceFixture = async t => {
  const directory = await mkdtemp(join(tmpdir(), 'adapter-editor-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const files = ['package.json', 'index.js', 'rules.js', 'README.md', 'UPSTREAM.json', 'upstream/LICENSE', 'upstream/THIRD_PARTY_NOTICES.md', 'prompts/local_execution.txt', 'prompts/appearance_tags.txt'];
  for (const file of files) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await copyFile(new URL('../../plugins/dsh-unrestricted-atelier/' + file, import.meta.url), join(directory, file));
  }
  return directory;
};

test('只编辑 TXT 即同步运行模块、预览与散列，保留换行和特殊字符且不执行旧模块', async t => {
  const sourceRoot = await sourceFixture(t);
  const execution = '合成正文\r\n"quoted" \\ backtick` ${globalThis.adapterEditorExecuted = true}\n';
  const appearance = '合成外观说明\n末尾空格  ';
  const original = Buffer.from('\uFEFF' + execution);
  await writeFile(join(sourceRoot, 'prompts/local_execution.txt'), original);
  await writeFile(join(sourceRoot, 'prompts/appearance_tags.txt'), appearance);
  await writeFile(join(sourceRoot, 'rules.js'), 'throw Error("old module must not execute");');
  const packaged = await packageAtelierAdapter({ sourceRoot, syncSources: true });
  assert.deepEqual(packaged, await packageAtelierAdapter({ sourceRoot, syncSources: true }));
  const zip = await JSZip.loadAsync(packaged);
  for (const entry of Object.values(zip.files)) assert.equal(entry.date.toISOString(), '2026-11-03T00:00:00.000Z', entry.name);
  const pkg = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(sourceRoot, 'UPSTREAM.json'), 'utf8'));
  const generated = await zip.file(`${pkg.name}/rules.js`).async('string');
  const runtime = await import('data:text/javascript;base64,' + Buffer.from(generated).toString('base64'));
  assert.equal(globalThis.adapterEditorExecuted, undefined);
  assert.equal(runtime.EXECUTION_MODE_BLOCK, execution);
  assert.equal(runtime.APPEARANCE_TAG_BLOCK, appearance);
  assert.deepEqual(pkg.atelier.promptBlocks.map(block => block.text), [execution, appearance]);
  assert.equal(provenance.fragmentSha256, createHash('sha256').update(execution).digest('hex'));
  assert.equal(provenance.appearanceSha256, createHash('sha256').update(appearance).digest('hex'));
  assert.deepEqual(await readFile(join(sourceRoot, 'prompts/local_execution.txt')), original);
  assert.equal(await readFile(join(sourceRoot, 'prompts/appearance_tags.txt'), 'utf8'), appearance);
  assert.equal((await zip.file(`${pkg.name}/prompts/local_execution.txt`).async('nodebuffer')).equals(original), true);
  assert.deepEqual(JSON.parse(await zip.file(`${pkg.name}/package.json`).async('string')), pkg);
  assert.equal(await readFile(join(sourceRoot, 'rules.js'), 'utf8'), generated);
});

test('命令行只输出 ZIP 路径、大小与散列，失败不回显正文且保留上次产物', async t => {
  const sourceRoot = await sourceFixture(t);
  const target = join(sourceRoot, 'output', 'adapter.zip');
  const body = 'SYNTHETIC_DO_NOT_LOG_THIS_BODY';
  await writeFile(join(sourceRoot, 'prompts/local_execution.txt'), body);
  let stdoutText = '', stderrText = '';
  const stdout = { write: text => { stdoutText += text; } };
  const stderr = { write: text => { stderrText += text; } };
  assert.equal(await packageAtelierAdapterCli({ sourceRoot, target, stdout, stderr }), 0);
  const receipt = JSON.parse(stdoutText);
  const archive = await readFile(target);
  const generated = await readFile(join(sourceRoot, 'rules.js'), 'utf8');
  assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'file', 'sha256']);
  assert.equal(receipt.file, target);
  assert.equal(receipt.bytes, archive.length);
  assert.equal(receipt.sha256, createHash('sha256').update(archive).digest('hex'));
  assert.ok(!stdoutText.includes(body)); assert.equal(stderrText, '');
  assert.deepEqual(JSON.parse(await readFile(target + '.sha256.json', 'utf8')), receipt);
  for (const invalid of ['', body.repeat(1000), Buffer.from([0xff, 0xfe])]) {
    stdoutText = ''; stderrText = '';
    await writeFile(join(sourceRoot, 'prompts/local_execution.txt'), invalid);
    assert.equal(await packageAtelierAdapterCli({ sourceRoot, target, stdout, stderr }), 1);
    assert.equal(stdoutText, '');
    assert.match(stderrText, /打包失败/);
    assert.ok(!stderrText.includes(body));
    assert.deepEqual(await readFile(target), archive);
    assert.equal(await readFile(join(sourceRoot, 'rules.js'), 'utf8'), generated);
  }
});
