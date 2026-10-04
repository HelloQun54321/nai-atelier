// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureAgentExports, copyAgentImage, getAgentCopiedImage, getAgentExport, getAgentExports } from '../../services/agentTransfer';
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
