/** 仅保存当前标签页主动操作产生的图片与导出，不监听系统剪贴板。 */
const exports = new Map<string, { blob: Blob; name: string }>();
let copied: { blob: Blob; name: string; label: string } | null = null;
export const getAgentExports = () => [...exports].map(([id, item]) => ({ id, name: item.name, bytes: item.blob.size, mimeType: item.blob.type }));
export const getAgentExport = (id: string) => { const item = exports.get(id); if (!item) throw new Error('导出副本已过期，请重新执行导出'); return item; };
export const getAgentCopiedImage = () => { if (!copied) throw new Error('还没有暂存图片，请先读取并暂存实际图片'); return copied; };
export const copyAgentImage = async (image: HTMLImageElement, signal?: AbortSignal) => {
  const src = new URL(image.dataset.agentOriginalSrc || image.currentSrc || image.src, location.href).href;
  if (!image.complete || !image.naturalWidth || !/^(https?:|blob:|data:image\/)/.test(src)) throw new Error('当前图片尚未准备好');
  const response = await fetch(src, { signal, credentials: src.startsWith(location.origin + '/') ? 'same-origin' : 'omit' });
  if (!response.ok) throw new Error('读取当前原图失败');
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > 30 * 1024 * 1024) throw new Error('只接受 30 MB 以内的实际图片');
  const suffix = blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1];
  copied = { blob, name: `nai-image.${suffix}`, label: image.alt || '当前图片' };
  return { copied: true, label: copied.label, bytes: blob.size, destination: '当前工坊标签页的图片暂存，可粘贴到任意图片上传入口' };
};
/** 临时捕获 Agent 触发的实际下载产物，不改变用户的正常浏览器下载。 */
export const captureAgentExports = () => {
  const blobs = new Map<string, Blob>(), create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { const url = create.call(URL, blob); if (blob instanceof Blob) blobs.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function () {
    const blob = blobs.get(this.href);
    if (this.download && blob && blob.size <= 30 * 1024 * 1024) {
      exports.set(crypto.randomUUID(), { blob, name: this.download });
      while (exports.size > 4) exports.delete(exports.keys().next().value!);
      window.dispatchEvent(new Event('nai-agent-capabilities-changed'));
    }
    click.call(this);
  };
  return () => { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; blobs.clear(); };
};
