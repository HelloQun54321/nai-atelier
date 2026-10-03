// 工具结果只携带完成当前判断所需的文字；图片和编码由资产引用承载。
/** Agent 仅保留 Token 计数；供应商费用不进入事件、会话或诊断记录。 */
export const agentTokenUsage = usage => usage && typeof usage === 'object'
  ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens', 'reasoning'].filter(key => typeof usage[key] === 'number' && Number.isFinite(usage[key])).map(key => [key, usage[key]]))
  : undefined;
const withoutUsageFees = value => Array.isArray(value) ? value.map(withoutUsageFees) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'usage' ? agentTokenUsage(item) : withoutUsageFees(item)])) : value;

export const compactAgentValue = (input, { maxChars = 16_000, maxString = 4_000, maxItems = 30 } = {}) => {
  let remaining = maxChars, nodes = 600, omitted = false;
  const visit = (value, depth = 0, key = '') => {
    if (--nodes < 0 || depth > 12 || remaining < 32) { omitted = true; return '[内容已省略]'; }
    if (typeof value === 'string') {
      if (/^data:[^;]+;base64,/i.test(value) || /data|encoding|encoded|buffer|bytes|image/i.test(key) && value.length > 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        omitted = true; return `[二进制数据已省略：${value.length} 字符]`;
      }
      const limit = Math.min(maxString, remaining);
      remaining -= Math.min(value.length, limit);
      if (value.length > limit) { omitted = true; return value.slice(0, limit) + '…[未读完，请缩小查询范围]'; }
      return value;
    }
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value.slice(0, maxItems)) {
        if (remaining < 32 || nodes <= 0) { omitted = true; break; }
        result.push(visit(item, depth + 1));
      }
      if (result.length < value.length) omitted = true;
      return result;
    }
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, item] of Object.entries(value).slice(0, 60)) {
        if (remaining < 32 || nodes <= 0) { omitted = true; break; }
        remaining -= key.length + 4;
        result[key] = visit(item, depth + 1, key);
      }
      if (Object.keys(result).length < Object.keys(value).length) omitted = true;
      return result;
    }
    remaining -= 12;
    return value;
  };
  const value = visit(input);
  return { value, omitted };
};

export const boundAgentToolResult = result => {
  let remaining = 16_000;
  const content = (result?.content || []).slice(0, 6).map(part => {
    if (part.type !== 'text') return part;
    let value;
    try { value = JSON.parse(part.text); } catch { value = String(part.text || ''); }
    const compact = compactAgentValue(value, { maxChars: Math.max(256, remaining) });
    const bounded = compact.omitted ? { data: compact.value, _agentNotice: '返回内容包含摘要或省略项；不得冒充完整资料。请按 ID、字段或分页继续读取，不要用摘要覆盖原资料。' } : compact.value;
    const text = typeof bounded === 'string' ? bounded : JSON.stringify(bounded);
    remaining -= text.length;
    return { ...part, text };
  });
  const details = compactAgentValue(result?.details, { maxChars: 2_000, maxString: 500, maxItems: 8 }).value;
  return { ...result, content, ...(result?.details !== undefined ? { details } : {}) };
};

// 展示/历史接口不发送图片 Base64；模型的原生图片内容仍由运行链路保留。
export const publicAgentToolContent = content => (content || []).map(part => part.type === 'image' ? { type: 'image', mimeType: part.mimeType, note: '图片正文仅交给当前模型' } : part);

export const agentOutputLimit = (thinkingLevel = 'medium') => ['high', 'xhigh', 'max'].includes(thinkingLevel) ? 8192 : ['off', 'minimal', 'low'].includes(thinkingLevel) ? 2048 : 4096;

export const AGENT_TOOL_GROUPS = {
  creative: ['get_lab_state', 'update_prompts', 'set_characters', 'set_generation_params', 'request_generation', 'search_tags', 'search_novelai_docs', 'read_novelai_doc', 'read_prompt_guidelines', 'set_prompt_modules', 'set_vibes', 'set_character_references'],
  library: ['get_project_overview', 'search_project_library', 'get_chain', 'get_inspiration', 'read_project_text', 'list_generation_history', 'inspect_generation_image', 'show_project_image', 'inspect_project_image', 'search_character_catalog', 'search_vibes', 'search_character_references', 'create_chain', 'update_chain', 'create_inspiration', 'update_inspiration', 'list_vibe_groups', 'search_aitag', 'get_aitag_work', 'import_aitag_image', 'create_character_reference_from_history', 'create_vibe_from_history', 'set_chain_cover_from_history', 'update_vibe', 'update_character_reference', 'save_vibe_group', 'request_vibe_encoding', 'manage_artist_favorite', 'navigate_view'],
  maintenance: ['get_project_settings', 'get_project_overview', 'request_delete_project_item', 'request_clear_history', 'request_cleanup_history', 'set_anlas_budget', 'set_cloud_queue', 'update_tag_dictionary', 'manage_aitag', 'set_client_preferences', 'request_clear_mobile_cache', 'navigate_view'],
  web: ['web_search', 'read_web_page'],
  local_files: ['request_local_image_folder_access', 'list_local_images', 'show_local_image', 'inspect_local_image', 'save_project_image_to_folder', 'copy_local_image'],
};
export const inferAgentToolGroups = (request = '', previous = '') => {
  const groups = new Set();
  const combined = /继续|刚才|之前|那个|同样|接着|再来/.test(request) ? request + ' ' + previous : request;
  if (/提示词|参数|生成|生图|出图|实验室|重绘|扩图|构图|prompt|render|generate/i.test(combined)) groups.add('creative');
  if (/图片|照片|看看|展示|贴图|收藏|保存|资料|风格串|画师|灵感|历史|Vibe|参考|角色|AITag|项目|image|history|library/i.test(combined)) groups.add('library');
  if (/删除|清理|预算|队列|设置|缓存|词库|delete|settings/i.test(combined)) groups.add('maintenance');
  if (/搜索|联网|网页|核实|最新|查资料|search|web/i.test(combined)) groups.add('web');
  if (/文件夹|目录|磁盘|本地图片|本地文件|电脑.*图片|保存到(?!资料|灵感|历史|项目)|存到(?!资料|灵感|历史|项目)|桌面|folder|directory|[a-z]:[\\/]/i.test(combined)) groups.add('local_files');
  return [...groups];
};
export const selectRuntimeTools = (tools, groups) => {
  const names = new Set(['get_agent_capabilities', 'get_local_time', 'read_current_page', 'operate_current_page', 'enable_tool_group', 'get_lab_state', 'show_project_image']);
  for (const group of groups) for (const name of AGENT_TOOL_GROUPS[group] || []) names.add(name);
  return tools.filter(tool => names.has(tool.name));
};

export const localTimeInfo = (now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(now);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { timeZone, localTime: `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`, utcTime: now.toISOString(), utcOffset: fields.timeZoneName.replace('GMT', 'UTC').replace('−', '-') };
};

export const isProjectImagePath = path => {
  if (typeof path !== 'string' || path.length > 800 || /[\\?#\u0000-\u001f]/.test(path)) return false;
  try {
    const decoded = decodeURIComponent(path);
    if (/[\\?#\u0000-\u001f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return false;
    return /^\/api\/(?:assets\/.+|integrations\/st-chatu8\/history\/[a-f0-9]{64}\/image|(?:local-history|inspirations|vibes|character-references)\/[^/]+\/(?:image|thumbnail))$/.test(path);
  } catch { return false; }
};

/** 兼容旧日志的导出瘦身；原文件不迁移、不删除。 */
export const compactAuditEntries = entries => {
  const output = [], streams = new Map();
  const flush = key => {
    const summary = streams.get(key);
    if (summary) { output.push(summary); streams.delete(key); }
  };
  for (const entry of entries) {
    const key = entry.runId || '';
    if (entry.type === 'agent_event' && ['thinking_delta', 'text_delta'].includes(entry.eventType)) {
      const summary = streams.get(key) || { type: 'stream_summary', runId: key, at: entry.at, timestamp: entry.timestamp, thinkingChunks: 0, textChunks: 0 };
      summary[entry.eventType === 'thinking_delta' ? 'thinkingChunks' : 'textChunks']++;
      streams.set(key, summary);
    } else { flush(key); output.push(withoutUsageFees(entry)); }
  }
  for (const key of streams.keys()) flush(key);
  return output;
};
