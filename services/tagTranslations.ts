import { lookupTagTranslations, normalizeTagQuery } from './tagDictionary';
import { parsePromptTags } from './promptTags.mjs';
import type { PromptTagToken } from './promptTags.mjs';

export { parsePromptTags } from './promptTags.mjs';
export type { PromptTagToken } from './promptTags.mjs';

export type PromptTranslationSource = 'dictionary' | 'ai' | 'missing' | 'native';

/** 原文本身就是中日韩文字时不需要再翻译，也不显示「待翻译」。 */
export const isNativePromptText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(text);

export interface PromptTagTranslation extends PromptTagToken {
  chinese?: string;
  source: PromptTranslationSource;
}

type TranslationListener = () => void;
const aiTranslations = new Map<string, string>();
const listeners = new Set<TranslationListener>();
const lookupRequests = new Map<string, Promise<void>>();

const removePromptSpan = (prompt: string, start: number, end: number): string => {
  const before = prompt.slice(0, start), after = prompt.slice(end);
  const following = after.match(/^\s*[,，|\n][\s,，|\n]*/);
  if (following) return before + after.slice(following[0].length);
  const preceding = before.match(/[\s,，|\n]*[,，|\n]\s*$/);
  return (preceding ? before.slice(0, -preceding[0].length) : before) + after;
};

/** 按位置删除所选词，递归保留剩余词的权重包装，只清理变空的组。 */
export const removePromptTagTokens = (prompt: string, selectedTokens: PromptTagToken[]): string => {
  if (!selectedTokens.length) return prompt;
  const selected = new Set(selectedTokens.map(token => `${token.start}:${token.end}`));
  const groups = new Map<string, PromptTagToken[]>();
  parsePromptTags(prompt).forEach(token => {
    const key = token.groupId || token.id;
    groups.set(key, [...(groups.get(key) || []), token]);
  });
  const replacements = [...groups.values()].flatMap(members => {
    const chosen = members.map(token => selected.has(`${token.start}:${token.end}`));
    if (!chosen.some(Boolean)) return [];
    const first = members[0], start = first.groupStart ?? first.start!, end = first.groupEnd ?? first.end!;
    let replacement = '';
    if (!chosen.every(Boolean) && first.groupKind) {
      const raw = prompt.slice(start, end);
      const opening = first.groupKind === 'numeric' ? raw.indexOf('::') + 2 : first.groupLevel || 1;
      const closing = first.groupKind === 'numeric' ? 2 : first.groupLevel || 1;
      const inner = raw.slice(opening, -closing);
      const remaining = removePromptTagTokens(inner, parsePromptTags(inner).filter((_, index) => chosen[index]));
      if (remaining.trim()) replacement = raw.slice(0, opening) + remaining + raw.slice(-closing);
    }
    return [{ start, end, replacement }];
  }).sort((a, b) => b.start - a.start);
  if (!replacements.length) return prompt;
  let result = prompt;
  replacements.forEach(({ start, end, replacement }) => {
    result = replacement ? result.slice(0, start) + replacement + result.slice(end) : removePromptSpan(result, start, end);
  });
  return /^[\s,，|\n]*$/.test(result) ? '' : result;
};

export type PromptWeightAction = 'up' | 'down' | 'remove' | 'numeric';
export type PromptWeightKind = 'brace' | 'bracket' | 'numeric';

export const formatNumericWeight = (value: number) => String(Number(Math.max(0.1, value).toFixed(12)));

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
    if (token.groupKind === 'brace' || token.groupKind === 'bracket') return raw.slice(token.groupLevel || 1, -(token.groupLevel || 1));
    return raw;
  }

  if (token.groupKind === 'numeric') {
    const current = Number(token.groupWeight || 1);
    const next = action === 'numeric' ? numericWeight : current + (action === 'up' ? step : -step);
    if (typeof next !== 'number' || !Number.isFinite(next)) return raw;
    return raw.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/, `${formatNumericWeight(next)}::`);
  }

  const plain = token.groupKind === 'brace' || token.groupKind === 'bracket' ? raw.slice(token.groupLevel || 1, -(token.groupLevel || 1)) : raw;
  const level = token.groupLevel || 1;
  if (action === 'up') {
    if (token.groupKind === 'bracket' && level > 1) return `${'['.repeat(level - 1)}${plain}${']'.repeat(level - 1)}`;
    if (token.groupKind === 'bracket') return plain;
    return `${'{'.repeat(token.groupKind === 'brace' ? level + 1 : 1)}${plain}${'}'.repeat(token.groupKind === 'brace' ? level + 1 : 1)}`;
  }
  if (token.groupKind === 'brace' && level > 1) return `${'{'.repeat(level - 1)}${plain}${'}'.repeat(level - 1)}`;
  if (token.groupKind === 'brace') return plain;
  return `${'['.repeat(token.groupKind === 'bracket' ? level + 1 : 1)}${plain}${']'.repeat(token.groupKind === 'bracket' ? level + 1 : 1)}`;
};

const emitTranslationChange = () => listeners.forEach(listener => listener());

export const subscribeTagTranslations = (listener: TranslationListener) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const acceptTagTranslations = (items: Array<{ tag?: string; chinese?: string }>) => {
  let changed = false;
  for (const item of items) {
    const tag = normalizeTagQuery(item.tag || '');
    const chinese = String(item.chinese || '').trim();
    if (tag && chinese) { aiTranslations.set(tag, chinese); changed = true; }
  }
  if (changed) emitTranslationChange();
};

const requestCachedTranslations = async (tags: string[]) => {
  const unique = [...new Set(tags.map(normalizeTagQuery).filter(tag => tag && !aiTranslations.has(tag)))].sort();
  if (!unique.length) return;
  for (let index = 0; index < unique.length; index += 50) {
    const batch = unique.slice(index, index + 50);
    const key = batch.join('\n');
    if (!lookupRequests.has(key)) {
      lookupRequests.set(key, fetch('/api/prompt-agent/tag-translations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', tags: batch }),
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
  }
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
  const normalized = [...new Set(tags.map(normalizeTagQuery).filter(Boolean))];
  const translated: Array<{ tag?: string; chinese?: string }> = [];
  for (let index = 0; index < normalized.length; index += 50) {
    const response = await fetch('/api/prompt-agent/tag-translations', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate', tags: normalized.slice(index, index + 50) }),
    });
    const payload = await response.json().catch(() => ({})) as { items?: Array<{ tag?: string; chinese?: string }>; error?: string };
    if (!response.ok) throw new Error(payload.error || '翻译失败');
    for (const item of payload.items || []) {
      const tag = normalizeTagQuery(item.tag || '');
      const chinese = String(item.chinese || '').trim();
      if (tag && chinese) aiTranslations.set(tag, chinese);
    }
    translated.push(...(payload.items || []));
    emitTranslationChange();
  }
  return translated;
};
