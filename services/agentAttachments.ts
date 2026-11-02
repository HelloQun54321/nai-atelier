import { extractDocumentText } from './agentDocumentText';

/** 发送给助手的一条附件：图片走模型看图通道，文字类文件并进消息正文。 */
export type AgentImageAttachment = { kind: 'image'; data: string; mimeType: string; name: string; bytes: number };
export type AgentTextAttachment = { kind: 'text'; data: ''; mimeType: string; name: string; bytes: number; text: string; note: string; truncated?: boolean };
export type AgentAttachment = AgentImageAttachment | AgentTextAttachment;

export const MAX_IMAGE_ATTACHMENTS = 4;
export const MAX_TEXT_ATTACHMENTS = 6;
/** 单次发送的文字总量上限；超出时截断并说明，不静默丢内容。 */
export const MAX_TEXT_CHARS = 120_000;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const TARGET_IMAGE_MIME = /^image\/(?:png|jpeg|webp|gif)$/i;
const SOURCE_IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;
const SOURCE_IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i;

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('读取失败，请重新选择图片'));
  reader.readAsDataURL(file);
});

export const isImageFile = (file: File): boolean => SOURCE_IMAGE_MIME.test(file.type) || SOURCE_IMAGE_EXTENSION.test(file.name);

const normalizedImageType = (file: File): string => {
  if (SOURCE_IMAGE_MIME.test(file.type)) return file.type.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() || '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon' } as Record<string, string>)[extension] || '';
};

/** 缩小发送副本，原文件不变；透明图片保持透明，动图只发送首帧预览。 */
export async function prepareAgentAttachment(file: File): Promise<AgentImageAttachment> {
  if (/^image\/(?:tiff?|heic|heif)$/i.test(file.type) || /\.(?:tiff?|heic|heif)$/i.test(file.name)) throw new Error('TIFF 与 HEIC 需要先转成 PNG 再发送');
  const mimeType = normalizedImageType(file);
  if (!SOURCE_IMAGE_MIME.test(mimeType)) throw new Error('仅支持 PNG、JPEG、WebP、GIF、BMP、AVIF、SVG 图片');
  if (file.size > MAX_FILE_BYTES) throw new Error('图片超过 32 MB，请先缩小图片');
  const source = await readDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('无法解码图片，请检查文件是否完整')); value.src = source;
  });
  // SVG 没有固有像素尺寸时按 1024 方图处理，避免整张图被当作无效。
  const naturalWidth = image.naturalWidth || (mimeType === 'image/svg+xml' ? 1024 : 0);
  const naturalHeight = image.naturalHeight || (mimeType === 'image/svg+xml' ? 1024 : 0);
  if (!naturalWidth || !naturalHeight) throw new Error('图片尺寸无效');
  if (naturalWidth * naturalHeight > 120_000_000) throw new Error('图片像素过多（超过 1.2 亿），请先缩小再发送');
  const needsTranscode = !TARGET_IMAGE_MIME.test(mimeType) || [naturalWidth, naturalHeight].some(value => value > 1600) || file.size > 1024 * 1024 || mimeType === 'image/gif';
  let output = source, note = '';
  if (needsTranscode) {
    const ratio = Math.min(1, 1600 / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理不可用，请换浏览器后重试');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    output = canvas.toDataURL('image/webp', 0.88);
    if (!/^data:image\/(?:webp|png);/i.test(output)) output = canvas.toDataURL('image/png');
    note = mimeType === 'image/gif' ? ' · 首帧预览' : ' · 已压缩';
  }
  if (!TARGET_IMAGE_MIME.test(output.slice(5, output.indexOf(';')))) throw new Error('这张图片无法转成可发送的格式，请另存为 PNG');
  const data = output.slice(output.indexOf(',') + 1);
  if (Math.ceil(data.length * 3 / 4) > MAX_IMAGE_BYTES) throw new Error('处理后的图片仍超过 6 MB，请进一步缩小');
  return { kind: 'image', data, mimeType: output.slice(5, output.indexOf(';')), name: file.name + note, bytes: Math.ceil(data.length * 3 / 4) };
}

/** 文字类附件：DOCX／XLSX／PPTX／PDF 提取正文，文本与代码按原样读取。 */
export async function prepareAgentTextAttachment(file: File): Promise<AgentTextAttachment> {
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 32 MB，请先精简内容');
  const extracted = await extractDocumentText(file);
  const text = extracted.text.trim();
  if (!text) throw new Error('没有从文件里读到文字');
  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    kind: 'text', data: '', mimeType: file.type || 'text/plain', name: file.name, bytes: text.length,
    text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, note: extracted.note, ...(truncated ? { truncated: true } : {}),
  };
}

/** 一个入口判断该走看图还是读文字。 */
export const prepareAgentFile = async (file: File): Promise<AgentAttachment> => isImageFile(file)
  ? prepareAgentAttachment(file)
  : prepareAgentTextAttachment(file);

const groupDigits = (value: number) => value.toLocaleString('en-US');

/** 消息里的附件段标记；发送、渲染和编辑重发都靠它还原。 */
export const AGENT_ATTACHMENT_MARKER = /^\[附件：(.+?) · ([\d,]+) 字符\]\n([\s\S]*?)\n\[\/附件\]$/gm;

export const formatAgentTextAttachment = (attachment: AgentTextAttachment): string => {
  const size = `${groupDigits(attachment.bytes)} 字符`;
  const suffix = attachment.truncated ? `\n（内容过长，只保留前 ${groupDigits(MAX_TEXT_CHARS)} 字符）` : '';
  return `[附件：${attachment.name} · ${size}]\n${attachment.text}${suffix}\n[/附件]`;
};

export const agentAttachmentsText = (attachments: readonly AgentAttachment[]): string => attachments
  .flatMap(attachment => attachment.kind === 'text' ? [formatAgentTextAttachment(attachment)] : [])
  .join('\n\n');

export type AgentTextSegment = { type: 'text'; text: string } | { type: 'attachment'; name: string; size: string; text: string };

/** 把一条消息拆成普通文字与附件段，界面上折叠附件正文。 */
export const splitAgentAttachmentSegments = (text: string): AgentTextSegment[] => {
  const segments: AgentTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(AGENT_ATTACHMENT_MARKER)) {
    const start = match.index ?? 0;
    const before = text.slice(cursor, start).trim();
    if (before) segments.push({ type: 'text', text: before });
    segments.push({ type: 'attachment', name: match[1], size: match[2], text: match[3] });
    cursor = start + match[0].length;
  }
  const rest = text.slice(cursor).trim();
  if (rest) segments.push({ type: 'text', text: rest });
  return segments.length ? segments : [{ type: 'text', text: text.trim() }];
};

/** 编辑重发时把附件正文剥掉，只把原话放回输入框。 */
export const stripAgentAttachmentText = (text: string): string => splitAgentAttachmentSegments(text)
  .filter(segment => segment.type === 'text').map(segment => segment.text).join('\n\n').trim();
