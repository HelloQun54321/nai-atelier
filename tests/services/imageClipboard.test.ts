// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPastedImageFile, isTextPasteTarget, readClipboardImage } from '../../services/imageClipboard';

const setClipboard = (clipboard: Clipboard) => vi.stubGlobal('navigator', { clipboard });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('图片剪贴板', () => {
  it('跳过文字并按实际图片 MIME 读取第一张支持的图片', async () => {
    const getType = vi.fn(async () => new Blob(['synthetic'], { type: 'image/png' }));
    const read = vi.fn(async () => [{ types: ['text/plain'], getType: vi.fn() }, { types: ['image/png', 'text/html'], getType }]);
    setClipboard({ read } as unknown as Clipboard);
    const file = await readClipboardImage();
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('clipboard.png');
    expect(file.size).toBe(9);
    expect(getType).toHaveBeenCalledExactlyOnceWith('image/png');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['image/jpeg', 'image/webp'])('支持 %s 的图片读取', async type => {
    const read = vi.fn(async () => [{ types: [type], getType: async () => new Blob(['image'], { type }) }]);
    setClipboard({ read } as unknown as Clipboard);
    expect((await readClipboardImage()).type).toBe(type);
  });

  it('只有链接或文字时不读取其内容，也不发起下载', async () => {
    const getType = vi.fn();
    setClipboard({ read: async () => [{ types: ['text/plain', 'text/html'], getType }] } as unknown as Clipboard);
    await expect(readClipboardImage()).rejects.toThrow('剪贴板中没有图片');
    expect(getType).not.toHaveBeenCalled();
  });

  it('格式不支持时明确说明允许的格式', async () => {
    setClipboard({ read: async () => [{ types: ['image/gif'] }] } as unknown as Clipboard);
    await expect(readClipboardImage()).rejects.toThrow('PNG、JPEG 或 WebP');
  });

  it('拒绝授权或浏览器不支持时提示键盘粘贴', async () => {
    setClipboard({ read: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } as unknown as Clipboard);
    await expect(readClipboardImage()).rejects.toThrow('Ctrl+V');
    setClipboard(undefined as unknown as Clipboard);
    await expect(readClipboardImage()).rejects.toThrow('localhost／HTTPS');
  });

  it('不安全来源不调用读取 API', async () => {
    const read = vi.fn();
    vi.stubGlobal('isSecureContext', false);
    setClipboard({ read } as unknown as Clipboard);
    await expect(readClipboardImage()).rejects.toThrow('Ctrl+V');
    expect(read).not.toHaveBeenCalled();
  });

  it('键盘粘贴接收 files 或 items 中的图片，不消费普通文字', () => {
    const file = new File(['image'], 'test.png', { type: 'image/png' });
    expect(getPastedImageFile({ files: [file] } as unknown as DataTransfer)).toBe(file);
    expect(getPastedImageFile({ files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } as unknown as DataTransfer)).toBe(file);
    expect(getPastedImageFile({ files: [], items: [{ kind: 'string', type: 'text/plain' }] } as unknown as DataTransfer)).toBeNull();
  });

  it('输入框与嵌套的可编辑文字保留原生粘贴，画布与按钮可接收图片', () => {
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = editable.appendChild(document.createElement('span'));
    expect(isTextPasteTarget(textarea)).toBe(true);
    expect(isTextPasteTarget(document.createElement('input'))).toBe(true);
    expect(isTextPasteTarget(child)).toBe(true);
    editable.setAttribute('contenteditable', 'false');
    expect(isTextPasteTarget(child)).toBe(false);
    expect(isTextPasteTarget(document.createElement('canvas'))).toBe(false);
    expect(isTextPasteTarget(document.createElement('button'))).toBe(false);
  });
});
