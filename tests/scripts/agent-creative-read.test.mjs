import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentCreativeRead } from '../../scripts/agent-creative-read.mjs';
import '../support/node-environment.mjs';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';

test('Roll 省略 ID 只列持久记录，不导航；模板正文按 JSON 游标读取', async () => {
  const calls = [], template = { prompt: 'long prompt '.repeat(100), params: { seed: 42 } };
  const read = createAgentCreativeRead({ requestJson: async path => {
    calls.push(path);
    return path.includes('experimentId=') ? { kind: 'rounds', experiment: { id: 'one', template }, items: [{ id: 'round' }], nextOffset: null } : { kind: 'experiments', items: [{ id: 'one' }], nextOffset: 20 };
  } });
  const list = await read.getRollState();
  assert.equal(list.items[0].id, 'one'); assert.equal(list.runtime.status, 'not_queried');
  assert.equal(calls.length, 1); assert.match(calls[0], /^\/api\/style-roll\?/);
  const chunks = []; let fieldOffset = 0;
  do {
    const result = await read.getRollState({ experimentId: 'one', field: 'template', fieldOffset, fieldLimit: 31 });
    chunks.push(result.text); fieldOffset = result.nextOffset;
  } while (fieldOffset !== null);
  assert.deepEqual(JSON.parse(chunks.join('')), template);
});

test('Roll 候选关联复用 Worker 提供的精确条件，跨历史分页且不把编辑/错seed当成功', async () => {
  const ids = Array.from({ length: 103 }, (_, index) => `history-${index}`), expectedHistory = { sourceChainId: 'style-roll:one', moduleId: 'style-roll:candidate', prompt: '1.2::artist:test::', seed: 42 };
  let pages = 0;
  const read = createAgentCreativeRead({ requestJson: async (path, options) => {
    if (path.startsWith('/api/style-roll?')) return { kind: 'candidates', experiment: { id: 'one', template: {} }, items: [{ id: 'candidate', expectedHistory }], nextOffset: null };
    if (path.startsWith('/api/local-history/browse?')) return { ids };
    assert.equal(path, '/api/local-history/browse-page'); pages++;
    return { items: options.body.ids.map(id => ({ id, imageUrl: `/images/${id}`, prompt: expectedHistory.prompt, sourceChainId: expectedHistory.sourceChainId, modules: [{ id: expectedHistory.moduleId }], params: { seed: id === 'history-102' ? 42 : 43 }, ...(id === 'history-0' ? { edit: { operation: 'inpaint' }, params: { seed: 42 } } : {}) })) };
  } });
  const result = await read.getRollState({ experimentId: 'one' });
  assert.equal(pages, 2); assert.equal(result.items[0].hasImage, true); assert.equal(result.items[0].history.id, 'history-102');
  assert.equal(result.items[0].expectedHistory, undefined);
});

test('持久样张和模板可直接分页读全，不从缺少前端任务推出idle', async () => {
  const template = { prompt: 'template', negativePrompt: 'blur', params: { seed: 42 } };
  const read = createAgentCreativeRead({ requestJson: async path => {
    assert.equal(path, '/api/artist-sample-data');
    return { templates: { v45: template }, samples: [{ id: 'removed', pack: 'v45', tag: 'artist:test' }, { id: 'saved', pack: 'v45', tag: 'artist:test', prompt: 'actual', imageUrl: '/saved.png' }, { id: 'other', pack: 'v5', tag: 'artist:test' }], removedSamples: [{ source: 'own', pack: 'v45', id: 'removed' }] };
  } });
  const result = await read.getArtistSampleStatus({ tag: 'artist:test' });
  assert.equal(result.total, 1); assert.equal(result.samples[0].id, 'saved'); assert.equal(result.runtime.status, 'not_queried');
  assert.deepEqual(JSON.parse((await read.getArtistSampleStatus({ tag: 'artist:test', field: 'template' })).text), template);
  assert.equal(JSON.parse((await read.getArtistSampleStatus({ tag: 'artist:test', field: 'sample', sampleId: 'saved' })).text).prompt, 'actual');
  await assert.rejects(read.getArtistSampleStatus({ tag: 'artist:test', field: 'sample', sampleId: 'missing' }), /不存在/);
  await assert.rejects(read.getRollState({ limit: 31 }), /分页/);
});

test('历史读取失败明确失败，不把未知历史报成没有图片', async () => {
  const read = createAgentCreativeRead({ requestJson: async path => {
    if (path.startsWith('/api/style-roll?')) return { kind: 'candidates', items: [{ id: 'candidate', expectedHistory: { sourceChainId: 'style-roll:one' } }] };
    throw new Error('synthetic history unavailable');
  } });
  await assert.rejects(read.getRollState({ experimentId: 'one' }), /history unavailable/);
});

test('真实工具包装下大候选和轮次摘要受12k预算约束，完整JSON仍可原样续读', async () => {
  const root = createWorkspace('creative-budget-');
  try {
    const service = new PromptAgentService({ configFile: root, lanSecret: 'synthetic' });
    service.config.permissionMode = 'read_only';
    const candidate = { id: 'candidate', tags: Array.from({ length: 64 }, (_, index) => ({ tag: `${index}-${'long tag '.repeat(24)}`, weight: 1.25 })), createdAt: 1 };
    const round = { id: 'round', candidateIds: ['candidate'], snapshot: { artists: Array.from({ length: 1000 }, (_, index) => ({ tag: `artist-${index}-${'x'.repeat(180)}` })) } };
    const tools = service.createTools({ params: {} }, {}, () => {}, { requestJson: async path => {
      if (path.startsWith('/api/local-history/browse?')) return { ids: [] };
      const query = new URL(path, 'http://synthetic').searchParams, offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 20);
      const rounds = query.get('section') === 'rounds';
      const all = Array.from({ length: 30 }, (_, index) => rounds ? { ...round, id: `round-${index}` } : { ...candidate, id: `candidate-${index}`, expectedHistory: { sourceChainId: 'source' } });
      const items = query.has('itemId') ? [all.find(item => item.id === query.get('itemId'))] : all.slice(offset, offset + limit);
      return { kind: rounds ? 'rounds' : 'candidates', experiment: { id: 'experiment', template: { prompt: 'template' } }, items, total: all.length, offset, limit, nextOffset: offset + items.length < all.length ? offset + items.length : null };
    } });
    const tool = tools.find(item => item.name === 'get_roll_state');
    const call = async args => {
      const result = await tool.execute('synthetic', { experimentId: 'experiment', ...args });
      return { raw: result.content[0].text, data: JSON.parse(result.content[0].text) };
    };
    const candidates = await call({ limit: 30 });
    assert.ok(candidates.raw.length <= 12000);
    assert.ok(candidates.data.items.length < 30);
    assert.equal(candidates.data.nextOffset, candidates.data.items.length);
    assert.equal(candidates.data.items[0].partial, true);
    assert.equal(candidates.data.items[0].tagCount, 64);
    const rounds = await call({ section: 'rounds', limit: 30 });
    assert.ok(rounds.raw.length <= 12000); assert.equal(rounds.data.items[0].snapshotAvailable, true);
    for (const [field, key, value] of [['candidate', 'candidateId', { ...candidate, id: 'candidate-0' }], ['round', 'roundId', { ...round, id: 'round-0' }]]) {
      let fieldOffset = 0, text = '';
      do { const page = (await call({ field, [key]: value.id, fieldOffset })).data; assert.ok(page.text.length <= 3500); text += page.text; fieldOffset = page.nextOffset; } while (fieldOffset !== null);
      assert.deepEqual(JSON.parse(text), value);
    }
  } finally { removeWorkspace(root); }
});
