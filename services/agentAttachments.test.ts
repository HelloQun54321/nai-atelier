// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareAgentAttachment } from './agentAttachments';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('格式和单张体积在读取之前拒绝', async () => {
  await expect(prepareAgentAttachment(new File(['x'], 'file.pdf', { type: 'application/pdf' }))).rejects.toThrow('仅支持');
  await expect(prepareAgentAttachment(new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow('超过 6 MB');
});
it('缩小发送副本到 1600 像素，保持比例并标明压缩', async () => {
  const draw = vi.fn(); let canvasSize: { width: number; height: number } | undefined;
  vi.stubGlobal('Image', class { naturalWidth = 3200; naturalHeight = 1600; onload: (() => void) | undefined; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) { canvasSize = { width: this.width, height: this.height }; return { drawImage: draw } as unknown as CanvasRenderingContext2D; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,YWJjZA==');
  const result = await prepareAgentAttachment(new File(['synthetic'], 'picture.png', { type: 'image/png' }));
  expect(canvasSize).toEqual({ width: 1600, height: 800 });
  expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 1600, 800]);
  expect(result).toEqual({ data: 'YWJjZA==', mimeType: 'image/webp', name: 'picture.png · 已压缩' });
});
