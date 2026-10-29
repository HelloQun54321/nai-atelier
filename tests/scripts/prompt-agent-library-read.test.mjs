import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { PromptAgentService, parseLibraryResponse, foldAgentToolResults } from '../../scripts/prompt-agent.mjs';

const directories = { revision: 3, nodes: [
  { id: 'parent', parentId: null, name: '人物与叙事' },
  { id: 'rain', parentId: 'parent', name: '雨中关系' },
] };
const fragment = (id, overrides = {}) => ({ id, name: `片段 ${id}`, type: 'preset', basePrompt: 'dress', negativePrompt: 'coat', tags: [],
  params: { _promptLibraryDirectoryIds: ['rain'], _promptLibraryPurposes: ['clothing'] }, ...overrides });
const fixture = async (t, entries, run, tree = directories) => {
  const workspace = createWorkspace('agent-library-read-');
  t.after(() => removeWorkspace(workspace));
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: workspace });
  service.appendAuditLog = async () => {};
  const writes = [];
  const tools = service.createTools({ params: {} }, {}, () => {}, { requestJson: async (path, options) => {
    if (path === '/api/prompt-library/directories') return tree;
    if (options?.method) { writes.push(options.body); return { id: options.body.id || 'saved' }; }
    if (path === '/api/chains') return entries;
    const entry = entries.find(item => path === '/api/chains/' + encodeURIComponent(item.id));
    if (!entry) throw new Error('合成资料不存在');
    return { item: entry };
  } });
  const call = async (name, args = {}) => {
    const result = await tools.find(tool => tool.name === name).execute('test', args);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data._agentNotice, undefined, '专用回执必须在通用预算包装后仍完整');
    return data;
  };
  await run({ call, writes, service });
};

const readAll = async (call, tool, args) => {
  let offset = 0, text = '';
  do {
    const part = await call(tool, { ...args, offset, limit: 1703 });
    assert.equal(part.offset, offset);
    assert.ok(part.content.length <= 1703);
    text += part.content;
    if (part.nextOffset === null) return text;
    assert.ok(part.nextOffset > offset);
    offset = part.nextOffset;
  } while (true);
};

test('85层目录与全路径经过实际工具预算可分段取全，nextOffset按真实条数推进', t => {
  const tree = { revision: 8, nodes: Array.from({ length: 85 }, (_, index) => ({ id: 'd' + index, parentId: index ? 'd' + (index - 1) : null, name: `目录${index}` + '长名称'.repeat(25) })) };
  return fixture(t, [], async ({ call }) => {
    let offset = 0;
    const ids = [];
    do {
      const page = await call('get_prompt_library_directories', { offset, limit: 100 });
      assert.equal(page.purposes.length, 22);
      assert.equal(page.limit, page.nodes.length);
      assert.equal(page.directories.length, page.nodes.length);
      ids.push(...page.nodes.map(node => node.id));
      if (page.nextOffset === null) break;
      assert.equal(page.nextOffset, offset + page.nodes.length);
      offset = page.nextOffset;
    } while (true);
    assert.deepEqual(ids, tree.nodes.map(node => node.id));
    const path = JSON.parse(await readAll(call, 'get_prompt_library_directories', { directoryId: 'd84', field: 'directoryPath' }));
    assert.deepEqual(path, tree.nodes.map(node => node.name));
    assert.equal((await call('get_prompt_library_directories', { directoryId: 'd84' })).pathLength, 85);
  }, tree);
});

test('110条长摘要请求limit100也不跳项，正文/目录/自由标签均可召回', t => {
  const entries = Array.from({ length: 110 }, (_, index) => fragment(String(index), {
    basePrompt: `正文${index}, ` + 'red dress, '.repeat(500), tags: ['自由主题', 'tag2', 'tag3', 'tag4', 'tag5'],
  }));
  return fixture(t, entries, async ({ call }) => {
    let offset = 0;
    const ids = [];
    do {
      const page = await call('search_prompt_library_items', { offset, limit: 100 });
      assert.equal(page.limit, page.items.length);
      assert.ok(page.items.length <= 30);
      ids.push(...page.items.map(item => item.id));
      if (page.nextOffset === null) break;
      assert.equal(page.nextOffset, offset + page.items.length);
      offset = page.nextOffset;
    } while (true);
    assert.deepEqual(ids, entries.map(item => item.id));
    for (const query of ['片段 109', '正文109', '自由主题', '人物与叙事', '雨中关系']) {
      const page = await call('search_prompt_library_items', { query });
      assert.equal(page.total, ['片段 109', '正文109'].includes(query) ? 1 : 110);
      assert.equal(page.items[0].promptLength, entries[Number(page.items[0].id)].basePrompt.length);
    }
  });
});

test('get_chain完整恢复长正文和45项组合JSON，字段读取拒绝原型和非资料路径', t => {
  const prompt = '1.25::红伞, rain::\n' + '🌧️ long weighted prompt, '.repeat(2400);
  const snapshot = { format: 'nai-roll-content', version: 2, items: Array.from({ length: 45 }, (_, index) => ({
    unitId: 'purpose:clothing:' + index, text: 'dress, '.repeat(120), negative: 'coat', meta: { entryName: '原始片段' + index },
  })) };
  const entry = fragment('long', { basePrompt: prompt, params: { _rollContentSnapshot: snapshot } });
  return fixture(t, [entry], async ({ call }) => {
    const initial = await call('get_chain', { id: entry.id });
    assert.equal(initial.partial, true);
    assert.ok(initial.fields.some(item => item.field === 'basePrompt' && item.length === prompt.length));
    assert.equal(await readAll(call, 'get_chain', { id: entry.id, field: 'basePrompt' }), prompt);
    const read = JSON.parse(await readAll(call, 'get_chain', { id: entry.id, field: 'params._rollContentSnapshot' }));
    assert.deepEqual(read, snapshot);
    assert.equal(await readAll(call, 'get_chain', { id: entry.id, field: 'params._rollContentSnapshot.items.44.text' }), snapshot.items[44].text);
    for (const field of ['params.__proto__', 'constructor', 'params.toString', 'local-data', 'params..secret']) {
      await assert.rejects(call('get_chain', { id: entry.id, field }), /字段/);
    }
  });
});

test('片段/原文/组合分区、负面极性、多用途any/all和纯用途原因如实返回', t => {
  const entries = [fragment('pure'), fragment('mixed', { params: { _promptLibraryDirectoryIds: ['rain'], _promptLibraryPurposes: ['clothing', 'pose'] } }),
    fragment('unmarked', { params: { _promptLibraryDirectoryIds: ['rain'] } }),
    fragment('negative', { basePrompt: 'bad anatomy', params: { _promptLibraryDirectoryIds: ['rain'], _promptLibraryPurposes: ['clothing'], _promptLibraryPolarity: 'negative' } }),
    fragment('empty', { basePrompt: '' }),
    { id: 'original', name: '整段原文', type: 'preset', basePrompt: 'original body', params: { _collectedPrompt: 1 } },
    { id: 'saved', name: '组合', type: 'preset', params: { _rollContentSnapshot: { version: 2, items: [{ text: 'snapshot-only-body', negative: 'snapshot-only-negative' }] } } },
  ];
  return fixture(t, entries, async ({ call }) => {
    const items = (await call('search_prompt_library_items', { section: 'items' })).items;
    assert.deepEqual(items.map(item => item.pureEligibility.reason), ['eligible', 'mixed', 'unmarked', 'negative_only', 'empty_prompt']);
    const negative = items.find(item => item.id === 'negative');
    assert.equal(negative.prompt, ''); assert.equal(negative.negativePrompt, 'bad anatomy');
    assert.equal(negative.polarity, 'negative'); assert.equal(negative.negativePromptField, 'basePrompt');
    assert.deepEqual((await call('search_prompt_library_items', { purposes: ['clothing', 'pose'], purposeMatch: 'all' })).items.map(item => item.id), ['mixed']);
    assert.equal((await call('search_prompt_library_items', { purposes: ['clothing', 'pose'] })).total, 4);
    assert.deepEqual((await call('search_prompt_library_items', { pure: true })).items.map(item => item.id), ['pure']);
    assert.equal((await call('search_prompt_library_items', { section: 'originals' })).items[0].id, 'original');
    for (const query of ['snapshot-only-body', 'snapshot-only-negative']) {
      const page = await call('search_prompt_library_items', { section: 'all', query });
      assert.equal(page.total, 1); assert.equal(page.items[0].section, 'saved');
      assert.equal(page.items[0].pureEligibility.reason, 'non_fragment');
      assert.equal(page.items[0].snapshot.field, 'params._rollContentSnapshot');
    }
    await assert.rejects(call('search_prompt_library_items', { purposeMatch: 'guess' }), /匹配方式/);
  });
});

test('创建更新超过4000字的正负词原样提交，不裁切或折叠换行', t => fixture(t, [fragment('entry')], async ({ call, writes }) => {
  const prompt = '🌧️, 1.2::red dress::\n'.repeat(600);
  const negativePrompt = 'bad anatomy,\n'.repeat(600);
  await call('create_prompt_library_item', { name: '长片段', prompt, negativePrompt, directoryIds: [] });
  await call('update_prompt_library_item', { id: 'entry', prompt, negativePrompt });
  for (const write of writes) {
    assert.equal(write.basePrompt, prompt);
    assert.equal(write.negativePrompt, negativePrompt);
  }
}));

test('组合用途读取canonical unitId及明确旧角色栏，不从itemId/目录或正文猜测', t => {
  const entries = [
    { id: 'scoped', type: 'preset', name: '跨角色组合', params: { _rollContentSnapshot: { format: 'nai-roll-content', version: 2, items: [
      { itemId: 'character:purpose:clothing', unitId: 'purpose:clothing', scope: 'character', text: 'snapshot dress', negative: 'snapshot coat' },
      { itemId: 'global:purpose:pose', unitId: 'purpose:pose', scope: 'global', text: 'walking' },
      { unitId: 'directory:rain', directoryName: '服饰', text: 'red dress', negative: '' },
    ] } } },
    { id: 'legacy', type: 'preset', name: '旧角色组合', params: { _rollContentSnapshot: { format: 'nai-roll-content', version: 1,
      roles: [{ provided: { wardrobe: true, expression: false }, sections: { wardrobe: 'legacy dress', expression: 'smile' } }],
      global: { scene: { provided: true, text: 'rainy room' }, camera: { provided: true, text: 'composition' } },
    } } },
  ];
  return fixture(t, entries, async ({ call }) => {
    const page = await call('search_prompt_library_items', { section: 'saved', purposes: ['clothing'] });
    assert.deepEqual(page.items.map(item => item.id), ['scoped', 'legacy']);
    assert.deepEqual(page.items[0].purposes, ['clothing', 'pose']);
    assert.deepEqual(page.items[1].purposes, ['clothing']);
    assert.equal(page.items[0].pureEligibility.reason, 'non_fragment');
    assert.deepEqual(page.items[0].pureEligibility.purposes, page.items[0].purposes);
    const both = await call('search_prompt_library_items', { section: 'all', purposes: ['clothing', 'pose'], purposeMatch: 'all', query: 'snapshot coat' });
    assert.deepEqual(both.items.map(item => item.id), ['scoped']);
    assert.equal((await call('search_prompt_library_items', { section: 'saved', purposes: ['camera', 'place', 'expression'] })).total, 0);
    assert.equal((await call('search_prompt_library_items', { section: 'saved', purposes: ['clothing'], pure: true })).total, 0);
  });
});

test('通用资料三类摘要limit100使用effectiveLimit与nextPage，不受回执数组预算跳项', t => fixture(t, [], async ({ service }) => {
  const kinds = ['chains', 'inspirations', 'artists'];
  const rows = Object.fromEntries(kinds.map(kind => [kind, Array.from({ length: 47 }, (_, index) => ({
    id: `${kind}-${index}`, name: '合成资料' + index, description: '备注'.repeat(150), tags: Array.from({ length: 40 }, (_, tag) => '标签' + tag), rating: 'favorite', isPinned: true, archived: false,
  }))]));
  const requests = [];
  const tool = service.createTools({ params: {} }, {}, () => {}, { requestJson: async path => {
    const query = new URL(path, 'https://synthetic.test').searchParams;
    const page = Number(query.get('page')), limit = Number(query.get('limit'));
    requests.push({ page, limit });
    return { page, limit, hasMore: Object.fromEntries(kinds.map(kind => [kind, (page + 1) * limit < rows[kind].length])),
      ...Object.fromEntries(kinds.map(kind => [kind, rows[kind].slice(page * limit, (page + 1) * limit)])) };
  } }).find(tool => tool.name === 'search_project_library');
  const ids = Object.fromEntries(kinds.map(kind => [kind, []]));
  let page = 0;
  do {
    const result = JSON.parse((await tool.execute('test', { kind: 'all', page, limit: 100 })).content[0].text);
    assert.equal(result._agentNotice, undefined);
    assert.equal(result.effectiveLimit, 5);
    assert.equal(result.inspirations[0].rating, 'favorite');
    assert.equal(result.inspirations[0].isPinned, true);
    assert.equal(result.inspirations[0].archived, false);
    for (const kind of kinds) ids[kind].push(...result[kind].map(item => item.id));
    if (result.nextPage === null) break;
    page = result.nextPage;
  } while (true);
  for (const kind of kinds) assert.deepEqual(ids[kind], rows[kind].map(item => item.id));
  assert.ok(requests.every(request => request.limit === 5));
}));

test('真实库回执可折叠且保留目录分页与长字段ID/offset恢复信息，原配对和全文不改', t => fixture(t,
  Array.from({ length: 4 }, (_, index) => fragment(String(index), { basePrompt: 'weighted prompt, '.repeat(700) })), async ({ call }) => {
    const cases = [
      ['get_prompt_library_directories', { offset: 0 }],
      ['search_prompt_library_items', { offset: 0 }],
      ['get_chain', { id: '0', field: 'basePrompt', offset: 127, limit: 2000 }],
    ];
    const messages = [];
    for (const [name, args] of cases) {
      const result = await call(name, args);
      const text = JSON.stringify(result);
      assert.ok(text.length > 800);
      messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: name, name, arguments: args }] },
        { role: 'toolResult', toolName: name, toolCallId: name, content: [{ type: 'text', text }] });
    }
    const original = structuredClone(messages);
    const folded = foldAgentToolResults(messages, 3);
    assert.equal(folded.folded, 3);
    assert.deepEqual(messages, original);
    for (let index = 0; index < cases.length; index++) {
      const [tool] = cases[index];
      assert.equal(folded.messages[index * 2], messages[index * 2]);
      const receipt = folded.messages[index * 2 + 1];
      assert.equal(receipt.toolCallId, tool);
      const result = JSON.parse(receipt.content[0].text);
      assert.match(result.libraryRead.note, /nextOffset/);
      assert.equal(result.libraryRead.offset, cases[index][1].offset);
      if (tool === 'get_chain') {
        assert.equal(result.libraryRead.id, '0');
        assert.equal(result.libraryRead.field, 'basePrompt');
        assert.equal(result.libraryRead.nextOffset, 2127);
        const reread = await call(tool, result.libraryRead);
        assert.equal(reread.content, JSON.parse(messages[index * 2 + 1].content[0].text).content);
      }
    }
  }));

test('新用途响应强制显式数组，[]有别于缺字段且不裁长正负词；旧生成兼容', () => {
  const parse = item => parseLibraryResponse(JSON.stringify({ items: [item] }), 1, { requirePurposes: true });
  for (const purposes of [undefined, null, 'clothing', {}]) assert.throws(() => parse({ prompt: 'dress', ...(purposes === undefined ? {} : { purposes }) }), /明确的用途 Tag 数组/);
  assert.deepEqual(parse({ prompt: 'dress', purposes: [] })[0].purposes, []);
  assert.throws(() => parse({ prompt: 'dress', purposes: ['invented'] }), /用途 Tag 无效/);
  assert.throws(() => parse({ prompt: '', purposes: ['invented'] }), /用途 Tag 无效/);
  assert.equal(parseLibraryResponse('{"items":[{"prompt":"legacy dress"}]}')[0].prompt, 'legacy dress');
  const prompt = 'weighted_dress, '.repeat(600).trim(), negativePrompt = 'bad_anatomy, '.repeat(600).trim();
  const item = parse({ prompt, negativePrompt, purposes: ['clothing'] })[0];
  assert.equal(item.prompt, prompt); assert.equal(item.negativePrompt, negativePrompt);
});

test('两个用途生成入口都拒绝模型漏标，显式空数组可返回；模型边界完全合成', t => fixture(t, [], async ({ service }) => {
  await service.saveCustomProvider({ id: 'synthetic-library', name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'synthetic' }], apiKey: 'synthetic', select: true });
  const previousFetch = globalThis.fetch;
  let purposes;
  globalThis.fetch = async () => new Response('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic',
    choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify({ items: [{ prompt: 'dress', ...(purposes === undefined ? {} : { purposes }) }] }) }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  try {
    for (const method of ['generateLibraryPrompt', 'generateLibraryBundle']) {
      purposes = undefined;
      await assert.rejects(service[method]({ purposes: ['clothing'], brief: '合成衣服' }), /明确的用途 Tag 数组/);
      purposes = [];
      assert.deepEqual((await service[method]({ purposes: ['clothing'], brief: '合成衣服' })).items[0].purposes, []);
    }
  } finally { globalThis.fetch = previousFetch; }
}));
