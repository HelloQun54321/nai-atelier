import { compactAgentValue } from './agent-runtime.mjs';
import { getEntryPurposes, getPromptPurposeCandidateStatus, PROMPT_PURPOSE_IDS, isPurposeSectionKey } from '../services/promptPurposes.mjs';
import { getPromptLibraryDirectoryPath, getPromptLibraryDirectoryTarget, getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry } from '../services/promptLibraryTree.mjs';

const text = value => typeof value === 'string' ? value : '';
const integer = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(0, Math.floor(Number(value)))) : fallback;
const preview = (value, length = 256) => text(value).slice(0, length);
const paramsOf = entry => {
  if (typeof entry?.params === 'string') { try { return JSON.parse(entry.params); } catch { return {}; } }
  return entry?.params || {};
};

export function promptLibrarySection(entry) {
  const params = paramsOf(entry);
  if (params._rollContentSnapshot) return 'saved';
  if (isPromptLibraryFragmentEntry(entry)) return 'items';
  if (params._promptLibraryOriginal || entry.type === 'preset' && params._collectedPrompt === 1 && params._collectedCategory !== 'general') return 'originals';
  return null;
}

const libraryPurposes = entry => {
  if (promptLibrarySection(entry) !== 'saved') return getEntryPurposes(entry);
  const snapshot = paramsOf(entry)._rollContentSnapshot;
  if (snapshot?.format !== 'nai-roll-content') return [];
  const purposes = new Set((Array.isArray(snapshot.items) ? snapshot.items : [])
    .filter(item => isPurposeSectionKey(item?.unitId) && text(item?.text).trim()).map(item => item.unitId.slice(8)));
  // 旧角色四栏含义可直接对应；旧 scene/camera 是复合栏，不猜成新的单用途。
  const legacy = { appearance: 'appearance', wardrobe: 'clothing', pose: 'pose', expression: 'expression' };
  for (const role of Array.isArray(snapshot.roles) ? snapshot.roles : []) {
    for (const [kind, purpose] of Object.entries(legacy)) if (role?.provided?.[kind] === true && text(role.sections?.[kind]).trim()) purposes.add(purpose);
  }
  return PROMPT_PURPOSE_IDS.filter(id => purposes.has(id));
};

export function promptLibraryDirectory(tree, id) {
  const path = getPromptLibraryDirectoryPath(tree, id);
  if (!path.length) throw new Error(`提示词目录不存在：${id}`);
  return { directoryId: id, directoryName: path.at(-1).name, parentId: path.at(-1).parentId,
    directoryPath: path.map(node => node.name), target: getPromptLibraryDirectoryTarget(tree, id) };
}

const directoryPreview = (tree, id) => {
  const directory = promptLibraryDirectory(tree, id);
  return { ...directory, directoryPath: directory.directoryPath.slice(0, 8), pathLength: directory.directoryPath.length,
    ...(directory.directoryPath.length > 8 ? { pathRead: { directoryId: id, field: 'directoryPath', offset: 0 } } : {}) };
};

/** 用实际可交付的条数推进游标，避免通用工具预算截掉一页尾部后跳项。 */
export function promptLibraryPage(records, args, toItem, metadata = {}, key = 'items') {
  const requestedLimit = Math.max(1, integer(args.limit, 10, 30));
  const offset = args.offset === undefined ? integer(args.page, 0, 100000) * requestedLimit : integer(args.offset, 0, Number.MAX_SAFE_INTEGER);
  const items = [];
  const result = () => ({ ...metadata, offset, limit: items.length, requestedLimit, total: records.length,
    nextOffset: offset + items.length < records.length ? offset + items.length : null, [key]: items });
  for (const record of records.slice(offset, offset + requestedLimit)) {
    items.push(toItem(record));
    if (compactAgentValue(result(), { maxChars: 12_000, maxItems: 30 }).omitted) {
      items.pop();
      if (!items.length) throw new Error('单条摘要超出读取预算，请按 ID 或字段读取');
      break;
    }
  }
  return result();
}

/** 字段分段以原文或 JSON 文本交付，数组与深层快照也能逐字恢复。 */
export function readPromptLibraryField(value, args, identity = {}) {
  const field = text(args.field);
  const path = field.split('.');
  if (!field || path.some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('资料字段路径无效');
  let selected = value;
  for (const key of path) {
    if (!selected || typeof selected !== 'object' || !Object.hasOwn(selected, key)) throw new Error(`资料字段不存在：${field}`);
    selected = selected[key];
  }
  const format = typeof selected === 'string' ? 'text' : 'json';
  const serialized = format === 'text' ? selected : JSON.stringify(selected);
  if (serialized === undefined) throw new Error(`资料字段不可读取：${field}`);
  const offset = integer(args.offset, 0, Number.MAX_SAFE_INTEGER), limit = Math.max(1, integer(args.limit, 2000, 3000));
  const content = serialized.slice(offset, offset + limit);
  return { ...identity, field, format, offset, length: serialized.length, content,
    nextOffset: offset + content.length < serialized.length ? offset + content.length : null };
}

export function readPromptLibraryChain(value, args) {
  if (args.field !== undefined) return readPromptLibraryField(value, args, { id: value.id });
  if (!compactAgentValue(value, { maxChars: 12_000 }).omitted) return value;
  return { id: value.id, name: preview(value.name, 160), type: value.type, partial: true,
    notice: '资料超过单次预算；fields 是字段目录。使用 get_chain(id, field, offset, limit)，按 nextOffset 续读，JSON 字段拼接后解析。不得用摘要覆盖原资料。',
    fields: Object.entries(value).filter(([, item]) => item !== undefined).map(([field, item]) => {
      const serialized = typeof item === 'string' ? item : JSON.stringify(item);
      return { field, format: typeof item === 'string' ? 'text' : 'json', length: serialized.length, preview: serialized.slice(0, 120) };
    }) };
}

export function readPromptLibraryDirectories(tree, purposes, args) {
  if (args.directoryId !== undefined) {
    const directory = promptLibraryDirectory(tree, args.directoryId);
    return args.field === undefined ? directoryPreview(tree, args.directoryId)
      : readPromptLibraryField(directory, args, { revision: tree.revision, directoryId: args.directoryId });
  }
  if (args.field !== undefined) throw new Error('读取目录字段时必须提供 directoryId');
  // nodes 和 directories 同属这一页，节点 parentId 可用于完整重建树。
  const records = tree.nodes;
  const result = promptLibraryPage(records, args, node => directoryPreview(tree, node.id), { revision: tree.revision, purposes }, 'directories');
  const ids = new Set(result.directories.map(item => item.directoryId));
  const nodes = records.filter(node => ids.has(node.id));
  // 预算中同时预留节点原始字段，不依赖后续包装器静默裁切。
  while (result.directories.length > 1 && compactAgentValue({ ...result, nodes }, { maxChars: 12_000 }).omitted) {
    result.directories.pop(); nodes.pop(); result.limit--; result.nextOffset = result.offset + result.limit;
  }
  return { ...result, nodes };
}

export function searchPromptLibrary(entries, tree, args) {
  const section = args.section || 'items';
  if (!['items', 'originals', 'saved', 'all'].includes(section)) throw new Error('提示词库范围无效');
  const purposeMatch = args.purposeMatch || 'any';
  if (!['any', 'all'].includes(purposeMatch)) throw new Error('用途匹配方式无效');
  const requestedPurposes = args.purposes || [];
  const query = text(args.query).trim().toLocaleLowerCase();
  const directoryIds = args.directoryIds;
  if (directoryIds !== undefined && (!Array.isArray(directoryIds) || directoryIds.some(id => !tree.nodes.some(node => node.id === id)))) throw new Error('提示词目录不存在，请重新读取目录');
  const selected = new Set(directoryIds || []);
  const candidates = entries.filter(entry => {
    const actualSection = promptLibrarySection(entry);
    if (!actualSection || section !== 'all' && actualSection !== section) return false;
    const ids = getPromptLibraryEntryDirectoryIds(entry, tree);
    if (directoryIds !== undefined && (selected.size ? !ids.some(id => getPromptLibraryDirectoryPath(tree, id).some(node => selected.has(node.id))) : ids.length > 0)) return false;
    const purposes = libraryPurposes(entry);
    if (requestedPurposes.length && !(purposeMatch === 'all' ? requestedPurposes.every(id => purposes.includes(id)) : requestedPurposes.some(id => purposes.includes(id)))) return false;
    if (args.pure && !getPromptPurposeCandidateStatus(entry).eligible) return false;
    const directories = ids.map(id => promptLibraryDirectory(tree, id));
    return !query || JSON.stringify([entry.name, entry.basePrompt, entry.negativePrompt, entry.description, entry.tags, paramsOf(entry), directories]).toLocaleLowerCase().includes(query);
  });
  return promptLibraryPage(candidates, args, entry => {
    const params = paramsOf(entry), polarity = params._promptLibraryPolarity === 'negative' ? 'negative' : 'positive';
    const prompt = polarity === 'negative' ? '' : text(entry.basePrompt);
    const negative = polarity === 'negative' ? text(entry.basePrompt) : text(entry.negativePrompt);
    const ids = getPromptLibraryEntryDirectoryIds(entry, tree), tags = Array.isArray(entry.tags) ? entry.tags : [];
    return { id: entry.id, section: promptLibrarySection(entry), name: preview(entry.name, 160), prompt: preview(prompt), promptLength: prompt.length,
      negativePrompt: preview(negative), negativePromptLength: negative.length, polarity,
      promptField: polarity === 'negative' ? null : 'basePrompt', negativePromptField: polarity === 'negative' ? 'basePrompt' : 'negativePrompt',
      description: preview(entry.description, 160), purposes: libraryPurposes(entry), pureEligibility: { ...getPromptPurposeCandidateStatus(entry), purposes: libraryPurposes(entry) },
      tags: tags.slice(0, 4).map(tag => preview(tag, 60)), tagCount: tags.length,
      meta: { preview: JSON.stringify(params._promptLibrary || {}).slice(0, 160), field: 'params._promptLibrary' },
      directories: ids.slice(0, 1).map(id => directoryPreview(tree, id)), directoryCount: ids.length,
      ...(params._rollContentSnapshot ? { snapshot: { field: 'params._rollContentSnapshot', preview: JSON.stringify(params._rollContentSnapshot).slice(0, 256) } } : {}),
      read: { tool: 'get_chain', id: entry.id, note: '正文为摘要；全文、全部标签/目录归属和组合快照按字段读取，按 nextOffset 续读。' } };
  }, { revision: tree.revision, section, purposeMatch });
}
