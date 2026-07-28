import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { canonicalVibeSourceHash, collectStHistoryCandidates, resolveStUserFile, StChatu8Bridge } from './st-chatu8-bridge.mjs';

const tempRoot = name => join(tmpdir(), `npm-st-bridge-${name}-${process.pid}-${Date.now()}`);

test('SillyTavern user paths stay inside the user data root', () => {
  const root = 'D:\\SillyTavern';
  assert.equal(resolveStUserFile(root, '/user/images/example.png'), join(root, 'data', 'default-user', 'user', 'images', 'example.png'));
  assert.equal(resolveStUserFile(root, '/user/../../settings.json'), null);
  assert.equal(resolveStUserFile(root, 'file:///C:/secret.txt'), null);
});

test('history discovery uses only the original path and never the thumbnail path', () => {
  const settings = { jiuguanStorage: { one: { images: [
    { path: '/user/images/chatu8/a.png', thumbnail_path: '/user/images/chatu8/thumbnails/a.jpg' },
    { path: '/user/images/chatu8/thumbnails/b.jpg', thumbnail_path: '/user/images/chatu8/thumbnails/b.jpg' },
  ] } } };
  const items = collectStHistoryCandidates(settings, path => `ROOT${path}`);
  assert.equal(items.length, 1);
  assert.equal(items[0].image.path, '/user/images/chatu8/a.png');
  assert.equal(items[0].filePath, 'ROOT/user/images/chatu8/a.png');
});

test('known external history rows are not imported again', async () => {
  const root = tempRoot('history');
  const imagePath = join(root, 'data', 'default-user', 'user', 'images', 'chatu8', 'a.png');
  await mkdir(join(root, 'data', 'default-user'), { recursive: true });
  await mkdir(join(root, 'data', 'default-user', 'user', 'images', 'chatu8'), { recursive: true });
  await writeFile(imagePath, Buffer.from('not-read-because-known'));
  await writeFile(join(root, 'data', 'default-user', 'settings.json'), JSON.stringify({ extension_settings: { 'st-chatu8': {
    jiuguanStorage: { one: { images: [{ path: '/user/images/chatu8/a.png', thumbnail_path: '/user/images/chatu8/thumbnails/a.jpg' }] } },
  } } }));
  let imports = 0;
  const bridge = new StChatu8Bridge({
    projectRoot: root,
    requestWorkerJson: async (path, options) => {
      if (path.endsWith('/known')) return { externalIds: options.body.externalIds };
      if (path.endsWith('/import')) imports++;
      return {};
    },
    requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }),
  });
  bridge.root = root;
  bridge.saveState = async () => {};
  await bridge.syncHistory();
  assert.equal(imports, 0);
  assert.equal(Object.keys(bridge.state.history).length, 1);
});

test('st-chatu8 remains authoritative for linked artists without creating duplicates', async () => {
  const chains = [];
  let updates = 0;
  const bridge = new StChatu8Bridge({
    requestWorkerJson: async (path, options = {}) => {
      if (path === '/api/chains' && !options.method) return structuredClone(chains);
      if (path === '/api/chains' && options.method === 'POST') {
        const item = { id: 'chain-1', ...options.body, createdAt: 1, updatedAt: 1 };
        chains.push(item);
        return { id: item.id };
      }
      if (path === '/api/chains/chain-1' && options.method === 'PUT') {
        updates++;
        Object.assign(chains[0], options.body, {
          previewImage: options.body.previewImage?.startsWith('data:') ? '/api/assets/covers/chain-1.png' : options.body.previewImage,
          updatedAt: 3,
        });
        return { id: 'chain-1' };
      }
      if (path === '/api/chains/chain-1' && !options.method) return structuredClone(chains[0]);
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    },
    requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }),
  });
  bridge.saveState = async () => {};
  await bridge.syncArtists([{ externalId: 'st:one', name: '画风 A', fixedPrompt: 'first', updatedAt: 1 }]);
  chains[0].basePrompt = 'local edit that must not win';
  chains[0].updatedAt = 999;
  await bridge.syncArtists([{ externalId: 'st:one', name: '画风 A', fixedPrompt: 'second', updatedAt: 2 }]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].basePrompt, 'second');
  assert.equal(updates, 1);
});

test('artist preview is retained and an unchanged preview is not uploaded on every sync', async () => {
  const chains = [];
  let previewUploads = 0;
  const bridge = new StChatu8Bridge({
    requestWorkerJson: async (path, options = {}) => {
      if (path === '/api/chains' && !options.method) return structuredClone(chains);
      if (path === '/api/chains' && options.method === 'POST') {
        chains.push({ id: 'chain-cover', previewImage: '', ...options.body, createdAt: 1, updatedAt: 1 });
        return { id: 'chain-cover' };
      }
      if (path === '/api/chains/chain-cover' && options.method === 'PUT') {
        if (options.body.previewImage?.startsWith('data:')) previewUploads++;
        Object.assign(chains[0], options.body, { previewImage: '/api/assets/covers/chain-cover.png', updatedAt: 2 });
        return { success: true };
      }
      if (path === '/api/chains/chain-cover' && !options.method) return structuredClone(chains[0]);
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    },
    requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }),
  });
  bridge.readStPreviewData = async () => 'data:image/png;base64,aW1hZ2U=';
  bridge.saveState = async () => {};
  const artist = { externalId: 'st:cover', name: '带封面的画风', fixedPrompt: 'style', previewPath: '/user/images/cover.png', updatedAt: 1 };
  await bridge.syncArtists([artist]);
  await bridge.syncArtists([artist]);
  assert.equal(chains[0].previewImage, '/api/assets/covers/chain-cover.png');
  assert.equal(previewUploads, 1);
  assert.equal(bridge.state.artistLinks['st:cover'].lastNpmPreviewImage, '/api/assets/covers/chain-cover.png');
});

test('Vibe identity is canonicalized from image bytes across exporter-specific ids', () => {
  const image = Buffer.from('same-vibe-image');
  const a = canonicalVibeSourceHash({ image: image.toString('base64'), id: 'a'.repeat(64) });
  const b = canonicalVibeSourceHash({ image: `data:image/png;base64,${image.toString('base64')}`, id: 'b'.repeat(64) });
  assert.equal(a, b);
  assert.notEqual(a, 'a'.repeat(64));
});
