// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { api } from '../../services/api';
import { characterReferenceService } from '../../services/characterReferenceService';
import { prepareImageBlob } from '../../services/imageSharing';
import { exportStyleBundle, readStyleBundle, getStyleBundleEntryPreview, importStyleBundle, STYLE_BUNDLE_LIMITS } from '../../services/styleBundle';
import type { PromptChain } from '../../types';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), uploadFile: vi.fn() } }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: { create: vi.fn() } }));
vi.mock('../../services/imageSharing', () => ({ prepareImageBlob: vi.fn(async (blob: Blob) => blob), getCleanSharedImages: () => false, getSharedImageCustomText: () => '', getSharedImageCleanContent: () => 'all' }));
const createChain = vi.fn();
const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]); new DataView(png.buffer).setUint32(16, 1); new DataView(png.buffer).setUint32(20, 1);
const options = { allChainIds: ['private-id'], coverMode: 'none' as const, author: '分享者', sourceUrl: 'https://example.org/free', note: '请保留免费来源' };
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
  it('无封面预览可查看完整配方，快照修改不会污染后续预览或导入', async () => {
    const original = chain();
    const preview = await readStyleBundle(await exportStyleBundle([original], options));
    const snapshot = getStyleBundleEntryPreview(preview, 's0');
    const expected = structuredClone(snapshot);
    expect(snapshot.coverBlob).toBeUndefined();
    expect(snapshot).toMatchObject({ id: 's0', name: original.name, description: original.description, tags: original.tags, basePrompt: original.basePrompt, negativePrompt: original.negativePrompt, modules: original.modules, variableValues: original.variableValues });
    snapshot.basePrompt = 'changed'; snapshot.tags.push('changed'); snapshot.modules[0].content = 'changed';
    snapshot.params.characters![0].prompt = 'changed';
    snapshot.params._promptSections!.sectionMeta!.scene.entryName = 'changed';
    snapshot.params._styleBundleSources![0].author = 'changed';
    snapshot.variableValues!.subject = 'changed';
    const unchanged = getStyleBundleEntryPreview(preview, 's0');
    expect(unchanged).toEqual(expected);
    expect(api.post).not.toHaveBeenCalled(); expect(api.uploadFile).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    await importStyleBundle(preview, ['s0']);
    expect(createChain.mock.calls[0][0]).toMatchObject({ basePrompt: original.basePrompt, tags: original.tags, modules: original.modules, variableValues: original.variableValues, params: { characters: original.params.characters, _promptSections: { sectionMeta: { scene: { entryName: '场景名' } } } } });
    await importStyleBundle(preview, ['s0']);
    expect(createChain).toHaveBeenCalledTimes(1);
  });

  it('真实包内封面按原字节只读提取，不调用上传、建串或联网读取', async () => {
    const file = await exportStyleBundle([chain()], { ...options, coverMode: 'original' });
    const preview = await readStyleBundle(file);
    vi.mocked(fetch).mockClear();
    const snapshot = getStyleBundleEntryPreview(preview, 's0');
    expect(snapshot.coverBlob?.type).toBe('image/png');
    expect(new Uint8Array(await snapshot.coverBlob!.arrayBuffer())).toEqual(png);
    expect(snapshot).not.toHaveProperty('cover');
    expect(api.post).not.toHaveBeenCalled(); expect(api.uploadFile).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(characterReferenceService.create).not.toHaveBeenCalled();
  });

  it('未校验或复制的预览对象与未知条目均明确拒绝', async () => {
    const preview = await readStyleBundle(await exportStyleBundle([chain()], options));
    expect(() => getStyleBundleEntryPreview({ ...preview }, 's0')).toThrow('请先读取并校验分享包');
    expect(() => getStyleBundleEntryPreview(preview, 'unknown')).toThrow('分享包中不存在该风格串');
    expect(api.post).not.toHaveBeenCalled(); expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it.each([
    { name: '完整库乱序且参考 ID 重复', exported: ['private-a', 'private-b'], all: ['private-b', 'private-a', 'private-a'], coverage: 'full' },
    { name: '实际子集', exported: ['private-a'], all: ['private-a', 'private-b'], coverage: 'partial' },
    { name: '数量相同但成员不同', exported: ['private-a', 'private-c'], all: ['private-a', 'private-b'], coverage: 'partial' },
    { name: '筛选或勾选实际覆盖全部', exported: ['private-b', 'private-a'], all: ['private-a', 'private-b'], coverage: 'full' },
    { name: '导出集合重复不改变覆盖意义', exported: ['private-a', 'private-a'], all: ['private-a'], coverage: 'full' },
  ])('按真实集合自动标记：$name', async ({ exported, all, coverage }) => {
    const file = await exportStyleBundle(exported.map(id => chain(id)), { ...options, allChainIds: all });
    expect((await readStyleBundle(file)).coverage).toBe(coverage);
    let manifest = '';
    await replaceManifest(file, raw => { manifest = JSON.stringify(raw); expect(raw.coverage).toBe(coverage); });
    for (const id of new Set([...exported, ...all])) expect(manifest).not.toContain(id);
    expect(manifest).not.toContain('allChainIds');
    expect(manifest).not.toContain('totalCount');
  });

  it('旧包没有标记显示未记录，存在但非法的范围标记一律拒绝', async () => {
    const file = await exportStyleBundle([chain()], options);
    const legacy = await replaceManifest(file, raw => { delete raw.coverage; });
    expect((await readStyleBundle(legacy)).coverage).toBe('unrecorded');
    for (const coverage of ['unrecorded', 'all', '', null, false, 1, {}]) {
      const invalid = await replaceManifest(file, raw => { raw.coverage = coverage; });
      await expect(readStyleBundle(invalid)).rejects.toThrow('打包范围');
    }
    expect(api.post).not.toHaveBeenCalled();
  });

  it('再次分享按当前工坊重新计算，不沿用此前包的范围或传入伪造选项', async () => {
    const file = await exportStyleBundle([chain()], { ...options, coverage: 'partial' } as Parameters<typeof exportStyleBundle>[1]);
    const preview = await readStyleBundle(file); expect(preview.coverage).toBe('full');
    await importStyleBundle(preview, ['s0']);
    const imported = createChain.mock.calls[0][0];
    expect(imported.params).not.toHaveProperty('coverage');
    const local = { ...chain(), ...imported, id: 'imported-local-id' };
    const reexported = await exportStyleBundle([local], { ...options, allChainIds: [local.id, 'another-local-id'] });
    expect((await readStyleBundle(reexported)).coverage).toBe('partial');
    await expect(exportStyleBundle([chain()], { ...options, allChainIds: undefined } as unknown as Parameters<typeof exportStyleBundle>[1])).rejects.toThrow('打包范围');
  });

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
    const file = await exportStyleBundle([first, second], { ...options, allChainIds: [first.id, second.id] }), preview = await readStyleBundle(file);
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

  it.each([true, false])('完整 Vibe 参数优先往返，提取量已知=%s；同提取量按参数与哈希选择编码', async informationKnown => {
    const item = chain();
    item.params.vibes = { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'old-vibe', encodingId: 'old-encoding', informationExtracted: 0.7, strength: -0.4 }] };
    const parameters = { ...(informationKnown ? { information_extracted: 0.7 } : {}), mask: 'selected-mask' };
    const encodingHash = Array.from(sha256(new TextEncoder().encode('x'.repeat(64))), byte => byte.toString(16).padStart(2, '0')).join('');
    vi.mocked(api.get).mockImplementation(async path => String(path).endsWith('/data')
      ? { encoding: btoa('x'.repeat(64)), variant: { model: item.params.model, modelKey: 'v4-5full', informationExtracted: 0.7, informationKnown, parameters } }
      : { item: { sourceHash: 'a'.repeat(64), name: 'Vibe' } });
    vi.mocked(api.post).mockImplementation(async (path, payload) => path === '/chains' ? createChain(payload) : { item: { id: 'new-vibe', encodings: [
      { id: 'other-parameters', model: item.params.model, informationExtracted: informationKnown ? 0.7 : 0.4, informationKnown, parameters: { ...parameters, mask: 'other-mask' }, encodingHash },
      { id: 'selected-encoding', model: item.params.model, informationExtracted: informationKnown ? 0.7 : 0.4, informationKnown, parameters, encodingHash },
    ] } });
    const preview = await readStyleBundle(await exportStyleBundle([item], options));
    expect(await importStyleBundle(preview, ['s0'])).toMatchObject({ importedEntryIds: ['s0'], failed: [] });
    const imported = vi.mocked(api.post).mock.calls.find(([path]) => path === '/vibes/import')![1] as { document: { encodings: Record<string, { variant: { params: unknown } }> } };
    expect(imported.document.encodings['v4-5full'].variant.params).toEqual(parameters);
    expect(createChain.mock.calls[0][0].params.vibes.slots[0]).toMatchObject({ encodingId: 'selected-encoding', informationExtracted: informationKnown ? 0.7 : 0.4, informationKnown, strength: -0.4 });
  });

  it.each([
    { name: '文字提取量', fields: { parameters: { information_extracted: 'bad' } } },
    { name: '负提取量', fields: { parameters: { information_extracted: -0.1 } } },
    { name: '超过 1 的提取量', fields: { parameters: { information_extracted: 1.1 } } },
    { name: '与外层不同的提取量', fields: { parameters: { information_extracted: 0.6 } } },
    { name: '未知标记带已知提取量', fields: { parameters: { information_extracted: 0.7 }, informationKnown: false } },
    { name: '已知标记没有提取量', fields: { parameters: { mask: 'mask' }, informationKnown: true } },
    { name: '缺少参数却标记已知', fields: { parameters: null, informationKnown: true } },
    { name: '非布尔状态', fields: { informationKnown: 'false' } },
  ])('完整读包阶段拒绝矛盾 Vibe 参数：$name，尚未写入任何资料', async ({ fields }) => {
    const item = chain(); item.params.vibes = { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'vibe', encodingId: 'encoding', informationExtracted: 0.7, strength: 1 }] };
    vi.mocked(api.get).mockImplementation(async path => String(path).endsWith('/data') ? { encoding: btoa('x'.repeat(64)), variant: { model: item.params.model, modelKey: 'v4-5full', informationExtracted: 0.7 } } : { item: { sourceHash: 'a'.repeat(64), name: 'Vibe' } });
    const file = await exportStyleBundle([chain('valid-first'), item], { ...options, allChainIds: ['valid-first', item.id] });
    const invalid = await replaceManifest(file, raw => Object.assign((raw.encodings as Record<string, unknown>[])[0], fields));
    await expect(readStyleBundle(invalid)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled(); expect(api.uploadFile).not.toHaveBeenCalled(); expect(characterReferenceService.create).not.toHaveBeenCalled();
  });

  it('完整读包阶段拒绝选择与编码的提取量状态相反', async () => {
    const item = chain(); item.params.vibes = { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'vibe', encodingId: 'encoding', informationExtracted: 0.7, strength: 1 }] };
    vi.mocked(api.get).mockImplementation(async path => String(path).endsWith('/data') ? { encoding: btoa('x'.repeat(64)), variant: { model: item.params.model, modelKey: 'v4-5full', informationExtracted: 0.7 } } : { item: { sourceHash: 'a'.repeat(64), name: 'Vibe' } });
    const invalid = await replaceManifest(await exportStyleBundle([item], options), raw => {
      const entry = (raw.entries as Array<{ params: { vibes: { slots: Array<{ informationKnown: boolean }> } } }>)[0];
      entry.params.vibes.slots[0].informationKnown = false;
    });
    await expect(readStyleBundle(invalid)).rejects.toThrow('分享包 Vibe 选择无效');
    expect(api.post).not.toHaveBeenCalled();
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
    const preview = await readStyleBundle(await exportStyleBundle([chain(), chain('second')], { ...options, allChainIds: ['private-id', 'second'] }));
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
    const preview = await readStyleBundle(await exportStyleBundle([original, legacy], { ...options, allChainIds: [original.id, legacy.id], coverMode: 'original' }));
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
      const preview = await readStyleBundle(await exportStyleBundle([item], { allChainIds: [item.id], coverMode: 'none', author, sourceUrl: '', note: '' }));
      expect(preview.entries[0].sources).toEqual(item.params._styleBundleSources);
    }
    await expect(exportStyleBundle([item], { allChainIds: [item.id], coverMode: 'none', author: '新作者', sourceUrl: '', note: '' })).rejects.toThrow('数量');
  });
});
