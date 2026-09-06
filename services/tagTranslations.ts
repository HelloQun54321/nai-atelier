import { lookupTagTranslations, normalizeTagQuery } from './tagDictionary';

export type PromptTranslationSource = 'dictionary' | 'ai' | 'missing';

export interface PromptTagToken {
  id: string;
  displayTag: string;
  lookupTag: string;
  start?: number;
  end?: number;
  groupId?: string;
  groupStart?: number;
  groupEnd?: number;
  groupWeight?: string;
  groupKind?: 'numeric' | 'brace' | 'bracket';
  groupLevel?: number;
  groupEdge?: 'open' | 'close' | 'both';
}

export interface PromptTagTranslation extends PromptTagToken {
  chinese?: string;
  source: PromptTranslationSource;
}

type TranslationListener = () => void;
const aiTranslations = new Map<string, string>();
const listeners = new Set<TranslationListener>();
const lookupRequests = new Map<string, Promise<void>>();

const unwrapToken = (raw: string, start = 0, group?: Partial<PromptTagToken>) => {
  const leading = raw.search(/\S/);
  let value = raw.trim();
  const tokenStart = leading >= 0 ? start + leading : start;
  const tokenEnd = leading >= 0 ? tokenStart + value.length : start + raw.length;
  value = value.replace(/^[{\[\s]+/, '').replace(/[}\]\s]+$/, '').trim();
  value = value.replace(/^\{+([\s\S]*?)\}+$/, '$1').replace(/^\[+([\s\S]*?)\]+$/, '$1').trim();
  value = value.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::\s*/, '').replace(/\s*::$/, '').trim();
  value = value.replace(/^\(([\s\S]*?)(?::\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))\)$/, '$1').trim();
  value = value.replace(/^\(([\s\S]*)\)$/, '$1').trim();
  const artistPrefix = /^artist\s*:\s*/i.test(value);
  if (artistPrefix) value = value.replace(/^artist\s*:\s*/i, '').trim();
  const { id: _id, ...metadata } = group || {};
  return { displayTag: value, lookupTag: normalizeTagQuery(value), start: tokenStart, end: tokenEnd, ...metadata };
};

const parseSegment = (prompt: string, rawStart: number, rawEnd: number, group?: Partial<PromptTagToken>): Array<Omit<PromptTagToken, 'id'>> =>
  prompt.slice(rawStart, rawEnd).split(/[,，\n|]+/).flatMap((raw, index, parts) => {
    const offset = parts.slice(0, index).reduce((sum, part) => sum + part.length + 1, 0);
    const token = unwrapToken(raw, rawStart + offset, group);
    return token.lookupTag && /[\p{L}\p{N}]/u.test(token.lookupTag) ? [token] : [];
  });

export const parsePromptTags = (prompt: string): PromptTagToken[] => {
  const tokens: Array<Omit<PromptTagToken, 'id'>> = [];
  let segmentStart = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let numericStart = -1;
  const flush = (end: number, contentStart = segmentStart, contentEnd = end) => {
    if (end <= segmentStart || contentEnd <= contentStart) return;
    // leading 必须取自未 trim 的切片：trimmed.search(/\S/) 恒为 0，会让 raw 首部多算空白、
    // 尾部少截同样长度，导致 `", 1.2::tag::"` 之类的后续权重组因 raw 不以 :: 结尾而丢失分组。
    const segment = prompt.slice(segmentStart, end);
    const trimmed = segment.trim();
    const leading = segment.search(/\S/);
    const groupStart = leading < 0 ? segmentStart : segmentStart + leading;
    const groupEnd = groupStart + trimmed.length;
    const raw = prompt.slice(groupStart, groupEnd);
    let start = contentStart;
    let finalEnd = contentEnd;
    let groupKind: PromptTagToken['groupKind'];
    let groupWeight: string | undefined;
    let groupLevel: number | undefined;

    if (numericStart >= 0 && raw.endsWith('::')) {
      groupKind = 'numeric';
      groupWeight = prompt.slice(groupStart, numericStart).trim();
      start = numericStart + 2;
      finalEnd = groupEnd - 2;
    } else {
      // 内容组必须懒惰匹配：贪婪会把多花括号的一个闭合符吞进内容，导致开口/闭合数量不等而整组失配。
      const braceMatch = raw.match(/^(\{+)([\s\S]*?)(\}+)$|^(\[+)([\s\S]*?)(\]+)$/);
      if (braceMatch) {
        const opening = braceMatch[1] || braceMatch[4];
        const closing = braceMatch[3] || braceMatch[6];
        if (opening.length === closing.length) {
          groupKind = braceMatch[1] ? 'brace' : 'bracket';
          groupLevel = opening.length;
          start = groupStart + opening.length;
          finalEnd = groupEnd - closing.length;
        }
      }
    }

    const group = groupKind ? { groupId: `${groupStart}:${groupEnd}`, groupStart, groupEnd, groupWeight, groupKind, groupLevel } : undefined;
    tokens.push(...parseSegment(prompt, start, finalEnd, group));
  };
  for (let i = 0; i < prompt.length; i += 1) {
    const char = prompt[i];
    if (char === ':' && prompt[i + 1] === ':' && numericStart >= 0) {
      flush(i + 2, numericStart + 2, i);
      segmentStart = i + 2;
      numericStart = -1;
      i += 1;
    } else if (char === ':' && prompt[i + 1] === ':' && numericStart < 0) {
      const prefix = prompt.slice(segmentStart, i).trim();
      if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(prefix)) numericStart = i;
      i += 1;
    } else if (char === '{') braceDepth += 1;
    else if (char === '}' && braceDepth) braceDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']' && bracketDepth) bracketDepth -= 1;
    if ((char === ',' || char === '，' || char === '\n' || char === '|') && !braceDepth && !bracketDepth && numericStart < 0) {
      flush(i);
      segmentStart = i + 1;
      numericStart = -1;
    }
  }
  flush(prompt.length);
  // 标记每个 token 在权重组内的位置：一对权重包裹多个 Tag 时，开口语法渲染在首项、闭合语法渲染在末项。
  const groupTotals = new Map<string, number>();
  tokens.forEach(token => { if (token.groupId) groupTotals.set(token.groupId, (groupTotals.get(token.groupId) || 0) + 1); });
  const groupSeen = new Map<string, number>();
  tokens.forEach(token => {
    if (!token.groupId) return;
    const seen = groupSeen.get(token.groupId) || 0;
    const total = groupTotals.get(token.groupId) || 1;
    token.groupEdge = total === 1 ? 'both' : seen === 0 ? 'open' : seen === total - 1 ? 'close' : undefined;
    groupSeen.set(token.groupId, seen + 1);
  });
  return tokens.map((item, index) => ({ ...item, id: `${index}:${item.lookupTag}` }));
};

export type PromptWeightAction = 'up' | 'down' | 'remove' | 'numeric';
export type PromptWeightKind = 'brace' | 'bracket' | 'numeric';

export const formatNumericWeight = (value: number) => String(Number(Math.max(0.1, value).toFixed(2)));

export const cleanTagContent = (raw: string): string => {
  let val = raw.trim();
  val = val.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::\s*/, '').replace(/\s*::$/, '').trim();
  val = val.replace(/^\{+/, '').replace(/\}+$/, '').trim();
  val = val.replace(/^\[+/, '').replace(/\]+$/, '').trim();
  val = val.replace(/^\(([\s\S]*?)(?::\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))\)$/, '$1').trim();
  return val.trim();
};

// 把选中组设定为目标权重类型：先剥离现有包装，再按类型重新包裹；普通 Tag 直接包装。
export const wrapPromptTag = (raw: string, token: PromptTagToken, kind: PromptWeightKind, numericWeight = 1.1): string => {
  const plain = cleanTagContent(raw);
  if (kind === 'numeric') return `${formatNumericWeight(numericWeight)}::${plain}::`;
  if (kind === 'bracket') return `[${plain}]`;
  return `{${plain}}`;
};

/**
 * 包装选中的一个或多个 Tag 标记：
 * - 数值权重：多选标签时将选中的多个标签连结在一起为一个整体数值组（例如 1.2::A, B, C::），而不是各加各的
 * - 括号模式（brace/bracket）：“括号就是各打各的了”，为每个单元标签分别包裹 {A}, {B} 或 [A], [B]
 */
export const wrapPromptTagTokens = (
  fullPrompt: string,
  selectedTokens: PromptTagToken[],
  kind: PromptWeightKind,
  numericWeight = 1.1,
): string => {
  if (!selectedTokens.length) return fullPrompt;

  const tokens = [...selectedTokens].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  if (kind === 'numeric') {
    const plainTags = tokens.map(token => {
      const raw = fullPrompt.slice(token.start ?? 0, token.end ?? 0);
      return cleanTagContent(raw);
    }).filter(Boolean);
    if (!plainTags.length) return fullPrompt;

    const weightPrefix = formatNumericWeight(numericWeight);
    const replacementText = `${weightPrefix}::${plainTags.join(', ')}::`;

    // 收集所有选中 token 对应的完整外层区间（若属于某权重组则取 groupStart/groupEnd，否则取 start/end）
    const spanMap = new Map<string, { start: number; end: number }>();
    tokens.forEach(t => {
      const key = t.groupId || `${t.start}:${t.end}`;
      if (!spanMap.has(key)) {
        spanMap.set(key, {
          start: t.groupStart ?? t.start ?? 0,
          end: t.groupEnd ?? t.end ?? (t.start ?? 0),
        });
      }
    });
    const spans = [...spanMap.values()].sort((a, b) => a.start - b.start);

    // 检查各区间是否在原文中前后紧邻（中间仅由空白、逗号、分号或竖线等分隔符相连）
    let allContiguous = true;
    for (let i = 0; i < spans.length - 1; i++) {
      const between = fullPrompt.slice(spans[i].end, spans[i + 1].start);
      if (!/^[\s,，|\n]*$/.test(between)) {
        allContiguous = false;
        break;
      }
    }

    if (allContiguous) {
      const start = spans[0].start;
      const end = spans[spans.length - 1].end;
      return fullPrompt.slice(0, start) + replacementText + fullPrompt.slice(end);
    }

    // 若选中的标签中间夹杂未选中的散标签，将合并结果置于首项位置，并从后往前清理其余选中项及其相邻分隔符
    let prompt = fullPrompt;
    for (let i = spans.length - 1; i >= 1; i--) {
      const span = spans[i];
      const after = prompt.slice(span.end);
      const before = prompt.slice(0, span.start);
      const afterMatch = after.match(/^(\s*[,，|\n]\s*)/);
      if (afterMatch) {
        prompt = before + after.slice(afterMatch[0].length);
      } else {
        const beforeMatch = before.match(/(\s*[,，|\n]\s*)$/);
        if (beforeMatch) {
          prompt = before.slice(0, -beforeMatch[0].length) + after;
        } else {
          prompt = before + after;
        }
      }
    }
    const firstSpan = spans[0];
    return prompt.slice(0, firstSpan.start) + replacementText + prompt.slice(firstSpan.end);
  }

  // 括号模式（brace 或 bracket）：“括号各打各的”
  // 按区间从后往前进行替换
  const spanMap = new Map<string, { start: number; end: number; tokens: PromptTagToken[] }>();
  tokens.forEach(t => {
    const key = t.groupId || `${t.start}:${t.end}`;
    const entry = spanMap.get(key);
    if (entry) {
      entry.tokens.push(t);
    } else {
      spanMap.set(key, {
        start: t.groupStart ?? t.start ?? 0,
        end: t.groupEnd ?? t.end ?? (t.start ?? 0),
        tokens: [t],
      });
    }
  });
  const spans = [...spanMap.values()].sort((a, b) => b.start - a.start);

  let nextPrompt = fullPrompt;
  for (const span of spans) {
    const wrappedMembers = span.tokens.map(t => {
      const raw = fullPrompt.slice(t.start ?? 0, t.end ?? 0);
      const clean = cleanTagContent(raw);
      return kind === 'bracket' ? `[${clean}]` : `{${clean}}`;
    });
    const replacement = wrappedMembers.join(', ');
    nextPrompt = nextPrompt.slice(0, span.start) + replacement + nextPrompt.slice(span.end);
  }

  return nextPrompt;
};

export const transformPromptWeight = (
  raw: string,
  token: PromptTagToken,
  action: PromptWeightAction,
  numericWeight?: number,
  step = 0.1,
): string => {
  if (action === 'remove') {
    if (token.groupKind === 'numeric') return raw.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/, '').replace(/::$/, '');
    if (token.groupKind === 'brace') return raw.replace(/^\{+/, '').replace(/\}+$/, '');
    if (token.groupKind === 'bracket') return raw.replace(/^\[+/, '').replace(/\]+$/, '');
    return raw;
  }

  if (token.groupKind === 'numeric') {
    const current = Number(token.groupWeight || 1);
    const next = action === 'numeric' ? numericWeight : current + (action === 'up' ? step : -step);
    if (typeof next !== 'number' || !Number.isFinite(next)) return raw;
    return raw.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/, `${formatNumericWeight(next)}::`);
  }

  const plain = token.groupKind === 'brace'
    ? raw.replace(/^\{+/, '').replace(/\}+$/, '')
    : token.groupKind === 'bracket'
      ? raw.replace(/^\[+/, '').replace(/\]+$/, '')
      : raw;
  const level = token.groupLevel || 1;
  if (action === 'up') {
    if (token.groupKind === 'bracket' && level > 1) return `${'['.repeat(level - 1)}${plain}${']'.repeat(level - 1)}`;
    if (token.groupKind === 'bracket') return plain;
    return `${'{'.repeat(token.groupKind === 'brace' ? level + 1 : 1)}${plain}${'}'.repeat(token.groupKind === 'brace' ? level + 1 : 1)}`;
  }
  if (token.groupKind === 'brace' && level > 1) return `${'{'.repeat(level - 1)}${plain}${'}'.repeat(level - 1)}`;
  if (token.groupKind === 'brace') return `[${plain}]`;
  return `${'['.repeat(token.groupKind === 'bracket' ? level + 1 : 1)}${plain}${']'.repeat(token.groupKind === 'bracket' ? level + 1 : 1)}`;
};

const emitTranslationChange = () => listeners.forEach(listener => listener());

export const subscribeTagTranslations = (listener: TranslationListener) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const requestCachedTranslations = async (tags: string[]) => {
  const unique = [...new Set(tags.map(normalizeTagQuery).filter(tag => tag && !aiTranslations.has(tag)))].sort();
  if (!unique.length) return;
  const key = unique.join('\n');
  if (!lookupRequests.has(key)) {
    lookupRequests.set(key, fetch('/api/prompt-agent/tag-translations', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lookup', tags: unique }),
    }).then(async response => {
      if (!response.ok) return;
      const payload = await response.json() as { items?: Array<{ tag?: string; chinese?: string }> };
      let changed = false;
      for (const item of payload.items || []) {
        const tag = normalizeTagQuery(item.tag || '');
        const chinese = String(item.chinese || '').trim();
        if (tag && chinese) { aiTranslations.set(tag, chinese); changed = true; }
      }
      if (changed) emitTranslationChange();
    }).catch(() => {}).finally(() => lookupRequests.delete(key)));
  }
  await lookupRequests.get(key);
};

export const resolvePromptTranslations = async (tokens: PromptTagToken[]): Promise<PromptTagTranslation[]> => {
  const tags = [...new Set(tokens.map(token => token.lookupTag))];
  const dictionary = await lookupTagTranslations(tags);
  const missing = tags.filter(tag => !dictionary.has(tag));
  await requestCachedTranslations(missing);
  return tokens.map(token => {
    const dictionaryItem = dictionary.get(token.lookupTag);
    if (dictionaryItem) return { ...token, chinese: dictionaryItem.chinese, source: 'dictionary' };
    const ai = aiTranslations.get(token.lookupTag);
    return ai ? { ...token, chinese: ai, source: 'ai' } : { ...token, source: 'missing' };
  });
};

export const translateMissingPromptTags = async (tags: string[]) => {
  const normalized = [...new Set(tags.map(normalizeTagQuery).filter(Boolean))].slice(0, 50);
  const response = await fetch('/api/prompt-agent/tag-translations', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'translate', tags: normalized }),
  });
  const payload = await response.json().catch(() => ({})) as { items?: Array<{ tag?: string; chinese?: string }>; error?: string };
  if (!response.ok) throw new Error(payload.error || '翻译失败');
  for (const item of payload.items || []) {
    const tag = normalizeTagQuery(item.tag || '');
    const chinese = String(item.chinese || '').trim();
    if (tag && chinese) aiTranslations.set(tag, chinese);
  }
  emitTranslationChange();
  return payload.items || [];
};
