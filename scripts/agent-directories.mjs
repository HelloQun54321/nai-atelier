import { randomUUID } from 'node:crypto';
import { compactAgentValue } from './agent-runtime.mjs';
import { flattenDirectoryTree, getDirectoryDescendantIds, validateDirectoryTree } from '../services/directoryTree.mjs';
import { getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry, readPromptLibraryTree, removePromptLibraryDirectory } from '../services/promptLibraryTree.mjs';

const scopes = {
  chains: { endpoint: '/api/chain-folders', nodes: 'folders', memberships: 'assignments', max: 500, name: 60 },
  artists: { endpoint: '/api/catalog-groups/artist', nodes: 'groups', memberships: 'memberships', max: 500, name: 60 },
  characters: { endpoint: '/api/catalog-groups/character', nodes: 'groups', memberships: 'memberships', max: 500, name: 60 },
  prompts: { endpoint: '/api/prompt-library/directories', nodes: 'nodes', max: 2000, name: 100 },
  combinations: { endpoint: '/api/prompt-library-category-tree/actions', nodes: 'nodes', max: Number.MAX_SAFE_INTEGER, name: 200 },
  inspirations: { endpoint: '/api/inspiration-boards', nodes: 'items', max: Number.MAX_SAFE_INTEGER, name: 80 },
};
const items = value => Array.isArray(value) ? value : value?.items;
const offsetOf = value => { if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error('分页偏移必须为非负整数'); return value || 0; };
const idOf = value => { if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('资料 ID 无效'); return value; };
const arrayIds = value => { if (!Array.isArray(value) || value.length > 30) throw new Error('单次最多处理 30 个 ID，请分批继续'); return [...new Set(value.map(idOf))]; };
const pathOf = id => encodeURIComponent(idOf(id));
const page = (values, args) => {
  const offset = offsetOf(args.offset), limit = args.limit === undefined ? 25 : args.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error('每页数量必须为 1 到 30');
  const result = []; let size = 0;
  for (const original of values.slice(offset, offset + limit)) {
    const value = { ...original }, partialFields = [];
    for (const field of ['name', 'path', 'directoryIds']) if (JSON.stringify(value[field] || []).length > 2500 || Array.isArray(value[field]) && value[field].length > 30) { delete value[field]; partialFields.push(field); }
    if (partialFields.length) { value.partial = true; value.partialFields = partialFields; }
    const length = JSON.stringify(value).length;
    if (result.length && (size + length > 12000 || compactAgentValue({ scope: 'inspirations', revision: 0, directoryId: 'x'.repeat(512), includeDescendants: true, items: [...result, value], offset, total: values.length, nextOffset: offset + result.length + 1 }).omitted)) break;
    result.push(value); size += length;
  }
  return { items: result, offset, total: values.length, nextOffset: offset + result.length < values.length ? offset + result.length : null };
};
const fieldPage = (value, args) => {
  const content = JSON.stringify(value), offset = offsetOf(args.offset);
  return { field: args.field, format: 'json', content: content.slice(offset, offset + 3500), offset, totalChars: content.length, nextOffset: offset + 3500 < content.length ? offset + 3500 : null };
};

/** 目录业务直接复用已有 API；catalogMembers 只注入公开词库身份，不读取私人磁盘资料。 */
export function createAgentDirectories(requestJson, { catalogMembers, resultStore = new Map() } = {}) {
  const receipts = resultStore;
  const receipt = value => {
    if (JSON.stringify(value).length <= 12000 && !compactAgentValue(value).omitted) return value;
    const resultId = randomUUID(); receipts.set(resultId, value);
    while (receipts.size > 4) receipts.delete(receipts.keys().next().value);
    return { scope: value.scope, id: value.id, operation: value.operation, ok: value.ok, partial: value.ok === false && (value.completedIds?.length || 0) > 0, completedCount: value.completedIds?.length ?? null, failedCount: value.failedItems?.length ?? null, resultId, note: '操作回执较长，请用 list_directories(scope,resultId,field:result,offset) 续读完整JSON；不重放已成功操作' };
  };
  const config = scope => { const value = scopes[scope]; if (!Object.hasOwn(scopes, scope)) throw new Error('目录 scope 无效'); return value; };
  const load = async scope => {
    const spec = config(scope), response = await requestJson(spec.endpoint), state = scope === 'combinations' ? response.tree : response;
    const nodes = state?.[spec.nodes];
    if (!Array.isArray(nodes) || nodes.length > spec.max || nodes.some(node => !node || typeof node.name !== 'string' || !node.name.trim())) throw new Error('目录数据不完整或无效');
    nodes.forEach(node => idOf(node.id)); validateDirectoryTree(nodes);
    if (scope === 'prompts') readPromptLibraryTree(state);
    if (scope !== 'inspirations' && (!Number.isSafeInteger(state.revision) || state.revision < 0)) throw new Error('目录版本无效');
    if (spec.memberships && (!state[spec.memberships] || typeof state[spec.memberships] !== 'object' || Array.isArray(state[spec.memberships]))) throw new Error('目录归属数据不完整');
    return { spec, state, nodes };
  };
  const node = (snapshot, id) => { const found = snapshot.nodes.find(value => value.id === id); if (!found) throw new Error('目录不存在，请读取最新目录'); return found; };
  const validateNodes = (scope, nodes) => {
    const spec = config(scope);
    if (nodes.length > spec.max || nodes.some(value => typeof value.name !== 'string' || !value.name.trim() || value.name.length > spec.name || /[\u0000-\u001f\u007f]/u.test(value.name))) throw new Error('目录名称无效或目录数量超限');
    if (scope !== 'inspirations' && new Set(nodes.map(value => JSON.stringify([value.parentId ?? null, value.name.toLocaleLowerCase()]))).size !== nodes.length) throw new Error('同一位置已有同名目录');
    validateDirectoryTree(nodes);
  };
  const save = async (scope, snapshot, nodes, memberships) => {
    validateNodes(scope, nodes);
    const body = { ...snapshot.state, [snapshot.spec.nodes]: nodes, ...(memberships ? { [snapshot.spec.memberships]: memberships } : {}) };
    if (scope === 'prompts') readPromptLibraryTree(body);
    // 只提交刚读到的版本；并发冲突原样失败，不能重放旧整树覆盖新数据。
    return requestJson(snapshot.spec.endpoint, { method: 'PUT', body });
  };
  const allMembers = async (scope, snapshot) => {
    if (scope === 'inspirations') {
      const result = items(await requestJson('/api/inspirations')); if (!Array.isArray(result)) throw new Error('收藏列表不完整');
      return result.filter(value => !value.archived).map(value => ({ id: String(value.id), name: value.title || value.name || '', directoryIds: value.boardIds ?? value.analysis?.collectionBoardIds ?? (value.boardId ? [value.boardId] : []) }));
    }
    const result = scope === 'artists' ? [] : items(await requestJson('/api/chains')); if (!Array.isArray(result)) throw new Error('资料列表不完整');
    if (scope === 'chains') return result.filter(value => !value.type || value.type === 'style').map(value => ({ id: String(value.id), name: value.name, directoryIds: snapshot.state.assignments[value.id] || [] }));
    if (scope === 'combinations') {
      const known = new Set(snapshot.nodes.map(value => value.id));
      return result.filter(value => value.params?._rollContentSnapshot && typeof value.params._rollContentSnapshot === 'object' && !Array.isArray(value.params._rollContentSnapshot) && value.params._rollContentSnapshot.format === 'nai-roll-content').map(value => ({ id: String(value.id), name: value.name, directoryIds: [...new Set((value.tags || []).filter(id => known.has(id)))] }));
    }
    if (scope === 'prompts') return result.filter(isPromptLibraryFragmentEntry).map(value => ({ id: String(value.id), name: value.name, directoryIds: getPromptLibraryEntryDirectoryIds(value, snapshot.state) }));
    if (!catalogMembers) throw new Error('目录词库服务不可用，不能把部分成员当成完整名单');
    const catalog = await catalogMembers(scope);
    if (!Array.isArray(catalog)) throw new Error('目录词库名单不完整');
    const values = catalog.map(value => typeof value === 'string' ? { id: value, name: value.slice(value.indexOf(':') + 1) } : { id: value.id, name: value.name });
    if (scope === 'characters') values.push(...result.filter(value => value.type === 'character' && !value.tags?.includes('__character_catalog__')).map(value => ({ id: `custom:${value.id}`, name: value.name })));
    const known = new Map();
    for (const value of values) {
      idOf(value.id);
      if (!(scope === 'artists' ? /^artist:.+/u : /^(catalog|custom):.+/u).test(value.id)) throw new Error('目录成员身份无效');
      known.set(value.id, { ...value, directoryIds: snapshot.state.memberships[value.id] || [] });
    }
    return [...known.values()];
  };
  const list = async args => {
    config(args.scope);
    if (args.resultId !== undefined) {
      const value = receipts.get(args.resultId);
      if (!value || value.scope !== args.scope) throw new Error('操作回执不存在或不属于当前会话、Key与目录范围，请回读实际资料');
      if (args.field !== 'result') throw new Error('操作回执续读须指定 field:result');
      return { scope: args.scope, resultId: args.resultId, ...fieldPage(value, args) };
    }
    const snapshot = await load(args.scope), values = flattenDirectoryTree(snapshot.nodes).map(value => ({ id: value.id, name: value.name, parentId: value.parentId ?? null, path: value.path, ...(value.target ? { target: value.target } : {}) }));
    if (args.directoryId !== undefined) node(snapshot, args.directoryId);
    if (args.field !== undefined) {
      if (!['name', 'path'].includes(args.field) || !args.directoryId) throw new Error('分段目录字段只支持指定 directoryId 的 name/path');
      return { scope: args.scope, id: args.directoryId, ...fieldPage(values.find(value => value.id === args.directoryId)[args.field], args) };
    }
    return { scope: args.scope, revision: snapshot.state.revision ?? snapshot.state.treeRevision, ...page(args.directoryId !== undefined ? values.filter(value => value.id === args.directoryId) : values, args) };
  };
  const members = async args => {
    const snapshot = await load(args.scope), values = await allMembers(args.scope, snapshot);
    if (args.memberId !== undefined) {
      const value = values.find(value => value.id === args.memberId); if (!value) throw new Error('目录成员不存在');
      if (!['name', 'directoryIds'].includes(args.field)) throw new Error('成员分段字段只支持 name/directoryIds');
      return { scope: args.scope, id: args.memberId, ...fieldPage(value[args.field], args) };
    }
    const directoryId = args.directoryId ?? '*', all = args.directoryId === undefined || directoryId === '*' && args.scope !== 'combinations'; let selected;
    if (!all && directoryId !== '') { node(snapshot, directoryId); selected = args.includeDescendants === false ? new Set([directoryId]) : getDirectoryDescendantIds(snapshot.nodes, directoryId); }
    const filtered = values.filter(value => all || directoryId === '' && !value.directoryIds.length || selected && value.directoryIds.some(id => selected.has(id)));
    return { scope: args.scope, revision: snapshot.state.revision ?? snapshot.state.treeRevision, directoryId, includeDescendants: args.includeDescendants !== false, ...page(filtered, args) };
  };
  const create = async args => {
    const snapshot = await load(args.scope), id = randomUUID();
    if (args.target !== undefined && args.scope !== 'prompts') throw new Error('只有提示词目录支持 target');
    if (args.scope === 'combinations') {
      if (snapshot.nodes.some(value => value.id === args.name?.trim())) throw new Error('同名组合分类已存在');
      const result = await requestJson(snapshot.spec.endpoint, { method: 'POST', body: { action: 'create', name: args.name, ...(args.parentId !== undefined ? { parentId: args.parentId } : {}) } });
      return receipt({ ...result, scope: args.scope, id: args.name?.trim(), operation: 'create' });
    }
    const value = { id, name: typeof args.name === 'string' ? args.name.trim() : '', parentId: args.parentId ?? null, ...(args.target !== undefined ? { target: args.target } : {}) };
    validateNodes(args.scope, [...snapshot.nodes, value]);
    const result = args.scope === 'inspirations'
      ? await requestJson(snapshot.spec.endpoint, { method: 'POST', body: value })
      : await save(args.scope, snapshot, [...snapshot.nodes, value]);
    return { ok: true, scope: args.scope, id, operation: 'create', revision: result.revision ?? result.treeRevision };
  };
  const update = async args => {
    const snapshot = await load(args.scope); node(snapshot, args.id);
    if (args.target !== undefined && args.scope !== 'prompts') throw new Error('只有提示词目录支持 target');
    if (args.scope === 'combinations') {
      if (args.name !== undefined && args.name.trim() !== args.id && snapshot.nodes.some(value => value.id === args.name.trim())) throw new Error('同名组合分类已存在，不能通过改名静默合并');
      const result = await requestJson(snapshot.spec.endpoint, { method: 'POST', body: { action: 'update', id: args.id, ...(args.name !== undefined ? { name: args.name } : {}), ...(args.parentId !== undefined ? { parentId: args.parentId } : {}) } });
      return receipt({ ...result, scope: args.scope, id: args.name?.trim() ?? args.id, operation: 'update' });
    }
    const patch = {};
    if (args.name !== undefined) patch.name = typeof args.name === 'string' ? args.name.trim() : '';
    if (args.parentId !== undefined) patch.parentId = args.parentId;
    if (args.target !== undefined) { if (args.scope !== 'prompts') throw new Error('只有提示词目录支持 target'); patch.target = args.target; }
    if (!Object.keys(patch).length) throw new Error('没有要修改的目录字段');
    const nodes = snapshot.nodes.map(value => value.id === args.id ? { ...value, ...patch } : value); validateNodes(args.scope, nodes);
    const result = args.scope === 'inspirations' ? await requestJson(`${snapshot.spec.endpoint}/${pathOf(args.id)}`, { method: 'PUT', body: patch }) : await save(args.scope, snapshot, nodes);
    return { ok: true, scope: args.scope, id: args.id, operation: 'update', revision: result.revision ?? result.treeRevision };
  };
  const setMemberships = async args => {
    const snapshot = await load(args.scope), memberIds = arrayIds(args.memberIds), add = arrayIds(args.addDirectoryIds ?? []), remove = arrayIds(args.removeDirectoryIds ?? []);
    if (JSON.stringify([memberIds, add, remove]).length > 3000) throw new Error('本次归属 ID 文字总量过长，请缩小批次');
    if (!memberIds.length || !add.length && !remove.length) throw new Error('请指定成员和需要增减的归属');
    for (const id of [...add, ...remove]) node(snapshot, id);
    if (add.some(id => remove.includes(id))) throw new Error('不能同时增加和移除同一归属');
    const known = new Set((await allMembers(args.scope, snapshot)).map(value => value.id));
    if (memberIds.some(id => !known.has(id))) throw new Error('目录成员不存在，请读取最新成员名单');
    if (snapshot.spec.memberships) {
      const memberships = { ...snapshot.state[snapshot.spec.memberships] };
      for (const id of memberIds) { const ids = new Set(memberships[id] || []); add.forEach(value => ids.add(value)); remove.forEach(value => ids.delete(value)); if (ids.size) memberships[id] = [...ids]; else delete memberships[id]; }
      await save(args.scope, snapshot, snapshot.nodes, memberships);
      return { ok: true, scope: args.scope, operation: 'memberships', completedIds: memberIds };
    }
    if (args.scope === 'prompts' || args.scope === 'combinations') {
      const result = await requestJson(args.scope === 'prompts' ? '/api/prompt-library/directory-memberships' : snapshot.spec.endpoint, { method: 'POST', body: { ...(args.scope === 'combinations' ? { action: 'memberships' } : {}), itemIds: memberIds, addDirectoryIds: add, removeDirectoryIds: remove } });
      if (!Array.isArray(result?.completedIds) || !Array.isArray(result.failedItems) || typeof result.ok !== 'boolean') throw new Error('提示词归属回执无效，请回读实际结果，不能直接重放整批');
      const completed = new Set(result.completedIds), failed = result.failedItems.map(value => value.id);
      if (completed.size !== result.completedIds.length || completed.size + failed.length !== memberIds.length || [...completed, ...failed].some(id => !memberIds.includes(id)) || memberIds.some(id => completed.has(id) === failed.includes(id)) || result.ok !== (completed.size === memberIds.length)) throw new Error('提示词归属回执范围不完整，请回读实际结果');
      return { ok: result.ok, completedIds: result.completedIds, failedItems: result.failedItems.map(value => ({ id: value.id, status: value.status, error: String(value.error || '').slice(0, 160) })), scope: args.scope, operation: 'memberships', partial: completed.size > 0 && !result.ok, remainingIds: memberIds.filter(id => !completed.has(id)) };
    }
    const completedIds = [];
    for (const id of memberIds) {
      try {
        await requestJson(`/api/inspirations/${pathOf(id)}`, { method: 'PUT', body: { addBoardIds: add, removeBoardIds: remove } });
        completedIds.push(id);
      } catch (error) { return { ok: false, partial: completedIds.length > 0, scope: args.scope, operation: 'memberships', completedIds, failedId: id, remainingIds: memberIds.slice(completedIds.length), error: error.message.slice(0, 160) }; }
    }
    return { ok: true, scope: args.scope, operation: 'memberships', completedIds };
  };
  // 调用方必须先取得删除授权；这里只执行目录删除，绝不删除成员资料。
  const remove = async args => {
    const snapshot = await load(args.scope), current = node(snapshot, args.id);
    if (args.scope === 'combinations') {
      const result = await requestJson(snapshot.spec.endpoint, { method: 'POST', body: { action: 'delete', id: args.id } });
      return receipt({ ...result, scope: args.scope, id: args.id, operation: 'delete', membersDeleted: false });
    }
    if (args.scope === 'inspirations') await requestJson(`${snapshot.spec.endpoint}/${pathOf(args.id)}`, { method: 'DELETE' });
    else if (args.scope === 'prompts') await save(args.scope, snapshot, removePromptLibraryDirectory(snapshot.state, args.id).nodes);
    else {
      const names = new Set(snapshot.nodes.filter(value => value.id !== args.id && (value.parentId ?? null) === (current.parentId ?? null)).map(value => value.name.toLocaleLowerCase()));
      const nodes = snapshot.nodes.filter(value => value.id !== args.id).map(value => {
        if (value.parentId !== args.id) return value;
        let name = value.name, suffix = 2;
        while (names.has(name.toLocaleLowerCase())) { const ending = ` (${suffix++})`; name = value.name.slice(0, snapshot.spec.name - ending.length) + ending; }
        names.add(name.toLocaleLowerCase()); return { ...value, name, parentId: current.parentId ?? null };
      });
      const memberships = Object.fromEntries(Object.entries(snapshot.state[snapshot.spec.memberships]).map(([id, values]) => [id, values.filter(value => value !== args.id)]).filter(([, values]) => values.length));
      await save(args.scope, snapshot, nodes, memberships);
    }
    return { ok: true, scope: args.scope, id: args.id, operation: 'delete', membersDeleted: false };
  };
  return { list, members, create, update, setMemberships, remove };
}
