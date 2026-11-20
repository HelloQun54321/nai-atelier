
import { ImageEditMetadata, LocalGenItem, NAIParams } from '../types';
import { api } from './api';
import { createUuid } from './id';
import { buildBrowserHistoryOrder, historyBrowseParams, type HistoryBrowseOrder, type HistoryBrowseQuery } from './historyBrowse';

const DB_NAME = 'NAI_History_DB';
const STORE_NAME = 'generations';
const EDIT_MASK_STORE_NAME = 'editMasks';
const BIN_STORE_NAME = 'recycleBin';
const BIN_EDIT_MASK_STORE_NAME = 'recycleBinEditMasks';
const DB_VERSION = 5;
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
    revision?: string;
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
    const rawDurationMs = Number(item.generationDurationMs ?? (params as NAIParams | undefined)?._local_generation_duration_ms);
    const generationDurationMs = Number.isFinite(rawDurationMs) && rawDurationMs > 0 ? Math.round(rawDurationMs) : undefined;
    return { ...item, params, edit: normalizeHistoryEdit(item.edit), ...(generationDurationMs !== undefined ? { generationDurationMs } : {}) };
};

const dataUrlToBlob = async (value: string): Promise<Blob> => {
    const response = await fetch(value);
    if (!response.ok) throw new Error('读取历史图片资产失败');
    return response.blob();
};

export type LocalHistoryRecycleBinItem = LocalGenItem & { movedAt: number; version: string };
export type LocalHistoryMoveSelection = { ids?: string[]; days?: number; keepCount?: number; clear?: boolean; protectedIds?: string[] };
export type LocalHistoryOperationIssue = { id: string; reasons: string[] };
export type LocalHistoryMovePreview = {
    previewToken: string; expiresAt: number; requestedCount: number; movableCount: number;
    skippedCount: number; skipped: LocalHistoryOperationIssue[];
};
export type LocalHistoryOperationResult = {
    operation: 'move' | 'restore' | 'purge'; requestedCount: number; completedCount: number;
    skippedCount: number; failedCount: number; movedCount: number; restoredCount: number; purgedCount: number;
    completedIds: string[]; skipped: LocalHistoryOperationIssue[]; failed: LocalHistoryOperationIssue[];
    warnings: LocalHistoryOperationIssue[]; success: boolean; ok: boolean;
    outcome: 'success' | 'partial' | 'blocked' | 'noop' | 'failed'; partial: boolean; deletedCount: number;
};
const operationResult = (operation: LocalHistoryOperationResult['operation'], requestedCount: number,
    completedIds: string[], skipped: LocalHistoryOperationIssue[], failed: LocalHistoryOperationIssue[]): LocalHistoryOperationResult => {
    const completedCount = completedIds.length;
    const success = skipped.length === 0 && failed.length === 0;
    return { operation, requestedCount, completedCount, completedIds, skipped, failed, warnings: [],
        skippedCount: skipped.length, failedCount: failed.length, movedCount: operation === 'move' ? completedCount : 0,
        restoredCount: operation === 'restore' ? completedCount : 0, purgedCount: operation === 'purge' ? completedCount : 0,
        success, ok: success, partial: completedCount > 0 && !success, deletedCount: completedCount,
        outcome: !requestedCount ? 'noop' : success ? 'success' : completedCount ? 'partial' : failed.length ? 'failed' : 'blocked' };
};
// 新条目使用随机版本；旧bin行按完整内容生成稳定版本，恢复再移入会获得新版本。
const binVersion = (item: LocalHistoryRecycleBinItem): string => item.version || JSON.stringify(item);
const uniqueHistoryIds = (ids: string[]) => [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];

export type LocalHistoryChange = {
    type: 'add' | 'delete' | 'clear' | 'cleanup' | 'favorite' | 'remote-takeover' | 'move' | 'restore' | 'purge' | 'migration-failed';
    completedIds?: string[];
    id?: string;
    favorite?: boolean;
    external?: boolean;
};

export interface LocalHistoryDateRange extends HistoryBrowseQuery {
    /** 本次浏览的轻量索引；生成/收藏变化不会静默改变浏览顺序。 */
    orderIds?: string[];
    browseKey?: string;
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
    private migrationError: string | null = null;
    private movePreviews = new Map<string, { expiresAt: number; ids: string[]; versions: Map<string, string>; skipped: LocalHistoryOperationIssue[]; requestedCount: number }>();

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

    /**
     * 后台任务已把结果写入历史（不经本页 add）：只广播变更让各视图刷新，
     * 不能在本页重复入库。
     */
    notifyBackgroundSaved(id?: string) {
        this.emit({ type: 'add', id });
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

    async getRecycleBinCapabilities(): Promise<{ move: 'remote' | 'requires-remote-migration' }> {
        return { move: await this.isRemoteEnabled() ? 'remote' : 'requires-remote-migration' };
    }

    /** 失败迁移的本地归档只读入口；正常写入继续走远端，避免重新分叉。 */
    async getBrowserMigrationRecovery(): Promise<{ error: string | null; active: LocalGenItem[]; bin: LocalHistoryRecycleBinItem[] }> {
        return { error: this.migrationError, active: await this.browserRows(), bin: (await this.browserRows<LocalHistoryRecycleBinItem>(BIN_STORE_NAME)).map(row => ({ ...row, version: binVersion(row) })) };
    }

    async getBrowserMigrationRecoveryMask(id: string, bin = false): Promise<Blob | null> {
        return this.readBrowserMask(id, bin);
    }

    private async browserRows<T = LocalGenItem>(storeName: string = STORE_NAME): Promise<T[]> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).getAll();
            tx.oncomplete = () => resolve(request.result as T[]);
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('读取历史记录失败'));
        });
    }

    async getRecycleBinPage(page: number, pageSize: number, range?: LocalHistoryDateRange): Promise<{ items: LocalHistoryRecycleBinItem[]; count: number }> {
        if (await this.isRemoteEnabled()) {
            const query = new URLSearchParams({ page: String(Math.max(0, page)), pageSize: String(Math.max(1, pageSize)) });
            if (range?.from !== undefined) query.set('from', String(range.from));
            if (range?.to !== undefined) query.set('to', String(range.to));
            return api.get(`/local-history/recycle-bin?${query}`, { cache: 'no-store' });
        }
        const rows = (await this.browserRows<LocalHistoryRecycleBinItem>(BIN_STORE_NAME))
            .filter(item => (range?.from === undefined || item.createdAt >= range.from) && (range?.to === undefined || item.createdAt <= range.to))
            .sort((a, b) => b.movedAt - a.movedAt || b.id.localeCompare(a.id));
        const size = Math.max(1, Math.floor(pageSize));
        return { items: rows.slice(Math.max(0, page) * size, (Math.max(0, page) + 1) * size).map(item => ({ ...normalizeHistoryItem(item), movedAt: item.movedAt, version: binVersion(item) })), count: rows.length };
    }

    async countRecycleBin(range?: LocalHistoryDateRange): Promise<number> {
        if (await this.isRemoteEnabled()) {
            const query = new URLSearchParams();
            if (range?.from !== undefined) query.set('from', String(range.from));
            if (range?.to !== undefined) query.set('to', String(range.to));
            return Number((await api.get(`/local-history/recycle-bin/count?${query}`, { cache: 'no-store' })).count);
        }
        return (await this.getRecycleBinPage(0, 1, range)).count;
    }

    async getRecycleBinItem(id: string): Promise<LocalHistoryRecycleBinItem | null> {
        if (await this.isRemoteEnabled()) return (await api.get(`/local-history/recycle-bin/${encodeURIComponent(id)}`, { cache: 'no-store' })).item || null;
        const row = (await this.browserRows<LocalHistoryRecycleBinItem>(BIN_STORE_NAME)).find(item => item.id === id);
        return row ? { ...row, version: binVersion(row) } : null;
    }

    async getRecycleBinEditMask(id: string, item?: LocalHistoryRecycleBinItem): Promise<Blob | null> {
        if (await this.isRemoteEnabled()) return api.getBlob(`/local-history/recycle-bin/${encodeURIComponent(id)}/edit-mask`);
        return this.readBrowserMask(id, true, item);
    }

    private async readBrowserMask(id: string, bin = false, item?: LocalGenItem): Promise<Blob | null> {
        const masks = await this.browserRows<StoredEditMask>(bin ? BIN_EDIT_MASK_STORE_NAME : EDIT_MASK_STORE_NAME);
        const mask = masks.find(entry => entry.historyId === id)?.blob;
        if (mask) return mask;
        const row = item?.edit?.maskData ? item : (await this.browserRows(bin ? BIN_STORE_NAME : STORE_NAME)).find(row => row.id === id);
        return row?.edit?.maskData ? dataUrlToBlob(row.edit.maskData) : null;
    }

    /** 浏览器没有完整持久引用快照时不能把未知当成未引用。 */
    private async browserMoveReasons(item: LocalGenItem, protectedIds: string[] = []): Promise<string[]> {
        if (item.isFavorite || protectedIds.includes(item.id)) return ['favorite'];
        return ['reference_check_failed'];
    }

    async previewMove(selection: LocalHistoryMoveSelection): Promise<LocalHistoryMovePreview> {
        if (await this.isRemoteEnabled()) return api.post('/local-history/recycle-bin/preview', selection);
        const modes = [selection.ids !== undefined, selection.days !== undefined, selection.keepCount !== undefined, selection.clear === true].filter(Boolean).length;
        if (modes !== 1 || (selection.days !== undefined && (!Number.isFinite(selection.days) || selection.days < 1)) ||
            (selection.keepCount !== undefined && (!Number.isInteger(selection.keepCount) || selection.keepCount < 1))) throw new Error('清理条件无效');
        const rows = (await this.browserRows()).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        const cutoff = Date.now() - (selection.days || 0) * 86400000;
        const ids = selection.ids ? uniqueHistoryIds(selection.ids) : selection.clear ? rows.map(row => row.id) :
            selection.days !== undefined ? rows.filter(row => row.createdAt < cutoff).map(row => row.id) : rows.slice(selection.keepCount).map(row => row.id);
        const allowed: string[] = [], skipped: LocalHistoryOperationIssue[] = [], versions = new Map<string, string>();
        for (const id of ids) {
            const row = rows.find(item => item.id === id);
            const reasons = row ? await this.browserMoveReasons(row, selection.protectedIds) : ['not_found'];
            if (reasons.length) skipped.push({ id, reasons });
            else { allowed.push(id); versions.set(id, JSON.stringify(row)); }
        }
        for (const [token, saved] of this.movePreviews) if (saved.expiresAt <= Date.now()) this.movePreviews.delete(token);
        const previewToken = createUuid(), expiresAt = Date.now() + 5 * 60000;
        this.movePreviews.set(previewToken, { expiresAt, ids: allowed, versions, skipped, requestedCount: ids.length });
        return { previewToken, expiresAt, requestedCount: ids.length, movableCount: allowed.length, skippedCount: skipped.length, skipped };
    }

    async moveToRecycleBin(input: { ids?: string[]; previewToken?: string; protectedIds?: string[] }): Promise<LocalHistoryOperationResult> {
        if (await this.isRemoteEnabled()) return this.remoteBinOperation('move', input);
        const preview = input.previewToken ? this.movePreviews.get(input.previewToken) : undefined;
        if (input.previewToken && (!preview || preview.expiresAt <= Date.now())) throw new Error('清理预览已过期，请重新预览');
        const ids = preview ? preview.ids.filter(id => !input.ids || input.ids.includes(id)) : uniqueHistoryIds(input.ids || []);
        return this.browserBinOperation('move', ids, preview, input.protectedIds);
    }

    async restoreFromRecycleBin(ids: string[], expectedVersions: Record<string, string>): Promise<LocalHistoryOperationResult> {
        if (!expectedVersions || uniqueHistoryIds(ids).some(id => !expectedVersions[id])) throw new Error('缺少确认时的回收站版本，请重新选择记录');
        return await this.isRemoteEnabled() ? this.remoteBinOperation('restore', { ids: uniqueHistoryIds(ids), ...(expectedVersions ? { expectedVersions } : {}) }) : this.browserBinOperation('restore', uniqueHistoryIds(ids), undefined, undefined, expectedVersions);
    }

    async purgeRecycleBin(ids: string[], expectedVersions: Record<string, string>): Promise<LocalHistoryOperationResult> {
        if (!expectedVersions || uniqueHistoryIds(ids).some(id => !expectedVersions[id])) throw new Error('缺少确认时的回收站版本，请重新选择记录');
        return await this.isRemoteEnabled() ? this.remoteBinOperation('purge', { ids: uniqueHistoryIds(ids), ...(expectedVersions ? { expectedVersions } : {}) }) : this.browserBinOperation('purge', uniqueHistoryIds(ids), undefined, undefined, expectedVersions);
    }

    private async remoteBinOperation(operation: LocalHistoryOperationResult['operation'], input: { ids?: string[]; previewToken?: string; protectedIds?: string[]; expectedVersions?: Record<string, string> }): Promise<LocalHistoryOperationResult> {
        const result: LocalHistoryOperationResult = await api.post(`/local-history/recycle-bin/${operation}`, input);
        if (result.completedIds?.length) this.emit({ type: operation, completedIds: result.completedIds, id: result.completedIds.length === 1 ? result.completedIds[0] : undefined });
        return result;
    }

    private async browserBinOperation(operation: LocalHistoryOperationResult['operation'], ids: string[], preview?: { versions: Map<string, string>; skipped: LocalHistoryOperationIssue[]; requestedCount: number }, protectedIds?: string[], expectedVersions?: Record<string, string>): Promise<LocalHistoryOperationResult> {
        const completed: string[] = [], skipped = [...(preview?.skipped || [])], failed: LocalHistoryOperationIssue[] = [];
        const db = await this.open();
        for (const id of ids) {
            // 每项一个跨 active/bin/蒙版的原子事务；一项失败不影响其他项。
            if (operation === 'move') {
                const row = (await this.browserRows()).find(item => item.id === id);
                const reasons = row ? await this.browserMoveReasons(row, protectedIds) : ['not_found'];
                if (reasons.length) { skipped.push({ id, reasons }); continue; }
            }
            try {
                const reason = await new Promise<string | null>((resolve, reject) => {
                    const tx = db.transaction([STORE_NAME, BIN_STORE_NAME, EDIT_MASK_STORE_NAME, BIN_EDIT_MASK_STORE_NAME], 'readwrite');
                    const source = tx.objectStore(operation === 'move' ? STORE_NAME : BIN_STORE_NAME);
                    const target = tx.objectStore(operation === 'move' ? BIN_STORE_NAME : STORE_NAME);
                    const sourceMasks = tx.objectStore(operation === 'move' ? EDIT_MASK_STORE_NAME : BIN_EDIT_MASK_STORE_NAME);
                    const targetMasks = tx.objectStore(operation === 'move' ? BIN_EDIT_MASK_STORE_NAME : EDIT_MASK_STORE_NAME);
                    let skip: string | null = null;
                    tx.oncomplete = () => resolve(skip);
                    tx.onabort = tx.onerror = () => reject(tx.error || new Error('历史事务失败'));
                    const request = source.get(id);
                    request.onsuccess = () => {
                        const row = request.result as LocalHistoryRecycleBinItem | undefined;
                        if (!row) { skip = 'not_found'; return; }
                        if (operation !== 'move' && expectedVersions && expectedVersions[id] !== binVersion(row)) { skip = 'source_changed'; return; }
                        if (operation === 'purge') { source.delete(id); sourceMasks.delete(id); return; }
                        if (operation === 'move' && (row.isFavorite || (preview && preview.versions.get(id) !== JSON.stringify(row)))) { skip = row.isFavorite ? 'favorite' : 'source_changed'; return; }
                        const collision = target.get(id);
                        collision.onsuccess = () => {
                            if (collision.result) { skip = 'id_conflict'; return; }
                            const { movedAt: _movedAt, version: _version, ...active } = row;
                            // 外部身份也必须唯一，不能恢复成重复的外部作品。
                            const all = target.getAll();
                            all.onsuccess = () => {
                                type ExternalIdentity = LocalGenItem & { externalSource?: string; externalId?: string; external_source?: string; external_id?: string };
                                const identity = row as ExternalIdentity;
                                const sourceKey = identity.externalSource || identity.external_source;
                                const externalKey = identity.externalId || identity.external_id;
                                if (sourceKey && externalKey && all.result.some((other: ExternalIdentity) => (other.externalSource || other.external_source) === sourceKey && (other.externalId || other.external_id) === externalKey)) { skip = 'external_identity_conflict'; return; }
                                target.add(operation === 'move' ? { ...row, movedAt: Date.now(), version: createUuid() } : active);
                                const mask = sourceMasks.get(id);
                                mask.onsuccess = () => { if (mask.result) targetMasks.add(mask.result); sourceMasks.delete(id); };
                                source.delete(id);
                            };
                        };
                    };
                });
                if (reason) skipped.push({ id, reasons: [reason] }); else completed.push(id);
            } catch { failed.push({ id, reasons: ['transaction_failed'] }); }
        }
        const result = operationResult(operation, preview?.requestedCount ?? ids.length, completed, skipped, failed);
        if (completed.length) this.emit({ type: operation, completedIds: completed, id: completed.length === 1 ? completed[0] : undefined });
        return result;
    }

    async prepare(onProgress?: (progress: LocalHistoryMigrationProgress) => void): Promise<number> {
        if (!(await this.isRemoteEnabled())) return 0;
        if (this.migrationPromise) return this.migrationPromise;
        this.migrationPromise = (async () => {
            this.channel?.postMessage({ type: 'remote-takeover' } satisfies LocalHistoryChange);
            const initialTotal = (await this.browserRows()).length + (await this.browserRows(BIN_STORE_NAME)).length;
            let migrated = 0;
            for (let round = 0; round < 6; round++) {
                let roundCount = 0;
                for (const bin of [false, true]) {
                    const rows = await this.browserRows<LocalHistoryRecycleBinItem>(bin ? BIN_STORE_NAME : STORE_NAME);
                    for (const item of rows) {
                        // 蒙版读取失败必须停止迁移并保留源，不能把错误当成没有蒙版。
                        const maskSnapshot = (await this.browserRows<StoredEditMask>(bin ? BIN_EDIT_MASK_STORE_NAME : EDIT_MASK_STORE_NAME)).find(row => row.historyId === item.id);
                        const mask = maskSnapshot?.blob || (item.edit?.maskData ? await dataUrlToBlob(item.edit.maskData) : null);
                        if (item.edit?.maskAvailable && !mask) throw new Error(`历史 ${item.id} 的蒙版缺失，已保留浏览器源记录`);
                        const image = await dataUrlToBlob(item.imageUrl);
                        const form = new FormData();
                        const { imageUrl: _url, ...metadata } = normalizeHistoryItem(item);
                        form.append('image', image, 'generation.png');
                        if (mask) form.append('editMask', mask, 'edit-mask.png');
                        form.append('metadata', JSON.stringify(metadata));
                        const response = await api.postForm(bin ? '/local-history/recycle-bin/import' : '/local-history/import', form);
                        if (response?.item?.id !== item.id) throw new Error(`历史 ${item.id} 的远端保存未确认，已保留浏览器源记录`);
                        await this.removeMigratedBrowserRecord(item, bin, maskSnapshot);
                        migrated++; roundCount++;
                        onProgress?.({ current: migrated, total: Math.max(initialTotal, migrated) });
                    }
                }
                if (!roundCount) break;
            }
            const remaining = (await this.browserRows()).length + (await this.browserRows(BIN_STORE_NAME)).length;
            if (remaining) throw new Error(`仍有 ${remaining} 条浏览器历史待迁移，已保留源数据，请重试`);
            if (migrated) this.emit({ type: 'add' });
            return migrated;
        })();
        try {
            const result = await this.migrationPromise;
            this.migrationError = null;
            return result;
        } catch (error) {
            this.migrationError = error instanceof Error ? error.message : String(error);
            this.emit({ type: 'migration-failed' });
            throw error;
        } finally { this.migrationPromise = null; }
    }

    private async removeMigratedBrowserRecord(item: LocalGenItem, bin: boolean, expectedMask: StoredEditMask | undefined): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([bin ? BIN_STORE_NAME : STORE_NAME, bin ? BIN_EDIT_MASK_STORE_NAME : EDIT_MASK_STORE_NAME], 'readwrite');
            const store = tx.objectStore(bin ? BIN_STORE_NAME : STORE_NAME);
            const masks = tx.objectStore(bin ? BIN_EDIT_MASK_STORE_NAME : EDIT_MASK_STORE_NAME);
            const row = store.get(item.id), mask = masks.get(item.id);
            let checked = 0;
            const finish = () => {
                if (++checked < 2) return;
                // Blob 内容不能在活跃 IDB 事务中异步比较；使用写入版本及快照属性核验后清源。
                const currentMask = mask.result as StoredEditMask | undefined;
                if (JSON.stringify(row.result) !== JSON.stringify(item) || (!!currentMask !== !!expectedMask) ||
                    (currentMask && expectedMask && (currentMask.revision !== expectedMask.revision || currentMask.updatedAt !== expectedMask.updatedAt || currentMask.blob.size !== expectedMask.blob.size || currentMask.blob.type !== expectedMask.blob.type))) { tx.abort(); return; }
                store.delete(item.id); masks.delete(item.id);
            };
            row.onsuccess = finish; mask.onsuccess = finish;
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('迁移期间源记录发生变化，已保留浏览器副本'));
        });
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
                if (!db.objectStoreNames.contains(BIN_STORE_NAME)) {
                    const bin = db.createObjectStore(BIN_STORE_NAME, { keyPath: 'id' });
                    bin.createIndex('movedAt', 'movedAt', { unique: false });
                    bin.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(BIN_EDIT_MASK_STORE_NAME)) {
                    db.createObjectStore(BIN_EDIT_MASK_STORE_NAME, { keyPath: 'historyId' });
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

    /** 远端蒙版尚未可用时读取旧副本；正式迁移使用严格读取，不吞掉错误。 */
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
                    updatedAt: Date.now(), revision: createUuid(),
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
                ? store.put({ historyId: id, blob: mask, mimeType: mask.type || 'image/png', updatedAt: Date.now(), revision: createUuid() } satisfies StoredEditMask)
                : store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('保存历史蒙版失败'));
        });
    }

    /** 按需读取历史蒙版；旧Base64保持只读，避免接管期间读操作重写或复活源记录。 */
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
        const result = await this.moveToRecycleBin({ ids: [id] });
        if (!result.success) throw new Error('移入回收站未完成：' + [...result.skipped, ...result.failed].flatMap(item => item.reasons).join('、'));
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
        const preview = await this.previewMove({ clear: true });
        const result = await this.moveToRecycleBin({ previewToken: preview.previewToken });
        if (!result.success) throw new Error('部分历史受保护或无法确认引用，已保留源记录');
    }

    /**
     * 分页查询历史记录
     * @param page 页码（从0开始）
     * @param pageSize 每页数量
     * @returns 当前页的记录数组
     */
    async getBrowseOrder(query: HistoryBrowseQuery): Promise<HistoryBrowseOrder> {
        if (await this.isRemoteEnabled()) {
            return api.get(`/local-history/browse?${historyBrowseParams(query)}`, { cache: 'no-store' });
        }
        return buildBrowserHistoryOrder(await this.getBrowserPage(0, Number.MAX_SAFE_INTEGER), query);
    }

    async getPage(page: number, pageSize: number, range?: LocalHistoryDateRange, includeCount = true): Promise<LocalHistoryPage> {
        if (range?.orderIds) {
            const ids = range.orderIds.slice(Math.max(0, page) * pageSize, (Math.max(0, page) + 1) * pageSize);
            let items: LocalGenItem[] = [];
            if (ids.length) {
                if (await this.isRemoteEnabled()) {
                    const result = await api.post('/local-history/browse-page', { ids });
                    const rows = new Map<string, LocalGenItem>((result.items || []).map((item: LocalGenItem) => [item.id, item]));
                    items = ids.flatMap(id => rows.has(id) ? [rows.get(id)!] : []);
                } else {
                    const database = await this.open();
                    items = await new Promise((resolve, reject) => {
                        const transaction = database.transaction([STORE_NAME], 'readonly');
                        const store = transaction.objectStore(STORE_NAME);
                        const found = new Map<string, LocalGenItem>();
                        ids.forEach(id => {
                            const request = store.get(id);
                            request.onsuccess = () => { if (request.result) found.set(id, normalizeHistoryItem(request.result)); };
                        });
                        transaction.oncomplete = () => resolve(ids.flatMap(id => found.has(id) ? [found.get(id)!] : []));
                        transaction.onerror = () => reject(transaction.error);
                    });
                }
            }
            return { items, ...(includeCount ? { count: range.orderIds.length } : {}) };
        }
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
        const preview = await this.previewMove({ days });
        const result = await this.moveToRecycleBin({ previewToken: preview.previewToken });
        if (!result.success) throw new Error('清理未完全完成：受保护或无法确认引用的历史已保留');
        return result.completedCount;
    }

    /**
     * 只保留最近的 N 条记录，删除多余的
     * @param n 要保留的记录数量
     * @returns 删除的记录数量
     */
    async keepOnly(n: number): Promise<number> {
        const preview = await this.previewMove({ keepCount: n });
        const result = await this.moveToRecycleBin({ previewToken: preview.previewToken });
        if (!result.success) throw new Error('清理未完全完成：受保护或无法确认引用的历史已保留');
        return result.completedCount;
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
