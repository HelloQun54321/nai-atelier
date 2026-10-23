import { parsePromptTags } from './tagTranslations';

/** 词库匹配键：大小写、下划线与括号前空格不影响裸画师名识别。 */
export const normalizeRollArtistKey = (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s*\(/g, ' (').replace(/\s+/g, ' ').toLowerCase();
const isArtistToken = (token: { start?: number; end?: number; displayTag: string }, prompt: string, knownArtists?: ReadonlySet<string>) => {
  if (token.start === undefined || token.end === undefined) return false;
  const raw = prompt.slice(token.start, token.end);
  if (/artists?\s*:/i.test(raw)) return true;
  const prefixed = raw.match(/^by[\s:]+(.+)$/i)?.[1] ?? raw.match(/^@(.+)$/)?.[1];
  if (prefixed) {
    const name = prefixed.replace(/:\s*\d+(?:\.\d+)?$/, '').trim();
    if (knownArtists?.has(normalizeRollArtistKey(name))) return true;
  }
  return Boolean(knownArtists?.has(normalizeRollArtistKey(token.displayTag)));
};

/** 提示词是否含可识别的画师 Tag，供外部作品筛选使用。 */
export function promptHasArtistTags(prompt: string, knownArtists?: ReadonlySet<string>): boolean {
  const text = prompt.trim();
  return Boolean(text) && parsePromptTags(text).some(token => isArtistToken(token, text, knownArtists));
}
