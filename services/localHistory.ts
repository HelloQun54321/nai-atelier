
import { ImageEditMetadata, LocalGenItem, NAIParams } from '../types';
import { api } from './api';
import { createUuid } from './id';

const DB_NAME = 'NAI_History_DB';
const STORE_NAME = 'generations';
const EDIT_MASK_STORE_NAME = 'editMasks';
const DB_VERSION = 4;
const HISTORY_THUMBNAIL_MAX_EDGE = 960;
const HISTORY_THUMBNAIL_VARIANT = 'thumb-960';

type LocalHistoryAddSource = Pick<LocalGenItem, 'basePrompt' | 'subjectPrompt' | 'modules' | 'sourceChainId' | 'sourceChainName' | 'sourceChainType' | 'edit'> & {
    editMask?: Blob;
};

type StoredEditMask = {
    historyId: string;
    blob: Blob;
    mimeType: string;
    updatedAt: number;
};

const normalizeHistoryEdit = (edit: ImageEditMetadata | undefined): ImageEditMetadata | undefined => {
    if (!edit) return undefined;
    const { maskData, actualCost, ...rest } = edit;
    const legacyCost = Number(actualCost);
    return {
        ...rest,
        ...(rest.estimatedCost === undefined && Number.isFinite(legacyCost) ? { estimatedCost: legacyCost } : {}),
        ...(rest.maskAvailable === undefined && typeof maskData === 'string' && maskData.length > 0 ? { maskAvailable: true } : {}),
    };
};

const normalizeHistoryItem = (item: LocalGenItem): LocalGenItem => {
    const params = item.params && typeof item.params === 'object'
        ? {
            ...item.params,
            ...((item.params as NAIParams & { _local_edit?: ImageEditMetadata })._local_edit
                ? { _local_edit: normalizeHistoryEdit((item.params as NAIParams & { _local_edit?: ImageEditMetadata })._local_edit) }
                : {}),
        } as NAIParams
        : item.params;
    return { ...item, params, edit: normalizeHistoryEdit(item.edit) };
};

const dataUrlToBlob = async (value: string): Promise<Blob> => {
    const response = await fetch(value);
    if (!response.ok) throw new Error('读取历史图片资产失败');
    return response.blob();
};

export type LocalHistoryChange = {
    type: 'add' | 'delete' | 'clear' | 'cleanup' | 'favorite' | 'remote-takeover';
    id?: string;
    favorite?: boolean;
    external?: boolean;
};

export interface LocalHistoryDateRange {
    from?: number;
    to?: number;
    favoriteOnly?: boolean;
}

export interface LocalHistoryPage {
    items: LocalGenItem[];
    count?: number;
}

export type LocalHistoryMigrationProgress = {
    current: number;
    total: number;
};

const createHistoryThumbnail = async (image: Blob): Promise<{ thumbnail: Blob | undefined; width: number; height: number } | undefined> => {
    try {
        const bitmap = await createImageBitmap(image);
        const { width, height } = { width: bitmap.width, height: bitmap.height };
        const scale = Math.min(1, HISTORY_THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            return undefined;
        }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const thumbnail = await new Promise<Blob | undefined>(resolve => {
            canvas.toBlob(blob => resolve(blob || undefined), 'image/webp', 0.8);
        });
        return { thumbnail, width, height };
    } catch {
        return undefined;
    }
};

const seedHistoryThumbnailCache = async (source: string, thumbnail: Blob) => {
    const response = await fetch(`/api/media/cache?source=${encodeURIComponent(source)}&variant=${HISTORY_THUMBNAIL_VARIANT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: thumbnail,
        credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('Unable to seed history thumbnail cache');
};

class LocalHistoryService {
    private db: IDBDatabase | null = null;
    private listeners = new Set<(change: LocalHistoryChange) => void>();
    private channel: BroadcastChannel | null = null;
    private remoteEnabled: boolean | null = null;
    private migrationPromise: Promise<number> | null = null;

    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('nai-local-history');
            this.channel.onmessage = (event: MessageEvent<LocalHistoryChange>) => {
                // 其他标签页已开始把浏览器历史迁移到本地服务：本页之后的写入必须
                // 直接走远端，否则新记录会落进即将被清空的浏览器库。此消息不是
                // 数据变更，不转发给订阅者。
                if (event.data?.type === 'remote-takeover') {
                    this.remoteEnabled = true;
                    return;
                }
                if (event.data?.type) {
                    this.notifyListeners({ ...event.data, external: true });
                }
            };
        }
    }

    subscribe(listener: (change: LocalHistoryChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners(change: LocalHistoryChange) {
        this.listeners.forEach(listener => listener(change));
    }

    private emit(change: LocalHistoryChange) {
        this.notifyListeners(change);
        this.channel?.postMessage(change);
    }

    private async isRemoteEnabled(): Promise<boolean> {
        if (this.remoteEnabled !== null) return this.remoteEnabled;
        try {
            const result = await api.get('/local-history/status');
            this.remoteEnabled = result.enabled === true;
            return this.remoteEnabled;
        } catch {
            return false;
        }
    }

    async prepare(onProgress?: (progress: LocalHistoryMigrationProgress) => void): Promise<number> {
        if (!(await this.isRemoteEnabled())) return 0;
        if (this.migrationPromise) return this.migrationPromise;

        this.migrationPromise = (async () => {
            // 宣告接管：广播后其他标签页立即把新历史写远端（本实例 remoteEnabled 已缓存为 true）。
            // 广播先于任何清空操作，把"迁移窗口内新记录落进待清空库"的窗口压到最短。
            this.channel?.postMessage({ type: 'remote-takeover' } satisfies LocalHistoryChange);

            const initialTotal = await this.getBrowserCount();
            if (initialTotal === 0) return 0;

            const batchSize = 10;
            let migrated = 0;
            // 迁移期间浏览器库不做任何删除，分页偏移因此稳定；已迁移记录靠 id 集合跳过，
            // 后续轮次只补迁新增（广播前已开始的事务等滞后写入）。
            const migratedIds = new Set<string>();
            for (let round = 0; round < 6; round++) {
                let roundNew = 0;
                for (let page = 0; ; page++) {
                    const batch = await this.getBrowserPage(page, batchSize);
                    if (batch.length === 0) break;
                    for (const item of batch) {
                        if (migratedIds.has(item.id)) continue;
                        const editMask = await this.getEditMask(item.id, item);
                        if (editMask) {
                            const image = await dataUrlToBlob(item.imageUrl);
                            const { imageUrl: _imageUrl, ...metadata } = item;
                            const formData = new FormData();
                            formData.append('image', image, `generation.${image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1] || 'png'}`);
                            formData.append('editMask', editMask, 'edit-mask.png');
                            formData.append('metadata', JSON.stringify(metadata));
                            await api.postForm('/local-history', formData);
                        } else {
                            await api.post('/local-history', normalizeHistoryItem(item));
                        }
                        migratedIds.add(item.id);
                        migrated++;
                        roundNew++;
                        onProgress?.({ current: migrated, total: Math.max(initialTotal, migrated) });
                    }
                }
                // 完整扫描一轮没有任何新记录，说明滞后写入已被全部补迁。
                if (roundNew === 0) break;
            }

            const remaining = await this.getBrowserCount();
            if (remaining > 0) {
                // 宁可放弃清空也不冒丢数据的风险：远端已有完整副本，浏览器库留待下次迁移重试。
                throw new Error(`历史迁移后浏览器库仍有 ${remaining} 条新增记录，已保留浏览器数据，请重试迁移`);
            }
            await this.clearBrowserHistory();
            this.emit({ type: 'add' });
            return migrated;
        })();

        try {
            return await this.migrationPromise;
        } finally {
            this.migrationPromise = null;
        }
    }

    private async open(): Promise<IDBDatabase> {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                let store: IDBObjectStore;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                } else {
                    store = request.transaction!.objectStore(STORE_NAME);
                    if (!store.indexNames.contains('createdAt')) {
                        store.createIndex('createdAt', 'createdAt', { unique: false });
                    }
                }

                if (!store.indexNames.contains('sourceChainId')) {
                    store.createIndex('sourceChainId', 'sourceChainId', { unique: false });
                }
                if (!store.indexNames.contains('isFavorite')) {
                    store.createIndex('isFavorite', 'isFavorite', { unique: false });
                }
                if (!db.objectStoreNames.contains(EDIT_MASK_STORE_NAME)) {
                    db.createObjectStore(EDIT_MASK_STORE_NAME, { keyPath: 'historyId' });
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                this.db.onversionchange = () => {
                    this.db?.close();
                    this.db = null;
                };
                resolve(this.db);
            };

            request.onerror = (event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    /** 迁移远端历史前读取浏览器旧库中的蒙版；读取失败不影响普通历史迁移。 */
    private async getBrowserEditMask(id: string, item?: LocalGenItem): Promise<Blob | null> {
        try {
            const db = await this.open();
            const stored = await new Promise<StoredEditMask | undefined>((resolve, reject) => {
                const request = db.transaction(EDIT_MASK_STORE_NAME, 'readonly').objectStore(EDIT_MASK_STORE_NAME).get(id);
                request.onsuccess = () => resolve(request.result as StoredEditMask | undefined);
                request.onerror = () => reject(request.error || new Error('读取历史蒙版失败'));
            });
            if (stored?.blob) return stored.blob;

            let legacyMask = item?.edit?.maskData;
            if (!legacyMask) {
                const storedItem = await new Promise<LocalGenItem | undefined>((resolve, reject) => {
                    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
                    request.onsuccess = () => resolve(request.result as LocalGenItem | undefined);
                    request.onerror = () => reject(request.error || new Error('读取历史记录失败'));
                });
                legacyMask = storedItem?.edit?.maskData;
            }
            return legacyMask ? dataUrlToBlob(legacyMask).catch(() => null) : null;
        } catch {
            return null;
        }
    }

    async add(
        image: string | Blob,
        prompt: string,
        params: NAIParams,
        negativePrompt = '',
        source?: LocalHistoryAddSource
    ): Promise<LocalGenItem> {
        const remoteEnabled = await this.isRemoteEnabled();
        const imageUrl = typeof image === 'string' ? image : '';
        const item: LocalGenItem = {
            id: createUuid(),
            imageUrl,
            prompt,
            negativePrompt,
            params,
            isFavorite: false,
            basePrompt: source?.basePrompt,
            subjectPrompt: source?.subjectPrompt,
            modules: source?.modules,
            sourceChainId: source?.sourceChainId,
            sourceChainName: source?.sourceChainName,
            sourceChainType: source?.sourceChainType,
            edit: normalizeHistoryEdit(source?.edit),
            createdAt: Date.now()
        };

        if (remoteEnabled) {
            let thumbnail: { thumbnail: Blob | undefined; width: number; height: number } | undefined;
            const uploadImage = image instanceof Blob
                ? image
                : source?.editMask
                    ? await dataUrlToBlob(image)
                    : null;
            const result = uploadImage
                ? await (async () => {
                    thumbnail = await createHistoryThumbnail(uploadImage);
                    // 复用缩略图 bitmap 的真实尺寸：调用方提供的宽高可能与图片文件不一致
                    if (thumbnail && thumbnail.width > 0 && thumbnail.height > 0) {
                        item.params = { ...item.params, width: thumbnail.width, height: thumbnail.height };
                    }
                    const formData = new FormData();
                    formData.append('image', uploadImage, `generation.${uploadImage.type === 'image/jpeg' ? 'jpg' : uploadImage.type.split('/')[1] || 'png'}`);
                    if (source?.editMask) formData.append('editMask', source.editMask, 'edit-mask.png');
                    formData.append('metadata', JSON.stringify(item));
                    return api.postForm('/local-history', formData);
                })()
                : await api.post('/local-history', item);
            if (thumbnail?.thumbnail && result.item?.imageUrl) {
                await seedHistoryThumbnailCache(result.item.imageUrl, thumbnail.thumbnail).catch(() => {});
            }
            this.emit({ type: 'add', id: item.id });
            return result.item as LocalGenItem;
        }

        const db = await this.open();
        if (image instanceof Blob) {
            item.imageUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('读取生成图片失败'));
                reader.readAsDataURL(image);
            });
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME, EDIT_MASK_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const editMaskStore = transaction.objectStore(EDIT_MASK_STORE_NAME);
            const request = store.add(item);
            if (source?.editMask) {
                editMaskStore.put({
                    historyId: item.id,
                    blob: source.editMask,
                    mimeType: source.editMask.type || 'image/png',
                    updatedAt: Date.now(),
                } satisfies StoredEditMask);
            }

            transaction.oncomplete = () => {
                this.emit({ type: 'add', id: item.id });
                resolve(item);
            };
            transaction.onerror = () => reject(transaction.error);
            request.onerror = () => reject(request.error);
        });
    }

    /** 保存独立编辑蒙版；远端记录会随 add() 的 multipart 一起上传。 */
    async saveEditMask(id: string, mask: Blob | undefined): Promise<void> {
        if (await this.isRemoteEnabled()) return;
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
            const store = db.transaction(EDIT_MASK_STORE_NAME, 'readwrite').objectStore(EDIT_MASK_STORE_NAME);
            const request = mask
                ? store.put({ historyId: id, blob: mask, mimeType: mask.type || 'image/png', updatedAt: Date.now() } satisfies StoredEditMask)
                : store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('保存历史蒙版失败'));
        });
    }

    /** 按需读取历史蒙版；旧记录中的 Base64 会在第一次访问时迁移到独立存储。 */
    async getEditMask(id: string, item?: LocalGenItem): Promise<Blob | null> {
        if (await this.isRemoteEnabled()) {
            try {
                return await api.getBlob(`/local-history/${encodeURIComponent(id)}/edit-mask`);
            } catch {
                // prepare() 会先读取本地旧记录再上传远端；此时远端还不存在该 ID，
                // 不能只看已经去掉 Base64 的轻量列表对象。
                return this.getBrowserEditMask(id, item);
            }
        }

        const db = await this.open();
        const stored = await new Promise<StoredEditMask | undefined>((resolve, reject) => {
            const request = db.transaction(EDIT_MASK_STORE_NAME, 'readonly').objectStore(EDIT_MASK_STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result as StoredEditMask | undefined);
            request.onerror = () => reject(request.error || new Error('读取历史蒙版失败'));
        });
        if (stored?.blob) return stored.blob;

        let legacyMask = item?.edit?.maskData;
        if (!legacyMask) {
            const storedItem = await new Promise<LocalGenItem | undefined>((resolve, reject) => {
                const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
                request.onsuccess = () => resolve(request.result as LocalGenItem | undefined);
                request.onerror = () => reject(request.error || new Error('读取历史记录失败'));
            });
            legacyMask = storedItem?.edit?.maskData;
        }
        if (!legacyMask) return null;
        try {
            const blob = await dataUrlToBlob(legacyMask);
            await this.saveEditMask(id, blob);
            // 迁移完成后清除历史记录中的大 Base64，列表与后续读取都只保留轻量元数据。
            const current = await new Promise<LocalGenItem | undefined>((resolve, reject) => {
                const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
                request.onsuccess = () => resolve(request.result as LocalGenItem | undefined);
                request.onerror = () => reject(request.error || new Error('读取历史记录失败'));
            });
            if (current?.edit?.maskData) {
                const updatedEdit = normalizeHistoryEdit(current.edit);
                const updated = { ...current, ...(updatedEdit ? { edit: updatedEdit } : { edit: undefined }) };
                const writeDb = await this.open();
                await new Promise<void>((resolve, reject) => {
                    const request = writeDb.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(updated);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error || new Error('迁移历史蒙版元数据失败'));
                });
            }
            return blob;
        } catch {
            return null;
        }
    }

    async deleteEditMask(id: string): Promise<void> {
        if (await this.isRemoteEnabled()) return;
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
            const request = db.transaction(EDIT_MASK_STORE_NAME, 'readwrite').objectStore(EDIT_MASK_STORE_NAME).delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('删除历史蒙版失败'));
        });
    }

    async getAll(): Promise<LocalGenItem[]> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const results = (request.result as LocalGenItem[])
                    .map(normalizeHistoryItem)
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                resolve(results);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getBySourceChain(sourceChainId: string, limit = 80): Promise<LocalGenItem[]> {
        if (!sourceChainId) return [];
        if (await this.isRemoteEnabled()) {
            const result = await api.get(`/local-history?sourceChainId=${encodeURIComponent(sourceChainId)}&limit=${limit}`);
            return result.items || [];
        }
        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);

            if (!store.indexNames.contains('sourceChainId')) {
                resolve([]);
                return;
            }

            const index = store.index('sourceChainId');
            const request = index.openCursor(IDBKeyRange.only(sourceChainId));
            const results: LocalGenItem[] = [];

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    results.push(normalizeHistoryItem(cursor.value as LocalGenItem));
                    cursor.continue();
                } else {
                    resolve(
                        results
                            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                            .slice(0, limit)
                    );
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async unlinkFromSourceChain(id: string): Promise<LocalGenItem | null> {
        if (await this.isRemoteEnabled()) {
            const result = await api.put(`/local-history/${encodeURIComponent(id)}/unlink`, {});
            return result.item || null;
        }
        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => {
                const item = request.result as LocalGenItem | undefined;
                if (!item) {
                    resolve(null);
                    return;
                }

                const updated: LocalGenItem = { ...item };
                delete updated.sourceChainId;
                delete updated.sourceChainName;
                delete updated.sourceChainType;

                const updateRequest = store.put(updated);
                updateRequest.onsuccess = () => resolve(updated);
                updateRequest.onerror = () => reject(updateRequest.error);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async unlinkAllFromSourceChain(sourceChainId: string): Promise<number> {
        if (!sourceChainId) return 0;
        if (await this.isRemoteEnabled()) {
            const result = await api.post('/local-history/unlink-source', { sourceChainId });
            return Number(result.count || 0);
        }
        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            if (!store.indexNames.contains('sourceChainId')) {
                resolve(0);
                return;
            }

            const index = store.index('sourceChainId');
            const request = index.openCursor(IDBKeyRange.only(sourceChainId));
            let unlinkedCount = 0;

            transaction.oncomplete = () => resolve(unlinkedCount);
            transaction.onerror = () => reject(transaction.error);

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    const updated: LocalGenItem = { ...(cursor.value as LocalGenItem) };
                    delete updated.sourceChainId;
                    delete updated.sourceChainName;
                    delete updated.sourceChainType;
                    cursor.update(updated);
                    unlinkedCount++;
                    cursor.continue();
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async delete(id: string): Promise<void> {
        if (await this.isRemoteEnabled()) {
            await api.delete(`/local-history/${encodeURIComponent(id)}`);
            // 幂等清理浏览器库中的同 id 残留：远端/本地模式曾翻转或迁移中断时，
            // 旧副本可能仍留在浏览器库，只删一侧会让记录在翻回本地模式时“复活”。
            await this.deleteBrowserRecord(id).catch(() => {});
            this.emit({ type: 'delete', id });
            return;
        }
        await this.deleteBrowserRecord(id);
        this.emit({ type: 'delete', id });
    }

    private async deleteBrowserRecord(id: string): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME, EDIT_MASK_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const editMaskStore = transaction.objectStore(EDIT_MASK_STORE_NAME);
            const request = store.delete(id);
            editMaskStore.delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            request.onerror = () => reject(request.error);
        });
    }

    async setFavorite(id: string, favorite: boolean): Promise<number> {
        return this.setFavorites([id], favorite);
    }

    async setFavorites(ids: string[], favorite: boolean): Promise<number> {
        const uniqueIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)));
        if (uniqueIds.length === 0) return 0;

        if (await this.isRemoteEnabled()) {
            const result = await api.post('/local-history/favorites', { ids: uniqueIds, favorite });
            const count = Number(result.updatedCount || 0);
            if (count > 0) this.emit({ type: 'favorite', id: uniqueIds.length === 1 ? uniqueIds[0] : undefined, favorite });
            return count;
        }

        const db = await this.open();
        const favoriteAt = favorite ? Date.now() : undefined;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            let updatedCount = 0;

            uniqueIds.forEach(id => {
                const request = store.get(id);
                request.onsuccess = () => {
                    const item = request.result as LocalGenItem | undefined;
                    if (!item) return;
                    const updated: LocalGenItem = { ...item, isFavorite: favorite };
                    if (favoriteAt) updated.favoriteAt = favoriteAt;
                    else delete updated.favoriteAt;
                    store.put(updated);
                    updatedCount++;
                };
                request.onerror = () => reject(request.error);
            });

            transaction.oncomplete = () => {
                if (updatedCount > 0) this.emit({ type: 'favorite', id: uniqueIds.length === 1 ? uniqueIds[0] : undefined, favorite });
                resolve(updatedCount);
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }
    
    async clear(): Promise<void> {
        if (await this.isRemoteEnabled()) {
            await api.delete('/local-history');
            // 与 delete 同理：清空是用户显式的“全部删除”，两侧副本都应清掉。
            await this.clearBrowserHistory().catch(() => {});
            this.emit({ type: 'clear' });
            return;
        }
        await this.clearBrowserHistory();
        this.emit({ type: 'clear' });
    }

    private async clearBrowserHistory(): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME, EDIT_MASK_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const editMaskStore = transaction.objectStore(EDIT_MASK_STORE_NAME);
            const request = store.clear();
            editMaskStore.clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 分页查询历史记录
     * @param page 页码（从0开始）
     * @param pageSize 每页数量
     * @returns 当前页的记录数组
     */
    async getPage(page: number, pageSize: number, range?: LocalHistoryDateRange, includeCount = true): Promise<LocalHistoryPage> {
        if (await this.isRemoteEnabled()) {
            const params = new URLSearchParams({ page: String(Math.max(0, page)), pageSize: String(Math.max(1, pageSize)) });
            if (range?.from) params.set('from', String(range.from));
            if (range?.to) params.set('to', String(range.to));
            if (range?.favoriteOnly) params.set('favorite', '1');
            if (!includeCount) params.set('includeCount', '0');
            const result = await api.get(`/local-history?${params.toString()}`);
            return { items: result.items || [], ...(includeCount ? { count: Number(result.count || 0) } : {}) };
        }
        const [items, count] = await Promise.all([
            this.getBrowserPage(page, pageSize, range),
            includeCount ? this.getBrowserCount(range) : Promise.resolve(undefined),
        ]);
        return { items, ...(count === undefined ? {} : { count }) };
    }

    private async getBrowserPage(page: number, pageSize: number, range?: LocalHistoryDateRange): Promise<LocalGenItem[]> {
        const db = await this.open();
        const safePage = Math.max(0, Math.floor(page));
        const safePageSize = Math.max(0, Math.floor(pageSize));

        if (safePageSize === 0) return [];

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            const keyRange = range?.from || range?.to
                ? IDBKeyRange.bound(range.from ?? 0, range.to ?? Number.MAX_SAFE_INTEGER)
                : null;
            const request = index.openCursor(keyRange, 'prev');
            const results: LocalGenItem[] = [];
            const offset = safePage * safePageSize;
            let skipped = 0;

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (!cursor) {
                    resolve(results);
                    return;
                }

                const item = normalizeHistoryItem(cursor.value as LocalGenItem);
                if (range?.favoriteOnly && !item.isFavorite) {
                    cursor.continue();
                    return;
                }
                if (skipped < offset) {
                    skipped++;
                    cursor.continue();
                    return;
                }

                results.push(item);
                if (results.length >= safePageSize) {
                    resolve(results);
                    return;
                }
                cursor.continue();
            };

            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 获取历史记录总数
     * @returns 记录总数
     */
    async getCount(range?: LocalHistoryDateRange): Promise<number> {
        if (await this.isRemoteEnabled()) {
            const params = new URLSearchParams();
            if (range?.from) params.set('from', String(range.from));
            if (range?.to) params.set('to', String(range.to));
            if (range?.favoriteOnly) params.set('favorite', '1');
            const result = await api.get(`/local-history/count${params.toString() ? `?${params.toString()}` : ''}`);
            return Number(result.count || 0);
        }
        return this.getBrowserCount(range);
    }

    private async getBrowserCount(range?: LocalHistoryDateRange): Promise<number> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const keyRange = range?.from || range?.to
                ? IDBKeyRange.bound(range.from ?? 0, range.to ?? Number.MAX_SAFE_INTEGER)
                : undefined;
            const index = store.index('createdAt');
            if (!range?.favoriteOnly) {
                const request = index.count(keyRange);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                return;
            }

            let count = 0;
            const request = index.openCursor(keyRange);
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve(count);
                    return;
                }
                if ((cursor.value as LocalGenItem).isFavorite) count++;
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除指定天数之前的历史记录
     * @param days 天数
     * @returns 删除的记录数量
     */
    async deleteOlderThan(days: number): Promise<number> {
        if (await this.isRemoteEnabled()) {
            const result = await api.post('/local-history/cleanup', { days });
            const count = Number(result.deletedCount || 0);
            if (count > 0) this.emit({ type: 'cleanup' });
            return count;
        }
        const db = await this.open();
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME, EDIT_MASK_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const editMaskStore = transaction.objectStore(EDIT_MASK_STORE_NAME);
            const index = store.index('createdAt');
            let deletedCount = 0;
            
            // 使用范围查询 createdAt < cutoffTime 的记录
            const range = IDBKeyRange.upperBound(cutoffTime, true);
            const request = index.openCursor(range);
            
            // 事务完成处理
            transaction.oncomplete = () => {
                if (deletedCount > 0) this.emit({ type: 'cleanup' });
                resolve(deletedCount);
            };
            
            transaction.onerror = () => {
                reject(transaction.error);
            };
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    editMaskStore.delete(cursor.primaryKey);
                    deletedCount++;
                    cursor.continue();
                }
                // 注意：不在这里resolve，等待事务完成
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 只保留最近的 N 条记录，删除多余的
     * @param n 要保留的记录数量
     * @returns 删除的记录数量
     */
    async keepOnly(n: number): Promise<number> {
        if (await this.isRemoteEnabled()) {
            const result = await api.post('/local-history/cleanup', { keepCount: n });
            const count = Number(result.deletedCount || 0);
            if (count > 0) this.emit({ type: 'cleanup' });
            return count;
        }
        const db = await this.open();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME, EDIT_MASK_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const editMaskStore = transaction.objectStore(EDIT_MASK_STORE_NAME);
            const index = store.index('createdAt');
            let deletedCount = 0;
            let index_count = 0;
            
            // 事务完成处理
            transaction.oncomplete = () => {
                if (deletedCount > 0) this.emit({ type: 'cleanup' });
                resolve(deletedCount);
            };
            
            transaction.onerror = () => {
                reject(transaction.error);
            };
            
            // 从最新记录开始遍历
            const request = index.openCursor(null, 'prev');
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    index_count++;
                    if (index_count > n) {
                        cursor.delete();
                        editMaskStore.delete(cursor.primaryKey);
                        deletedCount++;
                    }
                    cursor.continue();
                }
                // 注意：不在这里resolve，等待事务完成
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 统计指定天数之前的记录数量
     * @param days 天数
     * @returns 记录数量
     */
    async countOlderThan(days: number): Promise<number> {
        if (await this.isRemoteEnabled()) {
            const result = await api.get(`/local-history/count-older?days=${Math.max(1, Math.floor(days))}`);
            return Number(result.count || 0);
        }
        const db = await this.open();
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            
            // 使用范围查询 createdAt < cutoffTime 的记录
            const range = IDBKeyRange.upperBound(cutoffTime, true);
            const request = index.count(range);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

export const localHistory = new LocalHistoryService();
