import type { Inspiration, InspirationSourceType, InspirationUpdates, LocalGenItem, PromptChain, User } from '../types';
import { api, ApiError } from './api';
import { localHistory } from './localHistory';
import { aitagService, buildAitagImageUrl, extractAitagPrompt, getAitagMetadataText, type AitagWorkDetail } from './aitagService';
import { parseNovelAIMetadata } from './metadataService';
import { importPixivImageAsFile } from './pixivService';
import { importDanbooruCoverAsDataUrl } from './danbooruCoverImport';
import { applyCollectionBoardUpdates, getCollectionTags } from './inspirationUtils';
import { externalImageDrafts } from './externalImageTags';
import { createUuid } from './id';
import { readCodexImageFile, readCodexImageMetadata } from './codexService';
import { t } from './i18n';
import { getArtistSampleData } from './artistSampleDrafts';
import { normalizeArtistSampleTag } from './artistSamples';

export interface CollectionImage {
  imageUrl: string;
  title?: string;
  sourceType?: InspirationSourceType;
  sourceId?: string;
  sourceUrl?: string;
  imageId?: string;
  prompt?: string;
  negativePrompt?: string;
  params?: Inspiration['params'];
  analysis?: Inspiration['analysis'];
  collectionId?: string;
}

export interface CollectionTarget extends CollectionImage {
  groupSize?: number;
  getGroup?: () => Promise<CollectionImage[]>;
}

const favoriteId = (source: string, userId: string, id: string) => `favorite-${source}-${encodeURIComponent(userId)}-${encodeURIComponent(id)}`;
const isAutomaticFavorite = (id: string) => id.startsWith('favorite-history-') || id.startsWith('favorite-aitag-');
let items: Inspiration[] = [];
let unsaved = new Set<string>();
let revision = 0;
let owner: User | undefined;
let ownerRequest: Promise<User> | undefined;
let loading: Promise<Inspiration[]> | undefined;
let loadingOwner = '';
let loadingUsesChainSnapshot = false;
let requestedOwner = '';
let aitagCache = new Map<string, Inspiration[]>();
const ownerKey = (user: User) => JSON.stringify([user.id, user.role, user.username]);
const listeners = new Set<() => void>();
export const subscribeCollection = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const collectionRevision = () => revision;
export const collectionSnapshot = () => items;
const changed = () => { revision++; listeners.forEach(listener => listener()); };

export function readLegacyFavoriteIds(key: 'nai_chain_favs' | 'nai_character_favorites'): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return new Set();
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) throw new Error();
    return new Set(value);
  } catch { throw new Error(t('收藏库加载失败，请稍后重试')); }
}

/** 只汇总旧标记对应的当前封面；没有图片的标记留在原处，不批量写库或复制原图。 */
async function loadLegacyChainFavorites(user: User, chainSnapshot?: readonly PromptChain[]): Promise<Inspiration[]> {
  if (user.role === 'guest') return [];
  const legacy = readLegacyFavoriteIds('nai_chain_favs');
  const characters = readLegacyFavoriteIds('nai_character_favorites');
  const custom = new Set([...characters].filter(id => id.startsWith('custom:')).map(id => id.slice(7)));
  if (!legacy.size && !custom.size) return [];
  const chains: readonly PromptChain[] = chainSnapshot ?? await api.get('/chains');
  if (!Array.isArray(chains)) throw new Error(t('收藏库加载失败，请稍后重试'));
  return chains.filter(chain => (user.role === 'admin' || chain.userId === user.id) &&
    (chain.type === 'style' || chain.type === 'character' && !chain.tags?.includes('__character_catalog__')) &&
    (legacy.has(chain.id) || chain.type === 'character' && custom.has(chain.id)) && chain.previewImage && !chain.previewImage.startsWith('blob:'))
    .map(chain => ({
      id: favoriteId(chain.type === 'character' ? 'legacy-character' : 'legacy-chain', user.id, chain.id),
      userId: user.id, username: user.username, title: chain.name, imageUrl: chain.previewImage!,
      prompt: chain.basePrompt, negativePrompt: chain.negativePrompt, params: chain.params,
      sourceType: chain.type === 'character' ? 'character' : 'chain', sourceId: chain.id, tags: [],
      analysis: { collectionOriginalUrl: chain.previewImage, legacyChainFavorite: true },
      createdAt: chain.updatedAt || chain.createdAt, updatedAt: chain.updatedAt || chain.createdAt,
    }));
}

export function historyFavorite(item: LocalGenItem, user: User): Inspiration {
  return {
    id: favoriteId('history', user.id, item.id), userId: user.id, username: user.username,
    title: item.sourceChainName || new Date(item.createdAt).toLocaleString(), imageUrl: item.imageUrl,
    prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params,
    sourceType: 'history', sourceId: item.id, tags: [],
    createdAt: item.favoriteAt || item.createdAt, updatedAt: item.favoriteAt || item.createdAt,
  };
}

export function aitagCollectionImages(detail: AitagWorkDetail): CollectionImage[] {
  return detail.images.map((image, index) => {
    const metadata = getAitagMetadataText(image);
    const data = metadata.trim() ? parseNovelAIMetadata(metadata) : { prompt: extractAitagPrompt(image), negativePrompt: '', params: undefined };
    return {
      imageId: image.file_name || String(image.id),
      title: `${detail.work.title || `AITag ${detail.work.id}`}${detail.images.length > 1 ? ` · ${index + 1}` : ''}`,
      imageUrl: buildAitagImageUrl(image), prompt: data.prompt, negativePrompt: data.negativePrompt, params: data.params,
      sourceType: 'aitag', sourceId: String(detail.work.id), sourceUrl: `https://aitag.win/i/${detail.work.id}`,
      analysis: { collectionImageId: image.file_name || String(image.id), collectionGroupSize: detail.images.length },
    };
  });
}

export function aitagFavorites(detail: AitagWorkDetail, user: User): Inspiration[] {
  return aitagCollectionImages(detail).map(image => ({
    ...image, id: favoriteId('aitag', user.id, `${detail.work.id}:${image.imageId}`), userId: user.id, username: user.username,
    title: image.title!, prompt: image.prompt || '', tags: [], sourceType: 'aitag',
    createdAt: detail.work.favoriteAt || detail.work.favorite_at || 0, updatedAt: detail.work.favoriteAt || detail.work.favorite_at || 0,
  }));
}

export function matchesCollectionImage(item: Inspiration, image: CollectionImage): boolean {
  if (image.collectionId) return item.id === image.collectionId;
  // 缺样张画师只收藏 Tag；空地址不能把不同画师合并为同一张图。
  if (!image.imageUrl) return !item.imageUrl && image.sourceType === 'artist' && item.sourceType === 'artist' && Boolean(image.sourceId) && item.sourceId === image.sourceId;
  if (item.imageUrl === image.imageUrl || item.analysis?.collectionOriginalUrl === image.imageUrl) return true;
  if (image.sourceType && image.sourceId) {
    if (item.sourceType !== image.sourceType || item.sourceId !== image.sourceId) return false;
    if (image.sourceType === 'history' || image.sourceType === 'danbooru') return true;
    if (image.imageId !== undefined) return String(item.analysis?.collectionImageId ?? item.analysis?.externalSourcePage ?? '') === image.imageId;
  }
  return item.imageUrl === image.imageUrl;
}

export function mergeCollectionFavorites(stored: Inspiration[], favorites: Inspiration[]): Inspiration[] {
  const activeIds = new Set(favorites.map(item => item.id));
  const result = stored.map(item => ({ ...item, ...(isAutomaticFavorite(item.id) && !activeIds.has(item.id) ? { archived: true } : {}) }));
  const usedIds = new Set(result.map(item => item.id));
  const byUrl = new Map<string, number>();
  const bySource = new Map<string, number>();
  const sourceKey = (item: Inspiration) => {
    if (!item.sourceType || !item.sourceId) return '';
    const imageId = item.sourceType === 'history' || item.sourceType === 'danbooru' ? '' : item.analysis?.collectionImageId ?? item.analysis?.externalSourcePage;
    return imageId === undefined ? '' : JSON.stringify([item.userId, item.sourceType, item.sourceId, String(imageId)]);
  };
  const index = (item: Inspiration, position: number) => {
    for (const url of [item.imageUrl, item.analysis?.collectionOriginalUrl]) {
      if (typeof url !== 'string' || !url) continue;
      const key = JSON.stringify([item.userId, url]);
      if (!byUrl.has(key)) byUrl.set(key, position);
    }
    const key = sourceKey(item);
    if (key && !bySource.has(key)) bySource.set(key, position);
  };
  result.forEach(index);
  for (const favorite of favorites) {
    const existing = result[Math.min(byUrl.get(JSON.stringify([favorite.userId, favorite.imageUrl])) ?? Infinity, bySource.get(sourceKey(favorite)) ?? Infinity)];
    if (!existing) {
      // 同一旧串换过封面时保留已保存图片，新封面引用不能复用旧行 ID。
      let id = favorite.id, suffix = 0;
      while (usedIds.has(id)) id = `${favorite.id}-${++suffix}`;
      const added = id === favorite.id ? favorite : { ...favorite, id };
      usedIds.add(id);
      result.push(added); index(added, result.length - 1);
    }
    else if (favorite.sourceType === 'history') existing.archived = false;
  }
  return result.map(item => ({ ...item, tags: getCollectionTags(item) }));
}

async function loadImageFavorites(user: User, chainSnapshot?: readonly PromptChain[]) {
  const [history, details, legacyChains] = await Promise.all([
    (async () => {
      const result: LocalGenItem[] = [];
      let total = Infinity;
      for (let page = 0; ; page++) {
        const batch = await localHistory.getPage(page, 100, { favoriteOnly: true }, page === 0);
        if (page === 0) total = batch.count ?? Infinity;
        result.push(...batch.items);
        if (result.length >= total || batch.items.length < 100) return result;
        if (page === 0 && Number.isFinite(total)) {
          for (let nextPage = 1; nextPage < Math.ceil(total / 100); nextPage += 3) {
            const batches = await Promise.all(Array.from({ length: Math.min(3, Math.ceil(total / 100) - nextPage) }, (_, offset) =>
              localHistory.getPage(nextPage + offset, 100, { favoriteOnly: true }, false)));
            for (const next of batches) {
              result.push(...next.items);
              if (result.length >= total || next.items.length < 100) return result;
            }
          }
          return result;
        }
      }
    })(),
    api.get('/aitag/favorites').catch((cause: unknown) => {
      // 独立手机的旧运行时尚无此只读入口，已保存收藏仍可继续使用。
      if (cause instanceof ApiError && cause.status === 404) return [];
      throw cause;
    }) as Promise<AitagWorkDetail[]>,
    loadLegacyChainFavorites(user, chainSnapshot),
  ]);
  const previous = owner && ownerKey(owner) === ownerKey(user) ? aitagCache : new Map<string, Inspiration[]>();
  const parsed = new Map<string, Inspiration[]>();
  const aitag = details.flatMap(detail => {
    const key = JSON.stringify(detail);
    const favorites = previous.get(key) || aitagFavorites(detail, user);
    parsed.set(key, favorites);
    return favorites;
  });
  return { favorites: [...history.map(item => historyFavorite(item, user)), ...aitag, ...legacyChains], parsed };
}

export async function loadCollection(user?: User, chainSnapshot?: readonly PromptChain[]): Promise<Inspiration[]> {
  if (!user && loading) return loading;
  let requestUser = user || owner;
  if (!requestUser) {
    ownerRequest ||= api.get('/auth/me');
    try { requestUser = await ownerRequest; } finally { ownerRequest = undefined; }
  }
  const key = ownerKey(requestUser);
  requestedOwner = key;
  if (loading) {
    if (loadingOwner === key && (chainSnapshot !== undefined || !loadingUsesChainSnapshot)) return loading;
    try { await loading; } catch { /* 前次读取失败不阻止当前刷新。 */ }
    return loadCollection(requestUser, chainSnapshot);
  }
  loadingOwner = key;
  loadingUsesChainSnapshot = chainSnapshot !== undefined;
  loading = (async () => {
    const startedAt = revision;
    const [stored, { favorites, parsed }] = await Promise.all([api.get('/inspirations') as Promise<Inspiration[]>, loadImageFavorites(requestUser, chainSnapshot)]);
    if (requestedOwner !== key) return [];
    if (revision !== startedAt) return items;
    owner = requestUser;
    aitagCache = parsed;
    items = mergeCollectionFavorites(stored.map(item => ({ ...item, imageUrl: item.imageUrl || '' })), favorites);
    const savedIds = new Set(stored.map(item => item.id));
    unsaved = new Set(items.filter(item => !savedIds.has(item.id)).map(item => item.id));
    changed();
    return items;
  })();
  try { return await loading; } finally { loading = undefined; }
}

export async function ensureCollection(): Promise<void> {
  if (!owner || !revision) await loadCollection();
}

async function persistFavorites(ids: string[]): Promise<void> {
  for (const id of ids) {
    const item = items.find(item => item.id === id);
    if (!unsaved.has(id) || !item) continue;
    await api.post('/inspirations', item);
    unsaved.delete(id);
  }
}

export async function updateCollection(ids: string[], updates: InspirationUpdates): Promise<void> {
  if (!ids.length) return;
  await persistFavorites(ids);
  // 批量入口最多接收 500 项；每批成功后同步快照，失败不误报剩余项已保存。
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    if (chunk.length === 1) await api.put(`/inspirations/${encodeURIComponent(chunk[0])}`, updates);
    else await api.post('/inspirations/bulk-update', { ids: chunk, updates });
    const updatedIds = new Set(chunk);
    items = items.map(item => updatedIds.has(item.id) ? applyCollectionBoardUpdates(item, updates) : item);
    changed();
  }
}

export async function removeCollection(ids: string[]): Promise<void> {
  const selected = items.filter(item => ids.includes(item.id));
  const historyIds = selected.filter(item => item.sourceType === 'history' && item.sourceId).map(item => item.sourceId!);
  if (historyIds.length) await localHistory.setFavorites(historyIds, false);
  const workIds = new Set(selected.filter(item => item.sourceType === 'aitag').map(item => item.sourceId).filter(Boolean));
  for (const workId of workIds) {
    if (!items.some(item => item.sourceType === 'aitag' && item.sourceId === workId && !item.archived && !ids.includes(item.id))) await aitagService.setFavorite(workId!, false);
  }
  // 收藏移除只改变引用状态，原图与已有分类信息保留，重新收藏可以恢复。
  await updateCollection(ids, { archived: true });
}

const collectionKey = (...parts: unknown[]) => JSON.stringify(parts);
let activeIndex: ReturnType<typeof buildActiveIndex> | undefined;
function buildActiveIndex() {
  const byId = new Map<string, Inspiration>();
  const ids = new Set<string>(), urls = new Set<string>(), sources = new Set<string>(), artistTags = new Set<string>();
  const groups = new Map<string, { size: number; hasSize: boolean; identities: Set<unknown> }>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
    const key = collectionKey(item.userId, item.sourceType, item.sourceId);
    let group = groups.get(key);
    if (!group) { group = { size: 1, hasSize: false, identities: new Set() }; groups.set(key, group); }
    const declaredSize = item.analysis?.collectionGroupSize;
    if (!group.hasSize && declaredSize) { group.size = Number(declaredSize) || 1; group.hasSize = true; }
    if (item.archived) continue;
    group.identities.add(item.analysis?.collectionImageId ?? item.analysis?.externalSourcePage ?? item.imageUrl);
    ids.add(item.id);
    if (item.imageUrl) urls.add(item.imageUrl);
    const original = item.analysis?.collectionOriginalUrl;
    if (typeof original === 'string' && original) urls.add(original);
    if (!item.imageUrl && item.sourceType === 'artist' && item.sourceId) artistTags.add(item.sourceId);
    if (item.sourceType && item.sourceId) sources.add(collectionKey(item.sourceType, item.sourceId,
      item.sourceType === 'history' || item.sourceType === 'danbooru' ? '' : String(item.analysis?.collectionImageId ?? item.analysis?.externalSourcePage ?? '')));
  }
  return { snapshot: items, byId, ids, urls, sources, artistTags, groups };
}

export function collectionTargetActive(target: CollectionTarget): boolean {
  // 所有写入与加载均替换快照；同一快照的各卡片共用索引，owner 切换在查询时读取。
  if (activeIndex?.snapshot !== items) activeIndex = buildActiveIndex();
  const index = activeIndex;
  if (target.getGroup) {
    const userId = target.collectionId ? index.byId.get(target.collectionId)?.userId : owner?.id;
    const group = index.groups.get(collectionKey(userId, target.sourceType, target.sourceId));
    if (target.collectionId) return Boolean(group?.identities.size);
    return (group?.identities.size || 0) >= Math.max(group?.size || 1, target.groupSize || 1);
  }
  if (target.collectionId) return index.ids.has(target.collectionId);
  if (!target.imageUrl) return target.sourceType === 'artist' && Boolean(target.sourceId) && index.artistTags.has(target.sourceId!);
  if (index.urls.has(target.imageUrl)) return true;
  if (!target.sourceType || !target.sourceId) return false;
  if (target.sourceType === 'history' || target.sourceType === 'danbooru') return index.sources.has(collectionKey(target.sourceType, target.sourceId, ''));
  return target.imageId !== undefined && index.sources.has(collectionKey(target.sourceType, target.sourceId, target.imageId));
}

const pendingTargets = new Map<string, Promise<boolean>>();
let mutation: Promise<boolean> = Promise.resolve(false);
export async function toggleCollectionTarget(target: CollectionTarget): Promise<boolean> {
  await ensureCollection();
  if (owner?.role === 'guest') throw new Error('访客无法修改收藏');
  const key = `${target.sourceType}:${target.sourceId}:${target.getGroup ? 'group' : target.imageId ?? target.imageUrl}`;
  const pending = pendingTargets.get(key);
  if (pending) return pending;
  const favorite = !collectionTargetActive(target);
  const action = mutation.catch(() => false).then(async () => {
    if (!favorite) {
      const userId = target.collectionId ? items.find(item => item.id === target.collectionId)?.userId : owner?.id;
      const selected = items.filter(item => !item.archived && (target.getGroup ? item.userId === userId && item.sourceType === target.sourceType && item.sourceId === target.sourceId : matchesCollectionImage(item, target)));
      await removeCollection(selected.map(item => item.id));
      return false;
    }
    const images = target.getGroup ? await target.getGroup() : [target];
    if (!images.length) throw new Error('没有可收藏的图片');
    for (const image of images) {
      const existing = items.find(item => matchesCollectionImage(item, image));
      if (existing && owner?.role !== 'admin' && existing.userId !== owner?.id) throw new Error('无法修改其他用户的收藏');
      if (existing) {
        if (existing.archived) await updateCollection([existing.id], { archived: false });
        continue;
      }
      const now = Date.now();
      let imageUrl = image.imageUrl;
      let codexMetadata: Awaited<ReturnType<typeof readCodexImageMetadata>> = null;
      if (image.sourceType === 'codex' || image.sourceType === 'codex-community') {
        const file = await readCodexImageFile(imageUrl);
        codexMetadata = await readCodexImageMetadata(file);
        imageUrl = (await api.uploadFile(file, 'inspirations')).url;
      }
      else if (image.sourceType === 'pixiv' && /^https:\/\/i\.pximg\.net\//i.test(imageUrl)) imageUrl = (await api.uploadFile(await importPixivImageAsFile(imageUrl), 'inspirations')).url;
      else if (/^https:\/\/cdn\.donmai\.us\//i.test(imageUrl)) imageUrl = await importDanbooruCoverAsDataUrl(imageUrl);
      else if (imageUrl.startsWith('blob:') || imageUrl.startsWith('/api/artist-samples/image?')) {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error('无法读取收藏图片');
        const blob = await response.blob();
        imageUrl = (await api.uploadFile(new File([blob], 'collection.png', { type: blob.type }), 'inspirations')).url;
      }
      const reverse = image.sourceType === 'pixiv' || image.sourceType === 'danbooru' ? externalImageDrafts.get(`${image.sourceType}:${image.sourceId}:${image.imageId || 0}`) : undefined;
      const item: Inspiration = {
        id: createUuid(), userId: owner!.id, username: owner!.username,
        title: image.title || target.title || '未命名收藏', imageUrl,
        prompt: reverse?.prompt || (codexMetadata?.prompt ?? image.prompt ?? ''), negativePrompt: codexMetadata?.negativePrompt ?? image.negativePrompt ?? '', params: codexMetadata?.params || image.params,
        sourceType: image.sourceType || target.sourceType || 'other', sourceId: image.sourceId || target.sourceId,
        sourceUrl: image.sourceUrl || target.sourceUrl, tags: [],
        analysis: { ...image.analysis, ...(reverse ? { imageTagger: reverse } : {}), ...(!image.imageUrl.startsWith('data:') ? { collectionOriginalUrl: image.imageUrl } : {}), ...(image.imageId === undefined ? {} : { collectionImageId: image.imageId }), ...(target.getGroup ? { collectionGroupSize: images.length } : {}) },
        createdAt: now, updatedAt: now,
      };
      const response = await api.post('/inspirations', item);
      items = [...items, response.item ? { ...response.item, imageUrl: response.item.imageUrl || '' } : item];
      changed();
    }
    if (target.sourceType === 'history' && target.sourceId) await localHistory.setFavorite(target.sourceId, true);
    if (target.sourceType === 'aitag' && target.sourceId && target.getGroup) await aitagService.setFavorite(target.sourceId, true);
    return true;
  });
  pendingTargets.set(key, action); mutation = action;
  try { return await action; } finally {
    pendingTargets.delete(key);
  }
}

/** 画师偏好与收藏库共用来源组，取消偏好只归档收藏引用，原图保留。 */
export async function toggleArtistPreference(tag: string, imageUrl: string, sample?: CollectionImage): Promise<boolean> {
  await ensureCollection();
  const existing = collectionSnapshot().find(item => item.userId === owner?.id && item.sourceType === 'artist' && item.sourceId && normalizeArtistSampleTag(item.sourceId) === normalizeArtistSampleTag(tag));
  const sourceId = existing?.sourceId || tag;
  const saved = collectionSnapshot().filter(item => item.userId === owner?.id && item.sourceType === 'artist' && item.sourceId === sourceId);
  const ownSample = !sample && !saved.length && imageUrl.startsWith('/api/assets/') ? (await getArtistSampleData()).samples.find(sample => sample.imageUrl === imageUrl && normalizeArtistSampleTag(sample.tag) === normalizeArtistSampleTag(tag)) : undefined;
  const image: CollectionImage = { title: tag, prompt: ownSample?.prompt ?? `artist:${tag}`, negativePrompt: ownSample?.negativePrompt, params: ownSample?.params, imageId: imageUrl || 'tag', ...sample, imageUrl, sourceType: 'artist', sourceId };
  return toggleCollectionTarget({ ...image, ...(saved[0] ? { collectionId: saved[0].id } : {}), getGroup: async () => saved.length ? saved.map(item => ({ ...item, collectionId: item.id })) : [image] });
}

export async function syncHistoryCollectionFavorites(ids: string[], favorite: boolean): Promise<void> {
  const saved = items.filter(item => item.sourceType === 'history' && ids.includes(item.sourceId || '') && !unsaved.has(item.id));
  if (saved.length) await updateCollection(saved.map(item => item.id), { archived: !favorite });
  window.dispatchEvent(new Event('nai-collection-changed'));
}

export async function markCollectionUsed(id: string): Promise<void> {
  await persistFavorites([id]);
  await api.post(`/inspirations/${encodeURIComponent(id)}/use`, {});
}
