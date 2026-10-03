/** 档位名称统一用于显示；接口原始值保留在映射中，避免显示与请求脱节。 */
export const AGENT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const AGENT_THINKING_LABELS = { off: '关闭', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' };
const aliases = { none: 'off', 'x-high': 'xhigh', extra_high: 'xhigh', 'extra-high': 'xhigh' };
const normalizedLevel = value => typeof value === 'string' ? aliases[value.trim().toLowerCase()] || value.trim().toLowerCase() : '';
export const normalizeAgentThinkingLevels = value => {
  const requested = new Set(Array.isArray(value) ? value.map(normalizedLevel) : []);
  return AGENT_THINKING_LEVELS.filter(level => requested.has(level));
};
export const normalizeAgentThinkingMap = value => Object.fromEntries(
  Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).flatMap(([key, entry]) => {
    const level = normalizedLevel(key);
    if (!AGENT_THINKING_LEVELS.includes(level)) return [];
    return entry === null ? [[level, null]] : typeof entry === 'string' && entry.trim() && entry.trim().length <= 80 ? [[level, entry.trim()]] : [];
  }),
);
/** 缺席档位明确禁用，防止 Pi 自动补上通用档位；可用档位沿用供应商映射。 */
export const createAgentThinkingMap = (levels, mapping = {}, advertised = []) => {
  const supported = new Set(normalizeAgentThinkingLevels(levels));
  const clean = normalizeAgentThinkingMap(mapping);
  for (const value of Array.isArray(advertised) ? advertised : []) {
    const level = normalizedLevel(value);
    if (AGENT_THINKING_LEVELS.includes(level) && clean[level] === undefined) clean[level] = value === 'off' ? 'none' : String(value).trim();
  }
  return Object.fromEntries(AGENT_THINKING_LEVELS.map(level => [level, supported.has(level) && clean[level] !== null ? clean[level] || (level === 'off' ? 'none' : level) : null]));
};
