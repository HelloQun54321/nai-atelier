import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

const MODEL_ID = 'SmilingWolf/wd-vit-tagger-v3';
const MODEL_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const MODEL_DIR = join(process.cwd(), 'local-cache', 'models', 'wd-vit-tagger-v3');
const MODEL_PATH = join(MODEL_DIR, 'model.onnx');
const TAGS_PATH = join(MODEL_DIR, 'selected_tags.csv');
const MIN_MODEL_BYTES = 350 * 1024 * 1024;
const MIN_TAGS_BYTES = 200 * 1024;

const fileIsReady = async (path, minimumBytes) => {
  try { return (await stat(path)).size >= minimumBytes; } catch { return false; }
};

const downloadFile = async (url, destination, minimumBytes, remoteFetch) => {
  if (await fileIsReady(destination, minimumBytes)) return;
  await mkdir(MODEL_DIR, { recursive: true });
  const temporary = `${destination}.download`;
  await unlink(temporary).catch(() => {});
  const response = await remoteFetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20 * 60 * 1000),
    headers: { 'user-agent': 'NaiPromptManager/0.5 (+local image tagging)' },
  });
  if (!response.ok || !response.body) throw new Error(`模型下载失败 (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  if (!await fileIsReady(temporary, minimumBytes)) {
    await unlink(temporary).catch(() => {});
    throw new Error('下载的模型文件不完整，请重试');
  }
  await rename(temporary, destination);
};

const parseTagCsv = async () => {
  const rows = (await readFile(TAGS_PATH, 'utf8')).trim().split(/\r?\n/).slice(1);
  return rows.map(row => {
    const columns = row.split(',');
    return { name: columns[1], category: Number(columns[2]) };
  }).filter(row => row.name && [0, 4, 9].includes(row.category));
};

export class ImageTaggerService {
  constructor(remoteFetch = fetch) {
    this.remoteFetch = remoteFetch;
    this.session = null;
    this.tags = null;
    this.initializing = null;
  }

  async status() {
    return {
      model: MODEL_ID,
      downloaded: await fileIsReady(MODEL_PATH, MIN_MODEL_BYTES) && await fileIsReady(TAGS_PATH, MIN_TAGS_BYTES),
    };
  }

  async init() {
    if (this.session && this.tags) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      await downloadFile(`${MODEL_BASE_URL}/model.onnx`, MODEL_PATH, MIN_MODEL_BYTES, this.remoteFetch);
      await downloadFile(`${MODEL_BASE_URL}/selected_tags.csv`, TAGS_PATH, MIN_TAGS_BYTES, this.remoteFetch);
      const ort = await import('onnxruntime-node');
      this.tags = await parseTagCsv();
      this.session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['cpu'] });
      this.ort = ort;
    })().finally(() => { this.initializing = null; });
    return this.initializing;
  }

  async tag(imageBuffer, { threshold = 0.35, characterThreshold = 0.85 } = {}) {
    await this.init();
    const input = this.session.inputMetadata?.[0] || this.session.inputMetadata?.[this.session.inputNames[0]];
    const dimensions = input?.shape || input?.dimensions || input?.dims || [1, 448, 448, 3];
    const height = Number(dimensions[1]) || 448;
    const width = Number(dimensions[2]) || height;
    const pixels = await sharp(imageBuffer, { failOn: 'error', limitInputPixels: 80_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(width, height, { fit: 'contain', background: '#ffffff', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer();
    if (pixels.length !== width * height * 3) throw new Error('图片预处理失败');
    const bgr = new Float32Array(pixels.length);
    for (let index = 0; index < pixels.length; index += 3) {
      bgr[index] = pixels[index + 2];
      bgr[index + 1] = pixels[index + 1];
      bgr[index + 2] = pixels[index];
    }
    const tensor = new this.ort.Tensor('float32', bgr, [1, height, width, 3]);
    const output = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const probabilities = output[this.session.outputNames[0]]?.data;
    if (!probabilities || probabilities.length !== this.tags.length) throw new Error('模型输出与 Tag 词表不匹配');

    const ratings = [];
    const general = [];
    const character = [];
    for (let index = 0; index < this.tags.length; index++) {
      const tag = this.tags[index];
      const confidence = Number(probabilities[index] || 0);
      const item = { name: tag.name, confidence, category: tag.category === 4 ? 'character' : tag.category === 9 ? 'rating' : 'general' };
      if (tag.category === 9) ratings.push(item);
      else if (tag.category === 4 && confidence >= characterThreshold) character.push(item);
      else if (tag.category === 0 && confidence >= threshold) general.push(item);
    }
    const byConfidence = (a, b) => b.confidence - a.confidence;
    ratings.sort(byConfidence);
    general.sort(byConfidence);
    character.sort(byConfidence);
    return {
      model: MODEL_ID,
      threshold,
      characterThreshold,
      rating: ratings[0] || null,
      tags: [...character, ...general],
      character,
      general,
    };
  }
}
