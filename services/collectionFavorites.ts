import type { Inspiration, InspirationSourceType, LocalGenItem, User } from '../types';
import { api, ApiError } from './api';
import { localHistory } from './localHistory';
import { aitagService, buildAitagImageUrl, extractAitagPrompt, getAitagMetadataText, type AitagWorkDetail } from './aitagService';
import { parseNovelAIMetadata } from './metadataService';
import { importPixivImageAsFile } from './pixivService';
import { importDanbooruCoverAsDataUrl } from './danbooruCoverImport';
import { normalizeInspirationTags, sourceLabel } from './inspirationUtils';
import { externalImageDrafts } from './externalImageTags';
import { createUuid } from './id';

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
let loading: Promise<Inspiration[]> | undefined;
const listeners = new Set<() => void>();
export const subscribeCollection = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const collectionRevision = () => revision;
export const collectionSnapshot = () => items;
const changed = () => { revision++; listeners.forEach(listener => listener()); };

export function historyFavorite(item: LocalGenItem, user: User): Inspiration {
  return {
    id: favoriteId('history', user.id, item.id), userId: user.id, username: user.username,
    title: item.sourceChainName || new Date(item.createdAt).toLocaleString(), imageUrl: item.imageUrl,
    prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params,
    sourceType: 'history', sourceId: item.id, tags: ['生成历史'],
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
    title: image.title!, prompt: image.prompt || '', tags: ['AITag'], sourceType: 'aitag',
    createdAt: detail.work.favoriteAt || detail.work.favorite_at || 0, updatedAt: detail.work.favoriteAt || detail.work.favorite_at || 0,
  }));
}

export function matchesCollectionImage(item: Inspiration, image: CollectionImage): boolean {
  if (image.collectionId) return item.id === image.collectionId;
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
  const byUrl = new Map<string, number>();
  const bySource = new Map<string, number>();
  const sourceKey = (item: Inspiration) => {
    if (!item.sourceType || !item.sourceId) return '';
    const imageId = item.sourceType === 'history' || item.sourceType === 'danbooru' ? '' : item.analysis?.collectionImageId ?? item.analysis?.externalSourcePage;
    return imageId === undefined ? '' : JSON.stringify([item.userId, item.sourceType, item.sourceId, String(imageId)]);
  };
  const index = (item: Inspiration, position: number) => {
    for (const url of [item.imageUrl, item.analysis?.collectionOriginalUrl]) {
      if (typeof url !== 'string') continue;
      const key = JSON.stringify([item.userId, url]);
      if (!byUrl.has(key)) byUrl.set(key, position);
    }
    const key = sourceKey(item);
    if (key && !bySource.has(key)) bySource.set(key, position);
  };
  result.forEach(index);
  for (const favorite of favorites) {
    const existing = result[Math.min(byUrl.get(JSON.stringify([favorite.userId, favorite.imageUrl])) ?? Infinity, bySource.get(sourceKey(favorite)) ?? Infinity)];
    if (!existing) { result.push(favorite); index(favorite, result.length - 1); }
    else if (favorite.sourceType === 'history') existing.archived = false;
  }
  return result.map(item => ({ ...item, tags: normalizeInspirationTags([sourceLabel(item.sourceType), ...(item.tags || [])]) }));
}

async function loadImageFavorites(user: User): Promise<Inspiration[]> {
  const [history, details] = await Promise.all([
    (async () => {
      const result: LocalGenItem[] = [];
      let total = Infinity;
      for (let page = 0; ; page++) {
        const batch = await localHistory.getPage(page, 200, { favoriteOnly: true }, page === 0);
        if (page === 0) total = batch.count ?? Infinity;
        result.push(...batch.items);
        if (result.length >= total || batch.items.length < 200) return result;
      }
    })(),
    api.get('/aitag/favorites').catch((cause: unknown) => {
      // 独立手机的旧运行时尚无此只读入口，已保存收藏仍可继续使用。
      if (cause instanceof ApiError && cause.status === 404) return [];
      throw cause;
    }) as Promise<AitagWorkDetail[]>,
  ]);
  return [...history.map(item => historyFavorite(item, user)), ...details.flatMap(detail => aitagFavorites(detail, user))];
}

export async function loadCollection(user?: User): Promise<Inspiration[]> {
  if (loading) return loading;
  loading = (async () => {
    const startedAt = revision;
    owner = user || owner || await api.get('/auth/me');
    const [stored, favorites] = await Promise.all([api.get('/inspirations') as Promise<Inspiration[]>, loadImageFavorites(owner!)]);
    if (revision !== startedAt) return items;
    items = mergeCollectionFavorites(stored, favorites);
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

export async function updateCollection(ids: string[], updates: Partial<Inspiration>): Promise<void> {
  await persistFavorites(ids);
  if (ids.length === 1) await api.put(`/inspirations/${encodeURIComponent(ids[0])}`, updates);
  else await api.post('/inspirations/bulk-update', { ids, updates });
  items = items.map(item => ids.includes(item.id) ? { ...item, ...updates } : item);
  changed();
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

export function collectionTargetActive(target: CollectionTarget): boolean {
  if (target.getGroup) {
    const userId = target.collectionId ? items.find(item => item.id === target.collectionId)?.userId : owner?.id;
    const group = items.filter(item => item.userId === userId && item.sourceType === target.sourceType && item.sourceId === target.sourceId);
    if (target.collectionId) return group.some(item => !item.archived);
    const size = Math.max(Number(group.find(item => item.analysis?.collectionGroupSize)?.analysis?.collectionGroupSize) || 1, target.groupSize || 1);
    return new Set(group.filter(item => !item.archived).map(item => item.analysis?.collectionImageId ?? item.analysis?.externalSourcePage ?? item.imageUrl)).size >= size;
  }
  return items.some(item => !item.archived && matchesCollectionImage(item, target));
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
      if (image.sourceType === 'pixiv' && /^https:\/\/i\.pximg\.net\//i.test(imageUrl)) imageUrl = (await api.uploadFile(await importPixivImageAsFile(imageUrl), 'inspirations')).url;
      else if (/^https:\/\/cdn\.donmai\.us\//i.test(imageUrl)) imageUrl = await importDanbooruCoverAsDataUrl(imageUrl);
      else if (imageUrl.startsWith('blob:')) {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error('无法读取收藏图片');
        const blob = await response.blob();
        imageUrl = (await api.uploadFile(new File([blob], 'collection.png', { type: blob.type }), 'inspirations')).url;
      }
      const reverse = image.sourceType === 'pixiv' || image.sourceType === 'danbooru' ? externalImageDrafts.get(`${image.sourceType}:${image.sourceId}:${image.imageId || 0}`) : undefined;
      const item: Inspiration = {
        id: createUuid(), userId: owner!.id, username: owner!.username,
        title: image.title || target.title || '未命名收藏', imageUrl,
        prompt: reverse?.prompt || image.prompt || '', negativePrompt: image.negativePrompt || '', params: image.params,
        sourceType: image.sourceType || target.sourceType || 'other', sourceId: image.sourceId || target.sourceId,
        sourceUrl: image.sourceUrl || target.sourceUrl, tags: [sourceLabel(image.sourceType || target.sourceType)],
        analysis: { ...image.analysis, ...(reverse ? { imageTagger: reverse } : {}), ...(!image.imageUrl.startsWith('data:') ? { collectionOriginalUrl: image.imageUrl } : {}), ...(image.imageId === undefined ? {} : { collectionImageId: image.imageId }), ...(target.getGroup ? { collectionGroupSize: images.length } : {}) },
        createdAt: now, updatedAt: now,
      };
      const response = await api.post('/inspirations', item);
      items = [...items, response.item || item];
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

export async function syncHistoryCollectionFavorites(ids: string[], favorite: boolean): Promise<void> {
  const saved = items.filter(item => item.sourceType === 'history' && ids.includes(item.sourceId || '') && !unsaved.has(item.id));
  if (saved.length) await updateCollection(saved.map(item => item.id), { archived: !favorite });
  window.dispatchEvent(new Event('nai-collection-changed'));
}

export async function markCollectionUsed(id: string): Promise<void> {
  await persistFavorites([id]);
  await api.post(`/inspirations/${encodeURIComponent(id)}/use`, {});
}
