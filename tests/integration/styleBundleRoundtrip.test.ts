// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { crc32 } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { characterReferenceService } from '../../services/characterReferenceService';
import { exportStyleBundle, importStyleBundle, readStyleBundle } from '../../services/styleBundle';
import { handleSettingsRoute } from '../../worker/routes/settingsRoutes';
import { handleVibeRoute } from '../../worker/routes/vibeRoutes';
import { INIT_SQL, type D1Database, type Env, type RouteContext } from '../../worker/routes/types';
import type { PromptChain } from '../../types';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=', 'base64'));
const label = Buffer.from('tEXtComment\0second cover');
const chunk = Buffer.alloc(label.length + 8); chunk.writeUInt32BE(label.length - 4); chunk.set(label, 4); chunk.writeUInt32BE(crc32(label), chunk.length - 4);
const secondPng = Uint8Array.from(Buffer.concat([png.slice(0, -12), chunk, png.slice(-12)]));

// 复用正式 SQL 和真实路由，只把 D1/R2 接到隔离内存存储。
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const db = { prepare(query: string) {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(query).run(...values).changes } }; } };
  }, async batch(statements: { run(): Promise<unknown> }[]) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const files = new Map<string, { bytes: ArrayBuffer; type: string }>();
  const bucket = {
    async put(key: string, body: BodyInit, options?: { httpMetadata?: { contentType?: string } }) { files.set(key, { bytes: await new Response(body).arrayBuffer(), type: options?.httpMetadata?.contentType || 'application/octet-stream' }); },
    async get(key: string) { const file = files.get(key); return file ? { body: new Response(file.bytes.slice(0)).body!, httpEtag: 'synthetic', writeHttpMetadata(headers: Headers) { headers.set('content-type', file.type); } } : null; },
    async delete(key: string) { files.delete(key); },
  };
  const env = { BUCKET: bucket, ASSETS: { fetch: async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === '/tag-data/manifest.json') return Response.json({ artistPages: [] });
    throw new Error(`未配置的合成资产 ${url.pathname}`);
  } } } as unknown as Env;
  const initDB = async () => { throw new Error('隔离测试不得迁移'); };
  const route = async (input: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input);
    if (!raw.startsWith('/api/')) throw new Error(`禁止外网或非 API 请求：${raw}`);
    const request = new Request(`http://localhost${raw}`, options), url = new URL(request.url), path = url.pathname;
    if (path.startsWith('/api/assets/')) {
      const file = files.get(decodeURIComponent(path.slice('/api/assets/'.length)));
      return file ? new Response(file.bytes.slice(0), { headers: { 'content-type': file.type } }) : new Response(null, { status: 404 });
    }
    const context = { request, path, url, method: request.method, db, env, initDB, currentUser: { id: 'synthetic-owner', username: 'synthetic', role: 'admin' } } as RouteContext;
    const response = await handleVibeRoute(context) || await handleSettingsRoute(context);
    if (!response) throw new Error(`未接线的真实路由：${path}`);
    return response;
  };
  return { sqlite, files, route };
}

it.each(['original', 'none', 'original-retry', 'vibe-conflict'] as const)('%s 封面的多条配方经过真实 API 往返到独立空工坊，共享参考和编码保持可用', async scenario => {
  const coverMode = scenario === 'none' ? 'none' : 'original';
  let clock = 1_700_000_000_000; const now = vi.spyOn(Date, 'now').mockImplementation(() => clock++);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close() {} })));
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (done: (blob: Blob) => void) => done(new Blob([png], { type: 'image/png' })) }) });
  const source = fixture(), target = fixture(); let active = source;
  let rejectChain = scenario === 'original-retry';
  const fetch = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
    if (active === target && input === '/api/chains' && options?.method === 'POST' && rejectChain) {
      rejectChain = false; return Promise.resolve(Response.json({ error: 'synthetic transport failure' }, { status: 503 }));
    }
    return active.route(input, options);
  }); vi.stubGlobal('fetch', fetch);
  const reference = await characterReferenceService.create(new File([png], 'reference.png', { type: 'image/png' }), '共享参考');
  const encoding = btoa('synthetic-encoding'.repeat(5));
  const vibe = await api.post('/vibes/import', { document: { identifier: 'novelai-vibe-transfer', version: 1, type: 'image', id: 'a'.repeat(64), name: '共享编码', encodings: { 'v4-5full': { variant: { encoding, params: { information_extracted: 0.7 } } } } } });
  const params: PromptChain['params'] = {
    model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, seed: 42, sampler: 'k_euler_ancestral',
    qualityPresetId: 'none', ucPresetId: 'none', qualityToggle: false, ucPreset: 4, useCoords: true, variety: true, cfgRescale: 0.2,
    transparent: false, transparentWeight: 1.2, alphaMode: 'straight',
    characters: [{ id: 'role', prompt: 'girl', negativePrompt: 'hat', x: 0.3, y: 0.7, enabled: true, sections: { appearance: 'blue eyes' }, sectionNegatives: { pose: 'sitting' } }],
    _promptSections: { scene: 'park', camera: 'wide shot', extra: 'watercolor', sectionNegatives: { scene: 'city' } },
    vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: vibe.item.id, encodingId: vibe.item.encodings[0].id, informationExtracted: 0.7, strength: 0.6 }] },
    characterReferences: { enabled: true, slots: [{ assetId: reference.item.id, assetName: '共享参考', type: 'character_style', strength: 0.8, fidelity: 0.9 }] },
    _styleBundleSources: [{ author: '原作者', sourceUrl: 'https://example.org/original', note: '免费出处' }],
  };
  const originals: PromptChain[] = [];
  for (const [index, name] of ['配方一', '配方二'].entries()) {
    const cover = await api.uploadFile(new File([index ? secondPng : png], 'cover.png', { type: 'image/png' }), 'covers');
    const created = await api.post('/chains', { name, description: '合成说明', tags: ['夜景'], basePrompt: '1.2::artist:synthetic::', negativePrompt: 'bad hands', modules: [{ id: 'module', name: '材质', content: 'watercolor', isActive: true, position: 'post', group: '媒介' }], params, variableValues: { subject: 'standing' }, previewImage: cover.url, type: 'style' });
    originals.push(await api.get(`/chains/${created.id}`));
  }
  const blob = await exportStyleBundle(originals, { allChainIds: originals.map(chain => chain.id), coverMode, author: '分享者', sourceUrl: 'https://example.org/free', note: '保留来源' });
  const preview = await readStyleBundle(blob); expect(preview.coverage).toBe('full'); active = target; now.mockReturnValue(1_700_000_100_000);
  let conflictingVibe: any;
  const otherEncoding = btoa('different-existing-encoding'.repeat(5));
  if (scenario === 'vibe-conflict') {
    conflictingVibe = await api.post('/vibes/import', { document: { identifier: 'novelai-vibe-transfer', version: 1, type: 'image', id: 'a'.repeat(64), name: '目标已有编码', encodings: { 'v4-5full': { variant: { encoding: otherEncoding, params: { information_extracted: 0.7 } } } } } });
  }
  let result = await importStyleBundle(preview, preview.entries.map(entry => entry.id));
  if (scenario === 'vibe-conflict') {
    expect(result.createdIds).toEqual([]); expect(result.failed).toHaveLength(2);
    expect(result.failed.every(item => /编码.*冲突|冲突.*编码/.test(item.error))).toBe(true);
    expect(target.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(0);
    expect(target.sqlite.prepare('SELECT COUNT(*) AS count FROM vibe_encodings').get()?.count).toBe(1);
    expect((await api.get(`/vibes/${conflictingVibe.item.id}/encodings/${conflictingVibe.item.encodings[0].id}/data`)).encoding).toBe(otherEncoding);
    return;
  }
  if (scenario === 'original-retry') {
    expect(result.failed).toMatchObject([{ id: 's0', error: 'synthetic transport failure' }]);
    result = await importStyleBundle(preview, preview.entries.map(entry => entry.id));
  }
  expect(result.failed).toEqual([]); expect(result.createdIds).toHaveLength(2);
  const saved: PromptChain[] = await Promise.all(result.createdIds.map(id => api.get(`/chains/${id}`)));
  for (const [index, entry] of saved.entries()) {
    const original = originals[index];
    expect(entry).toMatchObject({ name: original.name, description: original.description, tags: original.tags, basePrompt: original.basePrompt, negativePrompt: original.negativePrompt, modules: original.modules, variableValues: original.variableValues });
    const plain = { ...original.params }; delete plain.vibes; delete plain.characterReferences; delete plain._styleBundleSources;
    expect(entry.params).toMatchObject(plain);
    expect(entry.params._styleBundleSources?.map(item => item.author)).toEqual(['原作者', '分享者']);
    const slot = entry.params.characterReferences!.slots[0]; expect(slot).toMatchObject({ type: 'character_style', strength: 0.8, fidelity: 0.9 });
    expect(slot.assetId).not.toBe(reference.item.id); expect((await fetch(`/api/character-references/${slot.assetId}/image`)).status).toBe(200);
    const vibeSlot = entry.params.vibes!.slots[0]; expect(vibeSlot).toMatchObject({ informationExtracted: 0.7, strength: 0.6 });
    expect(vibeSlot.vibeId).not.toBe(vibe.item.id);
    expect((await api.get(`/vibes/${vibeSlot.vibeId}/encodings/${vibeSlot.encodingId}/data`)).encoding).toBe(encoding);
    if (coverMode === 'none') expect(entry.previewImage).toBeFalsy();
    else { expect(entry.previewImage).toMatch(/^\/api\/assets\/covers\//); expect(new Uint8Array(await (await fetch(entry.previewImage!)).arrayBuffer())).toEqual(index ? secondPng : png); }
  }
  for (const table of ['character_reference_assets', 'vibe_assets', 'vibe_encodings']) expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(1);
  await importStyleBundle(preview, preview.entries.map(entry => entry.id));
  expect(target.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(2);
  expect(source.sqlite.prepare('SELECT COUNT(*) AS count FROM chains').get()?.count).toBe(2);
});
