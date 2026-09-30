import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import {
  canonicalVibeSourceHash,
  collectStHistoryCandidates,
  computeSillyTavernExtensionTargetDir,
  installSillyTavernBridgeExtension,
  resolveStUserFile,
  StChatu8Bridge,
} from './st-chatu8-bridge.mjs';

const tempRoot = name => join(tmpdir(), `npm-st-bridge-${name}-${process.pid}-${Date.now()}`);

// 全部资料与回执在内存，不接触真实 D1、R2 或酒馆设置。
const artistFixture = (initial = [], selected = []) => {
  const chains = structuredClone(initial);
  const calls = [];
  const selection = { chainIds: selected };
  let nextId = 0;
  const bridge = new StChatu8Bridge({
    requestWorkerJson: async (path, options = {}) => {
      calls.push({ path, ...structuredClone(options) });
      if (path === '/api/st-chatu8/export-selection') return structuredClone(selection);
      if (path === '/api/chains' && !options.method) return structuredClone(chains);
      if (path === '/api/chains' && options.method === 'POST') {
        const item = { ...options.body, id: `imported-${++nextId}`, previewImage: '', createdAt: 1, updatedAt: 1 };
        chains.push(item); return { id: item.id };
      }
      if (path.startsWith('/api/chains/')) {
        const chain = chains.find(item => item.id === decodeURIComponent(path.slice('/api/chains/'.length)));
        if (!chain) throw new Error('Synthetic chain missing');
        if (options.method === 'PUT') {
          Object.assign(chain, options.body, { updatedAt: chain.updatedAt + 1 });
          if (chain.previewImage?.startsWith('data:')) chain.previewImage = `/api/assets/${chain.id}-cover.png`;
          return { success: true };
        }
        return structuredClone(chain);
      }
      if (path === '/api/vibes' || path === '/api/vibe-groups') return { items: [] };
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    },
    requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }),
  });
  bridge.saveState = async () => {};
  const local = (id, name = id, model = 'nai-diffusion-4-5-full') => ({ id, name, type: 'style', basePrompt: `artist:${id}`, negativePrompt: '', modules: [], params: { model }, previewImage: '', createdAt: 1, updatedAt: 1 });
  return { bridge, chains, calls, selection, local };
};

test('outbound defaults to empty despite legacy full-library links; inbound still imports all', async () => {
  const f = artistFixture(); f.chains.push(f.local('keep-local'));
  f.bridge.state.artistLinks['npm:keep-local'] = { chainId: 'keep-local', lastNpmHash: 'legacy' };
  const result = await f.bridge.syncArtists([{ externalId: 'st:incoming', name: '酒馆风格', fixedPrompt: 'artist:st' }]);
  assert.deepEqual(result, []); assert.equal(f.chains.length, 2);
  assert.equal(f.chains[0].basePrompt, 'artist:keep-local');
  assert.equal(f.chains[1].basePrompt, 'artist:st');
  assert.equal(f.calls.some(call => call.method === 'DELETE'), false);
});

test('only selected V4.5 styles export, including Curated; V5 and other types cannot bypass server checks', async () => {
  const f = artistFixture();
  f.chains.push(f.local('chosen'), f.local('curated', 'Curated', 'nai-diffusion-4-5-curated'), f.local('hidden'), f.local('v5', 'V5', 'nai-diffusion-5-full'), f.local('v4', 'V4', 'nai-diffusion-4-full'), { ...f.local('character'), type: 'character' });
  const result = await f.bridge.syncArtists([], ['chosen', 'curated', 'v5', 'v4', 'character', 'deleted']);
  assert.deepEqual(result.map(item => item.externalId), ['npm:chosen', 'npm:curated']);
  assert.equal(f.bridge.state.artistLinks['npm:hidden'], undefined);
  assert.equal(f.bridge.state.artistLinks['npm:v5'], undefined);
  assert.equal(f.chains.find(item => item.id === 'v5').params.model, 'nai-diffusion-5-full');
  assert.deepEqual(await f.bridge.syncArtists([], []), []);
});

test('client snapshot acknowledges unchanged export and cover; repeated sync and restart do not write or bounce covers', async () => {
  const f = artistFixture(); f.chains.push({ ...f.local('chosen'), previewImage: '/api/assets/original.png' });
  const [first] = await f.bridge.syncArtists([], ['chosen']);
  let reads = 0; f.bridge.readStPreviewData = async () => { reads++; return 'data:image/png;base64,aW1hZ2U='; };
  const incoming = { ...first, previewPath: '/user/images/npm_bridge_preview.png', previewSourceImage: first.previewImage };
  f.calls.length = 0;
  assert.deepEqual(await f.bridge.syncArtists([incoming], ['chosen']), []);
  assert.deepEqual(await f.bridge.syncArtists([incoming], ['chosen']), []);
  assert.equal(reads, 0); assert.equal(f.calls.some(call => call.method), false);
  assert.equal(f.chains[0].previewImage, '/api/assets/original.png');
  const restart = artistFixture(f.chains); restart.bridge.state = structuredClone(f.bridge.state);
  assert.deepEqual(await restart.bridge.syncArtists([incoming], ['chosen']), []);
  assert.equal(restart.calls.some(call => call.method), false);
});

test('unacknowledged covers retry on the next sync; imported native covers and unchanged text are not echoed', async () => {
  const f = artistFixture(); f.chains.push({ ...f.local('chosen'), previewImage: '/api/assets/original.png' });
  const [first] = await f.bridge.syncArtists([], ['chosen']);
  assert.equal((await f.bridge.syncArtists([{ ...first, previewPath: '' }], ['chosen'])).length, 1);
  const native = artistFixture(); native.bridge.readStPreviewData = async () => 'data:image/png;base64,aW1hZ2U=';
  const item = { externalId: 'st:native', name: '酒馆原生风格', fixedPrompt: 'artist:native', previewPath: '/user/native.png' };
  await native.bridge.syncArtists([item]); const chainId = native.chains[0].id;
  native.calls.length = 0;
  assert.deepEqual(await native.bridge.syncArtists([item], [chainId]), []);
  assert.equal(native.calls.some(call => call.method), false);
});

test('all inbound styles beyond the old 1000 limit import once without repeatedly fetching the entire library', async () => {
  const f = artistFixture();
  const incoming = Array.from({ length: 1005 }, (_, index) => ({ externalId: `st:${index}`, name: `风格 ${index}`, fixedPrompt: `artist:${index}` }));
  await f.bridge.syncArtists(incoming);
  assert.equal(f.chains.length, incoming.length);
  assert.equal(f.calls.filter(call => call.path === '/api/chains' && !call.method).length, 2);
  f.calls.length = 0; await f.bridge.syncArtists(incoming);
  assert.equal(f.calls.some(call => call.method), false); assert.equal(f.chains.length, incoming.length);
  assert.equal(f.bridge.lastArtistSync.unchanged, incoming.length);
});

test('missing inbound cover is not acknowledged and can complete later without recreating the style', async () => {
  const f = artistFixture(); let reads = 0;
  f.bridge.readStPreviewData = async () => ++reads === 1 ? null : 'data:image/png;base64,aW1hZ2U=';
  const item = { externalId: 'st:pending-cover', name: '暂未就绪的封面', fixedPrompt: 'style', previewPath: '/user/pending.png' };
  await f.bridge.syncArtists([item]); assert.equal(f.bridge.state.artistLinks[item.externalId].lastStPreviewPath, '');
  await f.bridge.syncArtists([item]); await f.bridge.syncArtists([item]);
  assert.equal(f.chains.length, 1); assert.equal(reads, 2);
  assert.equal(f.chains[0].previewImage, '/api/assets/imported-1-cover.png');
  assert.equal(f.calls.filter(call => call.path === '/api/chains' && call.method === 'POST').length, 1);
});

test('renames retain stable identity and st-chatu8 authority; concurrent pages do not create duplicates', async () => {
  const f = artistFixture();
  const payload = { artists: [{ externalId: 'st:one', name: '原名称', fixedPrompt: 'original' }] };
  await Promise.all([f.bridge.sync(payload), f.bridge.sync(payload)]);
  assert.equal(f.chains.length, 1);
  f.selection.chainIds = [f.chains[0].id];
  const next = await f.bridge.sync({ artists: [{ externalId: 'st:one', name: '新名称', fixedPrompt: 'changed' }] });
  assert.equal(f.chains.length, 1); assert.equal(f.chains[0].name, '新名称'); assert.equal(f.chains[0].basePrompt, 'changed');
  assert.equal(next.artistSync.updated, 1); assert.deepEqual(next.artists, []);
});

const extensionFixture = async () => {
  const st = { yushe: {}, configImageStorage: {} };
  const extensionSettings = { 'st-chatu8': st };
  const source = (await readFile(new URL('../sillytavern-extension/npm-bridge/index.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  let fetchImpl = async () => { throw new Error('Synthetic request must be declared'); };
  let initialize;
  const timeouts = [];
  const events = new Map();
  const extension = runInNewContext(`${source}\n;({ applyArtists, collectArtists, applyGroups, settings, syncNow });`, {
    extension_settings: extensionSettings, crypto: webcrypto, TextEncoder, atob, btoa,
    document: { querySelector: () => null, body: {} }, jQuery: callback => { initialize = callback; }, console: { warn() {}, error() {} },
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    eventSource: { on() {} }, event_types: { SETTINGS_UPDATED: 'updated' },
    setInterval: () => 1, clearInterval() {}, clearTimeout() {}, setTimeout: (callback, ms) => { timeouts.push({ callback, ms }); return 1; },
    MutationObserver: class { observe() {} disconnect() {} },
    getRequestHeaders: () => ({}), saveSettingsDebounced() {},
    fetch: (...args) => fetchImpl(...args),
  });
  return { extension, st, setFetch(next) { fetchImpl = next; }, start: () => initialize(), focus: () => events.get('focus')(), startup: () => timeouts.find(timer => timer.ms === 2500).callback() };
};

test('new native preset IDs are stable across pages while existing IDs remain compatible', async () => {
  const a = await extensionFixture(); const b = await extensionFixture();
  a.st.yushe['稳定名称'] = b.st.yushe['稳定名称'] = { fixedPrompt: 'style' };
  const [first] = await a.extension.collectArtists(a.extension.settings());
  const [second] = await b.extension.collectArtists(b.extension.settings());
  assert.equal(first.externalId, second.externalId);
  a.extension.settings().artistIds['稳定名称'] = 'st:legacy-saved-id';
  assert.equal((await a.extension.collectArtists(a.extension.settings()))[0].externalId, 'st:legacy-saved-id');
});

test('disabling auto sync suppresses focus and startup triggers but allows explicit sync', async () => {
  const f = await extensionFixture(); let requests = 0;
  f.setFetch(async () => { requests++; return new Response(JSON.stringify({ artists: [], vibes: [], groups: [], status: {} }), { headers: { 'Content-Type': 'application/json' } }); });
  f.extension.settings().autoSync = false; await f.start(); f.focus(); f.startup();
  assert.equal(requests, 0);
  await f.extension.syncNow(); assert.equal(requests, 1);
});

test('extension leaves identical presets untouched and retains extra st-chatu8 fields', async () => {
  const f = await extensionFixture();
  const artist = { externalId: 'npm:one', name: '风格', fixedPrompt: 'artist:one', fixedPromptEnd: '', negativePrompt: '', previewImage: '', updatedAt: 1 };
  assert.equal(await f.extension.applyArtists([artist]), 1);
  f.st.yushe['风格'].pluginOption = 'keep'; const original = f.st.yushe['风格'];
  assert.equal(await f.extension.applyArtists([artist]), 0); assert.equal(f.st.yushe['风格'], original);
  await f.extension.applyArtists([{ ...artist, fixedPrompt: 'updated' }]);
  assert.equal(f.st.yushe['风格'].pluginOption, 'keep'); assert.equal(Object.keys(f.st.yushe).length, 1);
  await f.extension.collectArtists(f.extension.settings()); const first = f.extension.settings().artistUpdatedAt['npm:one'];
  await f.extension.collectArtists(f.extension.settings()); assert.equal(f.extension.settings().artistUpdatedAt['npm:one'], first);
});

test('extension acknowledges only successful cover uploads and does not re-download unchanged covers', async () => {
  const f = await extensionFixture(); const calls = [];
  let fail = true;
  f.setFetch(async (url, options = {}) => {
    calls.push({ url, method: options.method });
    if (options.method === 'POST') return new Response(JSON.stringify({ path: '/user/images/npm_bridge_preview.png' }), { headers: { 'Content-Type': 'application/json' } });
    if (fail) throw new Error('Synthetic download failed');
    return new Response(Buffer.from('synthetic-cover'), { headers: { 'Content-Type': 'image/png' } });
  });
  const artist = { externalId: 'npm:cover', name: '封面', fixedPrompt: 'style', previewImage: '/api/assets/original.png', updatedAt: 1 };
  await f.extension.applyArtists([artist]);
  assert.equal(f.extension.settings().artistPreviewUrls['npm:cover'], undefined);
  assert.equal((await f.extension.collectArtists(f.extension.settings()))[0].previewSourceImage, '');
  fail = false; await f.extension.applyArtists([artist]);
  const original = f.st.yushe['封面']; const reads = calls.length;
  assert.equal((await f.extension.collectArtists(f.extension.settings()))[0].previewSourceImage, artist.previewImage);
  await f.extension.applyArtists([artist]); assert.equal(calls.length, reads); assert.equal(f.st.yushe['封面'], original);
  f.st.configImageStorage[original.previewImageId].path = '/user/new-native-cover.png';
  assert.equal((await f.extension.collectArtists(f.extension.settings()))[0].previewSourceImage, '');
});

test('unchanged Vibe groups skip worker writes while real strength changes update the same group', async () => {
  const sourceHash = 'a'.repeat(64);
  const groups = []; let writes = 0;
  const bridge = new StChatu8Bridge({ requestWorkerJson: async (path, options = {}) => {
    if (path === '/api/vibes') return { items: [{ id: 'vibe', name: 'Vibe', sourceHash, encodings: [{ id: 'encoding', informationExtracted: 1 }] }] };
    if (path === '/api/vibe-groups' && !options.method) return { items: structuredClone(groups) };
    if (path === '/api/vibe-groups' && options.method === 'POST') {
      writes++; const item = { ...options.body, id: 'group' }; groups.push(item); return { item };
    }
    if (path === '/api/vibe-groups/group' && options.method === 'PUT') { writes++; Object.assign(groups[0], options.body); return { success: true }; }
    throw new Error('Unexpected synthetic group request');
  }, requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }) });
  bridge.saveState = async () => {};
  const group = { externalId: 'st-group:one', name: '组合', normalizeStrengths: true, vibes: [{ sourceHash, strength: 0.6 }] };
  await bridge.syncVibes([], [group], [sourceHash]); assert.equal(writes, 1);
  await bridge.syncVibes([], [group], [sourceHash]); assert.equal(writes, 1);
  await bridge.syncVibes([], [{ ...group, vibes: [{ sourceHash, strength: 0.8 }] }], [sourceHash]);
  assert.equal(writes, 2); assert.equal(groups.length, 1); assert.equal(groups[0].slots[0].strength, 0.8);
});

test('extension keeps identical Vibe group objects and retains plugin fields on actual changes', async () => {
  const f = await extensionFixture();
  const localVibes = new Map([['source', { dataId: 'data' }]]);
  const group = { name: '组合', updatedAt: 1, vibes: [{ sourceHash: 'source', strength: 0.6 }] };
  f.extension.applyGroups([group], localVibes);
  f.st.vibeGroups['组合'].pluginOption = 'keep'; const previous = f.st.vibeGroups['组合'];
  f.extension.applyGroups([group], localVibes); assert.equal(f.st.vibeGroups['组合'], previous);
  f.extension.applyGroups([{ ...group, vibes: [{ sourceHash: 'source', strength: 0.8 }] }], localVibes);
  assert.equal(f.st.vibeGroups['组合'].pluginOption, 'keep'); assert.equal(f.st.vibeGroups['组合'].vibes[0].strength, 0.8);
});

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
  let knownChecks = 0;
  const bridge = new StChatu8Bridge({
    projectRoot: root,
    requestWorkerJson: async (path, options) => {
      if (path.endsWith('/known')) {
        knownChecks++;
        return { externalIds: options.body.externalIds };
      }
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
  assert.equal(knownChecks, 1);
  await bridge.syncHistory();
  assert.equal(knownChecks, 1, 'already indexed history must not query the worker again');
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
  assert.equal(chains[0].params?.width, 832);
  assert.equal(chains[0].params?.height, 1216);
  assert.equal(chains[0].params?.sampler, 'k_euler_ancestral');
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

test('an st-chatu8 preset without a preview never clears an existing project cover', async () => {
  const chains = [{
    id: 'chain-local-cover', name: '本地画风', type: 'style', description: '', tags: [],
    previewImage: '/api/assets/covers/original.png', basePrompt: 'old', negativePrompt: '',
    modules: [], params: {}, variableValues: {}, createdAt: 1, updatedAt: 1,
  }];
  let updateBody = null;
  const bridge = new StChatu8Bridge({
    requestWorkerJson: async (path, options = {}) => {
      if (path === '/api/chains' && !options.method) return structuredClone(chains);
      if (path === '/api/chains/chain-local-cover' && options.method === 'PUT') {
        updateBody = structuredClone(options.body);
        Object.assign(chains[0], options.body, { updatedAt: 2 });
        return { success: true };
      }
      if (path === '/api/chains/chain-local-cover' && !options.method) return structuredClone(chains[0]);
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    },
    requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }),
  });
  bridge.saveState = async () => {};
  await bridge.syncArtists([{ externalId: 'st:no-cover', name: '本地画风', fixedPrompt: 'new', previewPath: '', updatedAt: 2 }]);
  assert.equal(chains[0].previewImage, '/api/assets/covers/original.png');
  assert.equal(Object.hasOwn(updateBody, 'previewImage'), false);
});

test('Vibe identity is canonicalized from image bytes across exporter-specific ids', () => {
  const image = Buffer.from('same-vibe-image');
  const a = canonicalVibeSourceHash({ image: image.toString('base64'), id: 'a'.repeat(64) });
  const b = canonicalVibeSourceHash({ image: `data:image/png;base64,${image.toString('base64')}`, id: 'b'.repeat(64) });
  assert.equal(a, b);
  assert.notEqual(a, 'a'.repeat(64));
});

test('missing st-chatu8 preview path does not crash with ENOENT and preserves existing cover', async () => {
  const chains = [{
    id: 'chain-missing-file', name: '画风测试', type: 'style', description: '', tags: [],
    previewImage: '/api/assets/covers/existing.png', basePrompt: 'prompt', negativePrompt: '',
    modules: [], params: {}, variableValues: {}, createdAt: 1, updatedAt: 1,
  }];
  let updateBody = null;
  const bridge = new StChatu8Bridge({
    requestWorkerJson: async (path, options = {}) => {
      if (path === '/api/chains' && !options.method) return structuredClone(chains);
      if (path === '/api/chains/chain-missing-file' && options.method === 'PUT') {
        updateBody = structuredClone(options.body);
        Object.assign(chains[0], options.body);
        return { success: true };
      }
      if (path === '/api/chains/chain-missing-file' && !options.method) return structuredClone(chains[0]);
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    },
    requestWorkerBuffer: async () => ({ status: 404, buffer: Buffer.alloc(0) }),
  });
  bridge.root = 'D:\\SillyTavern';
  bridge.saveState = async () => {};

  // Direct read of a non-existent file returns null without throwing ENOENT
  const previewData = await bridge.readStPreviewData('/user/images/chatu8_config/non_existent_file_12345.png');
  assert.equal(previewData, null);

  // syncArtists with missing preview file does not throw and preserves existing cover
  await bridge.syncArtists([{
    externalId: 'st:missing-cover',
    name: '画风测试',
    fixedPrompt: 'prompt',
    previewPath: '/user/images/chatu8_config/non_existent_file_12345.png',
    updatedAt: 2,
  }]);
  assert.equal(chains[0].previewImage, '/api/assets/covers/existing.png');
});

test('computeSillyTavernExtensionTargetDir 智能补全不同层级的酒馆安装路径', () => {
  const base = 'D:\\SillyTavern';
  assert.equal(computeSillyTavernExtensionTargetDir(base), 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge');
  assert.equal(computeSillyTavernExtensionTargetDir('D:\\SillyTavern\\public'), 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge');
  assert.equal(computeSillyTavernExtensionTargetDir('D:\\SillyTavern\\public\\scripts'), 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge');
  assert.equal(computeSillyTavernExtensionTargetDir('D:\\SillyTavern\\public\\scripts\\extensions'), 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge');
  assert.equal(computeSillyTavernExtensionTargetDir('D:\\SillyTavern\\public\\scripts\\extensions\\third-party'), 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge');
  assert.equal(computeSillyTavernExtensionTargetDir('D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge'), 'D:\\SillyTavern\\public\\scripts\\extensions\\third-party\\npm-bridge');
});

test('installSillyTavernBridgeExtension 正常安装扩展、注入服务地址并执行安全阻断', async () => {
  const fakeStRoot = tempRoot('st-install-target');
  try {
    // 1. 未指定或相对路径防护
    await assert.rejects(async () => installSillyTavernBridgeExtension({ sillyTavernRoot: '' }), { status: 400 });
    await assert.rejects(async () => installSillyTavernBridgeExtension({ sillyTavernRoot: 'relative/path' }), { status: 400 });

    // 2. 目标根目录不存在
    await assert.rejects(async () => installSillyTavernBridgeExtension({ sillyTavernRoot: fakeStRoot }), { status: 404 });

    // 3. 核心保护区阻断
    await mkdir(fakeStRoot, { recursive: true });
    await assert.rejects(
      async () => installSillyTavernBridgeExtension({ sillyTavernRoot: process.cwd() }),
      { status: 403 }
    );

    // 4. 正常安装并成功注入自定义服务地址
    const customUrl = 'http://192.168.1.100:3000';
    const result = await installSillyTavernBridgeExtension({
      sillyTavernRoot: fakeStRoot,
      targetUrl: customUrl,
      projectRoot: process.cwd(),
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.files, ['manifest.json', 'index.js', 'style.css', 'README.md']);

    // 验证文件存在且正确注入自定义服务地址
    const installedManifest = JSON.parse(await readFile(join(result.targetPath, 'manifest.json'), 'utf8'));
    assert.equal(installedManifest.display_name, 'NAI Atelier 连接器');
    const projectVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
    assert.equal(installedManifest.version, projectVersion);
    assert.equal(installedManifest.js, `index.js?v=${projectVersion}`);
    assert.equal(installedManifest.css, `style.css?v=${projectVersion}`);

    const installedIndex = await readFile(join(result.targetPath, 'index.js'), 'utf8');
    assert.match(installedIndex, /const DEFAULT_URL = 'http:\/\/192\.168\.1\.100:3000';/);
  } finally {
    await rm(fakeStRoot, { recursive: true, force: true });
  }
});
