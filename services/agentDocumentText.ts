/**
 * 把用户拖进助手对话框的文件变成可读文字。
 *
 * 助手模型只吃文字和图片，因此 DOCX／XLSX／PPTX 用项目已有的 jszip 拆出 XML 正文，
 * PDF 只做「文本层」尽力提取（扫描件与二进制字体编码拿不到就明确报错，不假装成功）。
 * 依赖按需动态加载，常规输入不会为这些格式付出体积。
 */

export type ExtractedText = { text: string; note: string };

/** 纯文本类扩展名；没有扩展名但能按 UTF-8 读通的文件也走这条路。 */
const TEXT_EXTENSIONS = /\.(?:txt|md|markdown|mdx|json|jsonc|json5|csv|tsv|log|yaml|yml|toml|ini|cfg|conf|properties|xml|html?|xhtml|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|vue|svelte|py|rb|php|java|kt|kts|go|rs|c|h|cc|cpp|cxx|hpp|m|mm|cs|swift|sh|bash|zsh|bat|cmd|ps1|sql|graphql|gql|proto|lua|pl|r|dart|ex|exs|erl|hs|clj|scala|asm|s|diff|patch)$/i;

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const safeCodePoint = (code: number): string => {
  try { return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; } catch { return ''; }
};

const decodeXml = (value: string): string => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
  .replace(/&([a-z]+);/gi, (entity, name: string) => XML_ENTITIES[name.toLowerCase()] ?? entity);

const stripTags = (value: string): string => decodeXml(value.replace(/<[^>]*>/g, ''));

/** 统一换行、去掉行尾空白和多余空行，保留可读的段落结构。 */
const tidy = (value: string): string => value
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .split('\n')
  .map(line => line.replace(/[ \t]+$/g, ''))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

type ZipLike = { file: (name: string) => { async: (type: 'string') => Promise<string> } | null; files: Record<string, unknown> };

const loadZip = async (buffer: ArrayBuffer): Promise<ZipLike> => {
  const { default: JSZip } = await import('jszip');
  return new JSZip().loadAsync(buffer) as unknown as Promise<ZipLike>;
};

const readBuffer = (file: File): Promise<ArrayBuffer> => typeof file.arrayBuffer === 'function'
  ? file.arrayBuffer()
  : new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('读取失败，请重新选择文件'));
    reader.readAsArrayBuffer(file);
  });

const docxText = async (buffer: ArrayBuffer): Promise<string> => {
  const zip = await loadZip(buffer);
  const document = zip.file('word/document.xml');
  if (!document) throw new Error('这个 DOCX 缺少正文，请确认文件没有损坏');
  const xml = await document.async('string');
  return tidy(stripTags(xml.replace(/<\/w:p>/g, '\n').replace(/<w:br[^>]*\/>/g, '\n').replace(/<w:tab[^>]*\/>/g, '\t')));
};

/** A→1、AA→27，与表格里的列号一致。 */
const columnIndex = (reference: string): number => {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase() || '';
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
};

const sheetText = async (zip: ZipLike, name: string, shared: string[]): Promise<string> => {
  const file = zip.file(name);
  if (!file) return '';
  const xml = await file.async('string');
  const lines: string[] = [];
  for (const row of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
    const cells: string[] = [];
    for (const cell of row.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || []) {
      const type = /\bt="([^"]+)"/.exec(cell)?.[1] || '';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell)?.[1] ?? '';
      const value = type === 's' ? shared[Number(raw)] ?? '' : decodeXml(raw);
      const column = columnIndex(/\br="([A-Z]+)\d+"/i.exec(cell)?.[1] || '');
      while (cells.length < Math.max(0, column - 1)) cells.push('');
      cells.push(value.replace(/\s+/g, ' ').trim());
    }
    if (cells.some(cell => cell)) lines.push(cells.join('\t'));
  }
  return lines.join('\n');
};

const xlsxText = async (buffer: ArrayBuffer): Promise<string> => {
  const zip = await loadZip(buffer);
  const shared: string[] = [];
  const strings = zip.file('xl/sharedStrings.xml');
  if (strings) {
    const xml = await strings.async('string');
    for (const item of xml.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(decodeXml((item.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(part => stripTags(part)).join('')));
  }
  const sheets = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => Number(/\d+/.exec(left)?.[0] || 0) - Number(/\d+/.exec(right)?.[0] || 0));
  const parsed: string[] = [];
  for (const [index, name] of sheets.entries()) {
    const text = await sheetText(zip, name, shared);
    if (text) parsed.push(sheets.length > 1 ? `# 工作表 ${index + 1}\n${text}` : text);
  }
  return tidy(parsed.join('\n\n'));
};

const pptxText = async (buffer: ArrayBuffer): Promise<string> => {
  const zip = await loadZip(buffer);
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(/\d+/.exec(left)?.[0] || 0) - Number(/\d+/.exec(right)?.[0] || 0));
  const parsed: string[] = [];
  for (const [index, name] of slides.entries()) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    const text = tidy(stripTags(xml.replace(/<\/a:p>/g, '\n').replace(/<a:br[^>]*\/>/g, '\n')));
    if (text) parsed.push(`# 第 ${index + 1} 页\n${text}`);
  }
  return tidy(parsed.join('\n\n'));
};

const latin1 = (bytes: Uint8Array): string => {
  let output = '';
  for (let index = 0; index < bytes.length; index += 0x8000) output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return output;
};

const inflate = async (bytes: Uint8Array): Promise<string | null> => {
  if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    return latin1(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch { return null; }
};

const PDF_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

const pdfLiteral = (value: string): string => value.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (match, escape: string) => {
  if (/^[0-7]+$/.test(escape)) return safeCodePoint(parseInt(escape, 8));
  return PDF_ESCAPES[escape] ?? match;
});

/** 从一段已解码的 PDF 内容流里取出文字操作符；粗粒度但足以读出文本层。 */
const pdfContentText = (content: string): string => {
  const lines: string[] = [];
  const blocks = content.match(/BT[\s\S]*?ET/g) || [];
  for (const block of blocks) {
    let line = '';
    const tokens = block.match(/\((?:[^()\\]|\\.)*\)\s*T[jJ]|\[(?:[^\[\]\\]|\\.)*\]\s*TJ|T\*|Td|TD/g) || [];
    for (const token of tokens) {
      if (token === 'T*') { lines.push(line); line = ''; continue; }
      if (/^T[dD]$/.test(token)) { if (line) { lines.push(line); line = ''; } continue; }
      if (token.endsWith('TJ')) {
        const inner = token.slice(0, token.lastIndexOf(']') + 1);
        for (const piece of inner.match(/\((?:[^()\\]|\\.)*\)/g) || []) line += pdfLiteral(piece.slice(1, -1));
      } else {
        const literal = /\((?:[^()\\]|\\.)*\)/.exec(token)?.[0];
        if (literal) line += pdfLiteral(literal.slice(1, -1));
      }
    }
    if (line) lines.push(line);
  }
  return tidy(lines.join('\n'));
};

const pdfText = async (buffer: ArrayBuffer): Promise<string> => {
  const bytes = new Uint8Array(buffer);
  const raw = latin1(bytes);
  const parts: string[] = [];
  let cursor = 0;
  while (true) {
    const start = raw.indexOf('stream', cursor);
    if (start < 0) break;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const body = raw.slice(start + 'stream'.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    cursor = end + 'endstream'.length;
    parts.push(body);
    if (!/FlateDecode/.test(raw.slice(Math.max(0, start - 400), start))) continue;
    const compressed = new Uint8Array(body.length);
    for (let index = 0; index < body.length; index++) compressed[index] = body.charCodeAt(index) & 0xff;
    const decoded = await inflate(compressed);
    if (decoded) parts.push(decoded);
  }
  const text = tidy(parts.map(pdfContentText).filter(Boolean).join('\n'));
  if (!text) throw new Error('这个 PDF 没有可提取的文字层（可能是扫描件或图片），请先另存为 PNG 或 DOCX');
  // 字体用 CID／子集编码时解出来是零散符号，交给模型只会添乱。
  const unreadable = text.replace(/[\s\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/g, '').length;
  if (unreadable > text.length * 0.4) throw new Error('这个 PDF 的文字层使用了无法还原的字体编码，请先另存为图片或 DOCX');
  return text;
};

const binaryLooksText = (buffer: ArrayBuffer): boolean => {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2048));
  if (bytes.includes(0)) return false;
  let suspicious = 0;
  for (const byte of bytes) if (byte < 9 || byte > 13 && byte < 32) suspicious++;
  return suspicious <= bytes.length * 0.02;
};

export const isTextLikeFile = (file: File): boolean => file.type.startsWith('text/')
  || /^application\/(?:json|xml|x-yaml|yaml|javascript|x-sh|sql)$/i.test(file.type)
  || TEXT_EXTENSIONS.test(file.name);

/** 按扩展名分派；拿不准时尝试按 UTF-8 文本读，读不通再报出可执行的下一步。 */
export const extractDocumentText = async (file: File): Promise<ExtractedText> => {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() || '';
  if (extension === 'docx') return { text: await docxText(await readBuffer(file)), note: 'DOCX 文档' };
  if (extension === 'xlsx') return { text: await xlsxText(await readBuffer(file)), note: 'XLSX 表格' };
  if (extension === 'pptx') return { text: await pptxText(await readBuffer(file)), note: 'PPTX 幻灯片' };
  if (extension === 'pdf' || file.type === 'application/pdf') return { text: await pdfText(await readBuffer(file)), note: 'PDF 文本层' };
  if (extension === 'doc' || extension === 'xls' || extension === 'ppt') throw new Error('旧版 Office 格式无法解析，请另存为 docx／xlsx／pptx');
  if (/\.(?:zip|rar|7z|gz|tar|exe|msi|dll|apk|bin|iso)$/i.test(file.name)) throw new Error('压缩包与程序文件不能直接发送，请解压后选择其中的图片或文字');
  if (!isTextLikeFile(file) && file.type && !/^(?:application\/octet-stream|application\/unknown)$/i.test(file.type)) {
    throw new Error('这种文件暂时读不出文字，请换用图片、文本、DOCX／XLSX／PPTX 或 PDF');
  }
  const buffer = await readBuffer(file);
  if (!binaryLooksText(buffer)) throw new Error('文件内容不是文字，请确认格式后重试');
  return { text: new TextDecoder('utf-8').decode(buffer), note: '文本文件' };
};
