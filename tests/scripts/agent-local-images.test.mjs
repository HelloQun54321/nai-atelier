import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentLocalImages } from '../../scripts/agent-local-images.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCX0AAAAASUVORK5CYII=', 'base64');
const scope = { sessionId: 'synthetic', keyHash: 'synthetic-key' };
const naia = () => {
  const bytes = Buffer.alloc(52); bytes.set([78,65,73,65,13,10,26,10]); bytes.writeUInt32BE(1, 8); bytes.writeUInt32BE(4, 12); return bytes;
};
const encoding = Buffer.alloc(64, 1).toString('base64');
const vibeBundle = Buffer.from(JSON.stringify({ identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes: [{ identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', id: createHash('sha256').update(encoding).digest('hex'), encodings: { v5full: { synthetic: { encoding, params: { information_extracted: 1 } } } } }] }));
const fixture = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'nai-local-image-test-'));
  const read = join(root, 'read'), write = join(root, 'write'), protectedRoot = join(root, 'local-data');
  await Promise.all([read, write, protectedRoot].map(path => mkdir(path)));
  await writeFile(join(read, 'source.png'), png);
  let mode = 'standard'; const store = new AgentLocalImages({ protectedRoot, getMode: () => mode });
  try { await fn({ root, read, write, protectedRoot, store, setMode: next => { mode = next; } }); }
  finally { await rm(root, { recursive: true, force: true }); }
};
test('标准档直接读取图片，写目录批准绑定用途、会话与 Key，没有计时租约', () => fixture(async ({ read, write, store }) => {
  assert.equal((await store.list(scope, read)).items[0].name, 'source.png');
  await assert.rejects(store.save(scope, read, 'image.png', png), /写入权限/);
  const receipt = await store.grant(scope, write, 'write'); assert.equal(receipt.expiresAt, undefined);
  assert.equal((await store.list(scope, write)).items.length, 0);
  await assert.rejects(store.save({ ...scope, keyHash: 'other' }, write, 'image.png', png), /写入权限/);
  await assert.rejects(store.save({ ...scope, sessionId: 'other' }, write, 'image.png', png), /写入权限/);
  assert.equal((await store.save(scope, write, 'image.png', png)).saved, true);
}));
test('只读拒绝写入和目录创建，完全访问无需目录授权，切档立即生效', () => fixture(async ({ root, read, write, store, setMode }) => {
  setMode('read_only');
  assert.equal((await store.list(scope, read)).items.length, 1);
  await assert.rejects(store.grant(scope, join(root, 'new'), 'write', true), /只读/);
  await assert.rejects(store.save(scope, write, 'read-only.png', png), /只读/);
  setMode('full'); assert.equal((await store.save(scope, write, 'full.png', png)).saved, true);
  setMode('standard'); await assert.rejects(store.save(scope, write, 'standard.png', png), /写入权限/);
}));
test('原图字节保留、同名不覆盖、重复调用幂等和文件名校验', () => fixture(async ({ write, store }) => {
  await store.grant(scope, write, 'write');
  await writeFile(join(write, 'image.png'), Buffer.from('existing'));
  const saved = await store.save(scope, write, 'image.png', png, 'operation');
  assert.equal(saved.filename, 'image (1).png'); assert.equal(saved.overwritten, false);
  assert.deepEqual(await readFile(saved.path), png);
  assert.equal((await readFile(join(write, 'image.png'))).toString(), 'existing');
  assert.deepEqual(await store.save(scope, write, 'image.png', png, 'operation'), saved);
  for (const filename of ['../escape.png', 'sub/image.png', 'CON.png', 'bad.png.', '.hidden.png', 'bad.jpg']) await assert.rejects(store.save(scope, write, filename, png));
  await assert.rejects(store.save(scope, write, 'text.png', Buffer.from('not an image')), /只允许/);
}));
test('所有档位保护 local-data，标准档写入软链接不能逃逸已确认目录', () => fixture(async ({ read, root, protectedRoot, store, setMode }) => {
  await assert.rejects(store.grant(scope, protectedRoot, 'read'), /保护区/);
  await assert.rejects(store.grant(scope, join(protectedRoot, 'new'), 'write', true), /保护区/);
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'other.png'), png);
  await symlink(outside, join(read, 'escape'), 'junction');
  await symlink(protectedRoot, join(read, 'protected'), 'junction');
  await store.grant(scope, read, 'write');
  assert.equal((await store.list(scope, read)).items.length, 2);
  assert.deepEqual((await store.read(scope, join(read, 'escape', 'other.png'))).buffer, png);
  await assert.rejects(store.save(scope, join(read, 'escape'), 'bad.png', png), /权限/);
  await assert.rejects(store.grant(scope, join(read, 'protected'), 'read'), /保护区/);
  setMode('full'); await assert.rejects(store.save(scope, protectedRoot, 'bad.png', png), /保护区/);
}));
test('展示使用不透明引用，不能换会话或 Key 获取图片，引用没有计时租约', () => fixture(async ({ read, store }) => {
  await store.grant(scope, read, 'read'); const reference = await store.register(scope, join(read, 'source.png'));
  assert.equal(reference.path.includes(read), false); assert.equal(reference.modelHasSeenImage, false);
  assert.deepEqual((await store.asset(scope, reference.id)).buffer, png);
  await assert.rejects(store.asset({ ...scope, keyHash: 'other' }, reference.id), /不属于/);
  await assert.rejects(store.asset({ ...scope, sessionId: 'other' }, reference.id), /不属于/);
  assert.equal(store.images.get(reference.id).expiresAt, undefined);
}));
test('分页不递归、拒绝伪图片、目录创建只在批准后执行', () => fixture(async ({ root, read, store }) => {
  await store.grant(scope, read, 'read'); await mkdir(join(read, 'sub'));
  await writeFile(join(read, 'fake.jpg'), 'text'); await writeFile(join(read, 'hidden.txt'), 'private');
  const first = await store.list(scope, read, 0, 1); assert.equal(first.items.length, 1); assert.equal(first.nextOffset, 1); assert.equal(first.recursive, false);
  await assert.rejects(store.read(scope, join(read, 'fake.jpg')), /内容不是/);
  const target = join(root, 'new', 'nested'); await store.folder(target, true);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  await store.grant(scope, target, 'write', true); assert.equal((await store.save(scope, target, 'new', png)).filename, 'new.png');
}));

test('创作文件上传引用校验内容与归属，目录递归保留相对路径', () => fixture(async ({ read, protectedRoot, store }) => {
  await mkdir(join(read, 'nested')); await writeFile(join(read, 'nested', 'preset.json'), '{"name":"synthetic"}');
  await writeFile(join(read, 'bad.json'), 'invalid');
  await assert.rejects(store.registerFile(scope, join(read, 'bad.json')));
  await rm(join(read, 'bad.json')); await writeFile(join(read, 'hidden.txt'), 'not an asset');
  const files = await store.directoryFiles(scope, read); assert.equal(files.length, 2);
  const listed = await store.list(scope, join(read, 'nested'), 0, 30, true); assert.equal(listed.items[0].name, 'preset.json'); assert.equal(listed.items[0].kind, 'creative-file');
  assert.equal((await store.list(scope, join(read, 'nested'))).items.length, 0);
  const json = files.find(item => item.name === 'preset.json'); assert.match(json.relativePath, /read\/nested\/preset.json$/);
  const id = new URL(json.path, 'http://localhost').searchParams.get('id');
  assert.deepEqual(JSON.parse((await store.asset(scope, id)).buffer.toString()), { name: 'synthetic' });
  await assert.rejects(store.asset({ ...scope, keyHash: 'different' }, id), /不属于/);
  await writeFile(join(protectedRoot, 'secret.json'), '{"synthetic":true}');
  await assert.rejects(store.registerFile(scope, join(protectedRoot, 'secret.json')), /保护区/);
}));
test('实际导出支持 JSON、Vibe 和 ZIP，隔离归属与写权限且同名不覆盖', () => fixture(async ({ write, store, setMode }) => {
  const bytes = Buffer.from('{"synthetic":true}');
  const item = store.registerExport(scope, 'preset.json', bytes);
  await assert.rejects(store.saveExport(scope, item.exportId, write), /写入权限/);
  setMode('full'); await assert.rejects(store.saveExport({ ...scope, sessionId: 'other' }, item.exportId, write), /不属于/);
  const first = await store.saveExport(scope, item.exportId, write, undefined, 'op');
  assert.deepEqual(await readFile(first.path), bytes); assert.equal(first.filename, 'preset.json');
  assert.deepEqual(await store.saveExport(scope, item.exportId, write, undefined, 'op'), first);
  const second = await store.saveExport(scope, item.exportId, write); assert.equal(second.filename, 'preset (1).json');
  for (const [name, data] of [['vibe.naiv4vibe', bytes], ['assets.zip', Buffer.from('PK-synthetic')]]) {
    const ref = store.registerExport(scope, name, data); assert.equal((await store.saveExport(scope, ref.exportId, write)).filename, name);
  }
  assert.throws(() => store.registerExport(scope, 'arbitrary.txt', bytes), /仅支持/);
  assert.throws(() => store.registerExport(scope, 'broken.zip', bytes), /仅支持/);
  setMode('read_only'); await assert.rejects(store.saveExport(scope, item.exportId, write), /只读/);
}));

test('分享包与 Vibe 组合贯通列出、文件引用、目录导入及原字节导出，不覆盖同名文件', () => fixture(async ({ read, write, store, setMode }) => {
  const cases = [['recipe.naia', naia(), 'application/x-nai-atelier-style-bundle'], ['references.naiv4vibeBundle', vibeBundle, 'application/json']];
  for (const [name, bytes] of cases) await writeFile(join(read, name), bytes);
  const listing = await store.list(scope, read, 0, 50, true);
  for (const [name] of cases) assert.equal(listing.items.find(item => item.name === name)?.kind, 'creative-file');
  assert.equal((await store.list(scope, read)).items.length, 1);
  const files = await store.directoryFiles(scope, read);
  setMode('full');
  for (const [name, bytes, mimeType] of cases) {
    const file = files.find(item => item.name === name); assert.ok(file); assert.equal(file.relativePath, 'read/' + name);
    const id = new URL(file.path, 'http://localhost').searchParams.get('id');
    const asset = await store.asset(scope, id); assert.deepEqual(asset.buffer, bytes); assert.equal(asset.mimeType, mimeType);
    await assert.rejects(store.asset({ ...scope, keyHash: 'other' }, id), /不属于/);
    const exported = store.registerExport(scope, name, asset.buffer);
    const first = await store.saveExport(scope, exported.exportId, write);
    assert.equal(first.filename, name); assert.deepEqual(await readFile(first.path), bytes);
    const second = await store.saveExport(scope, exported.exportId, write);
    assert.equal(second.overwritten, false); assert.notEqual(second.path, first.path); assert.deepEqual(await readFile(second.path), bytes);
  }
}));

test('新格式拒绝损坏头部、错误组合形态、保护区及超过单文件上限的包', () => fixture(async ({ read, protectedRoot, store }) => {
  const unsupported = naia(); unsupported.writeUInt32BE(2, 8);
  const length = naia(); length.writeUInt32BE(100, 12);
  for (const [name, bytes] of [['short.naia', Buffer.from('NAIA')], ['version.naia', unsupported], ['length.naia', length], ['array.naiv4vibeBundle', Buffer.from('[]')], ['empty.naiv4vibeBundle', Buffer.from('{"identifier":"novelai-vibe-transfer-bundle","version":1,"vibes":[]}')], ['bad.naiv4vibeBundle', Buffer.from('{"identifier":"novelai-vibe-transfer-bundle","version":1,"vibes":[{}]}')]]) {
    await writeFile(join(read, name), bytes);
    await assert.rejects(store.registerFile(scope, join(read, name)));
    assert.throws(() => store.registerExport(scope, name, bytes));
  }
  await writeFile(join(protectedRoot, 'private.naia'), naia());
  await assert.rejects(store.registerFile(scope, join(protectedRoot, 'private.naia')), /保护区/);
  await writeFile(join(read, 'large.naia'), naia()); await truncate(join(read, 'large.naia'), 30 * 1024 * 1024 + 1);
  await assert.rejects(store.registerFile(scope, join(read, 'large.naia')), /30 MB/);
  assert.throws(() => store.registerExport(scope, 'large.naia', Buffer.alloc(30 * 1024 * 1024 + 1)), /30 MB/);
}));

test('目录导入在 128 MB 总量处明确拒绝，不返回成功文件清单', () => fixture(async ({ read, store }) => {
  for (let index = 0; index < 5; index++) { const path = join(read, `large-${index}.png`); await writeFile(path, png); await truncate(path, 27 * 1024 * 1024); }
  await assert.rejects(store.directoryFiles(scope, read), /128 MB/);
}));
