import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { validatePromptBlocks } from './atelier-prompt-blocks.mjs';

const root = fileURLToPath(new URL('../plugins/dsh-unrestricted-atelier/', import.meta.url));
const sources = [
  { id: 'local_execution', title: '本地执行规则', file: 'prompts/local_execution.txt', symbol: 'EXECUTION_MODE_BLOCK', hash: 'fragmentSha256' },
  { id: 'appearance_tags', title: '非性化外观标签', file: 'prompts/appearance_tags.txt', symbol: 'APPEARANCE_TAG_BLOCK', hash: 'appearanceSha256' },
];
const files = ['package.json', 'index.js', 'rules.js', 'README.md', 'UPSTREAM.json', 'upstream/LICENSE', 'upstream/THIRD_PARTY_NOTICES.md', ...sources.map(source => source.file)];
const hash = data => createHash('sha256').update(data).digest('hex');

// 只把文本当数据读取，不执行旧 rules.js，也不把正文写入诊断输出。
export const packageAtelierAdapter = async ({ sourceRoot = root, syncSources = false } = {}) => {
  const upstream = JSON.parse(await readFile(resolve(sourceRoot, 'UPSTREAM.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(sourceRoot, 'package.json'), 'utf8'));
  const contents = new Map();
  for (const name of files.filter(name => !['package.json', 'rules.js', 'UPSTREAM.json'].includes(name))) {
    const data = await readFile(resolve(sourceRoot, name));
    if (upstream.files[name] && hash(data) !== upstream.files[name]) throw new Error('上游版权文件校验失败');
    contents.set(name, data);
  }
  const blocks = validatePromptBlocks(sources.map(source => ({
    id: source.id, title: source.title,
    // UTF-8 BOM 是编码标记；除此之外不裁切、不改换行或正文。
    text: new TextDecoder('utf-8', { fatal: true }).decode(contents.get(source.file)),
  })));
  pkg.atelier = { ...pkg.atelier, promptBlocks: blocks };
  upstream.promptSources = sources.map(source => source.file);
  for (const [index, source] of sources.entries()) upstream[source.hash] = hash(blocks[index].text);
  const rules = '// Generated from prompts/*.txt; edit those text files and repackage.\n'
    + sources.map((source, index) => `export const ${source.symbol} = ${JSON.stringify(blocks[index].text)};`).join('\n') + '\n';
  const generated = new Map([
    ['package.json', JSON.stringify(pkg, null, 2) + '\n'],
    ['rules.js', rules],
    ['UPSTREAM.json', JSON.stringify(upstream, null, 2) + '\n'],
  ]);
  for (const [name, text] of generated) contents.set(name, Buffer.from(text));
  const zip = new JSZip();
  for (const name of files) {
    zip.file(`${pkg.name}/${name}`, contents.get(name), { date: new Date('2026-11-03T00:00:00Z'), createFolders: false });
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (syncSources) for (const [name, text] of generated) await writeFile(resolve(sourceRoot, name), text);
  return buffer;
};

export const packageAtelierAdapterCli = async ({ sourceRoot = root, target, stdout = process.stdout, stderr = process.stderr } = {}) => {
  try {
    const pkg = JSON.parse(await readFile(resolve(sourceRoot, 'package.json'), 'utf8'));
    const output = resolve(target || `tests/.tmp/${pkg.name}-${pkg.version}.zip`);
    const zip = await packageAtelierAdapter({ sourceRoot, syncSources: true });
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, zip);
    const receipt = { file: output, bytes: zip.length, sha256: hash(zip) };
    await writeFile(`${output}.sha256.json`, JSON.stringify(receipt, null, 2) + '\n');
    stdout.write(JSON.stringify(receipt) + '\n');
    return 0;
  } catch {
    // 解析／编码错误可能携带原文；命令行统一给出固定错误，不打印异常或堆栈。
    stderr.write('打包失败：请检查两份 UTF-8 文本是否为空、超限或不可读取，以及版权文件和输出目录权限。未输出提示词正文。\n');
    return 1;
  }
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await packageAtelierAdapterCli({ target: process.argv[2] });
