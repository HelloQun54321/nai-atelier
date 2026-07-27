import { lookupTagTranslations, normalizeTagQuery } from './tagDictionary';

export type PromptTranslationSource = 'dictionary' | 'ai' | 'missing';

export interface PromptTagToken {
  id: string;
  displayTag: string;
  lookupTag: string;
}

export interface PromptTagTranslation extends PromptTagToken {
  chinese?: string;
  source: PromptTranslationSource;
}

type TranslationListener = () => void;
const aiTranslations = new Map<string, string>();
const listeners = new Set<TranslationListener>();
const lookupRequests = new Map<string, Promise<void>>();

const unwrapToken = (raw: string) => {
  let value = raw.trim();
  value = value.replace(/^[{\[\s]+/, '').replace(/[}\]\s]+$/, '').trim();
  value = value.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::\s*/, '').replace(/\s*::$/, '').trim();
  const artistPrefix = /^artist\s*:\s*/i.test(value);
  if (artistPrefix) value = value.replace(/^artist\s*:\s*/i, '').trim();
  return { displayTag: raw.trim(), lookupTag: normalizeTagQuery(value) };
};

export const parsePromptTags = (prompt: string): PromptTagToken[] => prompt
  .split(/[,\n|]+/)
  .map(unwrapToken)
  .filter(item => item.lookupTag && /[\p{L}\p{N}]/u.test(item.lookupTag))
  .map((item, index) => ({ ...item, id: `${index}:${item.lookupTag}` }));

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
