import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// 来源与致谢：画师串工作室（Artist String Studio）整理并公开维护的画师资料库，例图与评价来自其中署名的测试者。
// 工坊只读接入，数据与例图存放在可再生成的资源目录，不随安装包分发；来源未声明许可，界面与助手回复都标注来源。
export const ARTIST_REFERENCE_SOURCE = Object.freeze({
  id: 'artist-string-studio',
  label: '画师串工作室',
  origin: 'https://artist-string-library-moran.navyolm32.chatgpt.site',
  dataPath: '/data.json',
});
export const ARTIST_REFERENCE_USABILITY = Object.freeze(['稳定', '可用', '慎用', '失效', '待验证']);
export const ARTIST_REFERENCE_FIDELITY = Object.freeze(['高', '中', '低', '未知']);
const SCHEMA_VERSION = 1;
const STORE_VERSION = 1;
const DATA_LIMIT = 16 * 1024 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const ENTRY_LIMIT = 20000;
const FILE_PATTERN = /^(?:images|thumbs)\/[A-Za-z0-9_.-]{1,200}\.(?:webp|jpe?g|png)$/;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, limit = 600) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = (value, limit, length = 120) => Array.isArray(value)
  ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim().slice(0, length)).filter(Boolean))].slice(0, limit) : [];
export const normalizeArtistReferenceTag = value => String(value || '').replace(/^\s*artist\s*:\s*/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

const imageType = buffer => buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? 'image/jpeg'
  : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
  : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : '';

/** 只保留展示与筛选需要的字段；来源内部路径和未知字段不进入工坊。 */
export function normalizeArtistReferenceLibrary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw failure('画师参考数据格式无效');
  if (raw.schema_version !== SCHEMA_VERSION) throw failure('画师参考数据版本不受支持，请更新工坊后重试');
  if (!Array.isArray(raw.entries) || !raw.entries.length || raw.entries.length > ENTRY_LIMIT) throw failure('画师参考数据没有可用条目');
  const ids = new Set();
  const entries = raw.entries.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw failure('画师参考条目格式无效');
    const id = text(item.entry_id, 160);
    if (!/^[\w.-]{1,160}$/.test(id) || ids.has(id)) throw failure('画师参考条目编号无效或重复');
    ids.add(id);
    const tag = text(item.prompt_tag, 300).replace(/^artist\s*:\s*/i, '').trim();
    if (!tag) throw failure('画师参考条目缺少画师 Tag');
    const images = list(item.images, 8, 260), thumbnails = list(item.thumbnails, 8, 260);
    if ([...images, ...thumbnails].some(file => !FILE_PATTERN.test(file))) throw failure('画师参考例图地址无效');
    return {
      id, tag, artist: text(item.artist, 300) || tag, testedPrompt: text(item.tested_prompt, 1000), tester: text(item.tester, 80),
      danbooruTag: text(item.danbooru_tag, 300), danbooruPosts: Number.isSafeInteger(item.danbooru_posts) && item.danbooru_posts >= 0 ? item.danbooru_posts : null,
      look: text(item.nai5_look), danbooruLook: text(item.danbooru_look),
      fidelity: ARTIST_REFERENCE_FIDELITY.includes(item.fidelity) ? item.fidelity : '未知',
      usability: ARTIST_REFERENCE_USABILITY.includes(item.usability) ? item.usability : '待验证',
      tags: list(item.tags, 40, 40), roles: list(item.roles, 12, 40), note: text(item.note, 1000), model: text(item.model, 80),
      evidenceNote: text(item.evidence_note), effects: list(item.expected_effects, 12, 400), biases: list(item.possible_biases, 12, 400),
      assessment: text(item.mixing_assessment?.status, 40),
      images: images.map((full, index) => ({ full, thumb: thumbnails[index] || full })),
    };
  });
  return { schemaVersion: SCHEMA_VERSION, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, updatedAt: text(raw.updated_at, 64), upstreamVersion: text(raw.upstream_version, 64), entries };
}

export function validateArtistReferenceSource(source) {
  const value = String(source || ''), url = new URL(value, 'http://localhost');
  if (!value.startsWith('/api/artist-reference/image?') || url.pathname !== '/api/artist-reference/image' || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'file') || url.searchParams.getAll('file').length !== 1
    || !FILE_PATTERN.test(url.searchParams.get('file') || '')) throw failure('无效的画师参考例图地址');
  return url.searchParams.get('file');
}

const readLimited = async (response, limit, label) => {
  if (Number(response.headers.get('content-length')) > limit) throw failure(`${label}过大`);
  const chunks = []; let size = 0;
  if (response.body) for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw failure(`${label}过大`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};
const writeAtomic = async (path, data) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
};
const words = value => String(value || '').toLowerCase().split(/\s+/).filter(Boolean);
const haystack = entry => [entry.tag, entry.artist, entry.look, entry.note, ...entry.tags, ...entry.roles, ...entry.effects, ...entry.biases].join(' ').toLowerCase().replace(/_/g, ' ');
const promptTag = tag => `artist:${tag.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()}`;
const clampCount = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback;

/** 来源站点「按风格探索」的八个维度，顺序与名称保持一致。 */
export const ARTIST_REFERENCE_DIMENSIONS = Object.freeze([
  { key: '线', name: '线条与笔触' }, { key: '涂', name: '上色与材质' }, { key: '色', name: '色彩倾向' }, { key: '构', name: '构图与视角' },
  { key: '景', name: '背景与环境' }, { key: '风', name: '风格与表达' }, { key: '光', name: '光影氛围' }, { key: '材', name: '材质与表面' },
].map(item => Object.freeze(item)));
const dimensionKey = value => ARTIST_REFERENCE_DIMENSIONS.find(item => item.key === value || item.name === value)?.key || '';
const USABILITY_SCORE = { 稳定: 2, 可用: 1, 慎用: 0, 待验证: -1, 失效: -5 };
const FIDELITY_SCORE = { 高: 1.5, 中: 0.5, 未知: 0, 低: -0.5 };
// 同一维度里明显相反的取值不放进同一串，避免主画师的画法被附加项抵消。
const OPPOSITES = [['涂-厚涂', '涂-平涂'], ['涂-厚涂', '涂-赛璐璐'], ['色-高饱和', '色-低饱和'], ['色-暗调', '色-高明度'], ['色-暗调', '色-高调明亮'], ['色-冷色', '色-暖色'],
  ['色-冷蓝', '色-暖黄'], ['线-粗', '线-细'], ['风-写实', '风-Q版'], ['风-暗黑', '风-萌系'], ['景-繁密', '景-留白'], ['风-简约', '风-装饰性']];
/** 起始权重：主画师定调，副画师补充，附加项点到为止；慎用与低还原度再降一档。沿用 Roll 的 0.1 步进。 */
const weightFor = (role, entry) => {
  let weight = role === '主' ? 1.2 : role.startsWith('主-') ? 1.1 : role === '副' ? 0.9 : role === '附加-中和' ? 0.5 : role.startsWith('附加') ? 0.6 : 1;
  if (entry?.usability === '慎用') weight -= 0.2;
  if (entry?.fidelity === '低') weight -= 0.1;
  return Math.round(Math.min(1.5, Math.max(0.3, weight)) * 10) / 10;
};

export function createArtistReference({ cacheDir, fetchRemote = fetch, source = ARTIST_REFERENCE_SOURCE, concurrency = 4, timeoutMs = 30_000 }) {
  const libraryFile = join(cacheDir, 'library.json'), filesDir = join(cacheDir, 'files');
  let stored = null, library = null, loadError = '', closed = false, active = null, knownFiles = new Set(), thumbFiles = [];
  let sync = { stage: 'idle', done: 0, total: 0, failed: 0, error: '' };
  const cached = new Set(), downloads = new Map();
  const adopt = next => {
    library = normalizeArtistReferenceLibrary(next.data); stored = next; loadError = '';
    knownFiles = new Set(library.entries.flatMap(entry => entry.images.flatMap(image => [image.full, image.thumb])));
    thumbFiles = [...new Set(library.entries.flatMap(entry => entry.images.map(image => image.thumb)))];
  };
  const initialized = (async () => {
    try { adopt(JSON.parse(await readFile(libraryFile, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') loadError = '已下载的画师参考数据无法读取，请重新下载'; }
    for (const folder of ['images', 'thumbs']) {
      for (const name of await readdir(join(filesDir, folder)).catch(() => [])) cached.add(`${folder}/${name}`);
    }
  })();
  const version = () => stored ? `${library.revision}:${stored.fetchedAt}` : '';
  // 致谢沿用数据中署名的测试者，「(无原图)」只是同一位测试者的记录状态，不另列名字。
  const credits = () => {
    const counts = new Map();
    for (const entry of library?.entries || []) {
      const name = entry.tester.replace(/\s*[（(]无原图[)）]\s*/g, '').trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return { source: source.label, url: source.origin, testers: [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([name]) => name) };
  };
  const status = async canManage => {
    await initialized;
    return {
      available: true, canManage, source: { label: source.label, url: source.origin }, credits: credits(),
      phase: library ? 'ready' : loadError ? 'error' : 'missing', ...(loadError ? { error: loadError } : {}),
      version: version(), revision: library?.revision ?? 0, updatedAt: library?.updatedAt || '', fetchedAt: stored?.fetchedAt || 0,
      count: library?.entries.length || 0, artistCount: library ? new Set(library.entries.map(entry => normalizeArtistReferenceTag(entry.tag))).size : 0,
      thumbnails: { cached: thumbFiles.filter(file => cached.has(file)).length, total: thumbFiles.length },
      sync: { ...sync }, ...(canManage ? { directory: cacheDir } : {}),
    };
  };
  const data = async () => {
    await initialized;
    return library ? { version: version(), source: { label: source.label, url: source.origin }, credits: credits(), revision: library.revision, updatedAt: library.updatedAt, fetchedAt: stored.fetchedAt, entries: library.entries } : null;
  };
  const download = (file, signal) => {
    if (downloads.has(file)) return downloads.get(file);
    const task = (async () => {
      const response = await fetchRemote(`${source.origin}/${file}`, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(timeoutMs)]), redirect: 'manual', headers: { accept: 'image/webp,image/*' } });
      if (response.status !== 200) throw failure(`画师参考例图下载失败（HTTP ${response.status}）`, 502);
      const buffer = await readLimited(response, IMAGE_LIMIT, '画师参考例图');
      // 站点对不存在的路径也会回 200 网页，按文件头确认真的是图片。
      if (!imageType(buffer)) throw failure('画师参考例图不是受支持的图片', 502);
      await writeAtomic(join(filesDir, file), buffer);
      cached.add(file);
      return buffer;
    })().finally(() => downloads.delete(file));
    downloads.set(file, task);
    return task;
  };
  const readImage = async value => {
    await initialized;
    const file = validateArtistReferenceSource(value);
    if (!library || !knownFiles.has(file)) throw failure('未找到画师参考例图', 404);
    let buffer;
    try { buffer = await readFile(join(filesDir, file)); }
    catch (error) { if (error.code !== 'ENOENT') throw failure('画师参考例图缓存不可读取'); }
    if (!buffer || !imageType(buffer)) { cached.delete(file); buffer = await download(file); }
    return { status: 200, buffer, headers: { 'content-type': imageType(buffer) } };
  };
  const run = async controller => {
    const signal = controller.signal;
    try {
      const url = source.origin + source.dataPath;
      const response = await fetchRemote(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), redirect: 'manual', headers: { accept: 'application/json', ...(library && stored?.etag ? { 'if-none-match': stored.etag } : {}) } });
      let next;
      if (response.status === 304 && library) next = { ...stored, fetchedAt: Date.now() };
      else {
        if (response.status !== 200) throw failure(`画师参考数据下载失败（HTTP ${response.status}）`, 502);
        const bytes = await readLimited(response, DATA_LIMIT, '画师参考数据');
        let raw;
        try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw failure('画师参考数据不是有效的 JSON', 502); }
        normalizeArtistReferenceLibrary(raw);
        next = { version: STORE_VERSION, fetchedAt: Date.now(), etag: response.headers.get('etag') || '', sourceUrl: url, data: raw };
      }
      signal.throwIfAborted();
      await writeAtomic(libraryFile, JSON.stringify(next));
      adopt(next);
      // 数据先落盘；缩略图逐个补齐，单张失败不影响已更新的资料，浏览时仍会按需下载。
      const missing = thumbFiles.filter(file => !cached.has(file));
      sync = { stage: 'thumbnails', done: thumbFiles.length - missing.length, total: thumbFiles.length, failed: 0, error: '' };
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
        while (cursor < missing.length) {
          signal.throwIfAborted();
          const file = missing[cursor++];
          try { await download(file, signal); sync.done++; }
          catch (error) { if (signal.aborted) throw error; sync.failed++; }
        }
      }));
      sync = { stage: 'ready', done: sync.done, total: sync.total, failed: sync.failed, error: '' };
    } catch (error) {
      sync = { ...sync, stage: signal.aborted ? 'cancelled' : 'error', error: signal.aborted ? '' : error.status ? error.message
        : error.name === 'TimeoutError' ? '连接画师串工作室超时，已保留现有数据' : '无法连接画师串工作室，已保留现有数据' };
    } finally { if (active === controller) active = null; }
  };
  const control = async action => {
    await initialized;
    if (closed) throw failure('工坊服务正在关闭，请重新打开后操作');
    if (action === 'sync') {
      if (active) return {};
      const controller = new AbortController();
      active = controller;
      sync = { stage: 'fetching', done: 0, total: 0, failed: 0, error: '' };
      controller.promise = run(controller);
      return {};
    }
    if (action === 'cancel') { const task = active; task?.abort(); await task?.promise; return {}; }
    if (action === 'remove') {
      const task = active; task?.abort(); await task?.promise;
      await rm(libraryFile, { force: true });
      await rm(filesDir, { recursive: true, force: true });
      stored = null; library = null; loadError = ''; knownFiles = new Set(); thumbFiles = []; cached.clear();
      sync = { stage: 'idle', done: 0, total: 0, failed: 0, error: '' };
      return {};
    }
    throw failure('未知画师参考操作');
  };
  const missingNote = { available: false, note: '尚未下载画师组串参考，可在全局设置的数据维护中下载。' };
  const record = entry => ({ tester: entry.tester, usability: entry.usability, fidelity: entry.fidelity, roles: entry.roles, tags: entry.tags, look: entry.look, effects: entry.effects, biases: entry.biases, note: entry.note, testedPrompt: entry.testedPrompt, danbooruPosts: entry.danbooruPosts });
  /** 与画师库筛选同一语义：风格标签由同一条记录同时包含，其余条件在所选项中任一命中。 */
  const filterEntries = ({ query = '', tags = [], dimension = '', roles = [], usability = [], fidelity = [], testers = [] }) => {
    const terms = words(query), wanted = list(tags, 12, 40), key = dimensionKey(dimension);
    const sets = [list(roles, 12, 40), list(usability, 5, 8), list(fidelity, 4, 8), list(testers, 12, 80)].map(values => new Set(values));
    const [roleSet, usabilitySet, fidelitySet, testerSet] = sets;
    const filtered = Boolean(terms.length || wanted.length || key || sets.some(set => set.size));
    return { filtered, entries: library.entries.filter(entry => wanted.every(tag => entry.tags.includes(tag)) && (!key || entry.tags.some(tag => tag.startsWith(`${key}-`)))
      && (!roleSet.size || entry.roles.some(role => roleSet.has(role))) && (!usabilitySet.size || usabilitySet.has(entry.usability))
      && (!fidelitySet.size || fidelitySet.has(entry.fidelity)) && (!testerSet.size || testerSet.has(entry.tester))
      && terms.every(term => haystack(entry).includes(term.replace(/_/g, ' ')))) };
  };
  /** 词表沿用来源站点的「按风格探索」：八个维度的条目数与各自标签，以及全部筛选项。 */
  const vocabulary = () => {
    const count = values => [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    return {
      dimensions: ARTIST_REFERENCE_DIMENSIONS.map(({ key, name }) => ({ key, name, entries: library.entries.filter(entry => entry.tags.some(tag => tag.startsWith(`${key}-`))).length,
        tags: count(library.entries.flatMap(entry => entry.tags.filter(tag => tag.startsWith(`${key}-`)))).map(([tag, entries]) => ({ tag, entries })) })),
      roles: count(library.entries.flatMap(entry => entry.roles)).map(([role, entries]) => ({ role, entries })),
      usability: ARTIST_REFERENCE_USABILITY.map(value => ({ value, entries: library.entries.filter(entry => entry.usability === value).length })),
      fidelity: ARTIST_REFERENCE_FIDELITY.map(value => ({ value, entries: library.entries.filter(entry => entry.fidelity === value).length })),
      testers: count(library.entries.map(entry => entry.tester).filter(Boolean)).map(([tester, entries]) => ({ tester, entries })),
    };
  };
  /** 供助手检索：同一画师的多条来源记录分别返回，不合并成单一结论。 */
  const search = async ({ limit = 12, ...options } = {}) => {
    await initialized;
    if (!library) return missingNote;
    const { filtered, entries } = filterEntries(options);
    const groups = new Map();
    for (const entry of entries) {
      const key = normalizeArtistReferenceTag(entry.tag);
      if (!groups.has(key)) groups.set(key, { tag: `artist:${entry.tag}`, records: [] });
      groups.get(key).records.push(record(entry));
    }
    return { available: true, source: source.label, credits: credits(), revision: library.revision, totalArtists: groups.size, artists: [...groups.values()].slice(0, clampCount(limit, 1, 30, 12)),
      note: '来源例图观察与组串假设，未经工坊生图复测；同一画师不同测试者的结论分别列出。', ...(filtered ? {} : { vocabulary: vocabulary() }) };
  };
  /**
   * 按风格目标挑出主画师、副画师与附加画师并给出起始权重。只依据参考中的定位、标签、可用性与还原度，
   * 结果是可直接写入画师串的起点，不代表已经过生图验证。
   */
  const compose = async ({ tags = [], dimension = '', query = '', count = 3, includeCaution = false, exclude = [], keep = [] } = {}) => {
    await initialized;
    if (!library) return missingNote;
    const goal = list(tags, 12, 40), terms = words(query), key = dimensionKey(dimension), size = clampCount(count, 2, 6, 3);
    const allowed = new Set(includeCaution ? ['稳定', '可用', '慎用'] : ['稳定', '可用']);
    const excluded = new Set(list(exclude, 30, 300).map(normalizeArtistReferenceTag));
    const best = new Map();
    for (const entry of library.entries) {
      const id = normalizeArtistReferenceTag(entry.tag);
      if (excluded.has(id) || !allowed.has(entry.usability) || entry.assessment === 'unusable') continue;
      const matched = goal.filter(tag => entry.tags.includes(tag));
      const hits = terms.filter(term => haystack(entry).includes(term.replace(/_/g, ' '))).length + (key && entry.tags.some(tag => tag.startsWith(`${key}-`)) ? 1 : 0);
      const related = matched.length > 0 || hits > 0 || (!goal.length && !terms.length && !key);
      const score = matched.length * 3 + hits * 2 + USABILITY_SCORE[entry.usability] + FIDELITY_SCORE[entry.fidelity] + (related ? 0 : -20);
      if (!best.has(id) || score > best.get(id).score) best.set(id, { id, entry, score, matched, related });
    }
    // 有符合目标的候选时不拿无关画师凑数；完全没有时才按综合得分给出弱匹配起点。
    const sorted = [...best.values()].sort((left, right) => right.score - left.score || (right.entry.danbooruPosts || 0) - (left.entry.danbooruPosts || 0) || left.entry.tag.localeCompare(right.entry.tag));
    const ranked = sorted.some(item => item.related) ? sorted.filter(item => item.related) : sorted;
    const picked = [];
    for (const tag of list(keep, 6, 300)) {
      const id = normalizeArtistReferenceTag(tag);
      if (picked.some(item => item.id === id)) continue;
      // 用户指定保留的画师不受可用性过滤，参考里没有也照样保留。
      const entry = sorted.find(item => item.id === id)?.entry || library.entries.find(item => normalizeArtistReferenceTag(item.tag) === id) || null;
      picked.push({ id, entry: entry || null, tag: entry?.tag || tag.replace(/^\s*artist\s*:\s*/i, '').trim(), role: entry?.roles[0] || '', matched: entry ? goal.filter(item => entry.tags.includes(item)) : [], kept: true, alternatives: [] });
    }
    const isMain = role => role === '主' || role.startsWith('主-');
    const conflicts = candidate => picked.some(item => item.entry && OPPOSITES.some(([left, right]) => (item.entry.tags.includes(left) && candidate.entry.tags.includes(right)) || (item.entry.tags.includes(right) && candidate.entry.tags.includes(left))));
    const take = (accepts, fallbackRole, forceRole = false) => {
      const uncovered = goal.filter(tag => !picked.some(item => item.entry?.tags.includes(tag)));
      const usedRoles = new Set(picked.map(item => item.role));
      const options = ranked.filter(item => !picked.some(chosen => chosen.id === item.id) && (!accepts || item.entry.roles.some(accepts)) && !conflicts(item))
        .map(item => ({ item, value: item.score + uncovered.filter(tag => item.entry.tags.includes(tag)).length * 2 - (accepts && usedRoles.has(item.entry.roles.find(accepts)) ? 1 : 0) }))
        .sort((left, right) => right.value - left.value);
      const choice = options[0]?.item;
      if (!choice) return false;
      let role = forceRole ? fallbackRole : (accepts && choice.entry.roles.find(accepts)) || choice.entry.roles[0] || fallbackRole;
      // 定调位置只留一个，补位的主画师改作副画师。
      if (!forceRole && isMain(role) && picked.some(item => isMain(item.role))) role = '副';
      picked.push({ ...choice, tag: choice.entry.tag, role, alternatives: options.slice(1, 3).map(option => promptTag(option.item.entry.tag)) });
      return true;
    };
    // 没有标注为主画师的候选时，由综合得分最高的画师承担定调位置。
    if (!picked.some(item => isMain(item.role)) && picked.length < size && !take(isMain)) take(null, '主', true);
    const subs = size >= 5 ? 2 : 1;
    while (picked.length < size && picked.filter(item => item.role === '副').length < subs && take(role => role === '副'));
    while (picked.length < size && take(role => role.startsWith('附加')));
    while (picked.length < size && take(null, '副'));
    // 画师串按 主 → 副 → 附加 排列；Tag 统一为词库的空格写法，同一画师不同记录的下划线差异不再并存。
    const order = role => role === '主' || role.startsWith('主-') ? 0 : role.startsWith('附加') ? 2 : 1;
    const artists = picked.slice().sort((left, right) => order(left.role) - order(right.role)).map(item => ({
      tag: promptTag(item.tag), role: item.role, weight: weightFor(item.role, item.entry), inReference: Boolean(item.entry), ...(item.kept ? { kept: true } : {}),
      ...(item.entry ? { usability: item.entry.usability, fidelity: item.entry.fidelity, tester: item.entry.tester, matchedTags: item.matched, effects: item.entry.effects, biases: item.entry.biases } : {}),
      ...(item.related === false ? { weakMatch: true } : {}), alternatives: item.alternatives,
    }));
    return {
      available: true, source: source.label, credits: credits(), revision: library.revision, goal: { tags: goal, dimension: key ? ARTIST_REFERENCE_DIMENSIONS.find(item => item.key === key).name : '', query: terms.join(' ') },
      artists, artistString: artists.map(item => `${item.weight.toFixed(1)}::${item.tag} ::`).join(', '),
      uncoveredTags: goal.filter(tag => !picked.some(item => item.entry?.tags.includes(tag))), ...(artists.length < size ? { shortfall: size - artists.length } : {}),
      note: '按来源例图观察的定位、标签、可用性与还原度生成的起点组合与权重（参考均为 NAI V5 例图），未经工坊生图复测；可按需求调整后写入画师串。',
    };
  };
  return { status, data, readImage, control, search, compose, busy: () => Boolean(active), close: () => { closed = true; active?.abort(); return active?.promise || Promise.resolve(); } };
}
