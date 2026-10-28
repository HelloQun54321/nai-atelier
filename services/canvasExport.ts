/** 画布工程与图片分别使用系统另存为，并保留各自的最近目录。 */
export type CanvasExportKind = 'project' | 'image';

type WritableFile = { write: (data: Blob) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
type FileHandle = { createWritable: () => Promise<WritableFile> };
type DesktopBridge = {
  begin: (kind: CanvasExportKind, filename: string) => Promise<string | null>;
  start: (token: string) => Promise<void>;
  write: (token: string, bytes: Uint8Array) => Promise<void>;
  end: (token: string) => Promise<void>;
  abort: (token: string) => Promise<void>;
};
type ExportWindow = Window & {
  atelierCanvasExport?: DesktopBridge;
  showSaveFilePicker?: (options: {
    id: string;
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileHandle>;
};
export type CanvasExportTarget = { kind: 'desktop'; token: string; bridge: DesktopBridge } | { kind: 'browser'; handle: FileHandle };

/** 必须由用户点击的调用栈直接调用，以保留浏览器文件选择器的用户激活。 */
export async function beginCanvasExport(kind: CanvasExportKind, filename: string): Promise<CanvasExportTarget | null> {
  const host = window as ExportWindow;
  if (host.atelierCanvasExport) {
    const token = await host.atelierCanvasExport.begin(kind, filename);
    return token ? { kind: 'desktop', token, bridge: host.atelierCanvasExport } : null;
  }
  if (!host.showSaveFilePicker) throw new Error('当前浏览器不支持系统另存为，请使用 Windows 桌面版或支持文件保存对话框的浏览器');
  const isJpeg = /\.jpe?g$/i.test(filename);
  const types: { description: string; accept: Record<string, string[]> }[] = kind === 'project'
    ? [{ description: '画布工程', accept: { 'application/zip': ['.nai-canvas'] } }]
    : [{ description: isJpeg ? 'JPEG 图片' : 'PNG 图片', accept: isJpeg ? { 'image/jpeg': ['.jpg', '.jpeg'] } : { 'image/png': ['.png'] } }];
  try {
    const handle = await host.showSaveFilePicker({ id: `nai-canvas-${kind}`, suggestedName: filename, types });
    return { kind: 'browser', handle };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null;
    throw error;
  }
}

/** 用户选择完成后可异步生成文件，再调用此函数写入；大文件分片传给桌面主进程。 */
export async function finishCanvasExport(target: CanvasExportTarget, blob: Blob): Promise<void> {
  if (target.kind === 'browser') {
    const writable = await target.handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    return;
  }
  try {
    await target.bridge.start(target.token);
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      await target.bridge.write(target.token, bytes);
    }
    await target.bridge.end(target.token);
  } catch (error) {
    await target.bridge.abort(target.token).catch(() => {});
    throw error;
  }
}

/** 选择后生成文件失败或放弃时释放桌面导出目标。 */
export async function cancelCanvasExport(target: CanvasExportTarget): Promise<void> {
  if (target.kind === 'desktop') await target.bridge.abort(target.token);
}
