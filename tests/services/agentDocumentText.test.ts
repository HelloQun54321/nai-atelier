import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { extractDocumentText, isTextLikeFile } from '../../services/agentDocumentText';

const archive = async (files: Record<string, string>, name = 'synthetic.docx'): Promise<File> => {
  const zip = new JSZip();
  for (const [entry, content] of Object.entries(files)) zip.file(entry, content);
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], name, { type: 'application/zip' });
};

const pdf = (stream: string, compressed = false): File => {
  const bytes = compressed ? new Uint8Array(deflateSync(Buffer.from(stream, 'latin1'))) : new Uint8Array(Buffer.from(stream, 'latin1'));
  const head = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${bytes.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n%%EOF\n', 'latin1');
  const merged = new Uint8Array(head.length + bytes.length + tail.length);
  merged.set(head, 0); merged.set(bytes, head.length); merged.set(tail, head.length + bytes.length);
  return new File([merged], 'synthetic.pdf', { type: 'application/pdf' });
};

it('DOCX 按段落取正文，保留空行结构', async () => {
  const file = await archive({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>' });
  const result = await extractDocumentText(file);
  expect(result.text).toBe('第一段\n第二段');
  expect(result.note).toBe('DOCX 文档');
});

it('XLSX 用共享字符串还原单元格，按列定位', async () => {
  const file = await archive({
    'xl/sharedStrings.xml': '<sst><si><t>名字</t></si><si><t>芙宁娜</t></si><si><t>画师</t></si><si><t>wlop</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>3</v></c></row>'
      + '</sheetData></worksheet>',
  }, 'synthetic.xlsx');
  const result = await extractDocumentText(file);
  expect(result.text).toBe('名字\t画师\n芙宁娜\twlop');
  expect(result.note).toBe('XLSX 表格');
});

it('PPTX 按页顺序取文本框', async () => {
  const file = await archive({
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>封面</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>第二页</a:t></a:r></a:p></p:sld>',
  }, 'synthetic.pptx');
  const result = await extractDocumentText(file);
  expect(result.text).toBe('# 第 1 页\n封面\n\n# 第 2 页\n第二页');
});

it('PDF 取未压缩与 FlateDecode 的文字层', async () => {
  const plain = await extractDocumentText(pdf('BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET'));
  expect(plain.text).toBe('Hello PDF');
  const packed = await extractDocumentText(pdf('BT /F1 12 Tf 72 720 Td (Compressed text) Tj ET', true));
  expect(packed.text).toBe('Compressed text');
  expect(packed.note).toBe('PDF 文本层');
});

it('没有文字层或编码不可还原的 PDF 明确拒绝，不返回乱码', async () => {
  await expect(extractDocumentText(pdf('BT ET'))).rejects.toThrow('没有可提取的文字层');
  await expect(extractDocumentText(pdf(`BT (${String.fromCharCode(0xff, 0xfe, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07)}) Tj ET`))).rejects.toThrow('无法还原');
});

it('纯文本与代码按 UTF-8 读取，二进制内容不接受', async () => {
  expect(isTextLikeFile(new File(['x'], 'note.md'))).toBe(true);
  expect(isTextLikeFile(new File(['x'], 'script.ts'))).toBe(true);
  expect(isTextLikeFile(new File(['x'], 'hook.py'))).toBe(true);
  expect(isTextLikeFile(new File(['x'], 'photo.png', { type: 'image/png' }))).toBe(false);
  const text = await extractDocumentText(new File(['{"a":1}'], 'data.json'));
  expect(text).toMatchObject({ text: '{"a":1}', note: '文本文件' });
  await expect(extractDocumentText(new File([new Uint8Array([0, 1, 2, 3, 0, 5])], 'blob.dat', { type: 'application/octet-stream' }))).rejects.toThrow('不是文字');
});
