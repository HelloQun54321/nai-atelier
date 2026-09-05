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
  let value = raw.trim();
  value = value.replace(/^[{\[\s]+/, '').replace(/[}\]\s]+$/, '').trim();
  value = value.replace(/^\{+([\s\S]*?)\}+$/, '$1').replace(/^\[+([\s\S]*?)\]+$/, '$1').trim();
  value = value.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::\s*/, '').replace(/\s*::$/, '').trim();
  value = value.replace(/^\(([\s\S]*?)(?::\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))\)$/, '$1').trim();
  value = value.replace(/^\(([\s\S]*)\)$/, '$1').trim();
  const artistPrefix = /^artist\s*:\s*/i.test(value);
  if (artistPrefix) value = value.replace(/^artist\s*:\s*/i, '').trim();
  const { id: _id, ...metadata } = group || {};
  return { displayTag: raw.trim(), lookupTag: normalizeTagQuery(value), start, end: start + raw.length, ...metadata };
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
    const leading = prompt.slice(contentStart, contentEnd).search(/\S/);
    const start = leading < 0 ? contentStart : contentStart + leading;
    const groupKind = numericStart >= 0 ? 'numeric' : braceDepth > 0 ? 'brace' : bracketDepth > 0 ? 'bracket' : undefined;
    const groupWeight = numericStart >= 0 ? prompt.slice(segmentStart, numericStart).trim() : undefined;
    const groupStart = groupKind ? segmentStart : undefined;
    const groupEnd = groupKind ? end : undefined;
    tokens.push(...parseSegment(prompt, start, contentEnd, groupKind ? { groupId: `${groupStart}:${groupEnd}`, groupStart, groupEnd, groupWeight, groupKind } : undefined));
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
  return tokens.map((item, index) => ({ ...item, id: `${index}:${item.lookupTag}` }));
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
