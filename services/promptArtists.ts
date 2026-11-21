import type { NAIParams } from '../types';
import { parseChainPromptTokens, getChainPromptTokenWeight } from './chainSimilarity';
import { compileCharacterContent, getActiveCharacters } from './characterPrompts';
import { normalizeArtistUsageKey } from './artistParticipation';

export interface PromptArtist { name: string; weights: (number | null)[] }

/** 只读取当时的正向内容；裸名须命中目录，负面和停用角色不参与。 */
export function getPromptArtists(prompt = '', params: Partial<NAIParams> = {}, names: string[] = []): PromptArtist[] {
  const exact = new Set(names), aliases = new Map<string, string | null>();
  for (const name of exact) {
    const key = normalizeArtistUsageKey(name);
    aliases.set(key, aliases.has(key) ? null : name);
  }
  const artists = new Map<string, PromptArtist>();
  const texts = [prompt, ...getActiveCharacters(Array.isArray(params.characters) ? params.characters : []).map(character => compileCharacterContent(character).prompt)];
  for (const text of texts) for (const token of parseChainPromptTokens(text || '')) {
    const explicit = /^artists?\s*:/i.test(token.text);
    const raw = token.text.replace(/^(?:artists?\s*:\s*|by[\s:]+|@)/i, '').replace(/\\([()])/g, '$1').trim();
    const key = normalizeArtistUsageKey(raw);
    if (!key || /[:,，\r\n|<>\[\]{}]/.test(key)) continue;
    const matched = exact.has(raw) ? raw : aliases.get(key);
    if (!explicit && !matched) continue;
    const name = matched || raw;
    const artist = artists.get(name) || { name, weights: [] };
    const weight = getChainPromptTokenWeight(token);
    if (!artist.weights.includes(weight)) artist.weights.push(weight);
    artists.set(name, artist);
  }
  return [...artists.values()];
}
