import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { AGENT_TOOL_GROUPS } from '../../scripts/agent-runtime.mjs';

const toolsFor = (service, draft, project = {}, model) => {
  const tools = service.createTools(draft, {}, () => {}, project, model);
  return async (name, args = {}) => {
    const result = await tools.find(tool => tool.name === name).execute('synthetic', args);
    return JSON.parse(result.content[0].text);
  };
};

test('参考读取失败或编码失效整次保留草稿，明确空列表仍可清空', async () => {
  const root = createWorkspace('agent-reference-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const draft = { params: { vibes: { enabled: true, slots: [{ vibeId: 'original' }] }, characterReferences: { enabled: true, slots: [{ assetId: 'original' }] } } };
    const before = structuredClone(draft);
    const call = toolsFor(service, draft, { requestJson: async path => {
      if (path.endsWith('/valid')) return { item: { id: 'valid', encodings: [{ id: 'encoding', informationExtracted: 1 }] } };
      if (path.endsWith('/missing')) return { item: {} };
      throw new Error('synthetic read failure');
    } });
    for (const id of ['missing', 'failed']) {
      await assert.rejects(call('set_vibes', { slots: [{ vibeId: 'valid', encodingId: 'encoding', strength: 1 }, { vibeId: id, encodingId: 'bad', strength: 1 }] }));
      assert.deepEqual(draft, before);
      await assert.rejects(call('set_character_references', { slots: [{ assetId: 'valid' }, { assetId: id }] }));
      assert.deepEqual(draft, before);
    }
    await assert.rejects(call('set_vibes', { slots: [{ vibeId: 'valid', encodingId: 'missing', strength: 1 }] }));
    assert.deepEqual(draft, before);
    await call('set_vibes', { slots: [] });
    await call('set_character_references', { slots: [] });
    assert.deepEqual(draft.params.vibes.slots, []);
    assert.deepEqual(draft.params.characterReferences.slots, []);
  } finally { removeWorkspace(root); }
});

test('收藏读取保留归属，创建和更新直接传递归属增减而不覆盖未读取资料', async () => {
  const root = createWorkspace('agent-memberships-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const writes = [];
    const call = toolsFor(service, { params: {} }, { requestJson: async (path, options) => {
      if (options) { writes.push(options.body); return { id: 'saved' }; }
      if (path.startsWith('/api/local-history/')) return { item: { id: 'history', prompt: 'original' } };
      return { item: { id: 'saved', boardId: 'a', boardIds: ['a', 'b'], analysis: { boards: ['a', 'b'] } } };
    } });
    const read = await call('get_inspiration', { id: 'saved' });
    assert.deepEqual(read.boardIds, ['a', 'b']);
    assert.deepEqual(read.analysis, { boards: ['a', 'b'] });
    await call('create_inspiration', { title: '合成', historyId: 'history', boardIds: ['a', 'b'], addBoardIds: ['c'], removeBoardIds: ['b'] });
    assert.deepEqual(writes[0].boardIds, ['a', 'b']);
    assert.deepEqual(writes[0].addBoardIds, ['c']);
    assert.deepEqual(writes[0].removeBoardIds, ['b']);
    await call('update_inspiration', { id: 'saved', addBoardIds: ['d'], removeBoardIds: ['a'] });
    assert.equal(Object.hasOwn(writes[1], 'boardIds'), false);
    assert.deepEqual(writes[1].addBoardIds, ['d']);
    assert.deepEqual(writes[1].removeBoardIds, ['a']);
    await call('update_inspiration', { id: 'saved', boardId: 'legacy' });
    assert.equal(writes[2].boardId, 'legacy');
  } finally { removeWorkspace(root); }
});

test('能力报告区分模型工具状态和运行设备文件根', async () => {
  const root = createWorkspace('agent-capabilities-');
  try {
    for (const tools of [true, false, undefined]) {
      const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root, runtimePlatform: 'android' });
      const result = await toolsFor(service, { params: {} }, {}, { tools })('get_agent_capabilities');
      assert.equal(result.model.toolsStatus, tools === undefined ? 'unknown' : tools ? 'supported' : 'unsupported');
      assert.deepEqual(result.localImages.roots, ['/documents']);
    }
  } finally { removeWorkspace(root); }
});

test('收集浮窗无需页面连接，校验有限操作并执行真实服务，只读禁止控制', async () => {
  const root = createWorkspace('agent-collector-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const operations = [];
    const call = toolsFor(service, { params: {} }, {
      getStyleCollectorState: () => ({ available: true, running: true }),
      controlStyleCollector: (action, id) => { operations.push({ action, id }); return { available: true, running: true, mode: id }; },
    });
    assert.equal((await call('get_style_collector_state')).running, true);
    assert.equal((await call('control_style_collector', { action: 'mode', mode: 'content', category: 'scene' })).mode, 'content');
    assert.deepEqual(operations, [{ action: 'mode', id: 'content' }]);
    for (const args of [{ action: 'delete' }, { action: 'mode', mode: 'invalid' }, { action: 'category', category: 'invalid' }]) await assert.rejects(call('control_style_collector', args), /无效/);
    assert.equal(operations.length, 1);
    service.config.permissionMode = 'read_only';
    await assert.rejects(call('control_style_collector', { action: 'start' }), /只读/);
    assert.equal((await call('get_style_collector_state')).running, true);
  } finally { removeWorkspace(root); }
});

test('缺少收集服务或独立Android准确报告不可用，服务失败不伪报成功', async () => {
  const root = createWorkspace('agent-collector-unavailable-');
  try {
    for (const runtimePlatform of ['desktop', 'android']) {
      const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root, runtimePlatform });
      let calls = 0;
      const call = toolsFor(service, { params: {} }, runtimePlatform === 'android' ? {
        getStyleCollectorState: () => ({ available: false }), controlStyleCollector: () => { calls++; },
      } : {});
      assert.equal((await call('get_style_collector_state')).available, false);
      assert.equal((await call('get_agent_capabilities')).collector.available, false);
      await assert.rejects(call('control_style_collector', { action: 'start' }), /不支持|未连接/);
      assert.equal(calls, 0);
    }
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const call = toolsFor(service, { params: {} }, { getStyleCollectorState: () => ({ available: true }), controlStyleCollector: () => { throw new Error('synthetic collector failed'); } });
    await assert.rejects(call('control_style_collector', { action: 'start' }), /synthetic collector failed/);
  } finally { removeWorkspace(root); }
});

test('历史复用只规范化本轮工作正文，保留顺序并清除重复编译来源', async () => {
  const root = createWorkspace('agent-history-prompts-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const history = {
      id: 'history', basePrompt: 'artist', subjectPrompt: 'sky', negativePrompt: 'bad quality',
      modules: [{ id: 'pre', name: '前置', content: 'pre module', position: 'pre', isActive: true }],
      params: { model: 'nai-diffusion-4-5-full', _promptSections: { scene: 'sky', sectionNegatives: { scene: 'indoors' } }, characters: [{ id: 'c', prompt: 'girl', negativePrompt: 'hat', sections: { appearance: 'blue eyes' }, sectionNegatives: { appearance: 'red eyes' } }] },
    };
    const original = structuredClone(history);
    const draft = { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {}, target: { mode: 'text-to-image' } };
    await toolsFor(service, draft, { requestJson: async () => ({ item: history }) })('reuse_generation_history', { historyId: 'history' });
    assert.equal(draft.basePrompt, 'artist');
    assert.equal(draft.subjectPrompt, 'sky');
    assert.equal(draft.modules[0].id, 'pre');
    assert.equal(draft.modules[0].content, 'pre module');
    assert.match(draft.negativePrompt, /indoors/);
    assert.match(draft.params.characters[0].prompt, /blue eyes/);
    assert.match(draft.params.characters[0].negativePrompt, /red eyes/);
    assert.equal(draft.params._promptSections, undefined);
    assert.equal(draft.params.characters[0].sections, undefined);
    assert.deepEqual(history, original);
    service.searchTags = async () => [];
    const edit = service.createTools(draft, { clientSettings: { splitPromptFields: false } }, () => {}).find(tool => tool.name === 'update_prompts');
    const positive = { base: draft.basePrompt, subject: draft.subjectPrompt, modules: structuredClone(draft.modules) };
    await edit.execute('negative', { negativePrompt: 'new negative' });
    assert.deepEqual({ base: draft.basePrompt, subject: draft.subjectPrompt, modules: draft.modules }, positive);
    await edit.execute('positive', { basePrompt: 'new full prompt' });
    assert.equal(draft.subjectPrompt, '');
    assert.deepEqual(draft.modules, positive.modules);
  } finally { removeWorkspace(root); }
});

test('统一目录无需页面可分页读取30项、创建移动与增减归属，写权限及事件一致', async () => {
  const root = createWorkspace('agent-directories-tools-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    let state = { revision: 0, folders: Array.from({ length: 31 }, (_, index) => ({ id: `d${index}`, name: `目录${index}`, parentId: null })), assignments: { member: ['d0'] } };
    const events = [], requests = [];
    const requestJson = async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/chains') return { items: [{ id: 'member', type: 'style', name: '资料' }] };
      if (path === '/api/inspiration-boards') return { items: Array.from({ length: 31 }, (_, index) => ({ id: `b${index}`, name: `收藏夹${index}`, parentId: null })) };
      assert.equal(path, '/api/chain-folders');
      if (options) state = { ...structuredClone(options.body), revision: state.revision + 1 };
      return structuredClone(state);
    };
    const tools = service.createTools({ params: {} }, {}, event => events.push(event), { requestJson });
    const call = async (name, args) => JSON.parse((await tools.find(tool => tool.name === name).execute('directory', args)).content[0].text);
    for (const name of ['list_directories', 'get_directory_members', 'create_directory', 'update_directory', 'set_directory_memberships', 'request_delete_directory']) assert.ok(AGENT_TOOL_GROUPS.library.includes(name), name);
    const first = await call('list_directories', { scope: 'chains', limit: 30 });
    assert.equal(first.items.length, 30);
    assert.equal(first.nextOffset, 30);
    const second = await call('list_directories', { scope: 'chains', offset: first.nextOffset });
    assert.equal(second.items[0].id, 'd30');
    assert.equal(second.nextOffset, null);
    assert.deepEqual([...first.items, ...second.items].map(value => value.id), state.folders.map(value => value.id));
    const legacy = await call('list_inspiration_boards', { limit: 30 });
    assert.equal(legacy.items.length, 30);
    assert.equal(legacy.nextOffset, 30);
    assert.equal((await call('get_directory_members', { scope: 'chains', directoryId: 'd0' })).items[0].id, 'member');
    const created = await call('create_directory', { scope: 'chains', name: '新目录' });
    await call('update_directory', { scope: 'chains', id: created.id, name: '已改名', parentId: 'd1' });
    assert.equal(state.folders.find(value => value.id === created.id).parentId, 'd1');
    await call('set_directory_memberships', { scope: 'chains', memberIds: ['member'], addDirectoryIds: ['d1'], removeDirectoryIds: ['d0'] });
    assert.deepEqual(state.assignments.member, ['d1']);
    assert.ok(events.some(event => event.type === 'project_changed' && event.resource === 'chain_folders'));
    assert.ok(events.some(event => event.type === 'project_changed' && event.resource === 'chains'));
    service.config.permissionMode = 'read_only';
    const count = requests.length;
    for (const name of ['create_directory', 'update_directory', 'set_directory_memberships', 'request_delete_directory']) await assert.rejects(call(name, { scope: 'chains', id: 'd0', name: '拒绝', memberIds: ['member'] }), /只读/);
    assert.equal(requests.length, count);
    assert.equal((await call('list_directories', { scope: 'chains' })).scope, 'chains');
  } finally { removeWorkspace(root); }
});

test('目录删除必须绑定真实确认，执行时重读目录而不删除作品', async () => {
  const root = createWorkspace('agent-directory-confirm-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    let state = { revision: 0, folders: [{ id: 'parent', name: '父目录', parentId: null }, { id: 'child', name: '子目录', parentId: 'parent' }], assignments: { member: ['parent', 'child'] } };
    const writes = [], project = { requestJson: async (path, options) => {
      assert.equal(path, '/api/chain-folders');
      if (options) { writes.push(options.body); state = options.body; }
      return structuredClone(state);
    } };
    const input = { action: 'delete_directory', resourceId: 'parent', payload: { scope: 'chains', id: 'parent' }, sessionId: 's', confirmationRequestId: 'confirm' };
    await assert.rejects(service.executeConfirmedProjectAction(input, project), /确认令牌/);
    assert.equal(writes.length, 0);
    service.pendingConfirmations.set('confirm', { sessionId: 's', approved: true, expiresAt: Date.now() + 10000, resolve() {}, operation: { action: input.action, resourceId: input.resourceId, payload: input.payload } });
    const result = await service.executeConfirmedProjectAction(input, project);
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.deepEqual(state.folders, [{ id: 'child', name: '子目录', parentId: null }]);
    assert.deepEqual(state.assignments.member, ['child']);
  } finally { removeWorkspace(root); }
});

test('队列与反推无需页面可工作，只读可查，缺服务与scope不伪报成功', async () => {
  const root = createWorkspace('agent-direct-business-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    service.searchTags = async () => [{ tag: 'blue hair', chinese: '蓝发' }];
    const actions = [], bytes = Buffer.from('synthetic image');
    const call = toolsFor(service, { params: {} }, {
      generationQueue: async action => { actions.push(action); return { busy: true, paused: action === 'pause', completed: 1, total: 3 }; },
      requestJson: async () => ({ item: { id: 'history' } }), requestBuffer: async () => ({ buffer: bytes, mimeType: 'image/png' }),
      inspectImageTags: async (buffer, options) => { assert.deepEqual(buffer, bytes); assert.deepEqual(options, { threshold: .6 }); return { model: 'test', tags: [{ name: 'blue hair', confidence: .9 }], character: [], general: [{ name: 'blue hair', confidence: .9 }], rating: null }; },
    });
    assert.equal((await call('get_generation_status')).completed, 1);
    assert.equal((await call('control_generation', { action: 'pause' })).paused, true);
    await assert.rejects(call('control_generation', { action: 'cancel', scope: 'page' }), /scope/);
    assert.deepEqual(actions, ['read', 'pause']);
    service.config.permissionMode = 'read_only';
    const tagged = await call('inspect_image_tags', { source: 'project', kind: 'history', id: 'history', threshold: .6 });
    assert.equal(tagged.tags[0].chinese, '蓝发');
    assert.equal(tagged.general[0].chinese, '蓝发');
    assert.equal((await call('get_generation_status')).total, 3);
    await assert.rejects(call('control_generation', { action: 'resume' }), /只读/);
    const missing = toolsFor(service, { params: {} });
    await assert.rejects(missing('get_generation_status'), /未连接/);
    await assert.rejects(missing('inspect_image_tags', { source: 'project', kind: 'history', id: 'history' }), /未连接/);
  } finally { removeWorkspace(root); }
});

test('组合分类独立于片段目录，真实包装保留长字段续读与归属完整回执', async () => {
  const root = createWorkspace('agent-combination-tools-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const longName = '组合目录'.repeat(1000);
    const events = [], operations = [];
    const tools = service.createTools({ params: {} }, {}, event => events.push(event), { requestJson: async (path, options) => {
      operations.push({ path, options });
      if (path === '/api/chain-folders') return { revision: 1, folders: [{ id: 'long', name: longName, parentId: null }], assignments: {} };
      if (path === '/api/chains') return { items: [{ id: 'combo', name: '组合', tags: ['*'], params: { _rollContentSnapshot: { format: 'nai-roll-content' } } }, { id: 'fragment', type: 'appearance', tags: ['*'], params: {} }] };
      assert.equal(path, '/api/prompt-library-category-tree/actions');
      if (options?.body.action === 'memberships') return { ok: true, completedIds: options.body.itemIds, failedItems: [] };
      return { tree: { revision: 1, nodes: [{ id: '*', name: '*', parentId: null }, { id: '分类', name: '分类', parentId: null }] } };
    } });
    const call = async (name, args) => JSON.parse((await tools.find(tool => tool.name === name).execute('combo', args)).content[0].text);
    const listed = await call('list_directories', { scope: 'chains' });
    const partial = listed.items.find(value => value.id === 'long');
    assert.ok(partial.partialFields.includes('name'));
    assert.equal(listed.nextOffset, null);
    let offset = 0, content = '';
    do {
      const page = await call('list_directories', { scope: 'chains', directoryId: 'long', field: 'name', offset });
      content += page.content;
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(JSON.parse(content), longName);
    assert.equal((await call('list_directories', { scope: 'combinations' })).items.length, 2);
    const members = await call('get_directory_members', { scope: 'combinations', directoryId: '*' });
    assert.deepEqual(members.items.map(value => value.id), ['combo']);
    const result = await call('set_directory_memberships', { scope: 'combinations', memberIds: ['combo'], addDirectoryIds: ['*'] });
    assert.deepEqual(result.completedIds, ['combo']);
    assert.deepEqual(result.failedItems, []);
    assert.ok(events.some(event => event.resource === 'prompt_library_directories'));
    assert.ok(events.some(event => event.resource === 'chains'));
    assert.equal(operations.some(operation => operation.path === '/api/prompt-library/directories'), false);
  } finally { removeWorkspace(root); }
});

test('Roll与样张持久资料只读工具无需页面，完整模板可续读且不冒充运行状态', async () => {
  const root = createWorkspace('agent-creative-direct-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    service.config.permissionMode = 'read_only';
    const template = { prompt: 'long prompt '.repeat(1500) };
    const call = toolsFor(service, { params: {} }, { requestJson: async path => {
      if (path.startsWith('/api/style-roll?')) return { kind: 'experiments', items: [{ id: 'roll' }], nextOffset: null, experiment: { id: 'roll', template } };
      assert.equal(path, '/api/artist-sample-data');
      return { templates: { v5: template }, samples: [{ id: 'sample', pack: 'v5', tag: 'artist', imageUrl: '/api/assets/sample', createdAt: 1 }] };
    } });
    const roll = await call('get_roll_state');
    assert.equal(roll.items[0].id, 'roll');
    assert.equal(roll.runtime.status, 'not_queried');
    const sample = await call('get_artist_sample_status', { tag: 'artist', pack: 'v5' });
    assert.equal(sample.samples[0].id, 'sample');
    assert.equal(sample.runtime.status, 'not_queried');
    for (const [name, args] of [['get_roll_state', { experimentId: 'roll' }], ['get_artist_sample_status', { tag: 'artist', pack: 'v5' }]]) {
      let offset = 0, text = '';
      do { const page = await call(name, { ...args, field: 'template', fieldOffset: offset }); text += page.text; offset = page.nextOffset; } while (offset !== null);
      assert.deepEqual(JSON.parse(text), template);
    }
  } finally { removeWorkspace(root); }
});

test('确认删除部分完成不冒充成功，大回执仅同轮续读且新一轮拒绝旧结果编号', async () => {
  const root = createWorkspace('agent-directory-receipt-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    const audits = [], events = [];
    service.appendAuditLog = async (_sessionId, event) => { audits.push(event); };
    const nodes = Array.from({ length: 41 }, (_, index) => ({ id: `child${index}`, name: `child${index}`, parentId: null }));
    const fullResult = { ok: false, partial: true, completedIds: ['done'], failedItems: [{ id: 'failed', status: 409, error: 'synthetic conflict' }], tree: { revision: 2, nodes } };
    const project = { agentSessionId: 's', keyHash: 'synthetic', requestJson: async (path, options) => {
      assert.equal(path, '/api/prompt-library-category-tree/actions');
      return options ? fullResult : { tree: { revision: 1, nodes: [{ id: 'parent', name: 'parent', parentId: null }, ...nodes] } };
    } };
    let execution;
    const tools = service.createTools({ params: {} }, {}, event => {
      events.push(event);
      if (event.type !== 'action' || event.action.kind !== 'request_project_action') return;
      const patch = event.action.patch;
      service.pendingConfirmations.get(patch.requestId).approved = true;
      execution = service.executeConfirmedProjectAction({ sessionId: 's', confirmationRequestId: patch.requestId, action: patch.action, resourceId: patch.resourceId, payload: patch.payload }, project);
    }, project);
    const call = async (name, args) => JSON.parse((await tools.find(tool => tool.name === name).execute('receipt', args)).content[0].text);
    const removed = await call('request_delete_directory', { scope: 'combinations', id: 'parent' });
    const executed = await execution;
    assert.equal(executed.ok, false);
    assert.equal(executed.success, false);
    assert.equal(executed.outcome, 'partial');
    assert.equal(removed.ok, false);
    assert.equal(removed.confirmed, true);
    assert.equal(removed.partial, true);
    assert.ok(audits.some(event => event.type === 'project_action_partial'));
    assert.equal(audits.some(event => event.type === 'project_action_completed'), false);
    assert.ok(events.some(event => event.resource === 'prompt_library_directories'));
    assert.ok(events.some(event => event.resource === 'chains'));
    const resultId = removed.result.resultId;
    assert.ok(resultId);
    let offset = 0, content = '';
    do { const page = await call('list_directories', { scope: 'combinations', resultId, field: 'result', offset }); content += page.content; offset = page.nextOffset; } while (offset !== null);
    const restored = JSON.parse(content);
    assert.deepEqual(restored.tree, fullResult.tree);
    assert.deepEqual(restored.completedIds, ['done']);
    assert.deepEqual(restored.failedItems, fullResult.failedItems);
    await assert.rejects(toolsFor(service, { params: {} }, project)('list_directories', { scope: 'combinations', resultId, field: 'result' }), /过期|不存在/);
  } finally { removeWorkspace(root); }
});

test('旧收藏夹新增修改排序和确认删除都发布目录刷新事件', async () => {
  const root = createWorkspace('agent-board-events-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    service.appendAuditLog = async () => {};
    const events = [], project = { agentSessionId: 's', requestJson: async (_path, options) => options ? { item: { id: 'b', ...options.body } } : { items: [{ id: 'b', name: '收藏夹', parentId: null }] } };
    let execution;
    const tools = service.createTools({ params: {} }, {}, event => {
      events.push(event);
      if (event.type !== 'action' || event.action.kind !== 'request_project_action') return;
      const patch = event.action.patch;
      service.pendingConfirmations.get(patch.requestId).approved = true;
      execution = service.executeConfirmedProjectAction({ sessionId: 's', confirmationRequestId: patch.requestId, action: patch.action, resourceId: patch.resourceId, payload: patch.payload }, project);
    }, project);
    for (const [index, [name, args]] of [
      ['create_inspiration_board', { name: '新夹' }], ['update_inspiration_board', { id: 'b', name: '改名' }], ['reorder_inspiration_boards', { ids: ['b'] }], ['delete_inspiration_board', { id: 'b' }],
    ].entries()) {
      await tools.find(tool => tool.name === name).execute('board', args);
      assert.equal(events.filter(event => event.resource === 'inspiration_boards').length, index + 1);
    }
    await execution;
  } finally { removeWorkspace(root); }
});
