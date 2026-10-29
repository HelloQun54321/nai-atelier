const pageNumber = (value, fallback, maximum) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new Error('读取分页无效');
  return number;
};
const readField = (value, args) => {
  const text = JSON.stringify(value), offset = pageNumber(args.fieldOffset, 0, Number.MAX_SAFE_INTEGER);
  const limit = pageNumber(args.fieldLimit, 3500, 12000);
  if (!limit) throw new Error('读取分页无效');
  return { field: args.field, format: 'json', text: text.slice(offset, offset + limit), offset, limit, total: text.length, nextOffset: offset + limit < text.length ? offset + limit : null };
};

const preview = (value, limit = 300) => typeof value === 'string' ? value.slice(0, limit) : value;
// 按真实已返回项推进游标；原对象一律通过 field 分页取回。
const budgetPage = (result, key = 'items') => {
  while (JSON.stringify(result).length > 12000 && result[key].length > 1) result[key].pop();
  const next = result.offset + result[key].length;
  result.nextOffset = next < result.total ? next : null;
  return result;
};

/** 只读持久业务资料；运行中的任务另查后端队列，不推断页面状态。 */
export const createAgentCreativeRead = ({ requestJson }) => ({
  async getRollState(args = {}) {
    const query = new URLSearchParams({ agentRead: '1', section: args.field === 'round' ? 'rounds' : args.field === 'candidate' ? 'candidates' : args.section || 'candidates', offset: String(pageNumber(args.offset, 0, Number.MAX_SAFE_INTEGER)), limit: String(pageNumber(args.limit, 20, 30)) });
    if (args.experimentId) query.set('experimentId', String(args.experimentId));
    const itemId = args.field === 'candidate' ? args.candidateId : args.field === 'round' ? args.roundId : undefined;
    if (itemId) query.set('itemId', String(itemId));
    const result = await requestJson(`/api/style-roll?${query}`);
    if (!Array.isArray(result.items)) throw new Error('Roll 读取回执无效');
    if (args.field) {
      if (!args.experimentId) throw new Error('读取完整 Roll 字段必须指定 experimentId');
      const item = result.items[0];
      const value = args.field === 'template' ? result.experiment?.template : ((args.field === 'candidate' && result.kind === 'candidates') || (args.field === 'round' && result.kind === 'rounds')) && item ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'expectedHistory')) : undefined;
      if (!value) throw new Error('请指定 Roll 记录与有效 template/candidate/round 字段及对应 ID 或 offset');
      return readField(value, args);
    }
    if (result.kind === 'candidates' && result.items.length) {
      const source = result.items[0].expectedHistory?.sourceChainId;
      if (!source) throw new Error('Roll 候选历史条件缺失');
      const order = await requestJson(`/api/local-history/browse?${new URLSearchParams({ source, sort: 'oldest' })}`);
      if (!Array.isArray(order.ids)) throw new Error('Roll 历史读取回执无效');
      const matched = new Map();
      for (let offset = 0; offset < order.ids.length; offset += 100) {
        const page = await requestJson('/api/local-history/browse-page', { method: 'POST', body: { ids: order.ids.slice(offset, offset + 100) } });
        if (!Array.isArray(page.items)) throw new Error('Roll 历史读取回执无效');
        const byId = new Map(page.items.map(item => [item.id, item]));
        for (const id of order.ids.slice(offset, offset + 100)) {
          const item = byId.get(id);
          if (!item || item.edit) continue;
          for (const candidate of result.items) {
            const expected = candidate.expectedHistory;
            if (!matched.has(candidate.id) && item.sourceChainId === expected.sourceChainId && item.prompt === expected.prompt && item.params?.seed === expected.seed && item.modules?.some(module => module.id === expected.moduleId)) matched.set(candidate.id, { id: item.id, imageUrl: item.imageUrl, createdAt: item.createdAt });
          }
        }
      }
      result.items = result.items.map(({ expectedHistory, ...candidate }) => ({ ...candidate, hasImage: matched.has(candidate.id), history: matched.get(candidate.id) || null }));
    }
    if (result.experiment) {
      const { template, ...summary } = result.experiment;
      result.experiment = { id: summary.id, name: preview(summary.name), revision: summary.revision, archived: summary.archived, rounds: summary.rounds, candidates: summary.candidates, template: { available: Boolean(template), field: 'template' } };
    }
    result.items = result.items.map(item => result.kind === 'candidates'
      ? { id: item.id, archived: item.archived, savedChainId: item.savedChainId, createdAt: item.createdAt, tagCount: item.tags?.length || 0, tagPreview: preview((item.tags || []).map(tag => tag.tag).join(', ')), hasImage: item.hasImage, history: item.history ? { ...item.history, imageUrl: preview(item.history.imageUrl, 500) } : null, partial: true, field: 'candidate', candidateId: item.id }
      : result.kind === 'rounds' ? { id: item.id, createdAt: item.createdAt, closedAt: item.closedAt, candidateCount: item.candidateIds?.length || 0, snapshotAvailable: Boolean(item.snapshot), partial: true, field: 'round', roundId: item.id }
      : { ...item, name: preview(item.name) });
    return budgetPage({ ...result, offset: result.offset ?? pageNumber(args.offset, 0, Number.MAX_SAFE_INTEGER), total: result.total ?? result.items.length, runtime: { status: 'not_queried', note: '摘要非全文；按 field 与对应 ID 续读完整 JSON。当前任务请另查生成队列。' } });
  },
  async getArtistSampleStatus(args = {}) {
    const tag = String(args.tag || '').trim(), pack = args.pack || 'v45';
    if (!tag || !['v45', 'v5'].includes(pack)) throw new Error('请提供画师 Tag 和有效样张包');
    const data = await requestJson('/api/artist-sample-data');
    if (!Array.isArray(data.samples) || !data.templates || typeof data.templates !== 'object') throw new Error('画师样张读取回执无效');
    const samples = data.samples.filter(sample => sample.pack === pack && sample.tag === tag && !(data.removedSamples || []).some(removal => removal.source === 'own' && removal.pack === pack && removal.id === sample.id));
    if (args.field) {
      const value = args.field === 'template' ? data.templates[pack] : args.field === 'sample' ? samples.find(sample => sample.id === args.sampleId) : undefined;
      if (!value) throw new Error('样张模板或指定样张不存在');
      return readField(value, args);
    }
    const offset = pageNumber(args.offset, 0, Number.MAX_SAFE_INTEGER), limit = pageNumber(args.limit, 20, 30);
    if (!limit) throw new Error('读取分页无效');
    return budgetPage({ tag, pack, template: { available: Boolean(data.templates[pack]), field: 'template' }, samples: samples.slice(offset, offset + limit).map(({ id, imageUrl, createdAt }) => ({ id, imageUrl: preview(imageUrl, 500), createdAt, partial: true, field: 'sample' })), total: samples.length, offset, limit, nextOffset: offset + limit < samples.length ? offset + limit : null, runtime: { status: 'not_queried', note: '此处只读取持久模板与自建样张，不以未记录的前端状态判断任务空闲；当前任务请另查生成队列。' } }, 'samples');
  },
});
