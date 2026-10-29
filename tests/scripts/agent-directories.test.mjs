import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentDirectories } from '../../scripts/agent-directories.mjs';
import { boundAgentToolResult } from '../../scripts/agent-runtime.mjs';

const clone = value => structuredClone(value);
const nodes = () => [{ id: 'root', name: '父目录', parentId: null }, { id: 'child', name: '子目录', parentId: 'root' }, { id: 'other', name: '其他', parentId: null }];
const fixture = () => {
  const state = {
    '/api/chain-folders': { revision: 0, folders: nodes(), assignments: { chain: ['child', 'other'] } },
    '/api/catalog-groups/artist': { revision: 0, groups: nodes(), memberships: { 'artist:one': ['child', 'other'], 'artist:stale': ['root'] } },
    '/api/catalog-groups/character': { revision: 0, groups: nodes(), memberships: { 'catalog:alice': ['child'], 'custom:custom': ['other'] } },
    '/api/prompt-library/directories': { revision: 0, nodes: [...nodes(), { id: 'person-appearance', name: '原外貌', parentId: null }] },
    '/api/inspiration-boards': { treeRevision: 0, items: nodes() },
    '/api/chains': [{ id: 'chain', name: '串', type: 'style' }, { id: 'custom', name: '自定义角色', type: 'character', tags: [] }, { id: 'override', name: '词库覆写', type: 'character', tags: ['__character_catalog__'] }, { id: 'prompt', name: '片段', type: 'appearance', params: { untouched: 7 } }],
    '/api/inspirations': [{ id: 'image', title: '图片', boardIds: ['child', 'other'] }, { id: 'archived', title: '已归档', archived: true, boardIds: ['child'] }],
  };
  const calls = []; let failPath;
  const request = async (path, options = {}) => {
    calls.push({ path, ...clone(options) });
    if (path === failPath) throw Object.assign(new Error('synthetic failure'), { status: 409 });
    if (!options.method || options.method === 'GET') { if (!(path in state)) throw Error('unexpected GET ' + path); return clone(state[path]); }
    if (options.method === 'PUT' && path in state && 'revision' in state[path]) {
      assert.equal(options.body.revision, state[path].revision); state[path] = { ...clone(options.body), revision: state[path].revision + 1 }; return clone(state[path]);
    }
    if (path === '/api/inspiration-boards' && options.method === 'POST') { state[path].items.push(clone(options.body)); return { item: clone(options.body), treeRevision: ++state[path].treeRevision }; }
    const board = path.match(/^\/api\/inspiration-boards\/(.+)$/);
    if (board) {
      const list = state['/api/inspiration-boards'];
      if (options.method === 'PUT') Object.assign(list.items.find(value => value.id === board[1]), options.body);
      else if (options.method === 'DELETE') list.items = list.items.filter(value => value.id !== board[1]);
      return { success: true, treeRevision: ++list.treeRevision };
    }
    if (path === '/api/prompt-library/directory-memberships') {
      for (const id of options.body.itemIds) { const value = state['/api/chains'].find(value => value.id === id); value.params._promptLibraryDirectoryIds = options.body.addDirectoryIds; }
      return { ok: true, completedIds: options.body.itemIds, failedItems: [] };
    }
    const image = path.match(/^\/api\/inspirations\/(.+)$/);
    if (image && options.method === 'PUT') { const value = state['/api/inspirations'].find(value => value.id === image[1]); value.boardIds = [...new Set([...value.boardIds, ...options.body.addBoardIds])].filter(id => !options.body.removeBoardIds.includes(id)); return { success: true }; }
    throw Error('unexpected mutation ' + path);
  };
  const api = createAgentDirectories(request, { catalogMembers: async scope => scope === 'artists' ? [{ id: 'artist:one', name: 'one' }, { id: 'artist:two', name: 'two' }] : [{ id: 'catalog:alice', name: 'Alice' }] });
  return { api, state, calls, fail: path => { failPath = path; }, request };
};

test('五类完整目录直接读取真实层级，分页续读不依赖页面和模型', async () => {
  const { api, calls } = fixture();
  for (const scope of ['chains', 'artists', 'characters', 'prompts', 'inspirations']) {
    let offset = 0; const all = [];
    do { const result = await api.list({ scope, offset, limit: 1 }); all.push(...result.items); offset = result.nextOffset; } while (offset !== null);
    assert.deepEqual(all.find(value => value.id === 'child'), { id: 'child', name: '子目录', parentId: 'root', path: ['父目录', '子目录'] });
    assert.equal(new Set(all.map(value => value.id)).size, all.length);
  }
  assert.ok(calls.every(value => !value.method));
  await assert.rejects(api.list({ scope: '__proto__' }), /scope/);
  await assert.rejects(api.list({ scope: 'chains', offset: -1 }), /偏移/);
});

test('成员包含后代可切换，保留真实身份、未分组，排除失效Tag与目录覆写伪自定义', async () => {
  const { api } = fixture();
  assert.deepEqual((await api.members({ scope: 'chains', directoryId: 'root' })).items.map(value => value.id), ['chain']);
  assert.equal((await api.members({ scope: 'chains', directoryId: 'root', includeDescendants: false })).total, 0);
  assert.deepEqual((await api.members({ scope: 'artists', directoryId: '' })).items.map(value => value.id), ['artist:two']);
  assert.deepEqual((await api.members({ scope: 'artists', directoryId: 'root' })).items.map(value => value.id), ['artist:one']);
  assert.deepEqual((await api.members({ scope: 'characters' })).items.map(value => value.id), ['catalog:alice', 'custom:custom']);
  assert.deepEqual((await api.members({ scope: 'prompts', directoryId: 'person-appearance' })).items.map(value => value.id), ['prompt']);
  assert.deepEqual((await api.members({ scope: 'inspirations', directoryId: 'root' })).items.map(value => value.id), ['image']);
  await assert.rejects(api.members({ scope: 'artists', directoryId: 'missing' }), /不存在/);
});

test('预算分页保留续读，超长路径和成员归属支持分段读取完整JSON', async () => {
  const { api, state } = fixture();
  const tree = Array.from({ length: 100 }, (_, index) => ({ id: `d${index}`, name: '长'.repeat(50), parentId: index ? `d${index - 1}` : null }));
  state['/api/chain-folders'].folders = tree;
  state['/api/chain-folders'].assignments = { chain: tree.map(value => value.id) };
  const result = await api.list({ scope: 'chains', directoryId: 'd99' });
  assert.deepEqual(result.items[0].partialFields, ['path']); assert.equal(result.items[0].path, undefined);
  let offset = 0, content = '';
  do { const chunk = await api.list({ scope: 'chains', directoryId: 'd99', field: 'path', offset }); content += chunk.content; offset = chunk.nextOffset; } while (offset !== null);
  assert.equal(JSON.parse(content).length, 100);
  const member = await api.members({ scope: 'chains', memberId: 'chain', field: 'directoryIds' }); assert.equal(JSON.parse(member.content).length, 100);
  let cursor = 0, count = 0;
  do { const chunk = await api.list({ scope: 'chains', offset: cursor, limit: 30 }); assert.ok(JSON.stringify(chunk).length < 13500); count += chunk.items.length; cursor = chunk.nextOffset; } while (cursor !== null);
  assert.equal(count, 100);
  state['/api/chains'][0].name = '旧长名称'.repeat(4000);
  const long = await api.members({ scope: 'chains' }); assert.deepEqual(long.items[0].partialFields, ['name', 'directoryIds']); assert.ok(JSON.stringify(long).length < 13500);
  let nameOffset = 0, name = '';
  do { const part = await api.members({ scope: 'chains', memberId: 'chain', field: 'name', offset: nameOffset }); name += part.content; nameOffset = part.nextOffset; } while (nameOffset !== null);
  assert.equal(JSON.parse(name), state['/api/chains'][0].name);
});

test('真实最终工具预算处理不漏目录或嵌套归属，超量写入在任何执行前拒绝', async () => {
  const { api, state, calls } = fixture();
  const tree = Array.from({ length: 101 }, (_, index) => ({ id: `d${index}`, name: '名', parentId: index ? `d${index - 1}` : null }));
  state['/api/chain-folders'].folders = tree; state['/api/chain-folders'].assignments.chain = tree.map(value => value.id);
  let offset = 0; const ids = [];
  do {
    const result = await api.list({ scope: 'chains', offset, limit: 30 });
    const bounded = JSON.parse(boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(result) }] }).content[0].text);
    assert.deepEqual(bounded, result); ids.push(...bounded.items.map(value => value.id)); offset = bounded.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, tree.map(value => value.id));
  const result = await api.members({ scope: 'chains' }); assert.deepEqual(result.items[0].partialFields, ['directoryIds']);
  assert.deepEqual(JSON.parse(boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(result) }] }).content[0].text), result);
  await assert.rejects(api.setMemberships({ scope: 'chains', memberIds: Array.from({ length: 31 }, (_, index) => `c${index}`), addDirectoryIds: ['d0'] }), /30/);
  assert.ok(calls.every(value => !value.method));
});

test('创建改名移动用真实revision，拒绝循环、重复名、无效节点且不改其他字段', async () => {
  const { api, state, calls } = fixture();
  for (const scope of ['chains', 'artists', 'characters', 'prompts', 'inspirations']) {
    const created = await api.create({ scope, name: '新增', parentId: 'child', ...(scope === 'prompts' ? { target: 'character' } : {}) });
    await api.update({ scope, id: created.id, name: '改名', parentId: null });
    const result = await api.list({ scope, directoryId: created.id }); assert.equal(result.items[0].name, '改名'); assert.equal(result.items[0].parentId, null);
    await assert.rejects(api.update({ scope, id: 'root', parentId: 'child' }), /循环/);
    if (scope !== 'inspirations') await assert.rejects(api.create({ scope, name: '其他' }), /同名/);
    await assert.rejects(api.update({ scope, id: 'unknown', name: '错误' }), /不存在/);
  }
  assert.deepEqual(state['/api/chain-folders'].assignments.chain, ['child', 'other']);
  assert.ok(calls.some(value => value.method === 'PUT' && value.body.revision === 1));
});

test('revision冲突停止，不重试旧整树，不覆盖并发新增目录', async () => {
  const { state, request } = fixture(); let writes = 0;
  const api = createAgentDirectories(async (path, options) => {
    if (options?.method === 'PUT') { writes++; state[path].folders.push({ id: 'concurrent', name: '并发目录', parentId: null }); state[path].revision++; throw Object.assign(Error('conflict'), { status: 409 }); }
    return request(path, options);
  });
  await assert.rejects(api.update({ scope: 'chains', id: 'root', name: '新名称' }), /conflict/);
  assert.equal(writes, 1); assert.equal(state['/api/chain-folders'].folders[0].name, '父目录'); assert.ok(state['/api/chain-folders'].folders.some(value => value.id === 'concurrent'));
});

test('归属只增减指定关系；提示词走原子专用接口，拒绝无效成员及自相矛盾变更', async () => {
  const { api, state, calls } = fixture();
  await api.setMemberships({ scope: 'chains', memberIds: ['chain'], addDirectoryIds: ['root'], removeDirectoryIds: ['child'] });
  assert.deepEqual(state['/api/chain-folders'].assignments.chain, ['other', 'root']);
  await api.setMemberships({ scope: 'artists', memberIds: ['artist:one'], addDirectoryIds: ['root'] });
  assert.deepEqual(state['/api/catalog-groups/artist'].memberships['artist:one'], ['child', 'other', 'root']);
  await api.setMemberships({ scope: 'characters', memberIds: ['custom:custom'], addDirectoryIds: ['child'] });
  assert.deepEqual(state['/api/catalog-groups/character'].memberships['custom:custom'], ['other', 'child']);
  await api.setMemberships({ scope: 'inspirations', memberIds: ['image'], addDirectoryIds: ['root'], removeDirectoryIds: ['child'] });
  assert.deepEqual(state['/api/inspirations'][0].boardIds, ['other', 'root']);
  await api.setMemberships({ scope: 'prompts', memberIds: ['prompt'], addDirectoryIds: ['child'] });
  assert.equal(state['/api/chains'].find(value => value.id === 'prompt').params.untouched, 7);
  assert.deepEqual(calls.find(value => value.path === '/api/prompt-library/directory-memberships').body, { itemIds: ['prompt'], addDirectoryIds: ['child'], removeDirectoryIds: [] });
  await assert.rejects(api.setMemberships({ scope: 'artists', memberIds: ['artist:unknown'], addDirectoryIds: ['root'] }), /成员不存在/);
  await assert.rejects(api.setMemberships({ scope: 'chains', memberIds: ['chain'], addDirectoryIds: ['root'], removeDirectoryIds: ['root'] }), /同时/);
});

test('收藏逐项失败返回实际完成范围，不把部分成功报成全部成功', async () => {
  const { api, state, fail } = fixture(); state['/api/inspirations'].push({ id: 'later', title: '后一张', boardIds: [] }); fail('/api/inspirations/later');
  const result = await api.setMemberships({ scope: 'inspirations', memberIds: ['image', 'later'], addDirectoryIds: ['root'] });
  assert.equal(result.ok, false); assert.equal(result.partial, true); assert.deepEqual(result.completedIds, ['image']); assert.deepEqual(result.remainingIds, ['later']);
});

test('提示词批次准确保留服务部分成功回执，不重放成功项或伪造完整成功', async () => {
  const { request, state } = fixture(); state['/api/chains'].push({ id: 'second', name: '另一片段', type: 'appearance', params: {} });
  let posts = 0;
  const api = createAgentDirectories(async (path, options) => {
    if (path === '/api/prompt-library/directory-memberships') { posts++; return { ok: false, completedIds: ['prompt'], failedItems: [{ id: 'second', status: 409, error: '并发变化' }] }; }
    return request(path, options);
  });
  const result = await api.setMemberships({ scope: 'prompts', memberIds: ['prompt', 'second'], addDirectoryIds: ['root'] });
  assert.equal(result.ok, false); assert.equal(result.partial, true); assert.deepEqual(result.completedIds, ['prompt']); assert.deepEqual(result.remainingIds, ['second']); assert.equal(posts, 1);
  const invalid = createAgentDirectories(async (path, options) => path === '/api/prompt-library/directory-memberships' ? { ok: true, completedIds: [], failedItems: [] } : request(path, options));
  await assert.rejects(invalid.setMemberships({ scope: 'prompts', memberIds: ['prompt'], addDirectoryIds: ['root'] }), /回执/);
});

test('三十项归属的成功和逐项失败范围经最终预算处理仍完整', async () => {
  const { state, request } = fixture();
  const members = Array.from({ length: 30 }, (_, index) => ({ id: `entry-${index}`, name: `条目${index}`, type: 'appearance', params: {} }));
  state['/api/chains'].push(...members);
  const api = createAgentDirectories(async (path, options) => path === '/api/prompt-library/directory-memberships' ? { ok: false, completedIds: [], failedItems: options.body.itemIds.map(id => ({ id, status: 409, error: '长错误'.repeat(1000) })) } : request(path, options));
  const result = await api.setMemberships({ scope: 'prompts', memberIds: members.map(value => value.id), addDirectoryIds: ['root'] });
  const bounded = JSON.parse(boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(result) }] }).content[0].text);
  assert.deepEqual(bounded, result); assert.equal(bounded.failedItems.length, 30); assert.equal(bounded.remainingIds.length, 30);
  const success = createAgentDirectories(request);
  state['/api/chains'].push(...members.map(value => ({ ...value, id: `style-${value.id}`, type: 'style' })));
  const done = await success.setMemberships({ scope: 'chains', memberIds: members.map(value => `style-${value.id}`), addDirectoryIds: ['root'] });
  assert.deepEqual(JSON.parse(boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(done) }] }).content[0].text), done); assert.equal(done.completedIds.length, 30);
});

test('独立删除只解除所选目录关系并提升子目录，不删除成员；提示词保留原作用域', async () => {
  const { api, state, calls } = fixture();
  state['/api/chain-folders'].folders.push({ id: 'collision', name: '子目录', parentId: null });
  await api.remove({ scope: 'chains', id: 'root' });
  const child = state['/api/chain-folders'].folders.find(value => value.id === 'child'); assert.equal(child.parentId, null); assert.equal(child.name, '子目录 (2)');
  assert.deepEqual(state['/api/chain-folders'].assignments.chain, ['child', 'other']);
  state['/api/prompt-library/directories'].nodes[0].target = 'character';
  await api.remove({ scope: 'prompts', id: 'root' });
  assert.equal(state['/api/prompt-library/directories'].nodes.find(value => value.id === 'child').target, 'character');
  await api.remove({ scope: 'artists', id: 'child' });
  assert.deepEqual(state['/api/catalog-groups/artist'].memberships['artist:one'], ['other']);
  assert.equal(state['/api/chains'].length, 4); assert.ok(calls.every(value => value.method !== 'DELETE'));
  await assert.rejects(api.remove({ scope: 'characters', id: 'missing' }), /不存在/);
});

test('目录损坏或词库不可用明确失败，不拿空或部分目录冒充完整', async () => {
  const { api, state, request } = fixture(); state['/api/chain-folders'].folders[0].parentId = 'child';
  await assert.rejects(api.list({ scope: 'chains' }), /循环/);
  const missingCatalog = createAgentDirectories(request);
  await assert.rejects(missingCatalog.members({ scope: 'artists' }), /词库/);
});

test('组合分类使用完整投影API，保留旧标签、空分类、真实星号身份；CRUD与归属直接业务执行', async () => {
  const { request, state, calls } = fixture();
  const endpoint = '/api/prompt-library-category-tree/actions';
  let tree = { revision: 4, nodes: [{ id: '旧根', name: '旧根', parentId: null }, { id: '*', name: '*', parentId: '旧根' }, { id: '空分类', name: '空分类', parentId: null }] };
  state['/api/chains'].push({ id: 'combination', name: '组合', tags: ['*', '__internal__', 'pixiv'], params: { _rollContentSnapshot: { format: 'nai-roll-content' } } }, { id: 'original', name: '原文', tags: ['*'], params: { _promptLibraryOriginal: true } });
  const actions = [];
  const api = createAgentDirectories(async (path, options) => {
    if (path !== endpoint) return request(path, options);
    if (!options) return { tree: clone(tree) };
    const body = options.body; actions.push(clone(body));
    if (body.action === 'create') tree.nodes.push({ id: body.name, name: body.name, parentId: body.parentId ?? null });
    if (body.action === 'update') tree.nodes = tree.nodes.map(value => value.id === body.id ? { id: body.name ?? value.id, name: body.name ?? value.name, parentId: body.parentId ?? null } : value);
    if (body.action === 'delete') tree.nodes = tree.nodes.filter(value => value.id !== body.id);
    if (body.action === 'memberships') return { ok: true, completedIds: body.itemIds, failedItems: [] };
    tree.revision++; return { ok: true, completedIds: [], failedItems: [], tree: clone(tree) };
  });
  assert.deepEqual((await api.list({ scope: 'combinations' })).items.map(value => value.id), ['旧根', '*', '空分类']);
  assert.deepEqual((await api.members({ scope: 'combinations', directoryId: '*' })).items.map(value => value.id), ['combination']);
  assert.deepEqual((await api.members({ scope: 'combinations', directoryId: '旧根' })).items[0].directoryIds, ['*']);
  assert.equal((await api.members({ scope: 'combinations', directoryId: '空分类' })).total, 0);
  const created = await api.create({ scope: 'combinations', name: '新增', parentId: '旧根' }); assert.equal(created.id, '新增');
  await api.update({ scope: 'combinations', id: '新增', name: '改名', parentId: null });
  await api.setMemberships({ scope: 'combinations', memberIds: ['combination'], addDirectoryIds: ['改名'] });
  await api.remove({ scope: 'combinations', id: '改名' });
  assert.deepEqual(actions.map(value => value.action), ['create', 'update', 'memberships', 'delete']);
  assert.ok(calls.every(value => !value.method));
  await assert.rejects(api.create({ scope: 'combinations', name: '错误', target: 'character' }), /target/);
  const beforeConflict = actions.length;
  await assert.rejects(api.update({ scope: 'combinations', id: '*', name: '旧根' }), /不能.*合并/);
  assert.equal(actions.length, beforeConflict);
});

test('组合大量改名或删除的完整回执只在同次run的受控Map续读，不丢失部分完成范围', async () => {
  const value = { ok: false, completedIds: Array.from({ length: 80 }, (_, index) => `done-${index}`), failedItems: [{ id: 'failed', status: 409, error: '并发变化' }], tree: { revision: 7, nodes: [{ id: '分类', name: '分类', parentId: null }] } };
  const request = async (_path, options) => options ? clone(value) : { tree: { revision: 6, nodes: [{ id: '分类', name: '分类', parentId: null }] } };
  const resultStore = new Map(), api = createAgentDirectories(request, { resultStore });
  const result = await api.update({ scope: 'combinations', id: '分类', name: '新分类' });
  assert.equal(result.completedCount, 80); assert.equal(result.partial, true); assert.ok(result.resultId);
  assert.deepEqual(JSON.parse(boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(result) }] }).content[0].text), result);
  const reopened = createAgentDirectories(request, { resultStore });
  let offset = 0, content = '';
  do { const chunk = await reopened.list({ scope: 'combinations', resultId: result.resultId, field: 'result', offset }); assert.deepEqual(JSON.parse(boundAgentToolResult({ content: [{ type: 'text', text: JSON.stringify(chunk) }] }).content[0].text), chunk); content += chunk.content; offset = chunk.nextOffset; } while (offset !== null);
  assert.equal(JSON.parse(content).completedIds.length, 80); assert.deepEqual(JSON.parse(content).failedItems, value.failedItems);
  await assert.rejects(createAgentDirectories(request, { resultStore: new Map() }).list({ scope: 'combinations', resultId: result.resultId, field: 'result' }), /不属于/);
  await assert.rejects(reopened.list({ scope: 'chains', resultId: result.resultId, field: 'result' }), /不属于/);
});
