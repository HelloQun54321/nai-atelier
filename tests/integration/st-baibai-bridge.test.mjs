import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import {
  StBaiBaiBridge,
  collectBaiBaiHistoryCandidates,
  isCompleteBaiBaiArtistSnapshot,
  readBaiBaiHistoryMetadata,
} from '../../scripts/st-baibai-bridge.mjs';
import {
  computeSillyTavernExtensionTargetDir,
  installSillyTavernBridgeExtension,
  resolveTavernLayout,
} from '../../scripts/st-chatu8-bridge.mjs';
import { isLoopbackOrigin } from '../../scripts/media-gateway.mjs';

const tempRoot = name => join(tmpdir(), `nai-baibai-test-${name}-${randomUUID()}`);
const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const VIBE_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';

const sha256 = value => createHash('sha256').update(value).digest('hex');

const createMockWorker = (initial = {}) => {
  const chains = new Map((initial.chains || []).map(c => [c.id, { ...c }]));
  const vibes = new Map((initial.vibes || []).map(v => [v.id, { ...v }]));
  const groups = new Map((initial.groups || []).map(g => [g.id, { ...g }]));
  const history = new Map();
  let enabled = initial.enabled !== false;
  let workspace = initial.workspace || { entries: [], lastSnapshotAt: 0 };
  const chainIdsFromWorkspace = () => workspace.entries.filter(e => e.status === 'pending').map(e => e.chainId);

  const requestWorkerJson = async (path, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body;
    if (path === '/api/st-baibai/preferences') {
      if (method === 'POST') enabled = Boolean(body?.enabled);
      return { enabled };
    }
    if (path === '/api/st-baibai/workspace') {
      return { ...workspace, chainIds: chainIdsFromWorkspace() };
    }
    if (path === '/api/integrations/st-baibai/artist-records' && method === 'POST') {
      for (const update of body?.updates || []) {
        const entry = workspace.entries.find(e => e.chainId === update.chainId && e.requestId === update.requestId);
        if (!entry) continue;
        if (update.status === 'synced') { entry.status = 'synced'; entry.confirmedAt = body.verifiedAt || Date.now(); entry.lastVerifiedAt = body.verifiedAt || Date.now(); entry.error = ''; }
        else if (update.status === 'removed') { entry.status = 'removed'; entry.lastVerifiedAt = body.verifiedAt || Date.now(); }
        else if (typeof update.error === 'string') { entry.error = update.error; }
      }
      if (body?.verifiedAt) workspace.lastSnapshotAt = Math.max(workspace.lastSnapshotAt, body.verifiedAt);
      return { ...workspace, chainIds: chainIdsFromWorkspace() };
    }
    if (path === '/api/chains') {
      if (method === 'POST') {
        const id = `chain-${chains.size + 1}`;
        const created = { ...body, id, previewImage: body.previewImage || '', createdAt: Date.now(), updatedAt: Date.now() };
        chains.set(id, created);
        return created;
      }
      return [...chains.values()];
    }
    if (path.startsWith('/api/chains/')) {
      const id = decodeURIComponent(path.slice('/api/chains/'.length));
      if (method === 'PUT') {
        const prev = chains.get(id) || { id };
        const next = { ...prev, ...body, id, previewImage: body.previewImage ? `/api/assets/${id}.png` : (prev.previewImage || ''), updatedAt: Date.now() };
        chains.set(id, next);
        return next;
      }
      return chains.get(id) || null;
    }
    if (path === '/api/vibes/import' && method === 'POST') {
      const doc = body.document;
      const sourceHash = doc.id || sha256(Buffer.from(doc.image || '', 'base64'));
      let existing = [...vibes.values()].find(v => v.sourceHash === sourceHash);
      if (!existing) {
        const id = `vibe-${vibes.size + 1}`;
        existing = {
          id,
          name: doc.name || 'Vibe',
          sourceHash,
          defaultStrength: Number(doc.importInfo?.strength ?? 0.6),
          updatedAt: Date.now(),
          encodings: [{ id: 'enc-1', informationExtracted: 1 }],
          _document: doc,
        };
        vibes.set(id, existing);
      }
      return { item: existing };
    }
    if (path === '/api/vibes') return { items: [...vibes.values()] };
    if (path.startsWith('/api/vibes/') && method === 'PUT') {
      const id = decodeURIComponent(path.slice('/api/vibes/'.length));
      const v = vibes.get(id);
      if (v) Object.assign(v, body);
      return { item: v };
    }
    if (path === '/api/vibe-groups') {
      if (method === 'POST') {
        const id = `grp-${groups.size + 1}`;
        const item = { ...body, id, updatedAt: Date.now() };
        groups.set(id, item);
        return { item };
      }
      return { items: [...groups.values()] };
    }
    if (path.startsWith('/api/vibe-groups/') && method === 'PUT') {
      const id = decodeURIComponent(path.slice('/api/vibe-groups/'.length));
      const g = groups.get(id);
      if (g) Object.assign(g, body);
      return { item: g };
    }
    if (path === '/api/integrations/st-baibai/history/known' && method === 'POST') {
      return { externalIds: (body.externalIds || []).filter(id => history.has(id)) };
    }
    if (path === '/api/integrations/st-baibai/history/import' && method === 'POST') {
      let imported = 0;
      for (const item of body.items || []) {
        if (history.has(item.externalId)) continue;
        history.set(item.externalId, item);
        imported++;
      }
      return { imported, skipped: (body.items || []).length - imported };
    }
    throw new Error(`Unexpected worker route: ${method} ${path}`);
  };

  const requestWorkerBuffer = async path => {
    const match = path.match(/^\/api\/vibes\/([^/]+)\/file$/);
    if (match) {
      const v = vibes.get(decodeURIComponent(match[1]));
      if (v?._document) return { status: 200, buffer: Buffer.from(JSON.stringify(v._document), 'utf8') };
    }
    return { status: 404, buffer: Buffer.alloc(0) };
  };

  return { chains, vibes, groups, history, get workspace() { return workspace; }, requestWorkerJson, requestWorkerBuffer };
};

test('柏宝绘历史扫描：采集 柏宝绘_<角色> 与旧 user/files/bbi_*，排除 柏宝绘_画师串，并合并侧写 JSON 元数据', async () => {
  const stRoot = tempRoot('history');
  const stateFile = join(stRoot, 'state.json');
  try {
    const userDir = join(stRoot, 'data', 'default-user');
    await mkdir(join(userDir, 'user', 'images', '柏宝绘_Alice'), { recursive: true });
    await mkdir(join(userDir, 'user', 'images', '柏宝绘_画师串'), { recursive: true });
    await mkdir(join(userDir, 'user', 'files'), { recursive: true });
    await writeFile(join(userDir, 'settings.json'), JSON.stringify({ extension_settings: { baibai_image: {} } }));

    // 1. 新目录 JPEG（无 PNG 块，依赖侧写 JSON 恢复模型、参数、提示词与角色名）
    const jpgName = 'bbi_hash1_0_p1-gen001.jpg';
    const jpgPath = join(userDir, 'user', 'images', '柏宝绘_Alice', jpgName);
    await writeFile(jpgPath, TINY_JPG_BYTES);
    await writeFile(join(userDir, 'user', 'files', 'bbi_hash1_0_p1-gen001.json'), JSON.stringify({
      v: 2,
      character: '爱丽丝',
      prompt: '<bbi_image>1girl, silver hair</bbi_image>',
      seed: 424242,
      createdAt: 1730000001000,
      meta: {
        model: 'nai-diffusion-4-5-full',
        positive: 'artist:foo, 1girl, silver hair, masterpiece',
        negative: 'lowres, bad anatomy',
        width: 832,
        height: 1216,
        params: { sampler: 'k_euler_ancestral', steps: 28, cfg: 5.5, cfgRescale: 0.2, noiseSchedule: 'karras' },
      },
    }));

    // 2. 旧目录遗留 PNG
    const legacyName = 'bbi_old_1_p2-gen002.png';
    await writeFile(join(userDir, 'user', 'files', legacyName), TINY_PNG_BYTES);

    // 3. 画师串封面目录（必须排除！）
    await writeFile(join(userDir, 'user', 'images', '柏宝绘_画师串', 'bbi_cover_0_x-gen999.png'), TINY_PNG_BYTES);

    const candidates = await collectBaiBaiHistoryCandidates(stRoot, userDir);
    assert.equal(candidates.length, 2);
    assert.ok(candidates.some(c => c.publicPath === `/user/images/柏宝绘_Alice/${jpgName}`));
    assert.ok(candidates.some(c => c.publicPath === `/user/files/${legacyName}`));
    assert.ok(!candidates.some(c => c.publicPath.includes('柏宝绘_画师串')));

    const jpgCandidate = candidates.find(c => c.publicPath.endsWith(jpgName));
    const meta = await readBaiBaiHistoryMetadata(jpgCandidate.filePath, jpgCandidate.sidecarPath, jpgCandidate.folderCharacter);
    assert.equal(meta.sourceName, '柏宝绘 · 爱丽丝');
    assert.equal(meta.prompt, 'artist:foo, 1girl, silver hair, masterpiece');
    assert.equal(meta.negativePrompt, 'lowres, bad anatomy');
    assert.equal(meta.createdAt, 1730000001000);
    assert.deepEqual(meta.params, {
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5.5,
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      cfgRescale: 0.2,
      seed: 424242,
    });

    // 通过 StBaiBaiBridge 完整执行 syncHistory + readHistoryImage
    const worker = createMockWorker();
    const bridge = new StBaiBaiBridge({ projectRoot: stRoot, stateFile, sharedRootFallbackFile: '', ...worker });
    await bridge.init();
    await bridge.setRoot(stRoot);
    await bridge.syncHistory();
    assert.equal(worker.history.size, 2);
    const importedJpg = worker.history.get(jpgCandidate.externalId);
    assert.equal(importedJpg.imageType, 'image/jpeg');
    assert.equal(importedJpg.sourceName, '柏宝绘 · 爱丽丝');
    const readImg = await bridge.readHistoryImage(jpgCandidate.externalId);
    assert.equal(readImg.contentType, 'image/jpeg');
    assert.deepEqual(readImg.buffer, TINY_JPG_BYTES);
  } finally {
    await rm(stRoot, { recursive: true, force: true });
  }
});

test('StBaiBaiBridge 风格串与 Vibe 同步：自动同步严格只读入库、绝不写回；手动同步才导出并校验回执', async () => {
  const stRoot = tempRoot('sync');
  const stateFile = join(stRoot, 'state.json');
  try {
    const userDir = join(stRoot, 'data', 'default-user');
    await mkdir(join(userDir, 'user', 'images', '柏宝绘_画师串'), { recursive: true });
    await writeFile(join(userDir, 'settings.json'), JSON.stringify({ extension_settings: { baibai_image: {} } }));
    await writeFile(join(userDir, 'user', 'images', '柏宝绘_画师串', 'preset_in.png'), TINY_PNG_BYTES);

    const atelierVibeHash = sha256(TINY_PNG_BYTES);
    const worker = createMockWorker({
      chains: [
        {
          id: 'c-out',
          name: '工坊精选画风',
          type: 'style',
          basePrompt: 'artist:atelier_master',
          negativePrompt: 'bad quality',
          modules: [{ id: 'm1', name: '质量', content: 'best quality', isActive: true, position: 'post' }],
          previewImage: '/api/assets/c-out.png',
          params: { model: 'nai-diffusion-4-5-full' },
          updatedAt: 1000,
        },
      ],
      vibes: [
        {
          id: 'v-out',
          name: '工坊氛围',
          sourceHash: atelierVibeHash,
          defaultStrength: 0.7,
          updatedAt: 2000,
          encodings: [{ id: 'e1', informationExtracted: 1 }],
          _document: {
            identifier: 'novelai-vibe-transfer',
            id: atelierVibeHash,
            image: TINY_PNG_BYTES.toString('base64'),
            thumbnail: `data:image/png;base64,${TINY_PNG_BYTES.toString('base64')}`,
            encodings: { 'v4-5full': { [VIBE_ENCODING_KEY]: { encoding: 'QUFB', params: { information_extracted: 1 } } } },
            name: '工坊氛围',
            importInfo: { model: 'v4-5full', strength: 0.7 },
          },
        },
      ],
      groups: [
        { id: 'g-out', name: '水彩组', normalizeStrengths: true, slots: [{ vibeId: 'v-out', vibeName: '工坊氛围', encodingId: 'e1', informationExtracted: 1, strength: 0.7 }], updatedAt: 2000 },
      ],
      workspace: {
        entries: [{ chainId: 'c-out', requestId: 'req-1', status: 'pending', requestedAt: 100, confirmedAt: 0, lastVerifiedAt: 0 }],
        lastSnapshotAt: 0,
      },
    });

    const bridge = new StBaiBaiBridge({ projectRoot: stRoot, stateFile, sharedRootFallbackFile: '', ...worker });
    await bridge.init();
    await bridge.setRoot(stRoot);
    await bridge.refreshPreferences();

    const incomingArtists = [
      { externalId: 'baibai:bi_builtin', name: '内置应跳过', prompt: 'builtin', quality: '', negative: '', previewPath: '', previewSourceImage: '' },
      { externalId: 'baibai:preset_in', name: '柏宝绘入库画风', prompt: 'artist:baibai', quality: 'amazing quality', negative: 'ugly', previewPath: '/user/images/柏宝绘_画师串/preset_in.png', previewSourceImage: '' },
    ];
    const incomingVibeHash = sha256(Buffer.from('baibai-vibe-img'));
    const incomingVibeDoc = {
      identifier: 'novelai-vibe-transfer',
      id: incomingVibeHash,
      image: Buffer.from('baibai-vibe-img').toString('base64'),
      encodings: { 'v4-5full': { [VIBE_ENCODING_KEY]: { encoding: 'QkJC', params: { information_extracted: 1 } } } },
      name: '柏宝绘氛围',
      importInfo: { model: 'v4-5full', strength: 0.55 },
    };

    // 1. 自动同步（manual: false）：必须导入入站画师串（排除 bi_*）和 Vibe + 扁平分组，但绝不下发出站写回任务！
    const autoResult = await bridge.sync({
      manual: false,
      artists: incomingArtists,
      artistSnapshot: { version: 2, complete: true, count: incomingArtists.length, cursor: bridge.status().snapshotCursor },
      vibeDocuments: [incomingVibeDoc],
      vibeSourceHashes: [incomingVibeHash],
      vibeGroups: [{ externalId: 'baibai-group:厚涂', name: '厚涂', normalizeStrengths: true, vibes: [{ sourceHash: incomingVibeHash, strength: 0.55 }] }],
    });
    assert.equal(autoResult.writeBackAllowed, false);
    assert.deepEqual(autoResult.artists, []);
    assert.deepEqual(autoResult.vibes, []);
    assert.deepEqual(autoResult.groups, []);
    // 入站已正确写入工坊，内置 bi_* 已跳过
    const importedChain = [...worker.chains.values()].find(c => c.name === '柏宝绘入库画风');
    assert.ok(importedChain);
    assert.equal(importedChain.basePrompt, 'artist:baibai');
    assert.equal(importedChain.modules[0].content, 'amazing quality');
    assert.equal(importedChain.negativePrompt, 'ugly');
    assert.ok(importedChain.previewImage);
    assert.equal([...worker.chains.values()].some(c => c.name === '内置应跳过'), false);
    assert.ok([...worker.groups.values()].some(g => g.name === '厚涂'));

    // 2. 手动同步（manual: true）：导出工坊待同步风格串与 Vibe（携带扁平 group 名）
    const manualResult = await bridge.sync({
      manual: true,
      artists: [incomingArtists[1]],
      artistSnapshot: { version: 2, complete: true, count: 1, cursor: bridge.status().snapshotCursor },
      vibeDocuments: [],
      vibeSourceHashes: [incomingVibeHash],
      vibeGroups: [],
    });
    assert.equal(manualResult.writeBackAllowed, true);
    assert.equal(manualResult.artists.length, 1);
    assert.equal(manualResult.artists[0].name, '工坊精选画风');
    assert.equal(manualResult.artists[0].prompt, 'artist:atelier_master');
    assert.equal(manualResult.artists[0].quality, 'best quality');
    assert.equal(manualResult.artists[0].negative, 'bad quality');
    assert.ok(manualResult.artists[0].receipt?.token);
    const exportedVibe = manualResult.vibes.find(v => v.id === 'v-out');
    assert.ok(exportedVibe);
    assert.equal(exportedVibe.group, '水彩组');

    // 3. 回执校验：提交落盘快照后状态转为 synced
    const exported = manualResult.artists[0];
    const persistedSnapshot = [
      incomingArtists[1],
      {
        externalId: exported.externalId,
        name: exported.name,
        prompt: exported.prompt,
        quality: exported.quality,
        negative: exported.negative,
        previewPath: '/user/images/柏宝绘_画师串/npm_exported.png',
        previewSourceImage: exported.previewImage,
      },
    ];
    assert.equal(isCompleteBaiBaiArtistSnapshot({ artists: persistedSnapshot, artistSnapshot: { version: 2, complete: true, count: 2 } }), true);
    const ack = await bridge.acknowledgeArtists({
      artists: persistedSnapshot,
      artistSnapshot: { version: 2, complete: true, count: 2 },
      receipts: [{ externalId: exported.externalId, ...exported.receipt, success: true, reason: '' }],
    });
    assert.equal(ack.confirmed, 1);
    assert.equal(worker.workspace.entries[0].status, 'synced');
    if (bridge.historySyncPromise) await bridge.historySyncPromise;
    await bridge.writeQueue;
  } finally {
    await rm(stRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('共用扩展 (npm-bridge)：自动识别柏宝绘，自动同步绝不改写 baibai_image，手动同步写入封面/Vibe 并提示刷新酒馆页面', async () => {
  const source = (await readFile(new URL('../../sillytavern-extension/npm-bridge/index.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '');

  const dom = new JSDOM('<!doctype html><html><body><div id="extensions_settings2"></div></body></html>', { url: 'http://localhost:8000' });
  const baibaiSettings = {
    nai: {
      artistPresets: [
        { id: 'preset_a', name: '原有画风', prompt: 'artist:orig', quality: 'hq', negative: 'bad', previewPath: '' },
      ],
      vibes: [],
    },
  };
  const extension_settings = { baibai_image: baibaiSettings };
  let persistedDoc = JSON.parse(JSON.stringify({ extension_settings }));
  let saveCalls = 0;
  const uploadedImages = [];
  const uploadedFiles = [];
  let lastSyncPayload = null;
  let lastReceiptPayload = null;

  const fetchMock = async (url, init = {}) => {
    const href = String(url);
    if (href === '/api/settings/get') {
      return new Response(JSON.stringify({ settings: JSON.stringify(persistedDoc) }), { status: 200 });
    }
    if (href === '/api/images/upload') {
      const body = JSON.parse(init.body);
      uploadedImages.push(body);
      return new Response(JSON.stringify({ path: `/user/images/${body.ch_name}/${body.filename}.${body.format}` }), { status: 200 });
    }
    if (href === '/api/files/upload') {
      const body = JSON.parse(init.body);
      uploadedFiles.push(body);
      return new Response(JSON.stringify({ path: `/user/files/${body.name}` }), { status: 200 });
    }
    if (href.endsWith('/api/integrations/st-baibai/status')) {
      return new Response(JSON.stringify({ enabled: true, snapshotCursor: 'cur-1' }), { status: 200 });
    }
    if (href.endsWith('/api/integrations/st-baibai/sync')) {
      lastSyncPayload = JSON.parse(init.body);
      if (!lastSyncPayload.manual) {
        return new Response(JSON.stringify({
          enabled: true,
          protocolVersion: 2,
          writeBackAllowed: false,
          artistSnapshotComplete: true,
          artists: [],
          vibes: [],
          groups: [],
          artistSync: { created: 1, updated: 0 },
          status: { linkedHistory: 3 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        enabled: true,
        protocolVersion: 2,
        writeBackAllowed: true,
        artistSnapshotComplete: true,
        artists: [
          {
            externalId: 'npm:c1',
            name: '工坊同步画风',
            prompt: 'artist:sync_out',
            quality: 'masterpiece',
            negative: 'lowres',
            previewImage: '/api/assets/c1.png',
            updatedAt: 12345,
            receipt: { requestId: 'r1', token: 't1' },
          },
        ],
        vibes: [
          {
            id: 'v1',
            name: '霓虹氛围',
            sourceHash: sha256(TINY_PNG_BYTES),
            defaultStrength: 0.65,
            group: '赛博',
            updatedAt: 12345,
            fileUrl: '/api/integrations/st-baibai/vibes/v1/file',
          },
        ],
        groups: [],
        artistSync: { created: 0, updated: 0 },
        status: { linkedHistory: 3 },
      }), { status: 200 });
    }
    if (href.endsWith('/api/assets/c1.png')) {
      return new Response(TINY_PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (href.endsWith('/api/integrations/st-baibai/vibes/v1/file')) {
      return new Response(JSON.stringify({
        identifier: 'novelai-vibe-transfer',
        image: TINY_PNG_BYTES.toString('base64'),
        thumbnail: `data:image/png;base64,${TINY_PNG_BYTES.toString('base64')}`,
        encodings: { 'v4-5full': { [VIBE_ENCODING_KEY]: { encoding: 'Q0ND', params: { information_extracted: 1 } } } },
        name: '霓虹氛围',
        importInfo: { model: 'v4-5full', strength: 0.65 },
      }), { status: 200 });
    }
    if (href.endsWith('/api/integrations/st-baibai/artist-receipts')) {
      lastReceiptPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ confirmed: 1 }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  let initCallback = null;
  const extension = runInNewContext(
    `${source}\n;({ syncNow, renderSettings, settings });`,
    {
      extension_settings,
      eventSource: { on() {} },
      event_types: { SETTINGS_UPDATED: 'settings_updated' },
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      saveSettings: async () => { saveCalls++; persistedDoc = JSON.parse(JSON.stringify({ extension_settings })); },
      saveSettingsDebounced: () => {},
      jQuery: cb => { initCallback = cb; },
      document: dom.window.document,
      window: dom.window,
      MutationObserver: dom.window.MutationObserver,
      Event: dom.window.Event,
      fetch: fetchMock,
      crypto: globalThis.crypto,
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      console,
      setInterval: () => 1,
      clearInterval() {},
      setTimeout: () => 1,
      clearTimeout() {},
    },
  );

  await initCallback();
  const titleText = dom.window.document.querySelector('.npm-bridge-title').textContent;
  assert.match(titleText, /柏宝绘同步/);

  // 1. 自动同步（quiet: true, manual: false）：绝不调用 saveSettings、绝不改动 baibai_image
  await extension.syncNow({ quiet: true, manual: false });
  assert.equal(lastSyncPayload.manual, false);
  assert.equal(saveCalls, 0);
  assert.equal(baibaiSettings.nai.artistPresets.length, 1);
  assert.equal(baibaiSettings.nai.vibes.length, 0);

  // 2. 手动同步（quiet: false, manual: true）：写入画师串 + 封面（柏宝绘_画师串） + Vibe（/api/files/upload）+ 校验回执 + 提示刷新页面
  await extension.syncNow({ quiet: false, manual: true });
  assert.equal(lastSyncPayload.manual, true);
  assert.equal(saveCalls, 1);
  assert.equal(baibaiSettings.nai.artistPresets.length, 2);
  const writtenPreset = baibaiSettings.nai.artistPresets.find(p => p.name === '工坊同步画风');
  assert.ok(writtenPreset);
  assert.equal(writtenPreset.prompt, 'artist:sync_out');
  assert.equal(writtenPreset.quality, 'masterpiece');
  assert.equal(writtenPreset.negative, 'lowres');
  assert.ok(writtenPreset.previewPath.startsWith('/user/images/柏宝绘_画师串/'));
  assert.equal(uploadedImages.length, 1);
  assert.equal(uploadedImages[0].ch_name, '柏宝绘_画师串');
  assert.equal(uploadedImages[0].filename, writtenPreset.id);

  assert.equal(baibaiSettings.nai.vibes.length, 1);
  assert.equal(baibaiSettings.nai.vibes[0].name, '霓虹氛围');
  assert.equal(baibaiSettings.nai.vibes[0].group, '赛博');
  assert.deepEqual([...baibaiSettings.nai.vibes[0].modelKeys], ['v4-5full']);
  assert.ok(uploadedFiles.some(f => f.name.startsWith('bbi-vibe-') && f.name.endsWith('.json')));
  assert.ok(uploadedFiles.some(f => f.name.startsWith('bbi-vibe-thumb-')));

  assert.equal(lastReceiptPayload.receipts.length, 1);
  assert.equal(lastReceiptPayload.receipts[0].success, true);

  const statusText = dom.window.document.querySelector('.npm-bridge-status').textContent;
  assert.match(statusText, /请刷新酒馆页面生效/);
});

test('TauriTavern 适配：放行本机 Tauri WebView Origin，拒绝恶意伪造源', () => {
  assert.equal(isLoopbackOrigin('http://tauri.localhost'), true);
  assert.equal(isLoopbackOrigin('https://tauri.localhost'), true);
  assert.equal(isLoopbackOrigin('tauri://localhost'), true);
  assert.equal(isLoopbackOrigin('http://localhost:8000'), true);
  assert.equal(isLoopbackOrigin('http://127.0.0.1:8000'), true);
  assert.equal(isLoopbackOrigin('https://tauri.localhost.evil.com'), false);
  assert.equal(isLoopbackOrigin('tauri://evil.com'), false);
  assert.equal(isLoopbackOrigin('http://evil.com'), false);
  assert.equal(isLoopbackOrigin('file://localhost'), false);
});

test('TauriTavern 适配：识别标准目录、portable、runtime.json 迁移数据根与直接 data_root，并将扩展安装到 default-user/extensions/npm-bridge', async () => {
  const base = tempRoot('tauritavern');
  const appRoot = join(base, 'com.tauritavern.client');
  const migratedDataRoot = join(base, 'CustomTTData');
  const portableRoot = join(base, 'PortableTT');
  const fakeProject = join(base, 'project');
  try {
    // 准备假项目扩展源
    const srcExt = join(fakeProject, 'sillytavern-extension', 'npm-bridge');
    await mkdir(srcExt, { recursive: true });
    for (const f of ['manifest.json', 'index.js', 'style.css', 'README.md']) {
      await writeFile(join(srcExt, f), await readFile(new URL(`../../sillytavern-extension/npm-bridge/${f}`, import.meta.url), 'utf8'));
    }

    // 1. TauriTavern 迁移后自定义 data_root + appRoot/tauritavern-runtime.json
    await mkdir(join(appRoot), { recursive: true });
    await mkdir(join(migratedDataRoot, '_tauritavern'), { recursive: true });
    await mkdir(join(migratedDataRoot, 'default-user', 'user', 'images', '柏宝绘_Luna'), { recursive: true });
    await writeFile(join(migratedDataRoot, 'default-user', 'settings.json'), JSON.stringify({ extension_settings: { baibai_image: {} } }));
    await writeFile(join(migratedDataRoot, 'default-user', 'user', 'images', '柏宝绘_Luna', 'bbi_tt_0_p1-g1.png'), TINY_PNG_BYTES);
    await writeFile(join(appRoot, 'tauritavern-runtime.json'), JSON.stringify({ version: 1, data_root: migratedDataRoot }));

    const viaRuntime = resolveTavernLayout(appRoot);
    assert.equal(viaRuntime.kind, 'tauritavern');
    assert.equal(viaRuntime.dataRoot, migratedDataRoot);
    assert.equal(viaRuntime.userDir, join(migratedDataRoot, 'default-user'));
    assert.equal(viaRuntime.extensionTargetDir, join(migratedDataRoot, 'default-user', 'extensions', 'npm-bridge'));
    assert.equal(computeSillyTavernExtensionTargetDir(appRoot), join(migratedDataRoot, 'default-user', 'extensions', 'npm-bridge'));

    // 安装扩展通过 appRoot 应自动写入迁移后的 default-user/extensions/npm-bridge
    const installed = await installSillyTavernBridgeExtension({
      sillyTavernRoot: appRoot,
      targetUrl: 'http://localhost:3000',
      projectRoot: fakeProject,
    });
    assert.equal(installed.tavernKind, 'tauritavern');
    assert.equal(installed.targetPath, join(migratedDataRoot, 'default-user', 'extensions', 'npm-bridge'));
    assert.ok((await readFile(join(installed.targetPath, 'manifest.json'), 'utf8')).includes('ST-BaiBai-Image'));

    // 直接填 migratedDataRoot（外层无 data/）也能识别并扫描出柏宝绘历史图
    const directLayout = resolveTavernLayout(migratedDataRoot);
    assert.equal(directLayout.kind, 'tauritavern');
    assert.equal(directLayout.extensionTargetDir, join(migratedDataRoot, 'default-user', 'extensions', 'npm-bridge'));
    const candidates = await collectBaiBaiHistoryCandidates(appRoot);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].publicPath, '/user/images/柏宝绘_Luna/bbi_tt_0_p1-g1.png');

    // 2. Portable TauriTavern（含 portable.flag 与 data/default-user）
    await mkdir(join(portableRoot, 'data', 'default-user'), { recursive: true });
    await writeFile(join(portableRoot, 'portable.flag'), '');
    await writeFile(join(portableRoot, 'data', 'default-user', 'settings.json'), '{}');
    const portableLayout = resolveTavernLayout(portableRoot);
    assert.equal(portableLayout.kind, 'tauritavern');
    assert.equal(portableLayout.extensionTargetDir, join(portableRoot, 'data', 'default-user', 'extensions', 'npm-bridge'));
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
