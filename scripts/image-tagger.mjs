import { readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { IMAGE_TAGGER_MODELS, DEFAULT_IMAGE_TAGGER_MODEL } from '../services/imageTaggerModels.mjs';
import { downloadTaggerFile, fileSize, verifiedFile } from './tagger-model-download.mjs';

const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const parseTagCsv = async path => {
  const rows = (await readFile(path, 'utf8')).trim().split(/\r?\n/).slice(1);
  const tags = rows.map(row => { const columns = row.split(','); return { name: columns[1], category: Number(columns[2]) }; });
  if (!tags.length || tags.some(tag => !tag.name || ![0, 4, 9].includes(tag.category))) throw new Error('模型 Tag 词表无效');
  return tags;
};

export class ImageTaggerService {
  constructor(remoteFetch = fetch, { directory = join(process.cwd(), 'local-cache', 'models'), models = IMAGE_TAGGER_MODELS, loadPreference = async () => ({ model: DEFAULT_IMAGE_TAGGER_MODEL }), savePreference = async () => {}, loadRuntime = () => import('onnxruntime-node') } = {}) {
    this.remoteFetch = remoteFetch;
    this.directory = directory;
    this.models = models;
    this.loadPreference = loadPreference;
    this.savePreference = savePreference;
    this.loadRuntime = loadRuntime;
    this.model = models[0].id;
    this.session = null;
    this.tags = null;
    this.initializing = null;
    this.preferenceLoading = null;
    this.preferenceReady = false;
    this.busy = false;
    this.changing = false;
    this.download = null;
    this.jobs = new Map();
    this.verifications = new Map();
  }

  async preference() {
    if (this.preferenceReady) return;
    if (!this.preferenceLoading) this.preferenceLoading = (async () => {
      const saved = await this.loadPreference();
      this.model = this.models.find(model => model.id === saved?.model)?.id || this.models[0].id;
      this.preferenceReady = true;
    })().finally(() => { this.preferenceLoading = null; });
    return this.preferenceLoading;
  }

  definition(id) {
    const model = this.models.find(model => model.id === id);
    if (!model) throw problem('不支持的反推模型');
    return model;
  }

  async isVerified(model, file) {
    const path = join(this.directory, model.directory, file.name);
    let info;
    try { info = await stat(path); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const cached = this.verifications.get(path);
    if (cached?.signature === signature) return cached.promise;
    const promise = verifiedFile(path, file).catch(error => { this.verifications.delete(path); throw error; });
    this.verifications.set(path, { signature, promise });
    return promise;
  }

  async status() {
    await this.preference();
    const models = await Promise.all(this.models.map(async model => {
      const valid = await Promise.all(model.files.map(file => this.isVerified(model, file)));
      const downloaded = valid.every(Boolean);
      const totalBytes = model.files.reduce((sum, file) => sum + file.size, 0);
      const partial = await Promise.all(model.files.map(async (file, index) => valid[index] ? file.size : Math.min(file.size, await fileSize(join(this.directory, model.directory, `${file.name}.download`)))));
      const job = this.jobs.get(model.id);
      return { id: model.id, label: model.label, description: model.description, threshold: model.threshold, characterThreshold: model.characterThreshold,
        totalBytes, downloaded, ...(job || { stage: downloaded ? 'ready' : partial.some(Boolean) ? 'paused' : 'missing', receivedBytes: partial.reduce((a, b) => a + b, 0), error: '' }) };
    }));
    return {
      model: this.model, downloaded: models.find(model => model.id === this.model).downloaded,
      models, busy: this.busy || this.changing, downloadingModel: this.download?.model || null,
    };
  }

  async select(id) {
    await this.preference(); this.definition(id);
    if (this.busy || this.changing) throw problem('正在识别图片，请完成后再切换模型', 409);
    if (this.model === id) return;
    this.changing = true;
    try {
      await this.savePreference({ model: id });
      const previous = this.session;
      this.model = id; this.session = null; this.tags = null;
      await previous?.release().catch(() => {});
    } finally { this.changing = false; }
  }

  startDownload(id) {
    const model = this.definition(id);
    if (this.changing) throw problem('正在管理反推模型，请稍候', 409);
    if (this.download) {
      if (this.download.model === id) return this.download.promise;
      throw problem('已有模型正在下载，请完成或暂停后再下载其他模型', 409);
    }
    const controller = new AbortController();
    const task = { model: id, controller, promise: null };
    this.download = task;
    const job = { stage: 'downloading', receivedBytes: 0, error: '' };
    this.jobs.set(id, job);
    task.promise = (async () => {
      let completed = 0;
      for (const file of model.files) {
        await downloadTaggerFile({ model, file, directory: join(this.directory, model.directory), fetchRemote: this.remoteFetch,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60 * 1000)]),
          onProgress: (bytes, stage) => { job.receivedBytes = completed + bytes; job.stage = stage === 'verifying' ? 'verifying' : 'downloading'; },
        });
        completed += file.size;
      }
      job.stage = 'ready';
    })().catch(async error => {
      job.stage = controller.signal.aborted ? 'paused' : 'error';
      job.error = controller.signal.aborted ? '' : ['TimeoutError', 'AbortError'].includes(error.name) ? '模型下载超时或连接中断，点击继续下载可续传'
        : error.code === 'ENOSPC' ? '磁盘空间不足，请释放空间后继续下载'
        : ['EACCES', 'EPERM'].includes(error.code) ? '模型缓存目录没有写入权限'
        : error.message === 'fetch failed' ? '无法连接 Hugging Face，请检查网络或代理后继续下载' : error.message || '模型下载失败';
      const remaining = await Promise.all(model.files.map(async file => await this.isVerified(model, file) ? file.size : Math.min(file.size, await fileSize(join(this.directory, model.directory, `${file.name}.download`))))).catch(() => null);
      if (remaining) job.receivedBytes = remaining.reduce((a, b) => a + b, 0);
      throw problem(controller.signal.aborted ? '模型下载已暂停，请在设置中继续下载' : job.error, error.status || 503);
    }).finally(() => { if (this.download === task) this.download = null; });
    // 设置页后台下载不持有 HTTP 请求，也不让失败变成未处理拒绝。
    task.promise.catch(() => {});
    return task.promise;
  }

  async pauseDownload() {
    const task = this.download;
    if (!task) return;
    task.controller.abort();
    await task.promise.catch(() => {});
  }

  async deleteModel(id) {
    await this.preference();
    const model = this.definition(id);
    if (this.busy || this.changing || this.initializing) throw problem('模型正在使用，请完成后再删除', 409);
    // 仅删除注册表内的模型文件及续传副本，保留目录中的其他内容。
    const paths = model.files.flatMap(file => {
      const path = join(this.directory, model.directory, file.name);
      return [path, `${path}.download`];
    });
    const root = `${resolve(this.directory)}${sep}`;
    if (paths.some(path => !resolve(path).startsWith(root))) throw problem('模型缓存路径无效');
    this.changing = true;
    try {
      if (this.download?.model === id) await this.pauseDownload();
      if (this.model === id) {
        await this.session?.release();
        this.session = null; this.tags = null;
      }
      await Promise.allSettled(paths.map(path => this.verifications.get(path)?.promise));
      for (const path of paths) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } finally {
      this.jobs.delete(id);
      for (const path of paths) this.verifications.delete(path);
      this.changing = false;
    }
  }

  async init() {
    if (this.session && this.tags) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const model = this.definition(this.model);
      // 已下载模型不受其他模型后台下载影响。
      if (!(await Promise.all(model.files.map(file => this.isVerified(model, file)))).every(Boolean)) await this.startDownload(model.id);
      const ort = await this.loadRuntime();
      const tags = await parseTagCsv(join(this.directory, model.directory, 'selected_tags.csv'));
      const session = await ort.InferenceSession.create(join(this.directory, model.directory, 'model.onnx'), { executionProviders: ['cpu'] });
      this.tags = tags; this.session = session;
      this.ort = ort;
    })().finally(() => { this.initializing = null; });
    return this.initializing;
  }

  async tag(imageBuffer, options = {}) {
    await this.preference();
    if (this.busy || this.changing) throw problem('已有图片正在识别，请稍候', 409);
    if (options.model && options.model !== this.model) throw problem('反推模型已切换，请重新打开识别面板', 409);
    const model = this.definition(this.model);
    const threshold = options.threshold ?? model.threshold;
    const characterThreshold = options.characterThreshold ?? model.characterThreshold;
    this.busy = true;
    try {
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
      model: model.id,
      threshold,
      characterThreshold,
      rating: ratings[0] || null,
      tags: [...character, ...general],
      character,
      general,
    };
    } finally { this.busy = false; }
  }
}
