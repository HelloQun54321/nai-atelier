import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { exportWithPreferences, getDefaultExportDirectory, handleExportLocationRequest, saveExportFile } from '../../scripts/export-locations.mjs';
import { getStoragePreferences, updateStoragePreferences } from '../../scripts/storage-locations.mjs';

test('导出状态仅展示安装版注入的真实默认目录，源码默认路径保持未知', async () => {
  const root = createWorkspace('export-system-');
  try {
    for (const systemDirectory of ['', 'E:\\实际下载目录']) {
      const req = Readable.from([]); req.method = 'GET'; req.url = '/api/local-maintenance/export-location';
      let result; const res = { writeHead() {}, end(value) { result = JSON.parse(value); } };
      await handleExportLocationRequest(req, res, { workspace: root, canManage: true, systemDirectory });
      assert.equal(result.systemDirectory, systemDirectory);
    }
  } finally { removeWorkspace(root); }
});

test('选择请求断开后迟到路径不得保存，取消的排队偏好写入保持原设置', { skip: process.platform !== 'win32' }, async () => {
  const root = createWorkspace('export-abort-');
  try {
    await updateStoragePreferences({ exportMode: 'system', exportDir: 'original' }, root);
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'pick' }))]); req.method = 'POST'; req.url = '/api/local-maintenance/export-location'; req.headers = { 'x-nai-local-control': 'true' };
    const res = new EventEmitter(); res.writeHead = () => {}; res.end = () => {};
    let finish, reached; const called = new Promise(done => { reached = done; });
    const pending = handleExportLocationRequest(req, res, { workspace: root, canManage: true, pickDirectory: () => new Promise(done => { finish = done; reached(); }) });
    await called; res.destroyed = true; res.emit('close'); finish({ cancelled: false, path: 'E:\\迟到目录' }); await pending;
    assert.equal((await getStoragePreferences(root)).exportDir, 'original');
    const controller = new AbortController();
    const queued = updateStoragePreferences({ exportDir: 'late' }, root, { signal: controller.signal });
    controller.abort(); await assert.rejects(queued, /abort/i);
    assert.equal((await getStoragePreferences(root)).exportDir, 'original');
  } finally { removeWorkspace(root); }
});

test('导出副本原子避让同名文件，拒绝越界文件名与不可用目录', async () => {
  const root = createWorkspace('export-copies-');
  try {
    const copies = await Promise.all([1,2,3].map(value => saveExportFile({data:Buffer.from(String(value)),filename:'作品.png',directory:root})));
    assert.equal(new Set(copies.map(value=>value.path)).size,3);
    assert.deepEqual((await Promise.all(copies.map(value=>readFile(value.path,'utf8')))).sort(),['1','2','3']);
    await assert.rejects(saveExportFile({data:Buffer.from('x'),filename:'../private.png',directory:root}),/文件名无效/);
    await assert.rejects(saveExportFile({data:Buffer.from('x'),filename:'x.png',directory:join(root,'missing')}),/ENOENT/);
    assert.equal((await readdir(root)).length,3);
  } finally { removeWorkspace(root); }
});
test('明确目录实际写入，系统浏览器默认只移交下载，每次询问取消不生成文件',async()=>{
  const root=createWorkspace('export-modes-');
  try{
    const directory=join(root,'exports');await mkdir(directory);
    const options={workspace:root,data:Buffer.from('synthetic'),filename:'work.png',pickDirectory:async()=>({cancelled:true,path:''})};
    assert.deepEqual(await exportWithPreferences(options),{saved:false,cancelled:false,browserDownload:true});
    await updateStoragePreferences({exportMode:'directory',exportDir:directory},root);
    assert.equal(await getDefaultExportDirectory(root),directory);
    assert.equal((await exportWithPreferences(options)).saved,true);
    await updateStoragePreferences({exportMode:'ask'},root);
    assert.equal(await getDefaultExportDirectory(root),'');
    assert.deepEqual(await exportWithPreferences(options),{saved:false,cancelled:true});
    assert.deepEqual(await readdir(directory),['work.png']);
  }finally{removeWorkspace(root);}
});
test('目录选择取消保留偏好，LAN请求无权读取或写入电脑导出目录',async()=>{
  const root=createWorkspace('export-auth-');
  const request=async(canManage,body)=>{
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.url='/api/local-maintenance/export-location';req.method='POST';req.headers={'x-nai-local-control':'true'};
    let status=0,result;const res={writeHead(value){status=value;},end(value){result=JSON.parse(value);}};
    assert.equal(await handleExportLocationRequest(req,res,{workspace:root,canManage,pickDirectory:async()=>({cancelled:true,path:''})}),true);
    return {status,result};
  };
  try{
    await updateStoragePreferences({exportMode:'system',exportDir:'remembered'},root);
    assert.equal((await request(false,{action:'clear'})).status,403);
    if(process.platform==='win32')assert.deepEqual((await request(true,{action:'pick'})).result,{cancelled:true});
    assert.equal((await getStoragePreferences(root)).exportDir,'remembered');
    assert.equal((await request(true,{action:'save',data:'!',filename:'x.png'})).status,400);
  }finally{removeWorkspace(root);}
});
test('二进制导出逐块写入真实系统目录，长度校验和授权失败不留文件', async () => {
  const root = createWorkspace('export-binary-');
  const request = async (chunks, headers = {}, canManage = true) => {
    const req = Readable.from(chunks); req.method = 'POST'; req.url = '/api/local-maintenance/export-location';
    req.headers = { 'content-type': 'application/octet-stream', 'x-nai-local-control': 'true', 'x-nai-export-filename': encodeURIComponent('分享.naia'), 'x-nai-export-size': '6', ...headers };
    let status, result; const res = { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } };
    await handleExportLocationRequest(req, res, { workspace: root, canManage, systemDirectory: root });
    return { status, result };
  };
  try {
    assert.equal((await request([Buffer.from('abc'), Buffer.from('def')])).result.saved, true);
    assert.equal(await readFile(join(root, '分享.naia'), 'utf8'), 'abcdef');
    assert.equal((await request([Buffer.from('short')])).status, 400);
    assert.equal((await request([Buffer.from('excess!')])).status, 400);
    assert.equal((await request([], { 'x-nai-export-size': String(2 ** 31 + 1) })).status, 400);
    assert.equal((await request([], {}, false)).status, 403);
    assert.equal((await request([], { 'x-nai-local-control': '' })).status, 403);
    assert.deepEqual(await readdir(root), ['分享.naia']);
  } finally { removeWorkspace(root); }
});
test('流传输断开时清除部分文件且保留既有同名作品', async () => {
  const root = createWorkspace('export-stream-abort-');
  try {
    await saveExportFile({ data: Buffer.from('original'), filename: 'work.naia', directory: root });
    const controller = new AbortController();
    async function* chunks() { yield Buffer.from('partial'); controller.abort(); yield Buffer.from('late'); }
    await assert.rejects(saveExportFile({ data: chunks(), filename: 'work.naia', directory: root, signal: controller.signal, expectedLength: 11 }), /abort/i);
    assert.deepEqual(await readdir(root), ['work.naia']);
    assert.equal(await readFile(join(root, 'work.naia'), 'utf8'), 'original');
  } finally { removeWorkspace(root); }
});
test('HTTP响应连接断开后中止流写，不保留迟到文件', async () => {
  const root = createWorkspace('export-http-abort-');
  try {
    const res = new EventEmitter(); res.writeHead = () => {}; res.end = () => {};
    async function* chunks() { yield Buffer.from('part'); res.destroyed = true; res.emit('close'); yield Buffer.from('late'); }
    const req = Readable.from(chunks()); req.method = 'POST'; req.url = '/api/local-maintenance/export-location';
    req.headers = { 'content-type': 'application/octet-stream', 'x-nai-local-control': 'true', 'x-nai-export-filename': 'work.naia', 'x-nai-export-size': '8' };
    await handleExportLocationRequest(req, res, { workspace: root, canManage: true, systemDirectory: root });
    assert.deepEqual(await readdir(root), []);
  } finally { removeWorkspace(root); }
});

test('JSON 导出接受几 MiB 和几十 MiB 的合法 Base64，保存字节完整且拒绝错误补位', async () => {
  const root = createWorkspace('export-json-large-');
  const request = async (data, filename) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'save', data, filename }))]);
    req.method = 'POST'; req.url = '/api/local-maintenance/export-location'; req.headers = { 'x-nai-local-control': 'true' };
    let status, result;
    const res = { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } };
    await handleExportLocationRequest(req, res, { workspace: root, canManage: true });
    return { status, result };
  };
  try {
    const directory = join(root, 'exports'); await mkdir(directory);
    await updateStoragePreferences({ exportMode: 'directory', exportDir: directory }, root);
    for (const size of [64, 4 * 1024 * 1024, 24 * 1024 * 1024]) {
      const bytes = Buffer.alloc(size, 81), filename = `${size}.naiv4vibe`;
      const response = await request(bytes.toString('base64'), filename);
      assert.equal(response.status, 200, JSON.stringify(response.result));
      assert.equal(response.result.saved, true);
      assert.deepEqual(await readFile(join(directory, filename)), bytes);
    }
    for (const invalid of ['A', 'AAA', 'AAAA=', 'AA=A', 'AA===', 'AA\n=']) {
      const response = await request(invalid, 'invalid.naiv4vibe');
      assert.equal(response.status, 400);
      assert.equal(response.result.error, '导出文件内容无效');
    }
    assert.equal((await readdir(directory)).length, 3);
    await updateStoragePreferences({ exportDir: join(root, 'missing') }, root);
    assert.equal((await request('eA==', 'unavailable.naiv4vibe')).status, 400);
  } finally { removeWorkspace(root); }
});
