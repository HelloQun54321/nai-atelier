import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('BroadcastChannel', undefined); });
import { localHistory } from '../../services/localHistory';
import { api } from '../../services/api';
import type { LocalGenItem } from '../../types';

type Row = Record<string, unknown>;
/** 只模拟本模块使用的事务语义：请求按队列执行，失败回滚全部store。 */
const memoryDatabase = (seed: Record<string, Row[]>, fail?: (store: string, method: string, id: unknown) => boolean) => {
  const stores = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map(row => [row.id || row.historyId, row]))]));
  const database = {
    transaction(names: string | string[]) {
      const selected = typeof names === 'string' ? [names] : names;
      const copies = Object.fromEntries(selected.map(name => [name, new Map(stores[name]) ]));
      let pending = 0, aborted = false;
      const tx = {
        error: null as Error | null, oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore(name: string) {
          const request = (method: string, value?: unknown) => {
            const result = { result: undefined as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
            pending++;
            queueMicrotask(() => {
              if (aborted) return;
              try {
                const table = copies[name];
                if (fail?.(name, method, value)) throw new Error('synthetic transaction failure');
                if (method === 'getAll') result.result = [...table.values()];
                if (method === 'get') result.result = table.get(value);
                if (method === 'delete') table.delete(value);
                if (method === 'add') { const row = value as Row; const key = row.id || row.historyId; if (table.has(key)) throw new Error('constraint'); table.set(key, row); }
                result.onsuccess?.();
              } catch (error) { tx.error = error as Error; aborted = true; tx.onabort?.(); }
              if (--pending === 0) queueMicrotask(() => {
                if (pending || aborted) return;
                for (const name of selected) stores[name] = copies[name];
                tx.oncomplete?.();
              });
            });
            return result;
          };
          return { get: (id: unknown) => request('get', id), getAll: () => request('getAll'), delete: (id: unknown) => request('delete', id), add: (row: unknown) => request('add', row) };
        },
      };
      return tx;
    },
  };
  return { database: database as unknown as IDBDatabase, stores };
};
const item = (id: string, extra: Row = {}) => ({ id, createdAt: 10, imageUrl: 'data:image/png;base64,YQ==', prompt: '', params: {}, ...extra });
const seed = (active: Row[] = [], bin: Row[] = [], masks: Row[] = []) => ({ generations: active, editMasks: [], recycleBin: bin.map(row => ({ version: 'v1', ...row })), recycleBinEditMasks: masks });
// 私有入口只用于注入隔离内存数据库，不连接真实浏览器数据。
const internals = localHistory as unknown as {
  remoteEnabled: boolean | null; db: IDBDatabase | null;
  open(): Promise<IDBDatabase>; browserMoveReasons(item: LocalGenItem): Promise<string[]>;
};
beforeEach(() => { internals.remoteEnabled = false; internals.db = null; });
afterEach(() => { vi.restoreAllMocks(); internals.remoteEnabled = null; internals.db = null; });

describe('回收站浏览器事务', () => {
  it('升级仅新增两个store，保留v4 active和蒙版', async () => {
    const created: string[] = [];
    const db = { objectStoreNames: { contains: (name: string) => ['generations', 'editMasks'].includes(name) }, createObjectStore: (name: string) => { created.push(name); return { createIndex: vi.fn() }; } };
    vi.stubGlobal('indexedDB', { open: vi.fn((_name, version) => {
      expect(version).toBe(5);
      const request = { result: db, transaction: { objectStore: () => ({ indexNames: { contains: () => true } }) }, onupgradeneeded: null as unknown, onsuccess: null as unknown };
      queueMicrotask(() => { (request.onupgradeneeded as (event: unknown) => void)({ target: request }); (request.onsuccess as (event: unknown) => void)({ target: request }); });
      return request;
    }) });
    await internals.open();
    expect(created).toEqual(['recycleBin', 'recycleBinEditMasks']);
    vi.unstubAllGlobals();
  });
  it('只读旧浏览器归档明确声明需要远端迁移，不伪装完整清理能力', async () => {
    expect(await localHistory.getRecycleBinCapabilities()).toEqual({ move: 'requires-remote-migration' });
    internals.remoteEnabled = true;
    expect(await localHistory.getRecycleBinCapabilities()).toEqual({ move: 'remote' });
  });
  it('未知引用明确阻止，favorite单独报告，预览执行不假成功', async () => {
    const { database, stores } = memoryDatabase(seed([item('unknown'), item('fav', { isFavorite: true })]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    const preview = await localHistory.previewMove({ clear: true });
    expect(preview.movableCount).toBe(0);
    expect(preview.skipped.map(row => row.reasons[0]).sort()).toEqual(['favorite', 'reference_check_failed']);
    expect(await localHistory.moveToRecycleBin({ previewToken: preview.previewToken })).toMatchObject({ success: false, outcome: 'blocked', completedCount: 0, skippedCount: 2 });
    expect(stores.generations.size).toBe(2);
  });
  it('恢复与purge只触及bin，恢复mask完整，冲突保留源', async () => {
    const blob = new Blob(['mask']);
    const { database, stores } = memoryDatabase(seed([item('conflict')], [item('a', { movedAt: 20 }), item('conflict', { movedAt: 20 })], [{ historyId: 'a', blob, updatedAt: 1 }]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    const result = await localHistory.restoreFromRecycleBin(['a', 'conflict'], { a: 'v1', conflict: 'v1' });
    expect(result).toMatchObject({ completedIds: ['a'], skippedCount: 1, partial: true });
    expect(stores.generations.get('a')).not.toHaveProperty('movedAt');
    expect(stores.editMasks.get('a')?.blob).toBe(blob);
    expect(stores.recycleBin.has('conflict')).toBe(true);
    expect((await localHistory.purgeRecycleBin(['a', 'conflict'], { a: 'v1', conflict: 'v1' })).completedIds).toEqual(['conflict']);
    expect(stores.generations.has('a')).toBe(true);
  });
  it('mask写入失败原子回滚源记录与mask，同时其他项成功', async () => {
    const { database, stores } = memoryDatabase(seed([], [item('fail'), item('good')], [{ historyId: 'fail', blob: new Blob(['x']) }]), (name, method) => name === 'editMasks' && method === 'add');
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    const result = await localHistory.restoreFromRecycleBin(['fail', 'good'], { fail: 'v1', good: 'v1' });
    expect(result).toMatchObject({ completedIds: ['good'], failed: [{ id: 'fail', reasons: ['transaction_failed'] }], partial: true });
    expect(stores.recycleBin.has('fail')).toBe(true); expect(stores.recycleBinEditMasks.has('fail')).toBe(true);
    expect(stores.generations.has('fail')).toBe(false);
  });
  it('缺少确认版本时拒绝恢复和永久删除，不临时偷读新版本', async () => {
    await expect(localHistory.purgeRecycleBin(['a'], {})).rejects.toThrow('缺少确认时');
    await expect(localHistory.restoreFromRecycleBin(['a'], {})).rejects.toThrow('缺少确认时');
  });
  it('确认后的同ID新bin版本不会被旧永久删除或恢复', async () => {
    const { database, stores } = memoryDatabase(seed([], [item('a', { movedAt: 20, version: 'new' })]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    expect((await localHistory.purgeRecycleBin(['a'], { a: 'old' })).skipped).toEqual([{ id: 'a', reasons: ['source_changed'] }]);
    expect((await localHistory.restoreFromRecycleBin(['a'], { a: 'old' })).completedCount).toBe(0);
    expect(stores.recycleBin.has('a')).toBe(true);
  });
  it('legacy蒙版读取等待期间发生remote接管，仍保留唯一原始蒙版且不复活源', async () => {
    const original = item('legacy', { edit: { maskData: 'data:image/png;base64,YQ==' } });
    const { database, stores } = memoryDatabase(seed([original]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    let release!: (response: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const pending = localHistory.getEditMask('legacy');
    await started;
    internals.remoteEnabled = true;
    release(new Response(new Blob(['mask'])));
    expect(await pending).toBeTruthy();
    expect(stores.generations.get('legacy')).toEqual(original);
    expect(stores.editMasks.size).toBe(0);
  });
  it('冻结预览不扩入新增记录，move保存蒙版', async () => {
    const { database, stores } = memoryDatabase({ ...seed([item('a')]), editMasks: [{ historyId: 'a', blob: new Blob(['mask']) }] });
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    vi.spyOn(internals, 'browserMoveReasons').mockResolvedValue([]);
    const preview = await localHistory.previewMove({ clear: true });
    stores.generations.set('late', item('late'));
    expect((await localHistory.moveToRecycleBin({ previewToken: preview.previewToken, ids: ['a', 'late'] })).completedIds).toEqual(['a']);
    expect(stores.generations.has('late')).toBe(true); expect(stores.recycleBinEditMasks.has('a')).toBe(true);
  });
});

describe('远端接管迁移', () => {
  it('active与bin分别直达目标，全部确认才逐条清源，保留movedAt和mask', async () => {
    internals.remoteEnabled = true;
    const blob = new Blob(['mask']);
    const { database, stores } = memoryDatabase(seed([item('active')], [item('bin', { movedAt: 42 })], [{ historyId: 'bin', blob, updatedAt: 5 }]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob(['image'])));
    const post = vi.spyOn(api, 'postForm').mockImplementation(async (_path, form) => ({ item: { id: JSON.parse(String(form.get('metadata'))).id } }));
    expect(await localHistory.prepare()).toBe(2);
    expect(post.mock.calls.map(call => call[0])).toEqual(['/local-history/import', '/local-history/recycle-bin/import']);
    expect(JSON.parse(String(post.mock.calls[1][1].get('metadata'))).movedAt).toBe(42);
    expect(post.mock.calls[1][1].get('editMask')).toBeTruthy();
    expect(stores.recycleBin.size).toBe(0); expect(stores.generations.size).toBe(0);
  });
  it('迁移期间蒙版发生变化时保留源，不能清掉并发写入', async () => {
    internals.remoteEnabled = true;
    const { database, stores } = memoryDatabase(seed([], [item('bin')], [{ historyId: 'bin', blob: new Blob(['old']), updatedAt: 5, revision: 'old' }]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob(['image'])));
    vi.spyOn(api, 'postForm').mockImplementation(async () => {
      stores.recycleBinEditMasks.set('bin', { historyId: 'bin', blob: new Blob(['new']), updatedAt: 5, revision: 'new' });
      return { item: { id: 'bin' } };
    });
    await expect(localHistory.prepare()).rejects.toThrow('源记录发生变化');
    expect(stores.recycleBin.has('bin')).toBe(true);
    expect(stores.recycleBinEditMasks.get('bin')?.revision).toBe('new');
  });
  it('远端未确认保存时保留bin与mask，不清整库', async () => {
    internals.remoteEnabled = true;
    const { database, stores } = memoryDatabase(seed([], [item('bin', { movedAt: 42 })], [{ historyId: 'bin', blob: new Blob(['mask']), updatedAt: 5 }]));
    vi.spyOn(internals, 'open').mockResolvedValue(database);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob(['image'])));
    vi.spyOn(api, 'postForm').mockResolvedValue({ success: true });
    await expect(localHistory.prepare()).rejects.toThrow('远端保存未确认');
    expect(stores.recycleBin.has('bin')).toBe(true); expect(stores.recycleBinEditMasks.has('bin')).toBe(true);
    const recovery = await localHistory.getBrowserMigrationRecovery();
    expect(recovery.error).toContain('远端保存未确认'); expect(recovery.bin.map(row => row.id)).toEqual(['bin']);
    expect(await localHistory.getBrowserMigrationRecoveryMask('bin', true)).toBeTruthy();
    vi.mocked(api.postForm).mockResolvedValue({ item: { id: 'bin' }, replayed: true });
    expect(await localHistory.prepare()).toBe(1);
    expect((await localHistory.getBrowserMigrationRecovery()).bin).toEqual([]);
  });
  it('远端partial结果保留真实失败信息，媒体使用bin命名空间', async () => {
    internals.remoteEnabled = true;
    const response = { operation: 'restore', completedIds: ['a'], partial: true, failed: [{ id: 'b', reasons: ['object_failed'] }] };
    const post = vi.spyOn(api, 'post').mockResolvedValue(response);
    expect(await localHistory.restoreFromRecycleBin(['a', 'b', 'a'], { a: 'v1', b: 'v2' })).toEqual(response);
    expect(post).toHaveBeenCalledWith('/local-history/recycle-bin/restore', { ids: ['a', 'b'], expectedVersions: { a: 'v1', b: 'v2' } });
    const get = vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob());
    await localHistory.getRecycleBinEditMask('a/b');
    expect(get).toHaveBeenCalledWith('/local-history/recycle-bin/a%2Fb/edit-mask');
  });
});
