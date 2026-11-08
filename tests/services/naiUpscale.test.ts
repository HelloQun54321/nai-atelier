// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { NAI_UPSCALE_FACTOR, downloadUpscaledImage, upscaleCost, upscaleCostHint, upscaleHistoryImage, upscaleSupported } from '../../services/naiUpscale';
import { saveExportBlob } from '../../services/exportLocation';

vi.mock('../../services/exportLocation', () => ({
  beginExportTarget: vi.fn(() => undefined),
  saveExportBlob: vi.fn(async () => ({ saved: true, cancelled: false, filename: 'x.png', path: 'D:/exports/x.png' })),
}));

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('放大请求带当前 Key 与历史 ID，返回 2× PNG', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array(2048).fill(7), { status: 200, headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetch);
  const result = await upscaleHistoryImage('history-1', { createdAt: 0 });
  expect(String(fetch.mock.calls[0]![0])).toBe('/api/nai/upscale');
  const init = fetch.mock.calls[0]![1]!;
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-key');
  expect(JSON.parse(String(init.body))).toEqual({ historyId: 'history-1' });
  expect(result.blob.size).toBe(2048);
  expect(result.filename).toMatch(/_2x\.png$/);
  expect(NAI_UPSCALE_FACTOR).toBe(2);
});

it('按源图面积给出实测档位点数', () => {
  // 108 万像素以内统一 1 点。
  expect(upscaleCost(256, 256)).toBe(1);
  expect(upscaleCost(832, 1216)).toBe(1);
  expect(upscaleCost(1024, 1024)).toBe(1);
  // 1M~3M 均分三段，边界 1,747,627 / 2,446,678 两侧。
  expect(upscaleCost(1025, 1024)).toBe(2);
  expect(upscaleCost(1321, 1321)).toBe(2);
  expect(upscaleCost(1322, 1322)).toBe(3);
  expect(upscaleCost(1152, 1536)).toBe(3);
  expect(upscaleCost(1564, 1564)).toBe(3);
  expect(upscaleCost(1565, 1565)).toBe(4);
  expect(upscaleCost(1216, 1664)).toBe(3);
  expect(upscaleCost(1773, 1774)).toBe(4);
});

it('超过官方 3,145,728 像素上限时提前拒绝', () => {
  expect(upscaleSupported(832, 1216)).toBe(true);
  expect(upscaleSupported(1773, 1774)).toBe(true);
  expect(upscaleSupported(2048, 1537)).toBe(false);
  // 缺少尺寸时不阻止调用，交由官方判定。
  expect(upscaleSupported(undefined, undefined)).toBe(true);
  expect(upscaleCostHint(2048, 1537)).toContain('超过官方上限');
});

it('放大结果走项目统一的导出通道，不用浏览器默认下载', async () => {
  const blob = new Blob(['x']);
  const receipt = await downloadUpscaledImage({ blob, filename: 'a.png', width: 2, height: 2 });
  expect(saveExportBlob).toHaveBeenCalledWith(blob, 'a.png', undefined);
  expect(receipt.path).toBe('D:/exports/x.png');
});

it('缺少 Key 直接拒绝，不发起请求', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(upscaleHistoryImage('history-1')).rejects.toThrow('请先填写 NovelAI API Key');
  expect(fetch).not.toHaveBeenCalled();
});

it('网关错误原样抛出，不伪造成功', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'NovelAI Anlas 不足' }, { status: 402 })));
  await expect(upscaleHistoryImage('history-1')).rejects.toThrow('NovelAI Anlas 不足');
});


