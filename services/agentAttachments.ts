export type AgentAttachment = { data: string; mimeType: string; name: string };
const MAX_BYTES = 6 * 1024 * 1024;
const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('读取失败，请重新选择图片'));
  reader.readAsDataURL(file);
});

/** 缩小发送副本，原文件不变；透明图片保持透明，动图只发送首帧预览。 */
export async function prepareAgentAttachment(file: File): Promise<AgentAttachment> {
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('仅支持 PNG、JPEG、WebP、GIF');
  if (file.size > MAX_BYTES) throw new Error('单张图片超过 6 MB，请先缩小图片');
  const source = await readDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('无法解码图片，请检查文件是否完整')); value.src = source;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');
  let output = source, note = '';
  if (Math.max(image.naturalWidth, image.naturalHeight) > 1600 || file.size > 1024 * 1024 || file.type === 'image/gif') {
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理不可用，请换浏览器后重试');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    output = canvas.toDataURL('image/webp', 0.88);
    note = file.type === 'image/gif' ? ' · 首帧预览' : ' · 已压缩';
  }
  const data = output.slice(output.indexOf(',') + 1);
  if (Math.ceil(data.length * 3 / 4) > MAX_BYTES) throw new Error('处理后的图片仍超过 6 MB，请进一步缩小');
  return { data, mimeType: output.slice(5, output.indexOf(';')), name: file.name + note };
}
