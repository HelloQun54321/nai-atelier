import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { PromptAgentService, buildLibrarySystemPrompt, parseDirectoryLibraryResponse, buildPurposeLibraryPrompt, parseLibraryResponse } from '../../scripts/prompt-agent.mjs';
import { AGENT_TOOL_GROUPS } from '../../scripts/agent-runtime.mjs';
import { createDefaultPromptLibraryTree, getPromptLibraryDefaultSelection, selectPromptLibraryDirectoryEntries } from '../../services/promptLibraryTree.mjs';

const directories = { revision: 4, nodes: [
  { id: 'custom', parentId: null, name: '我的创作', target: 'character' },
  { id: 'rain', parentId: 'custom', name: '雨中关系' },
  { id: 'deep', parentId: 'rain', name: '牵手' },
  { id: 'lighting', parentId: null, name: '光的表现', target: 'global' },
] };
const isolated = async (t, fn) => {
  const root = createWorkspace('agent-directories-');
  t.after(() => removeWorkspace(root));
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  service.appendAuditLog = async () => {};
  await fn(service);
};
const content = result => JSON.parse(result.content[0].text);

test('Agent独立呈现形式读写保持风格、主负面与动态用途顺序', t => isolated(t, async service => {
  for (const mode of ['text-to-image', 'image-to-image']) {
    const style = 'artist:original, watercolor, warm light';
    const subject = 'rain, close-up, split panel';
    const draft = { target: { mode }, basePrompt: mode === 'text-to-image' ? style : `${style}, ${subject}`, subjectPrompt: subject, negativePrompt: 'lowres, bad anatomy', params: { _promptSections: { scene: 'rain', presentation: 'split panel', 'purpose:camera': 'close-up', sectionNegatives: { presentation: 'single panel' } } } };
    const tools = service.createTools(draft, { clientSettings: { promptClassificationEnabled: true } }, () => {}, {});
    const before = content(await tools.find(tool => tool.name === 'get_lab_state').execute('t', {}));
    assert.equal(before.promptSections.presentation, 'split panel');
    const update = tools.find(tool => tool.name === 'update_prompts');
    await update.execute('t', { sections: { presentation: 'comic layout' } });
    assert.equal(draft.negativePrompt, 'lowres, bad anatomy');
    assert.equal(draft.params._promptSections.presentation, 'comic layout');
    assert.equal(draft.params._promptSections.sectionNegatives.presentation, 'single panel');
    assert.equal(mode === 'text-to-image' ? draft.subjectPrompt : draft.basePrompt, mode === 'text-to-image' ? 'rain, close-up, comic layout' : `${style}, rain, close-up, comic layout`);
    if (mode === 'text-to-image') assert.equal(draft.basePrompt, style);
  }
}));

test('只读工具实时读取完整自定义树和父目录实际候选，不写入或补造固定类', t => isolated(t, async service => {
  service.config.permissionMode = 'read_only';
  const requests = [];
  const entries = [
    { id: 'a', type: 'preset', name: '同行', basePrompt: 'holding hands', negativePrompt: 'alone', params: { _promptLibraryDirectoryIds: ['deep', 'rain'] } },
    { id: 'b', type: 'preset', name: '散落片段', basePrompt: 'rain', params: { _promptLibraryDirectoryIds: [] } },
    { id: 'c', type: 'style', name: '原文', params: { _promptLibraryOriginal: 1 } },
  ];
  const tools = service.createTools({ params: {} }, {}, () => {}, { requestJson: async (path, options) => {
    requests.push({ path, options });
    return path === '/api/prompt-library/directories' ? directories : entries;
  } });
  const call = async (name, args = {}) => content(await tools.find(tool => tool.name === name).execute('t', args));
  const tree = await call('get_prompt_library_directories');
  assert.deepEqual(tree.directories.find(item => item.directoryId === 'deep').directoryPath, ['我的创作', '雨中关系', '牵手']);
  assert.ok(AGENT_TOOL_GROUPS.library.includes('search_prompt_library_items'));
  const selected = await call('search_prompt_library_items', { directoryIds: ['custom'] });
  assert.equal(selected.total, 1);
  assert.equal(selected.items[0].prompt, 'holding hands');
  assert.equal(selected.items[0].negativePrompt, 'alone');
  assert.equal(selected.items[0].directories[0].target, 'character');
  assert.deepEqual((await call('search_prompt_library_items', { directoryIds: [] })).items.map(item => item.id), ['b']);
  assert.equal((await call('search_prompt_library_items')).total, 2);
  await assert.rejects(call('search_prompt_library_items', { directoryIds: ['deleted'] }), /目录不存在/);
  assert.ok(requests.every(request => !request.options?.method));
}));

test('片段创建更新使用真实目录、多归属和显式未归类，未知目录阻止写入且prompt实际更新', t => isolated(t, async service => {
  const writes = [];
  const current = { id: 'fragment', type: 'preset', params: { _promptLibraryDirectoryIds: ['rain'], kept: true }, basePrompt: 'before' };
  const tools = service.createTools({ params: {} }, {}, () => {}, { requestJson: async (path, options) => {
    if (path === '/api/prompt-library/directories') return directories;
    if (!options?.method) return current;
    writes.push({ path, body: options.body }); return { id: options.body.id || 'fragment' };
  } });
  const create = tools.find(tool => tool.name === 'create_prompt_library_item');
  const update = tools.find(tool => tool.name === 'update_prompt_library_item');
  await create.execute('t', { name: '雨中同行', prompt: 'holding hands', directoryIds: ['deep', 'rain', 'deep'] });
  assert.deepEqual(writes[0].body.params._promptLibraryDirectoryIds, ['deep', 'rain']);
  assert.equal(writes[0].body.type, 'preset');
  await update.execute('t', { id: 'fragment', prompt: 'new prompt', directoryIds: [] });
  assert.equal(writes[1].body.basePrompt, 'new prompt');
  assert.equal(writes[1].body.params.kept, true);
  assert.deepEqual(writes[1].body.params._promptLibraryDirectoryIds, []);
  await assert.rejects(create.execute('t', { name: 'x', prompt: 'x', directoryIds: ['missing'] }), /目录不存在/);
  await assert.rejects(create.execute('t', { name: 'x', prompt: 'x', directoryIds: null }), /必须是数组/);
  await assert.rejects(update.execute('t', { id: 'fragment', params: { _promptLibraryDirectoryIds: ['missing'] } }), /目录不存在/);
  assert.equal(writes.length, 2);
  service.config.permissionMode = 'read_only';
  await assert.rejects(create.execute('t', { name: 'x', prompt: 'x', directoryIds: ['deep'] }), /只读/);
}));

test('生成预览依据当前路径与选择，响应携带目录快照且未知或未选目录不静默丢弃', t => isolated(t, async service => {
  const systemPrompt = buildLibrarySystemPrompt(undefined, { directories, directoryId: 'deep', keepEmpty: true });
  assert.match(systemPrompt, /我的创作/); assert.match(systemPrompt, /雨中关系/); assert.match(systemPrompt, /牵手/);
  assert.match(systemPrompt, /不套用固定六类/); assert.match(systemPrompt, /保持留空/);
  const preview = await service.generateLibraryBundle({ directories, directoryIds: ['rain', 'deep', 'lighting'], brief: '一起走过雨巷', dryRun: true });
  assert.deepEqual(preview.missing, ['rain', 'lighting']);
  assert.match(preview.systemPrompt, /光的表现/);
  const context = { tree: directories, selected: ['deep'] };
  const items = parseDirectoryLibraryResponse(JSON.stringify({ items: [{ directoryId: 'deep', prompt: 'holding hands', name: '牵手' }] }), context);
  assert.deepEqual(items[0].directoryPath, ['我的创作', '雨中关系', '牵手']);
  assert.equal(items[0].directoryName, '牵手');
  assert.equal(items[0].target, 'character');
  assert.equal(items[0].kind, undefined);
  for (const directoryId of ['missing', 'lighting']) assert.throws(() => parseDirectoryLibraryResponse(JSON.stringify({ items: [{ directoryId, prompt: 'rain' }] }), context), /未知或未选择/);
  await assert.rejects(service.generateLibraryBundle({ directories, directoryIds: [], brief: 'x', dryRun: true }), /选择参与搭配/);
  assert.throws(() => buildLibrarySystemPrompt('wardrobe', { directories, directoryId: 'deleted' }), /目录不存在/);
}));

test('AI全选与随机搭配共用当前末级目录，预设和任意深度生成结果均可从同一范围取用', t => isolated(t, async service => {
  const custom = { revision: 5, nodes: [...directories.nodes.map(node => node.id === 'deep' ? { ...node, name: '用户改名' } : node),
    { id: 'deeper', parentId: 'deep', name: '四层细分' },
  ] };
  for (const tree of [createDefaultPromptLibraryTree(), custom]) {
    const selected = getPromptLibraryDefaultSelection(tree);
    for (const directoryIds of [undefined, null]) {
      const preview = await service.generateLibraryBundle({ directories: tree, directoryIds, brief: '合成画面', dryRun: true });
      assert.deepEqual(preview.missing, selected);
    }
    const items = parseDirectoryLibraryResponse(JSON.stringify({ items: selected.map(directoryId => ({ directoryId, prompt: 'synthetic content' })) }), { tree, selected });
    const entries = items.map((item, index) => ({ id: String(index), type: 'preset', params: { _promptLibraryDirectoryIds: [item.directoryId] } }));
    for (const id of selected) assert.equal(selectPromptLibraryDirectoryEntries(entries, tree, [id]).length, 1);
  }
  const parent = await service.generateLibraryBundle({ directories: custom, directoryIds: ['rain', 'deeper'], brief: '父目录整段', dryRun: true });
  assert.deepEqual(parent.missing, ['rain']);
  const empty = { revision: 6, nodes: [] };
  await assert.rejects(service.generateLibraryBundle({ directories: empty, brief: '不恢复预设', dryRun: true }), /选择参与搭配/);
}));

test('角色动态分栏、负面和目录来源及v2组合快照经过Agent工具完整保留', t => isolated(t, async service => {
  const draft = { params: {} };
  const snapshot = { format: 'nai-roll-content', version: 2, items: [{ unitId: 'directory:deep', directoryId: 'deep', directoryName: '牵手', directoryPath: ['我的创作', '雨中关系', '牵手'], scope: 'character', text: 'holding hands', negative: 'alone', constraintNotes: '同行', meta: { entryId: 'a' } }] };
  const tools = service.createTools(draft, {}, () => {}, { requestJson: async () => ({ id: 'bundle', params: { _rollContentSnapshot: snapshot } }) });
  await tools.find(tool => tool.name === 'set_characters').execute('t', { characters: [{ id: 'role', prompt: '', sections: { 'directory:deep': 'holding hands' }, sectionNegatives: { 'directory:deep': 'alone' }, sectionMeta: { 'directory:deep': { directoryId: 'deep', directoryName: '牵手', directoryPath: ['我的创作', '雨中关系', '牵手'], entryId: 'a', notes: '同行' } } }] });
  assert.equal(draft.params.characters[0].sections['directory:deep'], 'holding hands');
  assert.equal(draft.params.characters[0].sectionNegatives['directory:deep'], 'alone');
  assert.deepEqual(draft.params.characters[0].sectionMeta['directory:deep'].directoryPath, ['我的创作', '雨中关系', '牵手']);
  const read = content(await tools.find(tool => tool.name === 'get_chain').execute('t', { id: 'bundle' }));
  assert.deepEqual(read.params._rollContentSnapshot, snapshot);
}));

test('导入分类先读取当前真实树，单次mock模型请求按路径分类并保留目录来源和空树兜底', t => isolated(t, async service => {
  await service.saveCustomProvider({ id: 'custom-directory-test', name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'a' }], apiKey: 'synthetic', select: true });
  const previousFetch = globalThis.fetch, requests = [], reads = [];
  let current = directories;
  const project = { requestJson: async path => { reads.push(path); return current; } };
  const documents = [
    { id: 'global', kind: 'global', prompt: 'artist:synthetic, soft light, other text' },
    { id: 'role', kind: 'character', prompt: 'holding hands, uncertain' },
  ];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    const classifications = current.nodes.length ? [
      { id: 'global', categories: ['purpose:artist', 'purpose:lighting', 'extra'] },
      { id: 'role', categories: ['purpose:interaction', 'extra'] },
    ] : [{ id: 'global', categories: ['purpose:artist', 'extra', 'extra'] }, { id: 'role', categories: ['extra', 'extra'] }];
    return new Response('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(classifications) }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const result = await service.classifyPrompts({ documents, directories: { invalid: 'stale request data' } }, project);
    assert.deepEqual(reads, ['/api/prompt-library/directories']);
    assert.equal(requests.length, 1);
    const prompt = requests[0].messages.find(message => message.role === 'system').content;
    assert.match(prompt, /固定用途/); assert.match(prompt, /不是用户文件夹/);
    const userContent = requests[0].messages.find(message => message.role === 'user').content;
    const sent = JSON.parse(typeof userContent === 'string' ? userContent : userContent.map(part => part.text || '').join(''));
    assert.ok(sent[0].categories.includes('purpose:artist'));
    assert.ok(sent[0].categories.includes('purpose:lighting'));
    assert.ok(sent[1].categories.includes('purpose:artist'));
    assert.ok(sent[1].categories.includes('purpose:lighting'));
    assert.equal(sent[1].directoryCategories.find(item => item.key === 'purpose:interaction').directoryName, '互动与关系');
    assert.equal(result.items[0].sections['purpose:lighting'], 'soft light');
    assert.equal(result.items[0].sections['purpose:artist'], 'artist:synthetic');
    assert.equal(result.items[1].sections.extra, 'uncertain');
    assert.equal(result.items[1].sectionMeta['purpose:interaction'].directoryName, '互动与关系');
    current = { revision: 5, nodes: [] };
    const emptyTree = await service.classifyPrompts({ documents }, project);
    assert.equal(requests.length, 2);
    assert.equal(Object.keys(emptyTree.items[0].sections).length, 23);
    assert.equal(Object.keys(emptyTree.items[1].sections).length, 23);
    await assert.rejects(service.classifyPrompts({ documents }, { requestJson: async () => { throw Error('目录读取失败'); } }), /目录读取失败/);
    assert.equal(requests.length, 2);
    assert.deepEqual(await service.classifyPrompts({ documents: [] }, { requestJson: async () => { throw Error('不应读取'); } }), { items: [] });
  } finally { globalThis.fetch = previousFetch; }
}));


test('固定用途生成不读文件夹语义，返回值拒绝未知 Tag', () => {
  const prompt = buildPurposeLibraryPrompt({ purposes: ['clothing'], directories });
  assert.match(prompt, /服饰与配件/);
  assert.doesNotMatch(prompt, /雨中关系/);
  assert.deepEqual(parseLibraryResponse(JSON.stringify({ items: [{ prompt: 'dress', purposes: ['clothing'] }] }))[0].purposes, ['clothing']);
  assert.throws(() => parseLibraryResponse(JSON.stringify({ items: [{ prompt: 'dress', purposes: ['custom'] }] })), /用途 Tag 无效/);
});

test('Agent 固定用途清单、纯用途查询、创建更新和分类栏位共用 ID', t => isolated(t, async service => {
  const writes = [];
  const pure = { id: 'a', type: 'preset', basePrompt: 'dress', params: { _promptLibraryDirectoryIds: [], _promptLibraryPurposes: ['clothing'] } };
  const mixed = { ...pure, id: 'b', params: { ...pure.params, _promptLibraryPurposes: ['clothing', 'pose'] } };
  const tools = service.createTools({ params: {} }, {}, () => {}, { requestJson: async (path, options) => {
    if (options?.method) { writes.push(options.body); return { id: 'a' }; }
    if (path === '/api/prompt-library/directories') return { revision: 1, nodes: [] };
    return path === '/api/chains' ? [pure, mixed] : pure;
  } });
  const call = async (name, args = {}) => content(await tools.find(tool => tool.name === name).execute('t', args));
  assert.equal((await call('get_prompt_library_directories')).purposes.length, 22);
  assert.deepEqual((await call('search_prompt_library_items', { purposes: ['clothing'], pure: true })).items.map(item => item.id), ['a']);
  assert.deepEqual((await call('search_prompt_library_items', { pure: true })).items.map(item => item.id), ['a']);
  await call('create_prompt_library_item', { name: 'dress', prompt: 'dress', purposes: ['clothing'], directoryIds: [] });
  assert.deepEqual(writes[0].params._promptLibraryPurposes, ['clothing']);
  await call('update_prompt_library_item', { id: 'a', purposes: ['clothing', 'pose'] });
  assert.deepEqual(writes[1].params._promptLibraryPurposes, ['clothing', 'pose']);
  await assert.rejects(call('update_prompt_library_item', { id: 'a', purposes: ['custom'] }), /用途 Tag 无效/);
  assert.equal(writes.length, 2);
}));
