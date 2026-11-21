import { vibeStrength } from '../services/vibeProtocol.mjs';
import { extractPngMetadata } from '../services/pngMetadata.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';

const STATE_FILE = join(process.cwd(), 'local-data', 'st-chatu8-bridge.json');
const MAX_VIBE_DOCUMENT_BYTES = 30 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 30 * 1024 * 1024;
const HISTORY_BATCH_SIZE = 250;

const sha256 = value => createHash('sha256').update(value).digest('hex');
// 只有明确声明且每条有效、ID 唯一的完整快照，才可据缺失判断对方已移除。
const isCompleteArtistSnapshot = payload => {
  const marker = payload?.artistSnapshot;
  const artists = payload?.artists;
  if (marker?.version !== 2 || marker.complete !== true || !Array.isArray(artists) || marker.count !== artists.length) return false;
  const ids = new Set();
  const names = new Set();
  for (const artist of artists) {
    if (!artist || typeof artist.externalId !== 'string' || !artist.externalId || artist.externalId.length > 160 || typeof artist.name !== 'string' || !artist.name.trim() || artist.name.length > 100 || ids.has(artist.externalId) || names.has(artist.name)) return false;
    for (const field of ['fixedPrompt', 'fixedPromptEnd', 'negativePrompt', 'previewPath', 'previewSourceImage']) if (typeof artist[field] !== 'string') return false;
    ids.add(artist.externalId); names.add(artist.name);
  }
  return true;
};
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

const defaultState = () => ({
  version: 1,
  sillyTavernRoot: '',
  artistLinks: {},
  vibeLinks: {},
  groupLinks: {},
  history: {},
  lastHistorySyncAt: 0,
  lastSyncAt: 0,
});

export const canonicalVibeSourceHash = document => {
  const image = String(document?.image || '').replace(/^data:image\/[^;]+;base64,/i, '');
  if (image) {
    try {
      const bytes = Buffer.from(image, 'base64');
      if (bytes.length) return sha256(bytes);
    } catch { /* Fall back to the declared identifier below. */ }
  }
  const declared = String(document?.id || '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(declared) ? declared : '';
};

const EXTENSION_SUFFIX_PARTS = ['public', 'scripts', 'extensions', 'third-party', 'npm-bridge'];
const TAURITAVERN_SUFFIX_LIST = [
  ['data', 'default-user', 'extensions', 'npm-bridge'],
  ['data', 'default-user', 'extensions'],
  ['data', 'extensions', 'third-party', 'npm-bridge'],
  ['data', 'extensions', 'third-party'],
  ['default-user', 'extensions', 'npm-bridge'],
  ['default-user', 'extensions'],
  ['extensions', 'third-party', 'npm-bridge'],
  ['extensions', 'third-party'],
];

const readTauriTavernRuntimeDataRoot = appRoot => {
  try {
    const configPath = join(appRoot, 'tauritavern-runtime.json');
    if (!existsSync(configPath)) return '';
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    const dataRoot = typeof parsed?.data_root === 'string' ? parsed.data_root.trim() : '';
    if (dataRoot && isAbsolute(dataRoot) && existsSync(dataRoot)) return normalize(dataRoot);
  } catch { /* 忽略损坏或不可读的运行时配置 */ }
  return '';
};

const findUserDirInsideDataRootSync = dataRoot => {
  if (!dataRoot || !existsSync(dataRoot)) return null;
  const defaultDir = join(dataRoot, 'default-user');
  if (existsSync(join(defaultDir, 'settings.json'))) return defaultDir;
  try {
    for (const entry of readdirSync(dataRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '_tauritavern' || entry.name === 'extensions') continue;
      const candidate = join(dataRoot, entry.name);
      if (existsSync(join(candidate, 'settings.json'))) return candidate;
    }
  } catch { /* 目录不可读 */ }
  return null;
};

const hasTauriTavernMarkers = dir => {
  if (!dir || !existsSync(dir)) return false;
  return existsSync(join(dir, 'tauritavern-runtime.json'))
    || existsSync(join(dir, 'portable.flag'))
    || existsSync(join(dir, '_tauritavern'))
    || existsSync(join(dir, 'data', '_tauritavern'))
    || existsSync(join(dir, 'extensions', 'third-party'))
    || existsSync(join(dir, 'data', 'extensions', 'third-party'));
};

/** 从酒馆根目录或各级扩展子目录反推出 SillyTavern / TauriTavern 根目录。 */
export const computeSillyTavernRootDir = stRoot => {
  const trimmed = String(stRoot || '').trim();
  if (!trimmed) return '';
  let current = normalize(trimmed).replace(/[\\/]+$/, '');
  const lower = current.replaceAll('\\', '/').toLowerCase();
  for (let depth = EXTENSION_SUFFIX_PARTS.length; depth >= 1; depth--) {
    const suffix = '/' + EXTENSION_SUFFIX_PARTS.slice(0, depth).join('/');
    if (lower.endsWith(suffix)) {
      const stripped = current.slice(0, current.length - suffix.length) || current;
      // 避免把 TauriTavern 的 <data_root>/default-user/extensions 误按原生规则截断
      if (!(depth <= 3 && lower.includes('/default-user/extensions'))) {
        return stripped;
      }
    }
  }
  for (const parts of TAURITAVERN_SUFFIX_LIST) {
    const suffix = '/' + parts.join('/');
    if (lower.endsWith(suffix)) {
      return current.slice(0, current.length - suffix.length) || current;
    }
  }
  return current;
};

/** 同步解析酒馆类型（原生 SillyTavern 或 TauriTavern）、数据根、用户目录与扩展安装目录。 */
export const resolveTavernLayout = inputPath => {
  const raw = String(inputPath || '').trim();
  if (!raw) return null;
  const root = resolve(computeSillyTavernRootDir(raw));
  if (!existsSync(root)) return null;

  // 1. TauriTavern 运行时引导配置（tauritavern-runtime.json → data_root，支持自定义迁移数据目录）
  const runtimeDataRoot = readTauriTavernRuntimeDataRoot(root);
  if (runtimeDataRoot) {
    const userDir = findUserDirInsideDataRootSync(runtimeDataRoot);
    if (userDir) {
      return {
        kind: 'tauritavern',
        root,
        dataRoot: runtimeDataRoot,
        userDir,
        extensionTargetDir: join(userDir, 'extensions', 'npm-bridge'),
      };
    }
  }

  // 2. TauriTavern 标记目录（标准安装目录、便携版目录或直接传入的 data_root）
  const ttMarked = hasTauriTavernMarkers(root);
  const nestedDataDir = join(root, 'data');
  const nestedUserDir = findUserDirInsideDataRootSync(nestedDataDir);
  if (ttMarked && nestedUserDir) {
    return {
      kind: 'tauritavern',
      root,
      dataRoot: nestedDataDir,
      userDir: nestedUserDir,
      extensionTargetDir: join(nestedUserDir, 'extensions', 'npm-bridge'),
    };
  }
  const directUserDir = findUserDirInsideDataRootSync(root);
  if (directUserDir) {
    // 直接传入 data/ 或自定义 data_root：若父目录存在 public/ 且无 TT 标记则回推原生 SillyTavern
    const parent = dirname(root);
    if (!ttMarked && parent !== root && existsSync(join(parent, 'public'))) {
      return {
        kind: 'sillytavern',
        root: parent,
        dataRoot: root,
        userDir: directUserDir,
        extensionTargetDir: join(parent, 'public', 'scripts', 'extensions', 'third-party', 'npm-bridge'),
      };
    }
    return {
      kind: 'tauritavern',
      root,
      dataRoot: root,
      userDir: directUserDir,
      extensionTargetDir: join(directUserDir, 'extensions', 'npm-bridge'),
    };
  }

  // 3. 原生 SillyTavern（<root>/data/<user>/settings.json）
  if (nestedUserDir) {
    return {
      kind: 'sillytavern',
      root,
      dataRoot: nestedDataDir,
      userDir: nestedUserDir,
      extensionTargetDir: join(root, 'public', 'scripts', 'extensions', 'third-party', 'npm-bridge'),
    };
  }

  // 4. 尚未初始化 settings.json 但明确有 TauriTavern 标记（允许提前一键安装扩展）
  if (ttMarked) {
    const dataRoot = runtimeDataRoot || (existsSync(join(root, '_tauritavern')) || existsSync(join(root, 'extensions', 'third-party')) ? root : nestedDataDir);
    const userDir = join(dataRoot, 'default-user');
    return {
      kind: 'tauritavern',
      root,
      dataRoot,
      userDir: existsSync(join(userDir, 'settings.json')) ? userDir : null,
      extensionTargetDir: join(userDir, 'extensions', 'npm-bridge'),
    };
  }

  return null;
};

/** 解析酒馆真实用户目录：兼容原生 SillyTavern（data/<user>）与 TauriTavern（含自定义 data_root 与 runtime.json）。 */
export const findSillyTavernUserDir = async root => {
  if (!root) return null;
  const layout = resolveTavernLayout(root);
  if (layout?.userDir) return layout.userDir;
  const dataDir = resolve(root, 'data');
  const defaultDir = join(dataDir, 'default-user');
  try {
    await stat(join(defaultDir, 'settings.json'));
    return defaultDir;
  } catch { /* 继续探测其他用户目录 */ }
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = join(dataDir, entry.name);
      try {
        await stat(join(candidate, 'settings.json'));
        return candidate;
      } catch { /* 非用户配置目录 */ }
    }
  } catch { /* data 目录不存在 */ }
  return null;
};

export const resolveStUserFile = (root, publicPath, userDir = null) => {
  if ((!root && !userDir) || typeof publicPath !== 'string' || !publicPath.startsWith('/user/')) return null;
  const resolvedUserDir = userDir || resolveTavernLayout(root)?.userDir || join(root, 'data', 'default-user');
  const userRoot = resolve(resolvedUserDir, 'user');
  const candidate = resolve(userRoot, publicPath.slice('/user/'.length));
  const rel = relative(userRoot, candidate);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? candidate : null;
};

export const collectStHistoryCandidates = (settings, resolvePath) => {
  const candidates = [];
  for (const entry of Object.values(settings?.jiuguanStorage || {})) {
    for (const image of Array.isArray(entry?.images) ? entry.images : []) {
      if (image?.isVideo || !image?.path || image.path === image.thumbnail_path) continue;
      const filePath = resolvePath(image.path);
      if (!filePath) continue;
      const externalId = sha256(String(image.path).replaceAll('\\', '/').toLowerCase());
      candidates.push({ image, filePath, externalId });
    }
  }
  return candidates;
};

export const computeSillyTavernExtensionTargetDir = stRoot => {
  let targetDir = String(stRoot || '').trim();
  const normalized = targetDir.replaceAll('/', '\\');
  const lower = normalized.toLowerCase();
  if (lower.endsWith('\\npm-bridge')) return targetDir;
  if (lower.endsWith('\\third-party')) return join(targetDir, 'npm-bridge');
  if (lower.endsWith('\\default-user\\extensions')) return join(targetDir, 'npm-bridge');
  if (lower.endsWith('\\extensions')) {
    const parent = dirname(targetDir);
    if (existsSync(join(parent, 'settings.json'))) return join(targetDir, 'npm-bridge');
    return join(targetDir, 'third-party', 'npm-bridge');
  }
  if (lower.endsWith('\\scripts')) return join(targetDir, 'extensions', 'third-party', 'npm-bridge');
  if (lower.endsWith('\\public')) return join(targetDir, 'scripts', 'extensions', 'third-party', 'npm-bridge');

  // 对存在的真实目录自动区分 TauriTavern 与原生 SillyTavern
  const layout = resolveTavernLayout(targetDir);
  if (layout?.extensionTargetDir) return layout.extensionTargetDir;

  return join(targetDir, 'public', 'scripts', 'extensions', 'third-party', 'npm-bridge');
};

export const installSillyTavernBridgeExtension = async ({
  sillyTavernRoot,
  targetUrl = '',
  projectRoot = process.cwd(),
  workspaceRoot = projectRoot,
} = {}) => {
  let stRoot = String(sillyTavernRoot || '').trim();
  if (!stRoot) throw Object.assign(new Error('未指定 SillyTavern / TauriTavern 安装路径，且未能自动检测到酒馆目录'), { status: 400 });
  if (!isAbsolute(stRoot)) throw Object.assign(new Error('酒馆安装路径必须为绝对路径'), { status: 400 });
  stRoot = normalize(stRoot);
  if (!existsSync(stRoot)) throw Object.assign(new Error(`指定的酒馆路径不存在：${stRoot}`), { status: 404 });

  const layout = resolveTavernLayout(stRoot);
  const targetDir = computeSillyTavernExtensionTargetDir(stRoot);

  const localDataDir = resolve(workspaceRoot, 'local-data');
  const resolvedProject = resolve(projectRoot);
  const resolvedWorkspace = resolve(workspaceRoot);
  if (
    targetDir === resolvedProject ||
    targetDir.startsWith(resolvedProject + '\\') ||
    targetDir.startsWith(resolvedProject + '/') ||
    targetDir === resolvedWorkspace || targetDir.startsWith(resolvedWorkspace + '\\') || targetDir.startsWith(resolvedWorkspace + '/') ||
    targetDir === localDataDir ||
    targetDir.startsWith(localDataDir + '\\') ||
    targetDir.startsWith(localDataDir + '/')
  ) {
    throw Object.assign(new Error('安全保护：禁止向项目核心保护区安装扩展'), { status: 403 });
  }

  const extensionDir = join(projectRoot, 'sillytavern-extension', 'npm-bridge');
  let [manifest, index, style, readme] = await Promise.all([
    readFile(join(extensionDir, 'manifest.json'), 'utf8'),
    readFile(join(extensionDir, 'index.js'), 'utf8'),
    readFile(join(extensionDir, 'style.css'), 'utf8'),
    readFile(join(extensionDir, 'README.md'), 'utf8'),
  ]);

  const cleanTargetUrl = String(targetUrl || '').trim().replace(/\/$/, '');
  if (cleanTargetUrl) {
    index = index.replace(
      /const DEFAULT_URL = 'http:\/\/localhost:3000';/,
      `const DEFAULT_URL = '${cleanTargetUrl}';`
    );
  }

  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    writeFile(join(targetDir, 'manifest.json'), manifest, 'utf8'),
    writeFile(join(targetDir, 'index.js'), index, 'utf8'),
    writeFile(join(targetDir, 'style.css'), style, 'utf8'),
    writeFile(join(targetDir, 'README.md'), readme, 'utf8'),
  ]);

  return {
    success: true,
    tavernKind: layout?.kind || 'sillytavern',
    sillyTavernRoot: layout?.root || computeSillyTavernRootDir(stRoot),
    targetPath: targetDir,
    files: ['manifest.json', 'index.js', 'style.css', 'README.md'],
  };
};

const defaultTauriTavernCandidates = projectRoot => {
  const list = [];
  if (process.env.TAURI_TAVERN_ROOT) list.push(process.env.TAURI_TAVERN_ROOT);
  if (process.platform === 'win32' && process.env.APPDATA) {
    list.push(join(process.env.APPDATA, 'com.tauritavern.client'));
  } else if (process.platform === 'darwin') {
    list.push(join(homedir(), 'Library', 'Application Support', 'com.tauritavern.client'));
  } else {
    list.push(join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'com.tauritavern.client'));
  }
  list.push(resolve(projectRoot, '..', 'TauriTavern'));
  if (process.platform === 'win32') list.push('D:\\TauriTavern');
  return list;
};

/** 扫描本机已安装的 SillyTavern 与 TauriTavern 目录（按规范化 userDir 去重，供双开／混用快捷切换）。 */
export const detectAllTavernLocations = async (projectRoot, preferredRoot = '') => {
  const rawCandidates = [
    preferredRoot ? computeSillyTavernRootDir(preferredRoot) : '',
    process.env.SILLY_TAVERN_ROOT ? computeSillyTavernRootDir(process.env.SILLY_TAVERN_ROOT) : '',
    resolve(projectRoot, '..', 'SillyTavern'),
    ...(process.platform === 'win32' ? ['D:\\SillyTavern'] : []),
    ...defaultTauriTavernCandidates(projectRoot),
  ].filter(Boolean);
  const found = [];
  const seenUserDirs = new Set();
  for (const candidate of rawCandidates) {
    const layout = resolveTavernLayout(candidate);
    if (!layout?.userDir) continue;
    const key = layout.userDir.toLowerCase();
    if (seenUserDirs.has(key)) continue;
    seenUserDirs.add(key);
    found.push(layout);
  }
  return found;
};

export const findSillyTavernLocation = async (projectRoot, preferredRoot = '') => {
  const all = await detectAllTavernLocations(projectRoot, preferredRoot);
  if (all.length) {
    const first = all[0];
    return {
      root: first.root,
      userDir: first.userDir,
      kind: first.kind,
      extensionTargetDir: first.extensionTargetDir,
      detectedRoots: all.map(item => ({ kind: item.kind, root: item.root, extensionTargetDir: item.extensionTargetDir })),
    };
  }
  return { root: null, userDir: null, kind: null, extensionTargetDir: null, detectedRoots: [] };
};

export const resolveNovelAiModelFromSource = (source, modelMappings = {}) => {
  const raw = String(source || '').trim();
  if (!raw) return '';
  if (modelMappings && typeof modelMappings === 'object' && modelMappings[raw]) {
    return String(modelMappings[raw]);
  }
  const lower = raw.toLowerCase();
  if (/^nai-diffusion-/i.test(raw)) return raw;
  if (lower.includes('v5')) {
    if (lower.includes('curated')) return 'nai-diffusion-5-curated';
    if (lower.includes('medium')) return 'nai-diffusion-5-full-medium';
    return 'nai-diffusion-5-full';
  }
  if (lower.includes('v4.5') || lower.includes('4.5')) {
    return lower.includes('curated') ? 'nai-diffusion-4-5-curated' : 'nai-diffusion-4-5-full';
  }
  if (lower.includes('v4') || lower.includes('4 ')) {
    return lower.includes('curated') ? 'nai-diffusion-4-curated-preview' : 'nai-diffusion-4-full';
  }
  if (lower.includes('v3') || lower.includes('furry')) {
    return lower.includes('furry') ? 'nai-diffusion-furry-3' : 'nai-diffusion-3';
  }
  return '';
};

/** 复用公共 PNG/隐写解析器提取提示词、角色、模型与采样参数。 */
export const readNovelAiMetadata = async (filePath, modelMappings = {}) => {
  if (extname(filePath).toLowerCase() !== '.png') return { prompt: '', negativePrompt: '', params: {} };
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= 0 || info.size > 24 * 1024 * 1024) {
      return { prompt: '', negativePrompt: '', params: {} };
    }
    const buffer = await readFile(filePath);
    const raw = await extractPngMetadata(buffer);
    if (!raw) return { prompt: '', negativePrompt: '', params: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { prompt: '', negativePrompt: '', params: {} };
    }
    const negativePrompt = String(parsed?.v4_negative_prompt?.caption?.base_caption || parsed?.uc || '');
    const characters = Array.isArray(parsed?.v4_prompt?.caption?.char_captions)
      ? parsed.v4_prompt.caption.char_captions.map((entry, index) => ({
          id: `st-${index + 1}`,
          prompt: String(entry?.char_caption || ''),
          negativePrompt: String(parsed?.v4_negative_prompt?.caption?.char_captions?.[index]?.char_caption || ''),
          x: Number(entry?.centers?.[0]?.x ?? 0.5),
          y: Number(entry?.centers?.[0]?.y ?? 0.5),
        }))
      : [];
    const model = resolveNovelAiModelFromSource(parsed?.Source || parsed?.source || parsed?.model, modelMappings);
    const noiseSchedule = typeof parsed?.noise_schedule === 'string' && parsed.noise_schedule.trim()
      ? parsed.noise_schedule.trim()
      : undefined;
    return {
      prompt: String(parsed?.prompt || parsed?.v4_prompt?.caption?.base_caption || ''),
      negativePrompt,
      params: {
        ...(model ? { model } : {}),
        width: Number(parsed?.width || 832),
        height: Number(parsed?.height || 1216),
        steps: Number(parsed?.steps || 28),
        scale: Number(parsed?.scale || 5),
        sampler: String(parsed?.sampler || 'k_euler_ancestral'),
        ...(noiseSchedule ? { noiseSchedule } : {}),
        seed: Number(parsed?.seed || 0),
        cfgRescale: Number(parsed?.cfg_rescale || 0),
        useCoords: parsed?.v4_prompt?.use_coords === true,
        characters,
      },
    };
  } catch {
    return { prompt: '', negativePrompt: '', params: {} };
  }
};

const chainToArtist = (chain, externalId) => {
  const activeModules = Array.isArray(chain.modules) ? chain.modules.filter(module => module?.isActive !== false) : [];
  const pre = activeModules.filter(module => module.position !== 'post').map(module => module.content).filter(Boolean);
  const post = activeModules.filter(module => module.position === 'post').map(module => module.content).filter(Boolean);
  return {
    externalId,
    name: chain.name,
    fixedPrompt: [chain.basePrompt, ...pre].filter(Boolean).join(', '),
    fixedPromptEnd: post.join(', '),
    negativePrompt: chain.negativePrompt || '',
    previewImage: chain.previewImage || '',
    updatedAt: Number(chain.updatedAt || 0),
  };
};

const artistHash = artist => sha256(JSON.stringify({
  name: String(artist.name || ''),
  fixedPrompt: String(artist.fixedPrompt || ''),
  fixedPromptEnd: String(artist.fixedPromptEnd || ''),
  negativePrompt: String(artist.negativePrompt || ''),
}));

const vibeGroupSignature = group => JSON.stringify({
  name: group.name, normalizeStrengths: group.normalizeStrengths !== false,
  slots: (group.slots || []).map(slot => [slot.vibeId, slot.vibeName || '', slot.encodingId, Number(slot.informationExtracted), Number(slot.strength)]),
});

const DEFAULT_CHAIN_PARAMS = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
};

const artistToChainBody = (artist, existing) => ({
  name: String(artist.name || '未命名风格串').slice(0, 100),
  description: existing?.description || '与 SillyTavern st-chatu8 双向同步',
  type: 'style',
  tags: Array.isArray(existing?.tags) ? existing.tags : [],
  basePrompt: String(artist.fixedPrompt || ''),
  negativePrompt: String(artist.negativePrompt || ''),
  modules: artist.fixedPromptEnd ? [{
    id: 'st-chatu8-postfix', name: '后置画风', content: String(artist.fixedPromptEnd), isActive: true, position: 'post',
  }] : [],
  params: {
    ...DEFAULT_CHAIN_PARAMS,
    ...(existing?.params || {}),
  },
  variableValues: existing?.variableValues || { subject: '' },
});

export class StChatu8Bridge {
  constructor({ projectRoot = process.cwd(), requestWorkerJson, requestWorkerBuffer, modelMappings = () => ({}) }) {
    this.projectRoot = projectRoot;
    this.requestWorkerJson = requestWorkerJson;
    this.requestWorkerBuffer = requestWorkerBuffer;
    this.modelMappings = typeof modelMappings === 'function' ? modelMappings : () => modelMappings || {};
    this.root = null;
    this.userDir = null;
    this.tavernKind = null;
    this.detectedRoots = [];
    this.state = defaultState();
    this.writeQueue = Promise.resolve();
    this.historySyncPromise = null;
    this.syncQueue = Promise.resolve();
    this.enabled = false;
    this.generation = 0;
    this.preferenceRevision = 0;
    this.preferenceQueue = Promise.resolve();
    this.receiptSession = randomUUID();
    this.snapshotCursor = randomUUID();
  }

  async init() {
    try { this.state = { ...defaultState(), ...JSON.parse(await readFile(STATE_FILE, 'utf8')) }; } catch { /* First run. */ }
    const found = await findSillyTavernLocation(this.projectRoot, this.state.sillyTavernRoot);
    this.root = found.root;
    this.userDir = found.userDir;
    this.tavernKind = found.kind || null;
    this.detectedRoots = found.detectedRoots || [];
  }

  async setRoot(inputPath, { strict = true } = {}) {
    const raw = String(inputPath || '').trim();
    if (!raw) {
      if (strict) throw Object.assign(new Error('请提供有效的 SillyTavern / TauriTavern 安装目录或数据目录'), { status: 400 });
      return { connected: Boolean(this.root), sillyTavernRoot: this.root };
    }
    const layout = resolveTavernLayout(raw);
    const candidate = layout?.root || resolve(computeSillyTavernRootDir(raw));
    const userDir = layout?.userDir || await findSillyTavernUserDir(candidate);
    if (!userDir) {
      if (strict) throw Object.assign(new Error(`未在该目录下找到酒馆用户配置（settings.json）：${candidate}`), { status: 404 });
      return { connected: Boolean(this.root), sillyTavernRoot: this.root };
    }
    this.root = candidate;
    this.userDir = userDir;
    this.tavernKind = layout?.kind || 'sillytavern';
    this.state.sillyTavernRoot = candidate;
    const all = await detectAllTavernLocations(this.projectRoot, candidate);
    this.detectedRoots = all.map(item => ({ kind: item.kind, root: item.root, extensionTargetDir: item.extensionTargetDir }));
    await this.saveState();
    return { connected: true, sillyTavernRoot: this.root, tavernKind: this.tavernKind };
  }

  applyPreferences(preferences) {
    if (typeof preferences?.enabled !== 'boolean') throw new Error('智慧姬同步设置响应无效');
    this.preferenceRevision++;
    if (this.enabled !== preferences.enabled) { this.generation++; this.snapshotCursor = randomUUID(); }
    this.enabled = preferences.enabled;
    return { enabled: this.enabled };
  }

  async refreshPreferences(request = () => this.requestWorkerJson('/api/st-chatu8/preferences')) {
    const ticket = ++this.preferenceRevision;
    try {
      const preferences = await request();
      if (ticket === this.preferenceRevision) this.applyPreferences(preferences);
      return { enabled: this.enabled };
    } catch (error) {
      if (ticket === this.preferenceRevision && ![401, 403].includes(error.status)) this.applyPreferences({ enabled: false });
      throw error;
    }
  }

  setPreferences(request) {
    // 先完成持久化，再让运行中的任务感知关闭；多个页面的设置写入串行。
    const pending = this.preferenceQueue.catch(() => {}).then(async () => {
      this.preferenceRevision++;
      return this.applyPreferences(await request());
    });
    this.preferenceQueue = pending;
    return pending;
  }

  assertEnabled(generation = this.generation) {
    if (!this.enabled || generation !== this.generation) {
      throw Object.assign(new Error('智慧姬同步已关闭，请在 Atelier 设置中开启'), { status: 409, code: 'SYNC_DISABLED' });
    }
  }

  async requestSyncJson(generation, path, options) {
    this.assertEnabled(generation);
    const result = await this.requestWorkerJson(path, options);
    this.assertEnabled(generation);
    return result;
  }

  startHistorySync() {
    if (!this.root || this.historySyncPromise) return;
    this.historySyncPromise = this.syncHistory().catch(error => {
      if (error.code !== 'SYNC_DISABLED') console.error('[st-chatu8 bridge] 历史同步失败:', error.message);
    }).finally(() => { this.historySyncPromise = null; });
  }

  status() {
    return {
      enabled: this.enabled,
      connected: Boolean(this.root),
      sillyTavernRoot: this.root,
      tavernKind: this.tavernKind,
      extensionTargetDir: this.root ? computeSillyTavernExtensionTargetDir(this.root) : null,
      detectedRoots: this.detectedRoots || [],
      linkedArtists: Object.keys(this.state.artistLinks || {}).length,
      linkedGroups: Object.keys(this.state.groupLinks || {}).length,
      linkedHistory: Object.keys(this.state.history || {}).length,
      lastSyncAt: Number(this.state.lastSyncAt || 0),
      lastHistorySyncAt: Number(this.state.lastHistorySyncAt || 0),
      historySyncing: Boolean(this.historySyncPromise),
      snapshotCursor: this.snapshotCursor,
    };
  }

  async saveState() {
    const snapshot = JSON.stringify(this.state, null, 2) + '\n';
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(STATE_FILE), { recursive: true });
      const temporary = `${STATE_FILE}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, STATE_FILE);
    });
    return this.writeQueue;
  }

  async readStSettings() {
    if (!this.root) throw Object.assign(new Error('未找到 SillyTavern'), { status: 503 });
    const userDir = this.userDir || await findSillyTavernUserDir(this.root) || join(this.root, 'data', 'default-user');
    this.userDir = userDir;
    const settingsPath = join(userDir, 'settings.json');
    const document = JSON.parse(await readFile(settingsPath, 'utf8'));
    return document?.extension_settings?.['st-chatu8'] || {};
  }

  async readStPreviewData(publicPath) {
    const filePath = this.resolveStUserPath(publicPath);
    if (!filePath) return null;
    try {
      const info = await stat(filePath);
      if (info.size <= 0 || info.size > MAX_PREVIEW_IMAGE_BYTES) return null;
      const bytes = await readFile(filePath);
      const contentType = bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG'
        ? 'image/png'
        : bytes[0] === 0xff && bytes[1] === 0xd8
          ? 'image/jpeg'
          : bytes.subarray(8, 12).toString('ascii') === 'WEBP'
            ? 'image/webp'
            : '';
      return contentType ? `data:${contentType};base64,${bytes.toString('base64')}` : null;
    } catch {
      return null;
    }
  }

  resolveStUserPath(publicPath) {
    return resolveStUserFile(this.root, publicPath, this.userDir);
  }

  async syncHistory() {
    if (!(await this.refreshPreferences()).enabled) return;
    const generation = this.generation;
    const settings = await this.readStSettings();
    this.assertEnabled(generation);
    const candidates = collectStHistoryCandidates(settings, publicPath => this.resolveStUserPath(publicPath));
    const unchecked = [];
    const known = new Set();
    for (const candidate of candidates) {
      const { image, externalId } = candidate;
      const previous = this.state.history[externalId];
      this.state.history[externalId] = { ...this.state.history[externalId], path: image.path, createdAt: Number(image.date || Date.now()) };
      if (!previous?.importedAt) unchecked.push(candidate);
    }
    for (let offset = 0; offset < unchecked.length; offset += 80) {
      const batch = unchecked.slice(offset, offset + 80).map(item => item.externalId);
      const result = await this.requestSyncJson(generation, '/api/integrations/st-chatu8/history/known', { method: 'POST', body: { externalIds: batch } });
      for (const id of result.externalIds || []) known.add(id);
    }
    const mappings = this.modelMappings() || {};
    const pending = [];
    for (const { image, filePath, externalId } of unchecked) {
        this.assertEnabled(generation);
        if (known.has(externalId)) {
          this.state.history[externalId].importedAt ||= Date.now();
          continue;
        }
        try {
          const metadata = await readNovelAiMetadata(filePath, mappings);
          const ext = extname(filePath).toLowerCase();
          pending.push({
            externalId,
            imageType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png',
            sourceName: 'st-chatu8',
            createdAt: Number(image.date || Date.now()),
            ...metadata,
          });
        } catch { /* A half-written or deleted image is retried next scan. */ }
        if (pending.length >= HISTORY_BATCH_SIZE) await this.importHistoryBatch(pending.splice(0), generation);
    }
    if (pending.length) await this.importHistoryBatch(pending, generation);
    this.assertEnabled(generation);
    this.state.lastHistorySyncAt = Date.now();
    await this.saveState();
  }

  async importHistoryBatch(items, generation = this.generation) {
    const result = await this.requestSyncJson(generation, '/api/integrations/st-chatu8/history/import', { method: 'POST', body: { items } });
    const now = Date.now();
    for (const item of items) this.state.history[item.externalId].importedAt = now;
    await this.saveState();
    return result;
  }

  async readHistoryImage(externalId, { maxBytes, signal } = {}) {
    const record = this.state.history?.[externalId];
    const filePath = record ? this.resolveStUserPath(record.path) : null;
    if (!filePath) throw Object.assign(new Error('st-chatu8 原图记录不存在'), { status: 404 });
    let buffer;
    if (maxBytes === undefined) buffer = await readFile(filePath);
    else {
      signal?.throwIfAborted();
      const file = await open(filePath, 'r');
      try {
        const info = await file.stat();
        if (!info.isFile()) throw Object.assign(new Error('st-chatu8 原图记录不存在'), { status: 404 });
        const tooLarge = () => Object.assign(new Error('图片过大，无法交给当前模型识别'), { status: 413 });
        if (info.size > maxBytes) throw tooLarge();
        const chunks = [];
        let size = 0;
        // 即使文件在检查后继续增长，也至多读取上限加一个字节。
        while (size <= maxBytes) {
          signal?.throwIfAborted();
          const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - size + 1));
          const { bytesRead } = await file.read(chunk, 0, chunk.length, size);
          if (!bytesRead) break;
          size += bytesRead;
          if (size > maxBytes) throw tooLarge();
          chunks.push(chunk.subarray(0, bytesRead));
        }
        signal?.throwIfAborted();
        buffer = Buffer.concat(chunks, size);
      } finally { await file.close(); }
    }
    const extension = extname(filePath).toLowerCase();
    return { buffer, contentType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png' };
  }

  async syncArtists(incoming = [], selectedChainIds = [], generation = this.generation, workspace = null, completeSnapshot = false) {
    let chains = await this.requestSyncJson(generation, '/api/chains');
    chains = Array.isArray(chains) ? chains : [];
    const byId = new Map(chains.map(chain => [chain.id, chain]));
    const byName = new Map();
    for (const chain of chains.filter(item => !item.type || item.type === 'style')) {
      const named = byName.get(chain.name) || [];
      named.push(chain);
      byName.set(chain.name, named);
    }
    const linkedIds = new Set(Object.values(this.state.artistLinks || {}).map(link => link.chainId));
    const incomingById = new Map();
    const selected = new Set(selectedChainIds);
    const counts = { received: 0, created: 0, updated: 0, unchanged: 0, selected: 0, exported: 0 };
    for (const raw of incoming) {
      this.assertEnabled(generation);
      if (!raw || typeof raw !== 'object') continue;
      const artist = {
        externalId: String(raw.externalId || '').slice(0, 160), name: String(raw.name || '').trim().slice(0, 100),
        fixedPrompt: String(raw.fixedPrompt || ''), fixedPromptEnd: String(raw.fixedPromptEnd || ''),
        negativePrompt: String(raw.negativePrompt || ''), previewPath: String(raw.previewPath || ''),
        previewSourceImage: String(raw.previewSourceImage || ''),
        updatedAt: Number(raw.updatedAt || 0),
      };
      if (!artist.externalId || !artist.name) continue;
      incomingById.set(artist.externalId, artist);
      counts.received++;
      let link = this.state.artistLinks[artist.externalId];
      let chain = link ? byId.get(link.chainId) : null;
      let wasCreated = false;
      if (chain?.type && chain.type !== 'style') chain = null;
      if (!chain) chain = byName.get(artist.name)?.find(item => !linkedIds.has(item.id));
      if (!chain) {
        const body = artistToChainBody(artist);
        const created = await this.requestSyncJson(generation, '/api/chains', { method: 'POST', body });
        if (created?.id) {
          chain = { ...body, id: created.id, previewImage: '', createdAt: Date.now(), updatedAt: Date.now() };
          chains.push(chain);
          byId.set(chain.id, chain);
          byName.set(chain.name, [...(byName.get(chain.name) || []), chain]);
          counts.created++;
          wasCreated = true;
        }
      }
      if (!chain) continue;
      if (workspace && workspace.chainIds.includes(chain.id)) {
        // 主动发送的任务保留 Atelier 所选内容；部分回执不能覆盖尚未送达的正文或封面。
        this.state.artistLinks[artist.externalId] = { ...link, chainId: chain.id };
        linkedIds.add(chain.id);
        counts.unchanged++;
        continue;
      }
      const stHash = artistHash(artist);
      link ||= { chainId: chain.id, lastStHash: '', lastNpmHash: '' };
      const npmHash = artistHash(chainToArtist(chain, artist.externalId));
      const previewChanged = artist.previewPath !== String(link.lastStPreviewPath || '')
        || String(chain.previewImage || '') !== String(link.lastNpmPreviewImage || '');
      const acknowledgedPreview = artist.previewPath && artist.previewSourceImage && artist.previewSourceImage === chain.previewImage;
      let previewConfirmed = !artist.previewPath || Boolean(acknowledgedPreview) || (!previewChanged && Boolean(chain.previewImage));
      let previewUpdated = false;
      let changed = false;
      if (stHash !== npmHash || previewChanged) {
        const body = artistToChainBody(artist, chain);
        // A missing st-chatu8 preview means "no preview supplied", not
        // "delete the NAI Atelier cover". Only replace a cover when the
        // authoritative side actually provides image data.
        // 酒馆确认此封面来自当前 Atelier URL 时，保留原封面，防止两端反复搬运同一图片。
        if (artist.previewPath && !acknowledgedPreview) {
          const preview = await this.readStPreviewData(artist.previewPath);
          if (preview) {
            body.previewImage = preview;
            previewUpdated = true;
            previewConfirmed = true;
          }
        }
        if (stHash !== npmHash || previewUpdated) {
          await this.requestSyncJson(generation, `/api/chains/${encodeURIComponent(chain.id)}`, { method: 'PUT', body });
          const refreshed = await this.requestSyncJson(generation, `/api/chains/${encodeURIComponent(chain.id)}`);
          if (refreshed?.id) {
            chain = refreshed;
            byId.set(chain.id, chain);
          }
          if (!wasCreated) counts.updated++;
          changed = true;
        }
      }
      if (!changed && !wasCreated) counts.unchanged++;
      this.state.artistLinks[artist.externalId] = {
        ...link,
        chainId: chain.id,
        lastStHash: stHash,
        lastNpmHash: stHash,
        lastStPreviewPath: previewConfirmed ? artist.previewPath : String(link.lastStPreviewPath || ''),
        lastNpmPreviewImage: previewConfirmed ? String(chain.previewImage || '') : String(link.lastNpmPreviewImage || ''),
        ...(previewUpdated ? { importedPreviewImage: String(chain.previewImage || ''), importedPreviewPath: artist.previewPath } : {}),
      };
      linkedIds.add(chain.id);
    }
    chains = await this.requestSyncJson(generation, '/api/chains');
    const linksByChain = new Map(Object.entries(this.state.artistLinks).map(pair => [pair[1].chainId, pair]));
    const entries = new Map((workspace?.entries || []).map(entry => [entry.chainId, entry]));
    const updates = [];
    const previewMatches = (artist, current, link) => !artist.previewImage || (current?.previewPath && (
      current.previewSourceImage === artist.previewImage
      || (link.importedPreviewImage === artist.previewImage && link.importedPreviewPath === current.previewPath)
      || (!workspace && !current.previewSourceImage && link.lastStPreviewPath === current.previewPath && link.lastNpmPreviewImage === artist.previewImage)
    ));
    if (completeSnapshot && workspace) {
      for (const entry of workspace.entries) {
        const pair = linksByChain.get(entry.chainId);
        const chain = chains.find(item => item.id === entry.chainId);
        if (!pair || !chain) continue;
        const current = incomingById.get(pair[0]);
        if (!current && entry.status !== 'pending') updates.push({ chainId: entry.chainId, requestId: entry.requestId, status: 'removed' });
        else if (current) {
          const artist = chainToArtist(chain, pair[0]);
          if (entry.status !== 'pending' || (artistHash(current) === artistHash(artist) && previewMatches(artist, current, pair[1]))) {
            updates.push({ chainId: entry.chainId, requestId: entry.requestId, status: 'synced' });
          }
        }
      }
    }
    const artists = chains.filter(chain => isStChatu8ExportableChain(chain) && selected.has(chain.id)).map(chain => {
      counts.selected++;
      let pair = linksByChain.get(chain.id);
      if (!pair) {
        const externalId = `npm:${chain.id}`;
        this.state.artistLinks[externalId] = { chainId: chain.id, lastStHash: '', lastNpmHash: '' };
        pair = [externalId, this.state.artistLinks[externalId]];
      }
      if (!workspace && pair[0].startsWith('st:') && !incomingById.has(pair[0])) return null;
      const artist = chainToArtist(chain, pair[0]);
      const current = incomingById.get(pair[0]);
      if (current && artistHash(current) === artistHash(artist) && previewMatches(artist, current, pair[1]) && (!workspace || completeSnapshot)) return null;
      const entry = entries.get(chain.id);
      if (workspace && entry) {
        const contentHash = sha256(JSON.stringify(artist));
        let transfer = pair[1].transfer;
        if (!transfer || transfer.requestId !== entry.requestId || transfer.contentHash !== contentHash || transfer.session !== this.receiptSession || transfer.generation !== generation) {
          transfer = { requestId: entry.requestId, token: randomUUID(), contentHash, textHash: artistHash(artist), previewImage: String(artist.previewImage || ''), session: this.receiptSession, generation };
          pair[1].transfer = transfer;
        }
        artist.receipt = { requestId: transfer.requestId, token: transfer.token };
      }
      pair[1].lastNpmHash = artistHash(artist);
      pair[1].lastNpmPreviewImage = String(chain.previewImage || '');
      return artist;
    }).filter(Boolean);
    counts.exported = artists.length;
    this.lastArtistSync = counts;
    this.assertEnabled(generation);
    await this.saveState();
    if (workspace && (updates.length || completeSnapshot)) await this.requestSyncJson(generation, '/api/integrations/st-chatu8/artist-records', {
      method: 'POST', body: { updates, verifiedAt: completeSnapshot ? Date.now() : 0 },
    });
    return artists;
  }

  async syncVibes(documents = [], incomingGroups = [], presentSourceHashes = [], generation = this.generation) {
    const incomingSourceHashes = new Set(presentSourceHashes
      .map(value => String(value || '').toLowerCase())
      .filter(value => /^[a-f0-9]{64}$/.test(value)));
    for (const document of documents.slice(0, 100)) {
      const text = JSON.stringify(document);
      if (Buffer.byteLength(text) > MAX_VIBE_DOCUMENT_BYTES) continue;
      if (document?.identifier !== 'novelai-vibe-transfer') continue;
      const sourceHash = canonicalVibeSourceHash(document);
      if (!sourceHash) continue;
      incomingSourceHashes.add(sourceHash);
      const result = await this.requestSyncJson(generation, '/api/vibes/import', { method: 'POST', body: { document } });
      const requestedName = String(document.name || '').trim();
      const vibeId = result?.item?.id || null;
      if (vibeId) this.state.vibeLinks[sourceHash] = { vibeId, lastSeenAt: Date.now() };
      const requestedStrength = vibeStrength(document.importInfo?.strength);
      if (vibeId && requestedName && (result?.item?.name !== requestedName || Number(result?.item?.defaultStrength) !== requestedStrength)) {
        await this.requestSyncJson(generation, `/api/vibes/${encodeURIComponent(vibeId)}`, {
          method: 'PUT', body: { name: requestedName, defaultStrength: requestedStrength },
        });
      }
    }
    const vibeResult = await this.requestSyncJson(generation, '/api/vibes');
    const vibes = Array.isArray(vibeResult?.items) ? vibeResult.items : [];
    const bySourceHash = new Map(vibes.map(vibe => [vibe.sourceHash, vibe]));
    let groupsResult = await this.requestSyncJson(generation, '/api/vibe-groups');
    let groups = Array.isArray(groupsResult?.items) ? groupsResult.items : [];
    const incomingGroupIds = new Set();
    for (const group of incomingGroups.slice(0, 200)) {
      const name = String(group?.name || '').trim().slice(0, 100);
      if (!name || !Array.isArray(group.vibes)) continue;
      const externalGroupId = String(group.externalId || name);
      const slots = group.vibes.slice(0, 16).map(reference => {
        const vibe = bySourceHash.get(reference.sourceHash);
        const encoding = vibe?.encodings?.find(item => Math.abs(Number(item.informationExtracted) - 1) < 0.001) || vibe?.encodings?.[0];
        return vibe && encoding ? {
          vibeId: vibe.id, vibeName: vibe.name, encodingId: encoding.id,
          informationExtracted: Number(encoding.informationExtracted), strength: vibeStrength(reference.strength),
        } : null;
      }).filter(Boolean);
      if (!slots.length) continue;
      let linkedId = this.state.groupLinks[externalGroupId];
      let existing = groups.find(item => item.id === linkedId) || groups.find(item => item.name === name);
      const body = { name, slots, normalizeStrengths: group.normalizeStrengths !== false };
      if (existing) {
        if (vibeGroupSignature(existing) !== vibeGroupSignature(body)) {
          await this.requestSyncJson(generation, `/api/vibe-groups/${encodeURIComponent(existing.id)}`, { method: 'PUT', body });
          Object.assign(existing, body);
        }
        linkedId = existing.id;
      } else {
        const created = await this.requestSyncJson(generation, '/api/vibe-groups', { method: 'POST', body });
        linkedId = created?.item?.id;
        if (linkedId) groups.push({ ...body, id: linkedId });
      }
      if (linkedId) {
        this.state.groupLinks[externalGroupId] = linkedId;
        incomingGroupIds.add(linkedId);
      }
    }
    groupsResult = await this.requestSyncJson(generation, '/api/vibe-groups');
    groups = Array.isArray(groupsResult?.items) ? groupsResult.items : [];
    const byId = new Map(vibes.map(vibe => [vibe.id, vibe]));
    this.assertEnabled(generation);
    await this.saveState();
    return {
      vibes: vibes.filter(vibe => !this.state.vibeLinks[vibe.sourceHash] || incomingSourceHashes.has(vibe.sourceHash)).map(vibe => ({
        id: vibe.id, name: vibe.name, sourceHash: vibe.sourceHash, defaultStrength: vibe.defaultStrength,
        updatedAt: vibe.updatedAt, encodingCount: vibe.encodings?.length || 0,
        fileUrl: `/api/integrations/st-chatu8/vibes/${encodeURIComponent(vibe.id)}/file`,
      })),
      groups: groups.filter(group => !Object.values(this.state.groupLinks).includes(group.id) || incomingGroupIds.has(group.id)).map(group => ({
        externalId: `npm:${group.id}`, name: group.name, normalizeStrengths: group.normalizeStrengths,
        updatedAt: group.updatedAt,
        vibes: group.slots.map(slot => ({ sourceHash: byId.get(slot.vibeId)?.sourceHash, strength: slot.strength })).filter(item => item.sourceHash),
      })),
    };
  }

  sync(payload = {}) {
    // 多个酒馆页面共用关联记录；串行处理，避免首次入库时并发创建重复条目。
    const queuedGeneration = this.enabled ? this.generation : null;
    const pending = this.syncQueue.catch(() => {}).then(() => this.performSync(payload, queuedGeneration));
    this.syncQueue = pending;
    return pending;
  }

  async performSync(payload, queuedGeneration = null) {
    const disabled = () => ({ enabled: false, protocolVersion: 2, artistSnapshotComplete: false, artists: [], vibes: [], groups: [], status: this.status() });
    if (!(await this.refreshPreferences()).enabled) return disabled();
    if (queuedGeneration !== null && queuedGeneration !== this.generation) return disabled();
    const generation = this.generation;
    try {
      const selection = await this.requestSyncJson(generation, '/api/st-chatu8/workspace');
      const selectedChainIds = (Array.isArray(selection?.chainIds) ? selection.chainIds : []).filter(id => payload.manual === true || !selection.entries?.find(entry => entry.chainId === id)?.error);
      const completeSnapshot = isCompleteArtistSnapshot(payload) && payload.artistSnapshot.cursor === this.snapshotCursor;
      if (completeSnapshot) this.snapshotCursor = randomUUID();
      const artists = await this.syncArtists(Array.isArray(payload.artists) ? payload.artists : [], selectedChainIds, generation, selection, completeSnapshot);
      const vibeData = await this.syncVibes(
        Array.isArray(payload.vibeDocuments) ? payload.vibeDocuments : [],
        Array.isArray(payload.vibeGroups) ? payload.vibeGroups : [],
        Array.isArray(payload.vibeSourceHashes) ? payload.vibeSourceHashes : [],
        generation,
      );
      this.assertEnabled(generation);
      this.state.lastSyncAt = Date.now();
      await this.saveState();
      this.startHistorySync();
      this.assertEnabled(generation);
      const current = await this.requestSyncJson(generation, '/api/st-chatu8/workspace');
      const activeRequests = new Map((current.entries || []).filter(entry => entry.status === 'pending').map(entry => [entry.chainId, entry.requestId]));
      const outgoing = artists.filter(artist => activeRequests.get(this.state.artistLinks[artist.externalId]?.chainId) === artist.receipt?.requestId);
      return { enabled: true, protocolVersion: 2, artistSnapshotComplete: completeSnapshot, artists: outgoing, artistSync: this.lastArtistSync, ...vibeData, status: this.status() };
    } catch (error) {
      if (error.code === 'SYNC_DISABLED') return disabled();
      throw error;
    }
  }

  acknowledgeArtists(payload = {}) {
    const queuedGeneration = this.generation;
    const pending = this.syncQueue.catch(() => {}).then(async () => {
      await this.refreshPreferences();
      this.assertEnabled(queuedGeneration);
      const complete = isCompleteArtistSnapshot(payload);
      const incoming = new Map((Array.isArray(payload.artists) ? payload.artists : []).map(artist => [artist.externalId, artist]));
      const workspace = await this.requestSyncJson(queuedGeneration, '/api/st-chatu8/workspace');
      const active = new Map((workspace.entries || []).filter(entry => entry.status === 'pending').map(entry => [entry.chainId, entry.requestId]));
      const updates = [];
      const seen = new Set();
      for (const receipt of Array.isArray(payload.receipts) ? payload.receipts : []) {
        if (!receipt || seen.has(receipt.externalId)) continue;
        seen.add(receipt.externalId);
        const link = this.state.artistLinks[receipt?.externalId];
        const transfer = link?.transfer;
        if (!transfer || active.get(link.chainId) !== transfer.requestId || transfer.session !== this.receiptSession || transfer.generation !== queuedGeneration || receipt.token !== transfer.token || receipt.requestId !== transfer.requestId) continue;
        const current = incoming.get(receipt.externalId);
        let confirmed = receipt.success === true && complete && current && artistHash(current) === transfer.textHash
          && (!transfer.previewImage || (current.previewPath && current.previewSourceImage === transfer.previewImage));
        let reason = receipt.reason;
        if (confirmed) {
          const chain = await this.requestSyncJson(queuedGeneration, `/api/chains/${encodeURIComponent(link.chainId)}`);
          if (!isStChatu8ExportableChain(chain) || artistHash(chainToArtist(chain, receipt.externalId)) !== transfer.textHash || String(chain.previewImage || '') !== transfer.previewImage) {
            confirmed = false; reason = '工坊条目已更新，请手动同步最新内容';
          }
        }
        updates.push({ chainId: link.chainId, requestId: transfer.requestId, onlyPending: true, ...(confirmed
          ? { status: 'synced' }
          : { error: String(reason || '未确认正文与封面已保存，请手动同步重试').slice(0, 200) }) });
      }
      const result = await this.requestSyncJson(queuedGeneration, '/api/integrations/st-chatu8/artist-records', {
        method: 'POST', body: { updates, verifiedAt: complete && updates.length ? Date.now() : 0 },
      });
      return { confirmed: updates.filter(update => update.status === 'synced').filter(update => result.entries?.some(entry => entry.chainId === update.chainId && entry.requestId === update.requestId && entry.status === 'synced')).length };
    });
    this.syncQueue = pending;
    return pending;
  }

  async readVibeFile(vibeId) {
    await this.refreshPreferences();
    const generation = this.generation;
    this.assertEnabled(generation);
    const result = await this.requestWorkerBuffer(`/api/vibes/${encodeURIComponent(vibeId)}/file`);
    if (result.status >= 400) throw Object.assign(new Error('Vibe 文件不存在'), { status: result.status });
    this.assertEnabled(generation);
    return { buffer: result.buffer, contentType: 'application/json; charset=utf-8' };
  }
}
