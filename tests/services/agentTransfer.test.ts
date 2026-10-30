// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureAgentExport, captureAgentExports, copyAgentImage, getAgentCopiedImage, getAgentExport, getAgentExports } from '../../services/agentTransfer';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('暂存原图使用相对原图路径，保留字节并拒绝伪图片', async () => {
  const image = document.createElement('img'); image.src = '/thumbnail.webp'; image.dataset.agentOriginalSrc = '/original.png';
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 64 } });
  const blob = new Blob(['synthetic-pixels'], { type: 'image/png' });
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, blob: async () => blob })); vi.stubGlobal('fetch', fetch);
  const receipt = await copyAgentImage(image); expect(receipt.bytes).toBe(blob.size);
  expect(fetch.mock.calls[0][0]).toBe(new URL('/original.png', location.href).href);
  expect(getAgentCopiedImage().blob).toBe(blob);
  fetch.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['bad'], { type: 'text/plain' }) });
  await expect(copyAgentImage(image)).rejects.toThrow('实际图片'); expect(getAgentCopiedImage().blob).toBe(blob);
});
it('仅记录实际下载产物，恢复原生函数且内存副本有界', () => {
  const original = vi.fn(() => 'blob:synthetic-' + Math.random());
  vi.stubGlobal('URL', class extends URL { static createObjectURL = original; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const stop = captureAgentExports();
  for (let i = 0; i < 6; i++) { const blob = new Blob(['{}'], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'preset-' + i + '.json'; link.click(); }
  const items = getAgentExports(); expect(items).toHaveLength(4); expect(items.at(-1)?.name).toBe('preset-5.json');
  expect(getAgentExport(items[0].id).blob.size).toBe(2); expect(click).toHaveBeenCalledTimes(6);
  stop(); expect(URL.createObjectURL).toBe(original); expect(HTMLAnchorElement.prototype.click).toBe(click);
});
it('原生导出可提供实际副本，普通操作不捕获，同一产物不重复记录', () => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); });
  const before = getAgentExports().length, blob = new Blob(['native-copy']);
  captureAgentExport(blob, 'normal.png');expect(getAgentExports()).toHaveLength(before);
  const stop = captureAgentExports();
  try {captureAgentExport(blob, 'native.png');captureAgentExport(blob, 'native.png');expect(getAgentExports().filter(item=>item.name==='native.png')).toHaveLength(1);}
  finally {stop();}
  expect(getAgentExport(getAgentExports().at(-1)!.id).blob).toBe(blob);
});
it('缺少 crypto.randomUUID 时导出暂存仍可用', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1; return bytes; } });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); });
  const blob = new Blob(['uuid-fallback']);
  const stop = captureAgentExports();
  try {
    captureAgentExport(blob, 'fallback.png');
    const receipt = getAgentExports().at(-1)!;
    expect(receipt.name).toBe('fallback.png');
    expect(receipt.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getAgentExport(receipt.id).blob).toBe(blob);
  } finally { stop(); }
});

it('分享包与 Vibe 组合保留原始 Blob、文件名和 MIME，超限导出返回不可另存的明确回执', () => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic-' + Math.random()); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const stop = captureAgentExports();
  try {
    for (const [name, type] of [['recipe.naia', 'application/x-nai-atelier-style-bundle'], ['references.naiv4vibeBundle', 'application/json']]) {
      const blob = new Blob(['synthetic-original-bytes'], { type });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click();
      const receipt = getAgentExports().at(-1)!;
      expect(receipt).toMatchObject({ name, mimeType: type, bytes: blob.size, available: true });
      expect(getAgentExport(receipt.id).blob).toBe(blob);
    }
    const large = new Blob([new Uint8Array(30 * 1024 * 1024 + 1)], { type: 'application/x-nai-atelier-style-bundle' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(large); link.download = 'large.naia'; link.click();
    const receipt = getAgentExports().at(-1)!;
    expect(receipt).toMatchObject({ name: 'large.naia', bytes: large.size, available: false });
    expect(() => getAgentExport(receipt.id)).toThrow('30 MB');
    expect(click).toHaveBeenCalledTimes(3);
  } finally { stop(); }
});
