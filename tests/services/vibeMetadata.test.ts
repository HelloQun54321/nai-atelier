// @vitest-environment node
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vibeService } from '../../services/vibeService';
import { parseNovelAIMetadata } from '../../services/metadataService';
import { api } from '../../services/api';

const encoded = Buffer.from('synthetic-encoded-reference'.repeat(8)).toString('base64');
const metadata = { model: 'nai-diffusion-4-5-full', prompt: 'watercolor', uc: '', steps: 28,
  reference_image_multiple: [encoded, encoded], reference_strength_multiple: [1.5, -0.5], normalize_reference_strength_multiple: false };
afterEach(() => vi.restoreAllMocks());

describe('PNG 中已有 Vibe 编码的免费复用', () => {
  it.each([undefined, 'unrecognized-model'])('原模型 %s 无法识别时不以当前草稿模型定型编码', async model => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ slots: [], normalizeStrengths: true });
    const parsed = parseNovelAIMetadata(JSON.stringify({ ...metadata, model }), { model: 'nai-diffusion-5-full' });
    expect(parsed.params.model).toBe('nai-diffusion-5-full');
    expect(parsed.params.vibes?.embedded?.model).toBe('');
    await expect(vibeService.resolveParams(parsed.params)).rejects.toThrow('缺少已知模型');
    expect(post).not.toHaveBeenCalled();
  });

  it('纯解析保留原始编码与负强度，不写资料；取用只调用本地导入，不发出编码请求', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ slots: [{ vibeId: 'v', encodingId: 'e', informationKnown: false, informationExtracted: 0.7, strength: 1.5 },
      { vibeId: 'v', encodingId: 'e', informationKnown: false, informationExtracted: 0.7, strength: -0.5 }], normalizeStrengths: false });
    const parsed = parseNovelAIMetadata(JSON.stringify(metadata));
    expect(parsed.params.vibes?.embedded?.encodings).toEqual([encoded, encoded]); expect(post).not.toHaveBeenCalled();
    const result = await vibeService.resolveParams(parsed.params);
    expect(post).toHaveBeenCalledOnce();
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/vibes/import');
    expect((body as any).document.vibes[0]).toMatchObject({ type: 'encoding', id: createHash('sha256').update(encoded).digest('hex'), encodings: { 'v4-5full': { unknown: { encoding: encoded } } } });
    expect((body as any).document.vibes[0].encodings['v4-5full'].unknown.params).toBeUndefined();
    expect(result.vibes?.embedded).toBeUndefined(); expect(result.vibes?.slots.map(slot => slot.strength)).toEqual([1.5, -0.5]);
  });

  it('从实际 PNG 文本块读取已有编码，同一解析结果的并发取用合并', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=', 'base64');
    const data = Buffer.from('tEXtComment\0' + JSON.stringify(metadata));
    const chunk = Buffer.alloc(data.length + 8); chunk.writeUInt32BE(data.length - 4); chunk.set(data, 4); chunk.writeUInt32BE(crc32(data), chunk.length - 4);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ slots: [], normalizeStrengths: false });
    await vibeService.importFile(new File([png.subarray(0, -12), chunk, png.subarray(-12)], 'official.png', { type: 'image/png' }));
    expect(post).toHaveBeenCalledOnce(); expect((post.mock.calls[0][1] as any).document.vibes).toHaveLength(2);
    const params = parseNovelAIMetadata(JSON.stringify(metadata)).params;
    await Promise.all([vibeService.resolveParams(params), vibeService.resolveParams(params)]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('空参考清除草稿旧 Vibe，坏强度不静默丢弃后继续生成', () => {
    const old = { vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'old', encodingId: 'old', informationExtracted: 1, strength: 0.6 }] } };
    expect(parseNovelAIMetadata(JSON.stringify({ prompt: 'new', reference_image_multiple: [] }), old).params.vibes?.slots).toEqual([]);
    expect(() => parseNovelAIMetadata(JSON.stringify({ ...metadata, reference_strength_multiple: ['broken'] }))).toThrow('图片中的 Vibe 强度无效');
  });
});
