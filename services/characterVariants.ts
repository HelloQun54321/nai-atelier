import type { CollectionImage, CollectionTarget } from './collectionFavorites';
import { getCollectionSourceImage } from './collectionFavorites';
import { danbooruService } from './danbooruService';
import { getMobileOriginalUrl } from './mobileImageCache';
import { normalizeTagQuery, type CharacterDictionaryEntry } from './tagDictionary';

export interface CharacterVariantFavorite extends Pick<CollectionImage, 'prompt' | 'negativePrompt' | 'params'> {
  tag: string;
  title: string;
  fixedSrc?: string;
}

/** 只联动有真实基础条目、同名且同作品后缀的限定变体，保留各条原始 Tag。 */
export function buildCharacterVariantIndex(entries: readonly CharacterDictionaryEntry[]): Map<string, readonly CharacterDictionaryEntry[]> {
  const byName = new Map(entries.map(entry => [normalizeTagQuery(entry.name), entry]));
  const families = new Map<string, CharacterDictionaryEntry[]>();
  for (const entry of entries) {
    const name = normalizeTagQuery(entry.name);
    const match = /^([^()]+?)\s+((?:\([^()]+\)\s*)+)$/.exec(name);
    if (!match) continue;
    const qualifiers = [...match[2].matchAll(/\(([^()]+)\)/g)].map(part => part[1]);
    // shortcut: 词库未提供家族关系；无作品后缀或复杂括号不猜测，补充显式关系后再扩展。
    if (qualifiers.length < 2 || qualifiers.some(value => /\b(?:cosplay|meme)\b/.test(value))) continue;
    const anchor = `${match[1]} (${qualifiers[qualifiers.length - 1]})`;
    const base = byName.get(anchor);
    if (!base) continue;
    const family = families.get(anchor) || [base];
    family.push(entry);
    families.set(anchor, family);
  }
  const index = new Map<string, readonly CharacterDictionaryEntry[]>();
  for (const family of families.values()) {
    for (const entry of family) index.set(normalizeTagQuery(entry.name), family);
  }
  return index;
}

/** 添加目录时扩展完整家族，保留原始身份；移除目录不使用此函数。 */
export function resolveCharacterVariantMembershipKeys(keys: readonly string[], index: ReadonlyMap<string, readonly CharacterDictionaryEntry[]>): string[] {
  const resolved = new Set(keys);
  for (const key of keys) {
    if (!key.startsWith('catalog:')) continue;
    for (const entry of index.get(normalizeTagQuery(key.slice(8))) || []) resolved.add(`catalog:${entry.name}`);
  }
  return [...resolved];
}

/** 每个变体只收录一张；已有收藏直接复用，缺失成员才查代表封面。 */
export function characterVariantFavoriteTarget(current: CollectionImage, variants?: readonly CharacterVariantFavorite[]): CollectionTarget {
  if (!variants || variants.length < 2) return current;
  return {
    ...current,
    groupSourceIds: variants.map(variant => variant.tag),
    getGroup: async () => {
      const images: CollectionImage[] = [];
      for (const variant of variants) {
        const existing = getCollectionSourceImage('character', variant.tag);
        if (existing) { images.push(existing); continue; }
        if (variant.tag === current.sourceId && current.imageUrl) { images.push(current); continue; }
        let imageUrl = variant.fixedSrc || '';
        let imageId = imageUrl;
        if (!imageUrl) {
          const covers = await danbooruService.getCoverSet(variant.tag, 'character');
          const cover = covers.representative || covers.candidates[0];
          imageUrl = cover?.sampleUrl || cover?.previewUrl || '';
          imageId = cover ? String(cover.id) : '';
        }
        if (!imageUrl) throw new Error(`无法读取 ${variant.title} 的代表封面，请重试或为该角色设置封面`);
        images.push({
          imageUrl: getMobileOriginalUrl(imageUrl), imageId, title: variant.title,
          sourceType: 'character', sourceId: variant.tag,
          prompt: variant.prompt || variant.tag, negativePrompt: variant.negativePrompt, params: variant.params,
        });
      }
      return images;
    },
  };
}


export interface CharacterVariantGroup {
  id: string;
  representativeKey: string;
  memberKeys: readonly string[];
}

/** 展示归组只影响卡片层级；范围与抽中的身份由调用者提供。 */
export function groupCharacterVariantKeys(keys: readonly string[], index: ReadonlyMap<string, readonly CharacterDictionaryEntry[]>, eligibleKeys: ReadonlySet<string> = new Set(keys)): CharacterVariantGroup[] {
  const order = new Map([...eligibleKeys].map((key, position) => [key, position]));
  const seen = new Set<string>(), groups: CharacterVariantGroup[] = [];
  for (const key of keys) {
    if (!eligibleKeys.has(key)) continue;
    const family = key.startsWith('catalog:') ? index.get(normalizeTagQuery(key.slice(8))) : undefined;
    const id = family ? 'catalog:' + family[0].name : key;
    const members = family ? family.map(entry => 'catalog:' + entry.name).filter(member => eligibleKeys.has(member)).sort((a, b) => order.get(a)! - order.get(b)!) : [key];
    if (!members.includes(key)) {
      if (!seen.has(key)) { seen.add(key); groups.push({ id: key, representativeKey: key, memberKeys: [key] }); }
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const representativeKey = members.includes(id) ? id : members[0];
    groups.push({ id, representativeKey, memberKeys: [representativeKey, ...members.filter(member => member !== representativeKey)] });
  }
  return groups;
}
