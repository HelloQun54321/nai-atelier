import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { ARTIST_REFERENCE_SOURCE, createArtistReference, normalizeArtistReferenceLibrary, validateArtistReferenceSource } from '../../scripts/artist-reference.mjs';

const origin = ARTIST_REFERENCE_SOURCE.origin;
const entry = (id, prompt, extra = {}) => ({
  no: 1, entry_id: id, artist: prompt, prompt_tag: `artist:${prompt}`, tested_prompt: `artist:${prompt}, year 2025`, tester: '合成测试者',
  danbooru_tag: prompt, danbooru_posts: 12, images: [`images/${id}.webp`], thumbnails: [`thumbs/${id}.webp`], nai5_look: '合成观察', danbooru_look: '',
  fidelity: '高', usability: '可用', tags: ['涂-厚涂'], roles: ['主'], note: '', model: 'novelai-v5-full', review_status: 'reviewed', evidence_note: '合成说明',
  source: 'sources/private/path.json', source_images: ['sources/private/a.png'], expected_effects: ['加厚体积'], possible_biases: ['可能偏灰'],
  mixing_assessment: { status: 'inferred', basis: '合成' }, ...extra,
});
const library = (entries, revision = 1) => ({ version: 'project-1', schema_version: 1, revision, updated_at: '2026-10-24T00:00:00Z', upstream_version: 'v0.1', entries });
const syntheticEntries = () => [
  entry('alpha_0001', 'alpha_artist', { tags: ['涂-厚涂', '光-强明暗'], roles: ['主'] }),
  entry('beta_0001', 'beta_artist', { tags: ['涂-厚涂'], roles: ['副'], usability: '稳定' }),
  entry('beta_0002', 'beta_artist', { tags: ['涂-平涂'], roles: ['附加-背景'], usability: '慎用', tester: '另一位测试者' }),
];
const webp = await sharp({ create: { width: 4, height: 6, channels: 3, background: '#335577' } }).webp().toBuffer();

const remote = (data, { broken = [], requests = [], etag = 'W/"one"' } = {}) => async (url, options = {}) => {
  requests.push({ url, headers: options.headers || {} });
  const path = new URL(url).pathname.slice(1);
  if (path === 'data.json') {
    if (typeof data === 'function') return data(options);
    if (options.headers?.['if-none-match'] === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(data), { status: 200, headers: { etag, 'content-type': 'application/json' } });
  }
  // 来源站点对未知路径也返回 200 网页，测试按真实行为模拟。
  if (broken.includes(path)) return new Response('<!doctype html><title>404</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response(webp, { status: 200, headers: { 'content-type': 'image/webp' } });
};
const settle = async service => {
  for (let i = 0; i < 400; i++) {
    const status = await service.status(true);
    if (!['fetching', 'thumbnails'].includes(status.sync.stage)) return status;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('合成同步超时');
};

test('规范化只保留展示字段，拒绝不支持的版本、重复编号和越界例图路径', () => {
  const result = normalizeArtistReferenceLibrary(library([entry('alpha_0001', 'alpha_artist', { usability: '神级', fidelity: '满分', thumbnails: [] })]));
  assert.equal(result.entries[0].tag, 'alpha_artist');
  assert.equal(result.entries[0].usability, '待验证');
  assert.equal(result.entries[0].fidelity, '未知');
  assert.deepEqual(result.entries[0].images, [{ full: 'images/alpha_0001.webp', thumb: 'images/alpha_0001.webp' }]);
  assert.equal('source' in result.entries[0], false);
  assert.equal(JSON.stringify(result).includes('sources/private'), false);
  for (const invalid of [
    { ...library(syntheticEntries()), schema_version: 2 },
    library([]),
    library([entry('same', 'a'), entry('same', 'b')]),
    library([entry('bad id', 'a')]),
    library([entry('a_1', 'a', { prompt_tag: '' })]),
    library([entry('a_1', 'a', { images: ['../secret.webp'] })]),
    library([entry('a_1', 'a', { thumbnails: ['sources/original/a.png'] })]),
    [],
  ]) assert.throws(() => normalizeArtistReferenceLibrary(invalid));
});

test('例图地址只接受单个受限文件参数', () => {
  assert.equal(validateArtistReferenceSource('/api/artist-reference/image?file=thumbs%2Fa_1.webp'), 'thumbs/a_1.webp');
  for (const invalid of ['/api/artist-reference/image?file=..%2Fa.webp', '/api/artist-reference/image?file=thumbs%2Fa.webp&file=thumbs%2Fb.webp', '/api/artist-reference/image?file=thumbs%2Fa.webp&path=C:/x',
    '/api/artist-reference/image?file=sources%2Fa.png', '/api/artist-reference/image?file=thumbs%2Fa.webp#x', '/api/artist-samples/image?file=thumbs%2Fa.webp', 'https://example.com/thumbs/a.webp']) {
    assert.throws(() => validateArtistReferenceSource(invalid));
  }
});

test('下载数据后补齐缩略图，网页冒充的图片计为失败，重启后从磁盘恢复并按 ETag 复用', async () => {
  const root = createWorkspace('artist-reference-'); let service;
  try {
    const cacheDir = join(root, 'artist-reference'), requests = [];
    service = createArtistReference({ cacheDir, fetchRemote: remote(library(syntheticEntries()), { broken: ['thumbs/beta_0002.webp'], requests }) });
    assert.equal((await service.status(true)).phase, 'missing');
    await service.control('sync');
    const ready = await settle(service);
    assert.equal(ready.phase, 'ready');
    assert.equal(ready.count, 3); assert.equal(ready.artistCount, 2);
    assert.deepEqual(ready.thumbnails, { cached: 2, total: 3 });
    assert.equal(ready.sync.stage, 'ready'); assert.equal(ready.sync.failed, 1);
    assert.equal(ready.directory, cacheDir);
    assert.deepEqual(ready.credits, { source: '画师串工作室', url: origin, testers: ['合成测试者', '另一位测试者'] });
    assert.equal((await service.status(false)).directory, undefined);
    assert.ok((await stat(join(cacheDir, 'files', 'thumbs', 'alpha_0001.webp'))).size > 0);
    const data = await service.data();
    assert.equal(data.entries.length, 3); assert.equal(data.source.url, origin);
    service.close();

    service = createArtistReference({ cacheDir, fetchRemote: remote(library(syntheticEntries()), { requests }) });
    const restored = await service.status(true);
    assert.equal(restored.phase, 'ready'); assert.equal(restored.version, ready.version);
    assert.deepEqual(restored.thumbnails, { cached: 2, total: 3 });
    await service.control('sync');
    const again = await settle(service);
    const dataRequests = requests.filter(item => item.url.endsWith('/data.json'));
    assert.equal(dataRequests.at(-1).headers['if-none-match'], 'W/"one"');
    assert.equal(again.revision, 1); assert.deepEqual(again.thumbnails, { cached: 3, total: 3 });
    assert.ok(again.fetchedAt >= ready.fetchedAt);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('更新失败保留已有数据并给出原因', async () => {
  const root = createWorkspace('artist-reference-fail-'); let service;
  try {
    const cacheDir = join(root, 'artist-reference');
    let mode = 'ok';
    const data = options => mode === 'ok' ? new Response(JSON.stringify(library(syntheticEntries(), 4)), { status: 200 })
      : mode === 'html' ? new Response('<!doctype html>', { status: 200 })
      : mode === 'schema' ? new Response(JSON.stringify({ ...library(syntheticEntries(), 5), schema_version: 9 }), { status: 200 })
      : mode === 'network' ? Promise.reject(new TypeError('fetch failed')) : new Response('busy', { status: 503 });
    service = createArtistReference({ cacheDir, fetchRemote: remote(data) });
    await service.control('sync'); await settle(service);
    const before = await readFile(join(cacheDir, 'library.json'), 'utf8');
    for (const [value, message] of [['html', /不是有效的 JSON/], ['schema', /版本不受支持/], ['busy', /HTTP 503/], ['network', /无法连接画师串工作室/]]) {
      mode = value;
      await service.control('sync');
      const status = await settle(service);
      assert.equal(status.sync.stage, 'error'); assert.match(status.sync.error, message);
      assert.equal(status.phase, 'ready'); assert.equal(status.revision, 4);
      assert.equal(await readFile(join(cacheDir, 'library.json'), 'utf8'), before);
    }
  } finally { await service?.close(); removeWorkspace(root); }
});

test('原图按需下载并缓存，只读取当前数据登记过的文件', async () => {
  const root = createWorkspace('artist-reference-image-'); let service;
  try {
    const cacheDir = join(root, 'artist-reference'), requests = [];
    service = createArtistReference({ cacheDir, fetchRemote: remote(library(syntheticEntries()), { requests, broken: ['images/beta_0002.webp'] }) });
    await assert.rejects(service.readImage('/api/artist-reference/image?file=images%2Falpha_0001.webp'), { status: 404 });
    await service.control('sync'); await settle(service);
    const full = await service.readImage('/api/artist-reference/image?file=images%2Falpha_0001.webp');
    assert.equal(full.headers['content-type'], 'image/webp'); assert.deepEqual(full.buffer, webp);
    const count = requests.filter(item => item.url.endsWith('images/alpha_0001.webp')).length;
    await service.readImage('/api/artist-reference/image?file=images%2Falpha_0001.webp');
    assert.equal(requests.filter(item => item.url.endsWith('images/alpha_0001.webp')).length, count);
    await assert.rejects(service.readImage('/api/artist-reference/image?file=images%2Funknown.webp'), { status: 404 });
    await assert.rejects(service.readImage('/api/artist-reference/image?file=images%2Fbeta_0002.webp'), /不是受支持的图片/);
    // 损坏的缓存文件重新下载，不把坏字节交给页面。
    await writeFile(join(cacheDir, 'files', 'thumbs', 'alpha_0001.webp'), 'broken');
    assert.deepEqual((await service.readImage('/api/artist-reference/image?file=thumbs%2Falpha_0001.webp')).buffer, webp);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('删除只清理参考目录，之后可以重新下载', async () => {
  const root = createWorkspace('artist-reference-remove-'); let service;
  try {
    const cacheDir = join(root, 'artist-reference'), sibling = join(root, 'keep.txt');
    await writeFile(sibling, 'synthetic');
    service = createArtistReference({ cacheDir, fetchRemote: remote(library(syntheticEntries())) });
    await service.control('sync'); await settle(service);
    await service.control('remove');
    const status = await service.status(true);
    assert.equal(status.phase, 'missing'); assert.equal(status.count, 0); assert.deepEqual(status.thumbnails, { cached: 0, total: 0 });
    await assert.rejects(stat(join(cacheDir, 'library.json')), { code: 'ENOENT' });
    await assert.rejects(stat(join(cacheDir, 'files')), { code: 'ENOENT' });
    assert.equal(await readFile(sibling, 'utf8'), 'synthetic');
    assert.equal(await service.data(), null);
    await assert.rejects(service.control('unknown'), /未知画师参考操作/);
    await service.control('sync');
    assert.equal((await settle(service)).phase, 'ready');
  } finally { await service?.close(); removeWorkspace(root); }
});

test('取消同步保留已写入的数据，缩略图留待浏览时补齐', async () => {
  const root = createWorkspace('artist-reference-cancel-'); let service;
  try {
    const cacheDir = join(root, 'artist-reference');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const base = remote(library(syntheticEntries()));
    service = createArtistReference({ cacheDir, concurrency: 1, fetchRemote: async (url, options) => {
      if (url.includes('/thumbs/')) { await gate; options.signal?.throwIfAborted(); }
      return base(url, options);
    } });
    await service.control('sync');
    for (let i = 0; i < 200 && (await service.status(true)).sync.stage !== 'thumbnails'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const cancelling = service.control('cancel');
    release();
    await cancelling;
    const status = await service.status(true);
    assert.equal(status.sync.stage, 'cancelled'); assert.equal(status.sync.error, '');
    assert.equal(status.phase, 'ready');
    assert.equal(service.busy(), false);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('助手检索按单条记录取交集，同一画师的不同结论分别返回', async () => {
  const root = createWorkspace('artist-reference-search-'); let service;
  try {
    service = createArtistReference({ cacheDir: join(root, 'artist-reference'), fetchRemote: remote(library(syntheticEntries())) });
    assert.equal((await service.search({ tags: ['涂-厚涂'] })).available, false);
    await service.control('sync'); await settle(service);
    const { vocabulary } = await service.search({});
    assert.deepEqual(vocabulary.dimensions.map(item => item.name), ['线条与笔触', '上色与材质', '色彩倾向', '构图与视角', '背景与环境', '风格与表达', '光影氛围', '材质与表面']);
    assert.deepEqual(vocabulary.dimensions[1], { key: '涂', name: '上色与材质', entries: 3, tags: [{ tag: '涂-厚涂', entries: 2 }, { tag: '涂-平涂', entries: 1 }] });
    assert.deepEqual(vocabulary.dimensions[6], { key: '光', name: '光影氛围', entries: 1, tags: [{ tag: '光-强明暗', entries: 1 }] });
    assert.equal(vocabulary.dimensions[0].entries, 0);
    assert.ok(vocabulary.roles.some(item => item.role === '附加-背景' && item.entries === 1));
    assert.deepEqual(vocabulary.usability.find(item => item.value === '可用'), { value: '可用', entries: 1 });
    assert.deepEqual(vocabulary.fidelity.find(item => item.value === '高'), { value: '高', entries: 3 });
    assert.deepEqual(vocabulary.testers, [{ tester: '合成测试者', entries: 2 }, { tester: '另一位测试者', entries: 1 }]);
    assert.deepEqual((await service.search({ dimension: '光影氛围' })).artists.map(item => item.tag), ['artist:alpha_artist']);
    assert.deepEqual((await service.search({ dimension: '涂', testers: ['另一位测试者'] })).artists.map(item => item.tag), ['artist:beta_artist']);
    assert.equal((await service.search({ fidelity: ['低'] })).totalArtists, 0);
    assert.equal((await service.search({ tags: ['涂-厚涂'] })).artists[0].records[0].testedPrompt, 'artist:alpha_artist, year 2025');
    const thick = await service.search({ tags: ['涂-厚涂'] });
    assert.equal(thick.totalArtists, 2); assert.equal(thick.vocabulary, undefined);
    assert.deepEqual((await service.search({ tags: ['涂-厚涂', '光-强明暗'] })).artists.map(item => item.tag), ['artist:alpha_artist']);
    // 两个标签分属 beta 的两条记录，不能拼成一条命中。
    assert.equal((await service.search({ tags: ['涂-厚涂', '涂-平涂'] })).totalArtists, 0);
    const beta = await service.search({ query: 'beta artist' });
    assert.equal(beta.artists.length, 1);
    assert.deepEqual(beta.artists[0].records.map(record => record.usability), ['稳定', '慎用']);
    assert.deepEqual((await service.search({ roles: ['附加-背景'], usability: ['慎用'] })).artists.map(item => item.tag), ['artist:beta_artist']);
    assert.equal((await service.search({ usability: ['失效'] })).totalArtists, 0);
    assert.equal((await service.search({ limit: 1 })).artists.length, 1);
  } finally { await service?.close(); removeWorkspace(root); }
});

test('组装画师串按定位挑选主副与附加画师，给出起始权重并避开失效与相反画法', async () => {
  const root = createWorkspace('artist-reference-compose-'); let service;
  try {
    const entries = [
      entry('main_a', 'main_a', { tags: ['涂-厚涂', '光-强明暗'], roles: ['主'], usability: '稳定', fidelity: '高', danbooru_posts: 50 }),
      entry('main_b', 'main_b', { tags: ['涂-厚涂'], roles: ['主'], usability: '可用', fidelity: '中' }),
      entry('sub_a', 'sub_a', { tags: ['光-强明暗', '色-低饱和'], roles: ['副'], usability: '可用', fidelity: '高' }),
      entry('flat_sub', 'flat_sub', { tags: ['涂-平涂', '光-强明暗', '色-低饱和'], roles: ['副'], usability: '稳定', fidelity: '高' }),
      entry('bg_a', 'bg_a', { tags: ['景-空间感', '光-强明暗'], roles: ['附加-背景'], usability: '稳定', fidelity: '高' }),
      entry('light_a', 'light_a', { tags: ['光-强明暗'], roles: ['附加-光影'], usability: '慎用', fidelity: '低' }),
      entry('broken', 'broken', { tags: ['涂-厚涂', '光-强明暗'], roles: ['主'], usability: '失效', fidelity: '低', mixing_assessment: { status: 'unusable' } }),
      entry('unrelated', 'unrelated_artist', { tags: ['风-萌系'], roles: ['副'], usability: '稳定', fidelity: '高', tester: '合成测试者(无原图)' }),
      entry('third', 'third_artist', { tags: ['风-萌系'], roles: [], usability: '失效', tester: '第三位（无原图）' }),
    ];
    service = createArtistReference({ cacheDir: join(root, 'artist-reference'), fetchRemote: remote(library(entries)) });
    assert.equal((await service.compose({ tags: ['涂-厚涂'] })).available, false);
    await service.control('sync'); await settle(service);

    const result = await service.compose({ tags: ['涂-厚涂', '光-强明暗'], count: 3 });
    assert.deepEqual(result.artists.map(item => [item.tag, item.role, item.weight]), [['artist:main a', '主', 1.2], ['artist:sub a', '副', 0.9], ['artist:bg a', '附加-背景', 0.6]]);
    // flat_sub 的平涂与主画师的厚涂相反，即使可用性更好也不进同一串。
    assert.equal(result.artists.some(item => item.tag === 'artist:flat sub'), false);
    assert.equal(result.artistString, '1.2::artist:main a ::, 0.9::artist:sub a ::, 0.6::artist:bg a ::');
    assert.deepEqual(result.artists[0].matchedTags, ['涂-厚涂', '光-强明暗']);
    assert.ok(result.artists[0].alternatives.includes('artist:main b'));
    assert.deepEqual(result.uncoveredTags, []);
    assert.match(result.note, /未经工坊生图复测/);
    // 致谢按数据署名合并「无原图」状态，不另列名字。
    assert.deepEqual(result.credits, { source: '画师串工作室', url: origin, testers: ['合成测试者', '第三位'] });
    assert.equal(JSON.stringify(result).includes('broken'), false);

    // 慎用画师默认不选；允许后降一档权重，低还原度再降一档。符合目标的画师不足时不拿无关画师凑数。
    const caution = await service.compose({ tags: ['光-强明暗'], count: 4, includeCaution: true, exclude: ['artist:bg_a', 'flat sub'] });
    assert.deepEqual(caution.artists.map(item => [item.tag, item.weight]), [['artist:main a', 1.2], ['artist:sub a', 0.9], ['artist:light a', 0.3]]);
    assert.equal(caution.shortfall, 1);
    assert.equal((await service.compose({ tags: ['光-强明暗'], count: 6 })).artists.some(item => item.tag === 'artist:light a'), false);

    // 保留用户指定的画师（参考外的也保留），其余位置补齐；补位的主画师改作副画师，画师串按 主 → 副 → 附加 排列。
    const kept = await service.compose({ tags: ['涂-厚涂'], keep: ['artist:outside_artist', 'bg_a'], count: 4 });
    assert.deepEqual(kept.artists.map(item => [item.tag, item.role, item.weight]), [['artist:main a', '主', 1.2], ['artist:outside artist', '', 1], ['artist:main b', '副', 0.9], ['artist:bg a', '附加-背景', 0.6]]);
    assert.deepEqual(kept.artists.find(item => item.tag === 'artist:outside artist'), { tag: 'artist:outside artist', role: '', weight: 1, inReference: false, kept: true, alternatives: [] });
    assert.equal(kept.artists.find(item => item.tag === 'artist:bg a').kept, true);

    // 完全没有相关候选时才用综合得分补位并标明弱匹配；相反画法仍然避开，数量限定在 2～6。
    const weak = await service.compose({ tags: ['材-晶体'], count: 9 });
    assert.deepEqual(weak.artists.map(item => item.tag), ['artist:main a', 'artist:unrelated artist', 'artist:sub a', 'artist:main b', 'artist:bg a']);
    assert.ok(weak.artists.every(item => item.weakMatch)); assert.equal(weak.shortfall, 1);
    assert.equal(weak.artists[0].role, '主'); assert.deepEqual(weak.uncoveredTags, ['材-晶体']);
    assert.equal((await service.compose({ dimension: '光影氛围', count: 1 })).artists.length, 2);
    const cute = await service.compose({ query: '萌系' });
    assert.deepEqual(cute.artists.map(item => [item.tag, item.role]), [['artist:unrelated artist', '主']]);
    assert.equal(cute.shortfall, 2);
  } finally { await service?.close(); removeWorkspace(root); }
});
