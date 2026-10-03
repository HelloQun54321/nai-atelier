export const TRANSPARENT_WEIGHT_MIN = 0.1;
export const TRANSPARENT_WEIGHT_MAX = 3;
export const TRANSPARENT_WEIGHT_STEP = 0.1;
export const TRANSPARENT_WEIGHT_DEFAULT = 1;

const transparentTag = /^(?:([+-]?(?:\d+(?:\.\d*)?|\.\d+))::transparent background::|transparent background)$/i;

export const normalizeTransparentWeight = value => {
  const weight = typeof value === 'number' && Number.isFinite(value) ? value : TRANSPARENT_WEIGHT_DEFAULT;
  return Math.round(Math.min(TRANSPARENT_WEIGHT_MAX, Math.max(TRANSPARENT_WEIGHT_MIN, weight)) * 10) / 10;
};

/** Text: 后的内容属于画面文字，自动标签不能进入该区域。 */
export const splitNaiTextPrompt = prompt => {
  const match = prompt.match(/(?:^|\s|[,.:[\]{}、。])text:(?!:)/i);
  if (!match) return { description: prompt, text: '' };
  const start = match.index + match[0].toLowerCase().lastIndexOf('text:');
  return { description: prompt.slice(0, start).replace(/[,\s]+$/, ''), text: prompt.slice(start) };
};

export const joinNaiTextPrompt = (description, text) => text ? `${description}\n${text}` : description;

const readTagWeight = part => {
  const match = part.trim().match(transparentTag);
  return match ? Number(match[1] ?? TRANSPARENT_WEIGHT_DEFAULT) : undefined;
};

/** 旧预设没有独立权重时，从描述区已有的透明标签恢复，缺省保持普通权重。 */
export const resolveTransparentWeight = (value, prompt = '') => {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeTransparentWeight(value);
  const { description } = splitNaiTextPrompt(prompt);
  const existing = description.split(',').map(readTagWeight).find(weight => weight !== undefined);
  return normalizeTransparentWeight(existing);
};

/** 只调整请求副本中的独立透明标签，保留原编辑文本、其他标签及画面文字。 */
export const withTransparentPromptTags = (prompt, value) => {
  const weight = resolveTransparentWeight(value, prompt);
  const tag = weight === TRANSPARENT_WEIGHT_DEFAULT ? 'transparent background' : `${weight}::transparent background::`;
  const parts = splitNaiTextPrompt(prompt);
  let replaced = false;
  let description = parts.description.split(',').flatMap(part => {
    if (readTagWeight(part) === undefined) return [part];
    if (replaced) return [];
    replaced = true;
    return [`${part.match(/^\s*/)[0]}${tag}${part.match(/\s*$/)[0]}`];
  }).join(',');
  if (!replaced) description = description.trim() ? `${description.trimEnd()}, ${tag}` : tag;
  if (!description.split(',').some(part => /^has alpha$/i.test(part.trim()))) description += ', has alpha';
  return joinNaiTextPrompt(description, parts.text);
};
