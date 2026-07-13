
import { LocalGenItem, NAIParams } from '../types';

const DB_NAME = 'NAI_History_DB';
const STORE_NAME = 'generations';
const DB_VERSION = 2;

class LocalHistoryService {
    private db: IDBDatabase | null = null;

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

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(item);

            request.onsuccess = () => resolve(item);
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
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async clear(): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
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
        const results = await this.getAll();
        return results.slice(page * pageSize, (page + 1) * pageSize);
    }

    /**
     * 获取历史记录总数
     * @returns 记录总数
     */
    async getCount(): Promise<number> {
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
        const db = await this.open();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            let deletedCount = 0;
            let index_count = 0;
            
            // 事务完成处理
            transaction.oncomplete = () => {
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
