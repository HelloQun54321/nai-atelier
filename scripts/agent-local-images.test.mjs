import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLocalImages } from './agent-local-images.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCX0AAAAASUVORK5CYII=', 'base64');
const scope = { sessionId: 'synthetic', keyHash: 'synthetic-key' };
const fixture = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'nai-local-image-test-'));
  const read = join(root, 'read'), write = join(root, 'write'), protectedRoot = join(root, 'local-data');
  await Promise.all([read, write, protectedRoot].map(path => mkdir(path)));
  await writeFile(join(read, 'source.png'), png);
  let clock = Date.now(); const store = new AgentLocalImages({ protectedRoot, now: () => clock });
  try { await fn({ root, read, write, protectedRoot, store, expire: () => { clock += 3 * 60 * 60 * 1000; } }); }
  finally { await rm(root, { recursive: true, force: true }); }
};
test('本地图片权限绑定用途、会话、Key 和过期时间', () => fixture(async ({ read, write, store, expire }) => {
  await assert.rejects(store.list(scope, read), /权限/);
  await store.grant(scope, read, 'read');
  assert.equal((await store.list(scope, read)).items[0].name, 'source.png');
  await assert.rejects(store.read({ ...scope, keyHash: 'other' }, join(read, 'source.png')), /权限/);
  await assert.rejects(store.read({ ...scope, sessionId: 'other' }, join(read, 'source.png')), /权限/);
  await assert.rejects(store.save(scope, read, 'image.png', png), /写入权限/);
  await store.grant(scope, write, 'write');
  await assert.rejects(store.list(scope, write), /读取权限/);
  expire(); await assert.rejects(store.list(scope, read), /权限/);
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
test('保护区和越界目录软链接不可读取或写入', () => fixture(async ({ read, root, protectedRoot, store }) => {
  await assert.rejects(store.grant(scope, protectedRoot, 'read'), /保护区/);
  await assert.rejects(store.grant(scope, join(protectedRoot, 'new'), 'write', true), /保护区/);
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'other.png'), png);
  await symlink(outside, join(read, 'escape'), 'junction');
  await symlink(protectedRoot, join(read, 'protected'), 'junction');
  await store.grant(scope, read, 'read');
  assert.equal((await store.list(scope, read)).items.length, 1);
  await assert.rejects(store.read(scope, join(read, 'escape', 'other.png')), /权限/);
  await assert.rejects(store.grant(scope, join(read, 'protected'), 'read'), /保护区/);
}));
test('展示使用不透明引用，不能换会话或 Key 读取；过期要重新确认', () => fixture(async ({ read, store, expire }) => {
  await store.grant(scope, read, 'read'); const reference = await store.register(scope, join(read, 'source.png'));
  assert.equal(reference.path.includes(read), false); assert.equal(reference.modelHasSeenImage, false);
  assert.deepEqual((await store.asset(scope, reference.id)).buffer, png);
  await assert.rejects(store.asset({ ...scope, keyHash: 'other' }, reference.id), /失效/);
  expire(); await assert.rejects(store.asset(scope, reference.id), /失效/);
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
