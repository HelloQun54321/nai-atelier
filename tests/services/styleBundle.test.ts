// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { api } from '../../services/api';
import { characterReferenceService } from '../../services/characterReferenceService';
import { prepareImageBlob } from '../../services/imageSharing';
import { exportStyleBundle, readStyleBundle, importStyleBundle, STYLE_BUNDLE_LIMITS } from '../../services/styleBundle';
import type { PromptChain } from '../../types';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), uploadFile: vi.fn() } }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: { create: vi.fn() } }));
vi.mock('../../services/imageSharing', () => ({ prepareImageBlob: vi.fn(async (blob: Blob) => blob), getCleanSharedImages: () => false, getSharedImageCustomText: () => '', getSharedImageCleanContent: () => 'all' }));
const createChain = vi.fn();
const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]); new DataView(png.buffer).setUint32(16, 1); new DataView(png.buffer).setUint32(20, 1);
const options = { coverMode: 'none' as const, author: '分享者', sourceUrl: 'https://example.org/free', note: '请保留免费来源' };
const chain = (id = 'private-id'): PromptChain => ({ id, userId: 'private-owner', username: '私人账号', type: 'style', name: '配方', description: '说明', tags: ['自定义'], previewImage: '/api/assets/covers/private.png', basePrompt: '1.2::artist:sample::, anime', negativePrompt: 'bad hands', modules: [{ id: 'module', name: '模块', content: 'watercolor', isActive: true, position: 'post', group: '媒介' }], params: { model: 'nai-diffusion-4-5-full', sampler: 'k_euler_ancestral', width: 832, height: 1216, scale: 5, steps: 28, seed: 42, characters: [{ id: 'role', enabled: true, prompt: 'girl', negativePrompt: 'hat', x: 0.3, y: 0.5, sections: { appearance: 'blue eyes' } }], _promptSections: { scene: 'park', sectionMeta: { scene: { entryId: 'private-entry', entryName: '场景名' } } }, _styleBundleSources: [{ author: '原作者', sourceUrl: '', note: '原声明' }] }, variableValues: { subject: 'standing' }, createdAt: 1, updatedAt: 2 });
beforeEach(() => {
  createChain.mockReset().mockResolvedValue({ ...chain('new-id') });
  vi.mocked(api.post).mockImplementation(async (path, payload) => {
    if (path === '/chains') return createChain(payload);
    return { item: { id: 'new-vibe', encodings: [{ id: 'new-encoding', model: 'nai-diffusion-4-5-full', informationExtracted: 0.7, encodingHash: Array.from(sha256(new TextEncoder().encode('x'.repeat(64))), byte => byte.toString(16).padStart(2, '0')).join('') }] } };
  });
  vi.mocked(api.uploadFile).mockResolvedValue({ url: '/api/assets/covers/new.png' });
  vi.mocked(characterReferenceService.create).mockResolvedValue({ item: { id: 'new-reference' } } as Awaited<ReturnType<typeof characterReferenceService.create>>);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } })));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function replaceManifest(file: Blob, change: (value: Record<string, unknown>) => void) {
  const header = new Uint8Array(await file.slice(0, 48).arrayBuffer()), view = new DataView(header.buffer), size = view.getUint32(12);
  const compressed = new Uint8Array(await file.slice(48, 48 + size).arrayBuffer()).map(byte => byte ^ 0xa7);
  const raw = JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  change(raw);
  const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(raw)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()).map(byte => byte ^ 0xa7);
  view.setUint32(12, bytes.length); header.set(sha256(bytes), 16);
  return new Blob([header, bytes, file.slice(48 + size)]);
}

describe('.naia 风格串分享包', () => {
  it('完整往返正文、模块、参数、多角色和主体，保留来源且不携带账号与未知本机字段', async () => {
    const original = chain(); Object.assign(original.params, { apiKey: 'secret', localPath: 'D:/private.png' });
    const file = await exportStyleBundle([original], options), preview = await readStyleBundle(file);
    expect(preview.entries[0].sources.map(item => item.author)).toEqual(['原作者', '分享者']);
    expect(preview.entries[0].cover).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(await importStyleBundle(preview, ['s0'])).toMatchObject({ importedEntryIds: ['s0'], failed: [] });
    const data = createChain.mock.calls[0][0]!;
    expect(data).toMatchObject({ basePrompt: original.basePrompt, negativePrompt: original.negativePrompt, modules: original.modules, variableValues: original.variableValues, params: { characters: original.params.characters, seed: 42, _promptSections: { scene: 'park', sectionMeta: { scene: { entryName: '场景名' } } } } });
    expect(JSON.stringify(data)).not.toMatch(/secret|private-owner|private-entry|private.png/);
    expect(data.id).toMatch(/^naia-[a-f0-9]{64}$/); expect(data.params).not.toHaveProperty('apiKey');
    expect(original.params._promptSections?.sectionMeta?.scene.entryId).toBe('private-entry');
  });

  it('无封面仍带必要参考和 Vibe 编码，重复引用只读一次且导入重映射', async () => {
    const first = chain(), second = chain('second');
    for (const item of [first, second]) {
      item.params.characterReferences = { enabled: true, slots: [{ assetId: 'old-ref', type: 'character', strength: 0.8, fidelity: 0.9 }] };
      item.params.vibes = { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'old-vibe', encodingId: 'old-encoding', informationExtracted: 0.7, strength: 0.6 }] };
    }
    vi.mocked(api.get).mockImplementation(async path => String(path).endsWith('/data') ? { encoding: btoa('x'.repeat(64)), variant: { model: 'nai-diffusion-4-5-full', modelKey: 'v4-5full', informationExtracted: 0.7 } } : { item: { sourceHash: 'a'.repeat(64), name: 'Vibe' } });
    const file = await exportStyleBundle([first, second], options), preview = await readStyleBundle(file);
    expect(fetch).toHaveBeenCalledTimes(1); expect(api.get).toHaveBeenCalledTimes(2);
    const mismatched = await replaceManifest(file, raw => { (raw.encodings as Array<Record<string, unknown>>)[0].model = 'bogus'; });
    await expect(readStyleBundle(mismatched)).rejects.toThrow('不一致');
    expect(api.post).not.toHaveBeenCalled(); expect(characterReferenceService.create).not.toHaveBeenCalled();
    const result = await importStyleBundle(preview, ['s0', 's1']); expect(result.failed).toEqual([]);
    expect(characterReferenceService.create).toHaveBeenCalledTimes(1); expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/vibes/import')).toHaveLength(1);
    const params = createChain.mock.calls[0][0]!.params!;
    expect(params.characterReferences!.slots[0].assetId).toBe('new-reference');
    expect(params.vibes!.slots[0]).toMatchObject({ vibeId: 'new-vibe', encodingId: 'new-encoding', strength: 0.6 });
    expect(preview.entries.every(entry => !entry.cover)).toBe(true);
  });

  it('拒绝损坏、未来版本、非法资产引用和过量条目，校验失败之前没有落库', async () => {
    const file = await exportStyleBundle([chain()], options);
    const corrupt = new Uint8Array(await file.arrayBuffer()); corrupt[48] ^= 1;
    await expect(readStyleBundle(new Blob([corrupt]))).rejects.toThrow('损坏');
    const future = new Uint8Array(await file.arrayBuffer()); new DataView(future.buffer).setUint32(8, 99);
    await expect(readStyleBundle(new Blob([future]))).rejects.toThrow('版本');
    const missing = await replaceManifest(file, raw => { (raw.entries as Array<Record<string, unknown>>)[0].cover = 'absent'; });
    await expect(readStyleBundle(missing)).rejects.toThrow('引用');
    const tooMany = await replaceManifest(file, raw => { raw.entries = Array(STYLE_BUNDLE_LIMITS.entries + 1).fill((raw.entries as unknown[])[0]); });
    await expect(readStyleBundle(tooMany)).rejects.toThrow('数量');
    expect(createChain).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });

  it('校验所有二进制内容，损坏参考图不能留下部分导入', async () => {
    const item = chain(); item.params.characterReferences = { enabled: true, slots: [{ assetId: 'old-ref', type: 'character', strength: 1, fidelity: 1 }] };
    const file = await exportStyleBundle([item], options), bytes = new Uint8Array(await file.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
    await expect(readStyleBundle(new Blob([bytes]))).rejects.toThrow('损坏');
    expect(characterReferenceService.create).not.toHaveBeenCalled();
  });

  it('导入失败可重试，成功条目在同包内不重复创建，先验证全部选择', async () => {
    const preview = await readStyleBundle(await exportStyleBundle([chain(), chain('second')], options));
    await expect(importStyleBundle(preview, ['unknown'])).rejects.toThrow('未知');
    createChain.mockResolvedValueOnce(chain('one')).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(chain('two'));
    expect(await importStyleBundle(preview, ['s0', 's1'])).toMatchObject({ importedEntryIds: ['s0'], failed: [{ id: 's1', error: '保存失败' }] });
    expect(await importStyleBundle(preview, ['s0', 's1'])).toMatchObject({ importedEntryIds: ['s0', 's1'], failed: [] });
    expect(createChain).toHaveBeenCalledTimes(3);
    expect(createChain.mock.calls[1][0].id).toBe(createChain.mock.calls[2][0].id);
  });

  it('原图与压缩封面均可导入，旧串缺少 type 仍可导出；失败重试复用封面上传', async () => {
    const old = chain(); delete (old as Partial<PromptChain>).type;
    const original = await readStyleBundle(await exportStyleBundle([old], { ...options, coverMode: 'original' }));
    expect(original.entries[0].cover).toBe(true);
    createChain.mockRejectedValueOnce(new Error('网络断线'));
    expect((await importStyleBundle(original, ['s0'])).failed).toHaveLength(1);
    await importStyleBundle(original, ['s0']); expect(api.uploadFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.uploadFile).mock.calls[0][0].name).toBe('cover.png');
    const webp = new Uint8Array(32); webp.set(new TextEncoder().encode('RIFF')); webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (done: (blob: Blob) => void) => done(new Blob([webp], { type: 'image/webp' })) }) });
    const compressed = await readStyleBundle(await exportStyleBundle([chain()], { ...options, coverMode: 'compressed' }));
    expect(compressed.entries[0].cover).toBe(true); expect(drawImage).toHaveBeenCalledTimes(1);
    await importStyleBundle(compressed, ['s0']);
    expect(vi.mocked(api.uploadFile).mock.calls[1][0].type).toBe('image/webp');
    expect(vi.mocked(api.uploadFile).mock.calls[1][0].name).toBe('cover.webp');
  });

  it('已有长名称和长正文完整保留，历史 NULL 文本按空白分享，内嵌封面仍可取用', async () => {
    const original = chain(); original.name = '长'.repeat(201); original.description = '说明'.repeat(33000);
    original.basePrompt = 'tag,'.repeat(17000); original.previewImage = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    const legacy = { ...chain('legacy'), description: null, basePrompt: null, negativePrompt: null, modules: null } as unknown as PromptChain;
    const preview = await readStyleBundle(await exportStyleBundle([original, legacy], { ...options, coverMode: 'original' }));
    expect(preview.entries[0]).toMatchObject({ name: original.name, description: original.description, cover: true });
    await importStyleBundle(preview, ['s0', 's1']);
    expect(createChain.mock.calls[0][0].basePrompt).toBe(original.basePrompt);
    expect(createChain.mock.calls[1][0]).toMatchObject({ description: '', basePrompt: '', negativePrompt: '', modules: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(exportStyleBundle([{ ...original, previewImage: 'data:text/html;base64,PHNjcmlwdD4=' }], { ...options, coverMode: 'original' })).rejects.toThrow('数据无效');
  });

  it('同源编码已存在但字节不同，明确拒绝绑定旧编码，也不创建风格串', async () => {
    const item = chain(); item.params.vibes = { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'vibe', encodingId: 'encoding', informationExtracted: 0.7, strength: 1 }] };
    vi.mocked(api.get).mockImplementation(async path => String(path).endsWith('/data') ? { encoding: btoa('x'.repeat(64)), variant: { model: 'nai-diffusion-4-5-full', modelKey: 'v4-5full', informationExtracted: 0.7 } } : { item: { sourceHash: 'a'.repeat(64), name: 'Vibe' } });
    const preview = await readStyleBundle(await exportStyleBundle([item], options));
    vi.mocked(api.post).mockResolvedValue({ item: { id: 'existing-vibe', encodings: [{ id: 'old-encoding', model: 'nai-diffusion-4-5-full', informationExtracted: 0.7, encodingHash: 'f'.repeat(64) }] } });
    expect(await importStyleBundle(preview, ['s0'])).toMatchObject({ createdIds: [], failed: [{ id: 's0', error: '已有 Vibe 编码与分享包冲突，已保留原编码' }] });
    expect(createChain).not.toHaveBeenCalled();
  });

  it('超过五万个编码的清单与导出允许的引用规模一致，不生成自身无法读取的包', async () => {
    const item = chain(); item.params.vibes = { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'vibe', encodingId: 'encoding', informationExtracted: 0.7, strength: 1 }] };
    vi.mocked(api.get).mockImplementation(async path => String(path).endsWith('/data') ? { encoding: btoa('x'.repeat(64)), variant: { model: 'nai-diffusion-4-5-full', modelKey: 'v4-5full', informationExtracted: 0.7 } } : { item: { sourceHash: 'a'.repeat(64), name: 'Vibe' } });
    const file = await exportStyleBundle([item], options);
    const large = await replaceManifest(file, raw => { const first = (raw.encodings as Record<string, unknown>[])[0]; raw.encodings = Array.from({ length: 50001 }, (_, index) => ({ ...first, id: `v${index}` })); });
    expect((await readStyleBundle(large)).entries).toHaveLength(1);
    const overflow = await replaceManifest(file, raw => { raw.assets = Array(STYLE_BUNDLE_LIMITS.assets + 1).fill(null); });
    await expect(readStyleBundle(overflow)).rejects.toThrow('数量');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('坏图片头和超过封面写入上限的原图在导出时拒绝，清洗失败不降级为泄露原图', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not an image'));
    await expect(exportStyleBundle([chain()], { ...options, coverMode: 'original' })).rejects.toThrow('图片');
    const oversized = new Blob([png, new Uint8Array(12 * 1024 * 1024)]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(oversized));
    await expect(exportStyleBundle([chain()], { ...options, coverMode: 'original' })).rejects.toThrow('12 MiB');
    vi.mocked(prepareImageBlob).mockRejectedValueOnce(new Error('元信息清洗失败'));
    await expect(exportStyleBundle([chain()], { ...options, coverMode: 'original' })).rejects.toThrow('元信息清洗失败');
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(createChain).not.toHaveBeenCalled();
  });

  it('先读头部限制巨幅图，不在发现坏包前解码像素或写资产', async () => {
    const original = await exportStyleBundle([chain()], { ...options, coverMode: 'original' });
    const bytes = new Uint8Array(await original.arrayBuffer()), view = new DataView(bytes.buffer);
    const start = 48 + view.getUint32(12), image = bytes.slice(start);
    new DataView(image.buffer).setUint32(16, 100000); new DataView(image.buffer).setUint32(20, 100000);
    const hash = Array.from(sha256(image), byte => byte.toString(16).padStart(2, '0')).join('');
    const changed = await replaceManifest(new Blob([bytes.slice(0, start), image]), raw => { (raw.assets as Array<Record<string, unknown>>)[0].hash = hash; });
    await expect(readStyleBundle(changed)).rejects.toThrow('像素');
    expect(createImageBitmap).not.toHaveBeenCalled(); expect(characterReferenceService.create).not.toHaveBeenCalled();
  });

  it('来源只追加去重，不允许本机、账号或可执行链接', async () => {
    for (const sourceUrl of ['file:///private', 'javascript:alert(1)', 'http://localhost/x', 'https://127.0.0.1/x', 'https://user:pass@example.org/x']) await expect(exportStyleBundle([chain()], { ...options, sourceUrl })).rejects.toThrow();
    const first = await readStyleBundle(await exportStyleBundle([chain()], options));
    const data = chain(); data.params._styleBundleSources = first.entries[0].sources;
    const second = await readStyleBundle(await exportStyleBundle([data], options));
    expect(second.entries[0].sources).toHaveLength(2);
  });

  it('来源已达数量上限时，留空或重复分享声明仍可再次导出且不丢原出处', async () => {
    const item = chain(); item.params._styleBundleSources = Array.from({ length: 100 }, (_, index) => ({ author: `作者${index}`, sourceUrl: '', note: '' }));
    for (const author of ['', '作者0']) {
      const preview = await readStyleBundle(await exportStyleBundle([item], { coverMode: 'none', author, sourceUrl: '', note: '' }));
      expect(preview.entries[0].sources).toEqual(item.params._styleBundleSources);
    }
    await expect(exportStyleBundle([item], { coverMode: 'none', author: '新作者', sourceUrl: '', note: '' })).rejects.toThrow('数量');
  });
});
