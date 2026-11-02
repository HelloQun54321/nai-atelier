// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { agentAttachmentsText, formatAgentTextAttachment, prepareAgentAttachment, prepareAgentFile, prepareAgentTextAttachment, splitAgentAttachmentSegments, stripAgentAttachmentText } from '../../services/agentAttachments';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('格式和单张体积在读取之前拒绝', async () => {
  await expect(prepareAgentAttachment(new File(['x'], 'file.pdf', { type: 'application/pdf' }))).rejects.toThrow('仅支持');
  await expect(prepareAgentAttachment(new File([new Uint8Array(33 * 1024 * 1024)], 'large.png', { type: 'image/png' }))).rejects.toThrow('超过 32 MB');
  await expect(prepareAgentAttachment(new File(['x'], 'scan.tiff', { type: 'image/tiff' }))).rejects.toThrow('TIFF');
});
it('缩小发送副本到 1600 像素，保持比例并标明压缩', async () => {
  const draw = vi.fn(); let canvasSize: { width: number; height: number } | undefined;
  vi.stubGlobal('Image', class { naturalWidth = 3200; naturalHeight = 1600; onload: (() => void) | undefined; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) { canvasSize = { width: this.width, height: this.height }; return { drawImage: draw } as unknown as CanvasRenderingContext2D; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,YWJjZA==');
  const result = await prepareAgentAttachment(new File(['synthetic'], 'picture.png', { type: 'image/png' }));
  expect(canvasSize).toEqual({ width: 1600, height: 800 });
  expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 1600, 800]);
  expect(result).toMatchObject({ kind: 'image', data: 'YWJjZA==', mimeType: 'image/webp', name: 'picture.png · 已压缩' });
});
it('BMP 这类浏览器能解码但模型不收的格式统一转成 WebP', async () => {
  vi.stubGlobal('Image', class { naturalWidth = 64; naturalHeight = 64; onload: (() => void) | undefined; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,YWJjZA==');
  const result = await prepareAgentAttachment(new File(['synthetic'], 'shot.bmp', { type: 'image/bmp' }));
  expect(result).toMatchObject({ kind: 'image', mimeType: 'image/webp' });
});
it('文本文件按原样读入，字符数如实记录', async () => {
  const result = await prepareAgentTextAttachment(new File(['第一行\n第二行'], 'note.md', { type: 'text/markdown' }));
  expect(result).toMatchObject({ kind: 'text', name: 'note.md', text: '第一行\n第二行', bytes: 7 });
});
it('压缩包与旧版 Office 直接给出替代做法', async () => {
  await expect(prepareAgentTextAttachment(new File(['x'], 'pack.zip', { type: 'application/zip' }))).rejects.toThrow('压缩包');
  await expect(prepareAgentTextAttachment(new File(['x'], 'old.doc', { type: 'application/msword' }))).rejects.toThrow('旧版 Office');
});
it('一个入口按图片／文字分派', async () => {
  const text = await prepareAgentFile(new File(['hello'], 'readme.txt', { type: 'text/plain' }));
  expect(text.kind).toBe('text');
  vi.stubGlobal('Image', class { naturalWidth = 800; naturalHeight = 600; onload: (() => void) | undefined; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  const image = await prepareAgentFile(new File(['synthetic'], 'small.png', { type: 'image/png' }));
  expect(image.kind).toBe('image');
});
it('附件段能在消息正文里往返，编辑时只还原自己的话', () => {
  const formatted = formatAgentTextAttachment({ kind: 'text', data: '', mimeType: 'text/plain', name: '设定.md', bytes: 12, text: '一只猫\n和一只狗', note: '文本文件' });
  const message = `请按附件改写提示词\n\n${formatted}`;
  const segments = splitAgentAttachmentSegments(message);
  expect(segments.map(segment => segment.type)).toEqual(['text', 'attachment']);
  expect(segments[1]).toMatchObject({ name: '设定.md', size: '12', text: '一只猫\n和一只狗' });
  expect(stripAgentAttachmentText(message)).toBe('请按附件改写提示词');
  expect(stripAgentAttachmentText('普通消息')).toBe('普通消息');
});
it('多个文字附件按顺序拼进同一条消息', () => {
  const attachments = [
    { kind: 'text' as const, data: '' as const, mimeType: 'text/plain', name: 'a.txt', bytes: 3, text: 'aaa', note: '文本文件' },
    { kind: 'image' as const, data: 'AAAA', mimeType: 'image/png', name: 'b.png', bytes: 3 },
    { kind: 'text' as const, data: '' as const, mimeType: 'text/plain', name: 'c.txt', bytes: 3, text: 'ccc', note: '文本文件' },
  ];
  const text = agentAttachmentsText(attachments);
  expect(text).toContain('[附件：a.txt · 3 字符]');
  expect(text).toContain('[附件：c.txt · 3 字符]');
  expect(text).not.toContain('b.png');
});
