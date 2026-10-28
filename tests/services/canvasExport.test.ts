import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginCanvasExport, cancelCanvasExport, finishCanvasExport } from '../../services/canvasExport';

afterEach(() => vi.unstubAllGlobals());

describe('画布另存为', () => {
  it('浏览器在点击调用中直接打开系统选择器，工程与图片使用不同目录 ID', async () => {
    const written: Blob[] = [];
    const close = vi.fn(async () => {});
    const picker = vi.fn((_options: unknown) => Promise.resolve({ createWritable: async () => ({ write: async (blob: Blob) => { written.push(blob); }, close, abort: async () => {} }) }));
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    const projectPromise = beginCanvasExport('project', '作品.nai-canvas');
    expect(picker).toHaveBeenCalledTimes(1);
    const project = await projectPromise;
    const image = await beginCanvasExport('image', '作品.png');
    expect(picker.mock.calls[0][0]).toMatchObject({ id: 'nai-canvas-project', suggestedName: '作品.nai-canvas' });
    expect(picker.mock.calls[1][0]).toMatchObject({ id: 'nai-canvas-image', suggestedName: '作品.png' });
    const blob = new Blob(['content']);
    await finishCanvasExport(project!, blob);
    expect(written).toEqual([blob]);
    expect(close).toHaveBeenCalledOnce();
    expect(image?.kind).toBe('browser');
  });

  it('取消系统选择不写文件，不支持选择器时明确报错', async () => {
    const picker = vi.fn(() => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    expect(await beginCanvasExport('image', '作品.jpg')).toBeNull();
    vi.stubGlobal('window', {});
    await expect(beginCanvasExport('image', '作品.jpg')).rejects.toThrow('不支持系统另存为');
  });

  it('浏览器写入失败时取消写入并反馈错误', async () => {
    const abort = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write: async () => { throw new Error('写入失败'); }, close, abort }) }));
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    const target = await beginCanvasExport('image', '作品.png');
    await expect(finishCanvasExport(target!, new Blob(['x']))).rejects.toThrow('写入失败');
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('桌面桥接分片写入并按类别选择，取消后不启动写入', async () => {
    const bridge = { begin: vi.fn(async (_kind: string) => _kind === 'image' ? null : 'token'), start: vi.fn(async () => {}), write: vi.fn(async () => {}), end: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    vi.stubGlobal('window', { atelierCanvasExport: bridge });
    expect(await beginCanvasExport('image', '作品.jpg')).toBeNull();
    expect(bridge.start).not.toHaveBeenCalled();
    const target = await beginCanvasExport('project', '作品.nai-canvas');
    await finishCanvasExport(target!, new Blob([new Uint8Array(4 * 1024 * 1024 + 12)]));
    expect(bridge.begin).toHaveBeenNthCalledWith(2, 'project', '作品.nai-canvas');
    expect(bridge.write).toHaveBeenCalledTimes(2);
    expect((bridge.write.mock.calls[0] as unknown[])[1]).toHaveLength(4 * 1024 * 1024);
    expect((bridge.write.mock.calls[1] as unknown[])[1]).toHaveLength(12);
    expect(bridge.end).toHaveBeenCalledWith('token');
  });

  it('写入失败后释放桌面目标，取消已选目标也会释放', async () => {
    const bridge = { begin: vi.fn(async () => 'token'), start: vi.fn(async () => {}), write: vi.fn(async () => { throw new Error('磁盘已满'); }), end: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    vi.stubGlobal('window', { atelierCanvasExport: bridge });
    const target = await beginCanvasExport('project', '作品.nai-canvas');
    await expect(finishCanvasExport(target!, new Blob(['x']))).rejects.toThrow('磁盘已满');
    expect(bridge.abort).toHaveBeenCalledWith('token');
    expect(bridge.end).not.toHaveBeenCalled();
    await cancelCanvasExport(target!);
    expect(bridge.abort).toHaveBeenCalledTimes(2);
  });
});
