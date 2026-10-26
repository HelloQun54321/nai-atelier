/**
 * 提取分类的图片元数据读取：这里刻意不使用 mock，而是用 fast-png 合成**真实的 PNG**，
 * 分别覆盖普通文本块（tEXt Comment）与 stealth（alpha 位 + gzip）两条读取路径，
 * 确认全局与各角色的正向内容都能进入分类请求，角色内容不会丢。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { encode } from 'fast-png';
import { extractPngMetadata } from '../../services/pngMetadata.mjs';
import { parseStoredGenerationMetadata, prepareExtractionChunks } from '../../services/promptExtraction.mjs';

const SIZE = 64;
const metadata = {
  prompt: 'classroom, sunset, red hair, red eyes, blue hair, blue eyes',
  uc: 'bad quality',
  steps: 28,
  sampler: 'k_euler_ancestral',
  seed: 4_204_204,
  Source: 'NovelAI',
  v4_prompt: { caption: {
    base_caption: 'classroom, sunset',
    char_captions: [{ char_caption: 'red hair, red eyes' }, { char_caption: 'blue hair, blue eyes' }],
  } },
  v4_negative_prompt: { caption: {
    base_caption: 'bad quality',
    char_captions: [{ char_caption: 'bad hands' }, { char_caption: '' }],
  } },
};

const plainPng = () => Buffer.from(encode({ width: SIZE, height: SIZE, channels: 4, data: new Uint8Array(SIZE * SIZE * 4).fill(255) }));

/** 把 JSON 写进 alpha 通道最低位：与 gateway／采集器读取的 stealth 格式一致。 */
const stealthPng = (value = metadata, magic = 'stealth_pngcomp') => {
  const payload = magic === 'stealth_pngcomp'
    ? gzipSync(Buffer.from(JSON.stringify({ Software: 'NovelAI', Comment: JSON.stringify(value) })))
    : Buffer.from(JSON.stringify(value));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length * 8);
  const header = Buffer.concat([Buffer.from(magic), length, payload]);
  const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
  for (let bitIndex = 0; bitIndex < header.length * 8; bitIndex += 1) {
    const x = Math.floor(bitIndex / SIZE);
    const y = bitIndex % SIZE;
    data[(y * SIZE + x) * 4 + 3] = 254 | ((header[bitIndex >> 3] >> (7 - (bitIndex % 8))) & 1);
  }
  return Buffer.from(encode({ width: SIZE, height: SIZE, channels: 4, data }));
};

/** 在 IEND 前插入一个合法的 tEXt 块（含 CRC）。 */
const withTextChunk = (source, keyword, text) => {
  const content = Buffer.concat([Buffer.from(`${keyword}\0`, 'latin1'), Buffer.from(text, 'utf8')]);
  const chunk = Buffer.alloc(content.length + 12);
  chunk.writeUInt32BE(content.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  content.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([source.subarray(0, source.length - 12), chunk, source.subarray(source.length - 12)]);
};

const extractFrom = async bytes => {
  const raw = await extractPngMetadata(new Uint8Array(bytes));
  return raw ? parseStoredGenerationMetadata(raw) : null;
};

test('真实 PNG 文本块：全局与两名角色的正向都读到，角色负面不混进正向', async () => {
  const stored = await extractFrom(withTextChunk(plainPng(), 'Comment', JSON.stringify(metadata)));
  assert.ok(stored);
  assert.equal(stored.globalPrompt, 'classroom, sunset');
  assert.deepEqual(stored.characters.map(entry => [entry.label, entry.prompt, entry.negative]), [
    ['人物 A', 'red hair, red eyes', 'bad hands'],
    ['人物 B', 'blue hair, blue eyes', ''],
  ]);
  assert.equal(stored.negative, 'bad quality');
});

test('真实 stealth PNG（alpha 位 + gzip）同样读到角色内容', async () => {
  const stored = await extractFrom(stealthPng());
  assert.ok(stored);
  assert.equal(stored.globalPrompt, 'classroom, sunset');
  assert.deepEqual(stored.characters.map(entry => entry.prompt), ['red hair, red eyes', 'blue hair, blue eyes']);
  assert.equal(stored.negative, 'bad quality');
  // 未压缩的 stealth_pnginfo 变体也要能读。
  const uncompressed = await extractFrom(stealthPng(metadata, 'stealth_pnginfo'));
  assert.deepEqual(uncompressed.characters.map(entry => entry.prompt), ['red hair, red eyes', 'blue hair, blue eyes']);
});

test('角色内容真的进入分类片段：两个角色的发型不合并，角色负面进入剥离区', async () => {
  const stored = await extractFrom(withTextChunk(plainPng(), 'Comment', JSON.stringify(metadata)));
  // 与界面一致：全局负面拼在文本末尾交给服务端剥离，角色正向单独传输。
  const text = stored.negative ? `${stored.globalPrompt}\nNegative prompt: ${stored.negative}` : stored.globalPrompt;
  const prepared = prepareExtractionChunks({ text, characters: stored.characters });
  assert.deepEqual(prepared.chunks.map(chunk => [chunk.text, chunk.subject]), [
    ['classroom', ''], ['sunset', ''],
    ['red hair', '人物 A'], ['red eyes', '人物 A'],
    ['blue hair', '人物 B'], ['blue eyes', '人物 B'],
  ]);
  // 角色负面与全局负面只出现在剥离区，正向片段里没有它们。
  assert.match(prepared.excluded.negative, /bad quality/);
  assert.match(prepared.excluded.negative, /bad hands/);
  assert.equal(prepared.chunks.some(chunk => /bad hands|bad quality/.test(chunk.text)), false);
});

test('没有内嵌信息的 PNG 返回空，读取失败抛错：两者不能混为一谈', async () => {
  assert.equal(await extractFrom(plainPng()), null);
  // 截断的文件属于读取失败，界面要单独提示，而不是说「没有元数据」。
  const broken = plainPng().subarray(0, 40);
  await assert.rejects(() => extractPngMetadata(new Uint8Array(broken)));
});
