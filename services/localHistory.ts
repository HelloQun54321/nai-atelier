
import { LocalGenItem, NAIParams } from '../types';
import { api } from './api';

const DB_NAME = 'NAI_History_DB';
const STORE_NAME = 'generations';
const DB_VERSION = 2;

export type LocalHistoryChange = {
    type: 'add' | 'delete' | 'clear' | 'cleanup';
    id?: string;
    external?: boolean;
};

export type LocalHistoryMigrationProgress = {
    current: number;
    total: number;
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
            const total = await this.getBrowserCount();
            if (total === 0) return 0;

            const batchSize = 10;
            let migrated = 0;
            for (let page = 0; migrated < total; page++) {
                const batch = await this.getBrowserPage(page, batchSize);
                if (batch.length === 0) break;
                for (const item of batch) {
                    await api.post('/local-history', item);
                    migrated++;
                    onProgress?.({ current: migrated, total });
                }
            }

            if (migrated !== total) throw new Error(`迁移数量不一致：${migrated}/${total}`);
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

    async add(
        imageUrl: string,
        prompt: string,
        params: NAIParams,
        negativePrompt = '',
        source?: Pick<LocalGenItem, 'sourceChainId' | 'sourceChainName' | 'sourceChainType'>
    ): Promise<LocalGenItem> {
        const db = await this.open();
        const item: LocalGenItem = {
            id: crypto.randomUUID(),
            imageUrl,
            prompt,
            negativePrompt,
            params,
            sourceChainId: source?.sourceChainId,
            sourceChainName: source?.sourceChainName,
            sourceChainType: source?.sourceChainType,
            createdAt: Date.now()
        };

        if (await this.isRemoteEnabled()) {
            const result = await api.post('/local-history', item);
            this.emit({ type: 'add', id: item.id });
            return result.item as LocalGenItem;
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(item);

            transaction.oncomplete = () => {
                this.emit({ type: 'add', id: item.id });
                resolve(item);
            };
            transaction.onerror = () => reject(transaction.error);
            request.onerror = () => reject(request.error);
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
                    results.push(cursor.value as LocalGenItem);
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
            this.emit({ type: 'delete', id });
            return;
        }
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            transaction.oncomplete = () => {
                this.emit({ type: 'delete', id });
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
            request.onerror = () => reject(request.error);
        });
    }
    
    async clear(): Promise<void> {
        if (await this.isRemoteEnabled()) {
            await api.delete('/local-history');
            this.emit({ type: 'clear' });
            return;
        }
        await this.clearBrowserHistory();
        this.emit({ type: 'clear' });
    }

    private async clearBrowserHistory(): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
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
    async getPage(page: number, pageSize: number): Promise<LocalGenItem[]> {
        if (await this.isRemoteEnabled()) {
            const result = await api.get(`/local-history?page=${Math.max(0, page)}&pageSize=${Math.max(1, pageSize)}`);
            return result.items || [];
        }
        return this.getBrowserPage(page, pageSize);
    }

    private async getBrowserPage(page: number, pageSize: number): Promise<LocalGenItem[]> {
        const db = await this.open();
        const safePage = Math.max(0, Math.floor(page));
        const safePageSize = Math.max(0, Math.floor(pageSize));

        if (safePageSize === 0) return [];

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            const request = index.openCursor(null, 'prev');
            const results: LocalGenItem[] = [];
            const offset = safePage * safePageSize;
            let positioned = offset === 0;

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (!cursor) {
                    resolve(results);
                    return;
                }

                if (!positioned) {
                    positioned = true;
                    cursor.advance(offset);
                    return;
                }

                results.push(cursor.value as LocalGenItem);
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
    async getCount(): Promise<number> {
        if (await this.isRemoteEnabled()) {
            const result = await api.get('/local-history/count');
            return Number(result.count || 0);
        }
        return this.getBrowserCount();
    }

    private async getBrowserCount(): Promise<number> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.count();
            
            request.onsuccess = () => resolve(request.result);
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
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
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
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
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
