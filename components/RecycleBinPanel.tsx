import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ListChecks, MoreVertical, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { localHistory, type LocalHistoryCoverRef, type LocalHistoryRecycleBinItem } from '../services/localHistory';
import { getLanguage, t, useLanguage } from '../services/i18n';
import { EmptyState, InlineSpinner, PageSpinner, ToolbarButton, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { compactCount, ToolbarCountBadge } from './ToolbarCountBadge';
import { ToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { useMobileLayout } from './TouchActionMenu';
import { HistoryImageViewer } from './HistoryImageViewer';
import { ParamsViewer } from './ParamsViewer';
import { SmartImage } from './SmartImage';
import { useConfirmDialog } from './ConfirmDialog';
import { useMobileHistoryLayer } from './MobileUI';
import { useGalleryLoadMore } from './useGalleryLoadMore';
import type { LocalGenItem } from '../types';
import { downloadFile } from '../services/fileDownload';
import { beginExportTarget } from '../services/exportLocation';

interface Props {
    onBack: () => void;
    notify: (message: string, type?: 'success' | 'error') => void;
    archive?: Awaited<ReturnType<typeof localHistory.getBrowserMigrationRecovery>>;
    onRetryMigration?: () => Promise<void>;
}
type PanelItem = LocalGenItem & { movedAt?: number; version?: string; archiveBin?: boolean };
const PAGE_SIZE = 60;
// 浏览器迁移冲突允许 active/bin 同编号并存，档案身份必须包括来源。
const panelItemKey = (item: PanelItem) => `${item.archiveBin === undefined ? 'bin' : item.archiveBin ? 'archive-bin' : 'archive-active'}:${item.id}`;

const formatCoverRefLabel = (ref: LocalHistoryCoverRef) => {
    const kind = ref.type === 'style' ? t('风格串') : ref.type === 'character' ? t('角色') : t('提示词库');
    const name = ref.name.trim() || ref.id;
    return `${kind}「${name}」`;
};
const formatChainReason = (coverRefs?: LocalHistoryCoverRef[]) => {
    if (!coverRefs?.length) return t('创作配方仍在引用');
    const shown = coverRefs.slice(0, 3).map(formatCoverRefLabel).join('、');
    const summary = coverRefs.length > 3 ? t('{0} 等 {1} 项', [shown, coverRefs.length]) : shown;
    return t('已被用作封面（{0}）', [summary]);
};

export const formatHistoryBinReasons = (reasons: string[], coverRefs?: LocalHistoryCoverRef[]) => reasons.map(reason => (
    reason === 'chain' && coverRefs?.length ? formatChainReason(coverRefs) : t(({
        favorite: '有效收藏或收藏正在保存', prompt_library: '提示词库仍在引用', collection: '收藏资料仍在引用',
        chain: '创作配方仍在引用', artist: '画师资料仍在引用', roll: 'Roll 候选仍在引用', comic: '漫画书架仍在引用', shared_image: '原图仍被其他资料共享',
        history: '其他历史仍在引用', recycle_bin: '其他回收站条目仍在引用', settings: '设置仍在引用', reference_asset: '参考资产仍在引用',
        reference_check_failed: '无法确认引用关系，已保留原记录', source_changed: '条目已变化，请重新读取后重试',
        source_changed_or_referenced: '条目已变化或仍被引用', write_conflict: '条目正在写入，请稍后重试',
        not_found: '条目不存在', not_in_recycle_bin: '条目已不在回收站', active_id_conflict: '生成历史中已有同编号条目，已保留两份资料',
        restore_conflict_or_failed: '恢复冲突或失败，回收站资料已保留', move_conflict_or_failed: '移动冲突或失败，原记录已保留',
        id_conflict: '生成历史中已有同编号条目，已保留两份资料', external_identity_conflict: '外部来源标识冲突，已保留两份资料', transaction_failed: '事务失败，原资料已保留',
        purge_failed: '永久删除失败', image_retained_reference: '共享原图仍被引用，已保留', image_cleanup_failed: '原图清理失败',
        link_cleanup_failed: '关联资料清理失败', mask_cleanup_failed: '蒙版清理失败',
    } as Record<string, string>)[reason] || reason)
)).join('、');

/** 回收站独立浏览；只按完成回执移出条目，冲突和失败项保留选择供重试。 */
export const RecycleBinPanel: React.FC<Props> = ({ onBack, notify, archive, onRetryMigration }) => {
    useLanguage();
    const confirmAction = useConfirmDialog();
    const mobile = useMobileLayout();
    const archiveRows = archive ? [...archive.active.map(item => ({ ...item, archiveBin: false })), ...archive.bin.map(item => ({ ...item, archiveBin: true }))] : null;
    const archiveRowsRef = useRef(archiveRows); archiveRowsRef.current = archiveRows;
    const [items, setItems] = useState<PanelItem[]>([]);
    const itemsRef = useRef(items); itemsRef.current = items;
    const [count, setCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const loadingRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [viewer, setViewer] = useState<PanelItem | null>(null);
    const viewerRef = useRef(viewer); viewerRef.current = viewer;
    const [detailsOpen, setDetailsOpen] = useState(true);
    const [navigating, setNavigating] = useState(false);
    const navigationRef = useRef(0);
    const mounted = useRef(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const requestBack = useMobileHistoryLayer(true, () => busyRef.current ? false : onBack(), 'history-recycle-bin');
    const requestCloseViewer = useMobileHistoryLayer(Boolean(viewer), () => {
        if (busyRef.current) return false;
        navigationRef.current++; setViewer(null);
    }, 'history-recycle-bin-detail');
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; navigationRef.current++; }; }, []);

    const loadMore = async () => {
        if (loadingRef.current || busyRef.current) return [];
        loadingRef.current = true; setLoading(true); setLoadFailed(false);
        // 移出成功条目后从不足一页处重叠读取，避免 offset 左移漏掉下一页。
        const page = Math.floor(itemsRef.current.length / PAGE_SIZE);
        try {
            const rows = archiveRowsRef.current;
            const result = rows ? { items: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), count: rows.length } : await localHistory.getRecycleBinPage(page, PAGE_SIZE);
            if (!mounted.current) return [];
            const merged = new Map(itemsRef.current.map(item => [panelItemKey(item), item]));
            result.items.forEach(item => merged.set(panelItemKey(item), item));
            const next = [...merged.values()];
            itemsRef.current = next; setItems(next); setCount(result.count);
            return next;
        } catch (error) {
            if (mounted.current) { setLoadFailed(true); notify(error instanceof Error ? error.message : t('回收站读取失败'), 'error'); }
            return [];
        } finally {
            loadingRef.current = false;
            if (mounted.current) setLoading(false);
        }
    };
    useEffect(() => {
        void loadMore();
        const unsubscribe = localHistory.subscribe(change => {
            if (!busyRef.current && ['move', 'restore', 'purge', 'remote-takeover'].includes(change.type)) setNeedsRefresh(true);
        });
        const changed = () => { if (!busyRef.current) setNeedsRefresh(true); };
        window.addEventListener('nai-project-data-changed', changed);
        return () => { unsubscribe(); window.removeEventListener('nai-project-data-changed', changed); };
    }, []);
    useEffect(() => {
        if (!archiveRowsRef.current) return;
        const first = archiveRowsRef.current.slice(0, PAGE_SIZE);
        itemsRef.current = first; setItems(first); setCount(archiveRowsRef.current.length); setLoadFailed(false); setNeedsRefresh(false);
    }, [archive]);
    const refresh = async () => {
        if (loadingRef.current || busyRef.current || archive) return;
        loadingRef.current = true; setLoading(true);
        const scrollTop = scrollRef.current?.scrollTop || 0;
        const target = Math.max(PAGE_SIZE, itemsRef.current.length);
        try {
            const next: PanelItem[] = [];
            let total = 0;
            for (let page = 0; page === 0 || next.length < Math.min(target, total); page++) {
                const result = await localHistory.getRecycleBinPage(page, PAGE_SIZE);
                next.push(...result.items); total = result.count;
                if (!result.items.length) break;
            }
            if (!mounted.current) return;
            itemsRef.current = next; setItems(next); setCount(total); setLoadFailed(false); setNeedsRefresh(false);
            const ids = new Set(next.map(item => item.id));
            setSelected(value => new Set([...value].filter(id => ids.has(id))));
            if (viewerRef.current) {
                const full = await localHistory.getRecycleBinItem(viewerRef.current.id);
                if (mounted.current) setViewer(full);
            }
            if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
        } catch (error) {
            if (mounted.current) { setNeedsRefresh(true); notify(error instanceof Error ? error.message : t('回收站读取失败'), 'error'); }
        } finally { loadingRef.current = false; if (mounted.current) setLoading(false); }
    };
    useGalleryLoadMore(scrollRef, sentinelRef, !loading && !loadFailed && !busy && count !== null && items.length < count, () => { void loadMore(); }, '800px 0px', items.length);

    const openItem = async (item: PanelItem) => {
        if (busyRef.current) return;
        const request = ++navigationRef.current; setNavigating(true);
        try {
            const full = archiveRowsRef.current ? archiveRowsRef.current.find(row => row.id === item.id && row.archiveBin === item.archiveBin) : await localHistory.getRecycleBinItem(item.id);
            if (!full) throw new Error(t('回收站条目已变化，请重新读取'));
            if (mounted.current && request === navigationRef.current) setViewer(full);
        } catch (error) {
            if (request === navigationRef.current) notify(error instanceof Error ? error.message : t('回收站读取失败'), 'error');
        } finally { if (mounted.current && request === navigationRef.current) setNavigating(false); }
    };
    const navigate = async (delta: number) => {
        if (busyRef.current || navigating || !viewerRef.current) return;
        const index = itemsRef.current.findIndex(item => viewerRef.current && panelItemKey(item) === panelItemKey(viewerRef.current)) + delta;
        let list = itemsRef.current;
        if (index >= list.length && count !== null && list.length < count) list = await loadMore();
        if (list[index]) await openItem(list[index]);
    };
    const perform = async (operation: 'restore' | 'purge', ids: string[]) => {
        if (!ids.length || busyRef.current || loadingRef.current || navigating || archive) return;
        if (ids.length > 500) { notify(t('每次最多操作 500 张，请减少选择后重试'), 'error'); return; }
        const snapshot = new Map(itemsRef.current.map(item => [item.id, item]));
        if (viewerRef.current) snapshot.set(viewerRef.current.id, viewerRef.current);
        const expectedVersions: Record<string, string> = {};
        for (const id of ids) {
            const version = snapshot.get(id)?.version;
            if (!version) { notify(t('条目版本未知，请重新读取后再操作'), 'error'); return; }
            expectedVersions[id] = version;
        }
        busyRef.current = true; setBusy(true);
        try {
            // 永久删除必须单独、逐次确认，不继承移入回收站的记住授权。
            if (operation === 'purge' && !await confirmAction({
                title: t('永久删除 {0} 张回收站图片？', [ids.length]),
                message: t('此操作不可恢复。记录、提示词与编辑信息将永久删除；仍被其他资料共享的原图可能保留。'),
                confirmLabel: t('永久删除'), tone: 'danger',
            })) return;
            const result = operation === 'restore' ? await localHistory.restoreFromRecycleBin(ids, expectedVersions) : await localHistory.purgeRecycleBin(ids, expectedVersions);
            const completed = new Set(result.completedIds);
            const previous = itemsRef.current;
            const oldIndex = previous.findIndex(item => item.id === viewerRef.current?.id);
            const remaining = previous.filter(item => !completed.has(item.id));
            itemsRef.current = remaining; setItems(remaining);
            setCount(value => value === null ? null : Math.max(0, value - completed.size));
            setSelected(value => new Set([...value].filter(id => !completed.has(id))));
            if (viewerRef.current && completed.has(viewerRef.current.id)) {
                navigationRef.current++;
                setViewer(remaining[Math.min(Math.max(0, oldIndex), remaining.length - 1)] || null);
            }
            const message = t(operation === 'restore' ? '已恢复 {0} 张 · 跳过 {1} 张 · 失败 {2} 张' : '已永久删除 {0} 张 · 跳过 {1} 张 · 失败 {2} 张', [completed.size, result.skippedCount, result.failedCount]);
            if (result.skippedCount || result.failedCount) setNeedsRefresh(true);
            const reasons = [...result.skipped, ...result.failed].map(entry => `${entry.id}: ${formatHistoryBinReasons(entry.reasons, entry.coverRefs)}`).join('\n');
            const warnings = result.warnings.map(entry => `${entry.id}: ${formatHistoryBinReasons(entry.reasons, entry.coverRefs)}`).join('\n');
            notify([message, reasons, warnings].filter(Boolean).join('\n'), result.skippedCount || result.failedCount ? 'error' : 'success');
        } catch (error) {
            notify(error instanceof Error ? error.message : t('回收站操作失败'), 'error');
        } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    };
    const toggle = (id: string) => {
        if (busyRef.current) return;
        setSelected(value => { const next = new Set(value); next.has(id) ? next.delete(id) : next.add(id); return next; });
    };
    const exportMask = async (item: PanelItem) => {
        const target = beginExportTarget();
        try {
            const mask = archive ? await localHistory.getBrowserMigrationRecoveryMask(item.id, item.archiveBin) : await localHistory.getRecycleBinEditMask(item.id, item as LocalHistoryRecycleBinItem);
            if (!mask) throw new Error(t('蒙版不存在或已无法读取'));
            const receipt = await downloadFile(mask, 'NAI-' + item.id + '-mask.png', target);
            if (receipt.saved) notify(t('蒙版已导出'), 'success');
        } catch (error) { notify(error instanceof Error ? error.message : t('蒙版导出失败'), 'error'); }
    };
    const index = viewer ? items.findIndex(item => panelItemKey(item) === panelItemKey(viewer)) : -1;
    const heading = t(archive ? '浏览器历史只读档案' : '回收站');
    const selectedLabel = t('已选 {0} 张', [selected.size]);
    const secondaryActions = [
        { label: '刷新', Icon: RefreshCw, disabled: loading, action: () => void refresh() },
        { label: '全选已加载', Icon: ListChecks, disabled: !items.length, action: () => setSelected(new Set(items.map(item => item.id))) },
        { label: '清空选择', Icon: X, disabled: !selected.size, action: () => setSelected(new Set()) },
    ];
    const toolbarAction = (label: string, icon: React.ReactNode, onClick: () => void, disabled: boolean, tone?: 'danger') =>
        <ToolbarButton key={label} tone={tone} aria-label={t(label)} title={t(label)} onClick={onClick} disabled={disabled}
            className="mobile-touch w-10 !px-0 xl:w-auto xl:!px-3">{icon}<span className="hidden xl:inline">{t(label)}</span></ToolbarButton>;

    return <div className="workspace-canvas flex h-full min-h-0 flex-1 flex-col overflow-hidden" aria-label={t(archive ? '浏览器历史只读档案' : '历史回收站')}>
        <WorkspaceChrome><WorkspaceToolbar scrollable={false} className="!gap-1 lg:!gap-2">
            {toolbarAction('返回生成历史', <ArrowLeft />, requestBack, busy)}
            <h2 className="min-w-0 truncate text-sm font-bold" title={heading}>{heading}</h2>
            <ToolbarCountBadge loaded={items.length} total={count ?? undefined} />
            <span className="min-w-0 flex-1" aria-hidden="true" />
            {archive ? toolbarAction('重试迁移', <RefreshCw />, () => {
                busyRef.current = true;
                setBusy(true);
                void onRetryMigration?.().finally(() => { busyRef.current = false; if (mounted.current) setBusy(false); });
            }, busy) : <>
                <output aria-label={selectedLabel} title={selectedLabel} className="shrink-0 text-xs tabular-nums">{compactCount(selected.size)}</output>
                {mobile ? <ToolbarPopover label="更多操作" title={t('更多操作')} icon={<MoreVertical />} iconOnly disabled={busy}>
                    {close => secondaryActions.map(({ label, Icon, disabled, action }) => <button key={label} type="button" disabled={busy || disabled}
                        className={`${TOOLBAR_MENU_CLASS} disabled:opacity-40`} onClick={() => { close(); action(); }}><Icon />{t(label)}</button>)}
                </ToolbarPopover> : <div className="flex items-center gap-1">{secondaryActions.map(({ label, Icon, disabled, action }) =>
                    toolbarAction(label, <Icon />, action, busy || disabled))}</div>}
                {toolbarAction('恢复选中', <RotateCcw />, () => void perform('restore', [...selected]), busy || !selected.size)}
                {toolbarAction('永久删除选中', <Trash2 />, () => void perform('purge', [...selected]), busy || !selected.size, 'danger')}
            </>}
        </WorkspaceToolbar></WorkspaceChrome>
        <div ref={scrollRef} className="workspace-scroll-viewport min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <p className="mb-4 text-xs text-gray-500">{t(archive ? '浏览器旧资料仅供只读浏览与导出。请连接本地服务完成迁移后再管理历史。' : '移入回收站不释放空间，也不会自动过期。恢复后回到生成历史。')}</p>
            {archive?.error && <p role="alert" className="mb-3 break-words text-sm">{archive.error}</p>}
            {needsRefresh && <p role="status" className="mb-3 text-sm">{t('回收站已变化，可刷新后重试；当前浏览与选择仍保留')}</p>}
            {loadFailed && <div role="alert" className="mb-4 flex items-center gap-3"><span>{t('回收站读取失败')}</span><ToolbarButton disabled={loading} onClick={() => void loadMore()}>{t('重试')}</ToolbarButton></div>}
            {loading && !items.length ? <PageSpinner /> : count === 0 && !loadFailed ? <EmptyState icon={<Trash2 />} title={t('回收站为空')} /> : <ul className="space-y-3">
                {items.map(item => <li key={panelItemKey(item)} data-recycle-bin-id={item.id} className="appearance-panel flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                    {!archive && <input type="checkbox" className="h-5 w-5" aria-label={t('选择回收站图片 {0}', [item.id])} checked={selected.has(item.id)} disabled={busy} onChange={() => toggle(item.id)} />}
                    <button className="h-24 w-20 shrink-0 overflow-hidden rounded-lg" disabled={busy || navigating} onClick={() => void openItem(item)} aria-label={t('查看回收站图片 {0}', [item.id])}><SmartImage src={item.imageUrl} alt={t('回收站图片')} className="h-full w-full object-contain" /></button>
                    <div className="min-w-0 flex-1 text-xs"><p>{new Date(item.createdAt).toLocaleString(getLanguage())}</p>{item.movedAt !== undefined && <p className="mt-1 text-gray-500">{t('移入时间：{0}', [new Date(item.movedAt).toLocaleString(getLanguage())])}</p>}{archive && <p>{t(item.archiveBin ? '回收站档案' : '生成历史档案')}</p>}<p className="mt-2 line-clamp-2 break-words">{item.prompt}</p></div>
                    {!archive && <div className="flex w-full justify-end gap-2 sm:w-auto"><ToolbarButton disabled={busy} onClick={() => void perform('restore', [item.id])}><RotateCcw />{t('恢复')}</ToolbarButton><ToolbarButton tone="danger" disabled={busy} onClick={() => void perform('purge', [item.id])}><Trash2 />{t('永久删除')}</ToolbarButton></div>}
                </li>)}
            </ul>}
            <div ref={sentinelRef} data-recycle-bin-load-more="true" className="h-1" />
            <div className="flex justify-center py-6">{loading && items.length > 0 ? <InlineSpinner /> : count !== null && items.length < count ? <ToolbarButton disabled={loading || busy} onClick={() => void loadMore()}>{t('加载更多')}</ToolbarButton> : count !== null && items.length > 0 ? <span className="text-xs text-gray-500">{t('已全部加载')}</span> : null}</div>
        </div>
        {viewer && <HistoryImageViewer item={viewer} index={Math.max(0, index)} total={count ?? items.length} navigating={busy || navigating || loading} favoritePending={false} hideFavorite hideDelete={Boolean(archive)} deleteLabel="永久删除" detailsOpen={detailsOpen} onDetailsChange={setDetailsOpen} onNavigate={delta => void navigate(delta)} onClose={() => { if (!busyRef.current) requestCloseViewer(); }} onFavorite={async () => {}} onDelete={() => void perform('purge', [viewer.id])} filename={`NAI-${viewer.id}.png`} notify={notify}>
            {!archive && <div className="mb-4 flex gap-2"><ToolbarButton className="flex-1" disabled={busy} onClick={() => void perform('restore', [viewer.id])}><RotateCcw />{t('恢复')}</ToolbarButton><ToolbarButton tone="danger" disabled={busy} onClick={() => void perform('purge', [viewer.id])}>{t('永久删除')}</ToolbarButton></div>}
            <p className="mb-3 text-xs">{t(archive ? '此档案只读；迁移完成后可在生成历史中使用。' : '需要导入实验室或复用编辑时，请先恢复到生成历史。')}</p>
            {viewer.edit?.maskAvailable && <ToolbarButton disabled={busy} onClick={() => void exportMask(viewer)}>{t('导出原蒙版')}</ToolbarButton>}
            <ParamsViewer params={viewer.params} prompt={viewer.prompt} negativePrompt={viewer.negativePrompt ?? ''} edit={viewer.edit} notify={notify} />
            {(viewer.basePrompt !== undefined || viewer.subjectPrompt !== undefined || viewer.modules?.length) && <details className="mt-4"><summary>{t('结构化提示词')}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify({ basePrompt: viewer.basePrompt, subjectPrompt: viewer.subjectPrompt, modules: viewer.modules }, null, 2)}</pre></details>}
        </HistoryImageViewer>}
    </div>;
};
