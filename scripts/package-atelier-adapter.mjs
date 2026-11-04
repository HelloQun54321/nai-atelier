import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { EXECUTION_MODE_BLOCK, APPEARANCE_TAG_BLOCK } from '../plugins/dsh-unrestricted-atelier/rules.js';

const root = fileURLToPath(new URL('../plugins/dsh-unrestricted-atelier/', import.meta.url));
const files = ['package.json', 'index.js', 'rules.js', 'README.md', 'UPSTREAM.json', 'upstream/LICENSE', 'upstream/THIRD_PARTY_NOTICES.md'];
export const packageAtelierAdapter = async () => {
  const upstream = JSON.parse(await readFile(resolve(root, 'UPSTREAM.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (pkg.atelier?.promptBlocks?.length !== 2 || pkg.atelier.promptBlocks[0].text !== EXECUTION_MODE_BLOCK || pkg.atelier.promptBlocks[1].text !== APPEARANCE_TAG_BLOCK) throw new Error('安装包预览声明与运行规则不一致');
  for (const [text, hash] of [[EXECUTION_MODE_BLOCK, upstream.fragmentSha256], [APPEARANCE_TAG_BLOCK, upstream.appearanceSha256]]) {
    if (createHash('sha256').update(text).digest('hex') !== hash) throw new Error('适配规则校验失败');
  }
  const zip = new JSZip();
  for (const name of files) {
    const data = await readFile(resolve(root, name));
    if (upstream.files[name] && createHash('sha256').update(data).digest('hex') !== upstream.files[name]) throw new Error(`上游文件校验失败：${name}`);
    zip.file(`${pkg.name}/${name}`, data, { date: new Date('2026-11-03T00:00:00Z') });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = resolve(process.argv[2] || 'tests/.tmp/dsh-unrestricted-atelier-0.1.1.zip');
  const zip = await packageAtelierAdapter();
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, zip);
  const receipt = { file: target, bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex') };
  await writeFile(`${target}.sha256.json`, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
