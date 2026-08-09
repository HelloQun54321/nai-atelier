
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { LocalHistoryDateRange, LocalHistoryPage, localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, PromptChain, User } from '../types';
import { PAGINATION_CONFIG } from '../config/pagination';
import { MobileBottomSheet, useMobileHistoryLayer } from './MobileUI';
import { extractMetadata, IMPORT_SESSION_KEY, parseNovelAIMetadata } from '../services/metadataService';
import { compilePrompt } from '../services/promptUtils';
import { ParamsViewer } from './ParamsViewer';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';
import { createUuid } from '../services/id';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { AlertTriangle, CalendarDays, ChevronDown, Clock3, ListChecks, LoaderCircle, RefreshCw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { IconButton, ToolbarButton, WorkspaceToolbar } from './DesignSystem';
import { buildMediaUrl, canUseMediaGateway } from '../services/mobileImageCache';

interface GenHistoryProps {
    currentUser: User;
    chains: PromptChain[];
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
    onRefreshInspiration?: () => void;
}

const toDateInputValue = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatHistoryDay = (key: string) => {
    const today = toDateInputValue(new Date());
    const yesterday = toDateInputValue(new Date(Date.now() - 86400000));
    if (key === today) return '今天';
    if (key === yesterday) return '昨天';
    const date = new Date(`${key}T00:00:00`);
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
};

const HISTORY_THUMBNAIL_VARIANT = 'thumb-960';

const prewarmHistoryThumbnails = async (items: LocalGenItem[]) => {
    const sources = items.map(item => item.imageUrl).filter(canUseMediaGateway);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, sources.length) }, async () => {
        while (cursor < sources.length) {
            const source = sources[cursor++];
            try {
                const response = await fetch(buildMediaUrl(source, HISTORY_THUMBNAIL_VARIANT), {
                    cache: 'force-cache',
                    credentials: 'same-origin',
                });
                if (response.ok) await response.arrayBuffer();
            } catch {
                // Adjacent-page warming is best-effort and must not affect navigation.
            }
        }
    });
    await Promise.all(workers);
};

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser, chains, notify, onNavigateToPlayground, onRefreshInspiration }) => {
    const confirmAction = useConfirmDialog();
    const imageDisplay = useMobileImageDisplayPreferences();
    const [items, setItems] = useState<LocalGenItem[]>([]);
    const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
    const closeLightbox = useMobileHistoryLayer(Boolean(lightbox), () => setLightbox(null), 'history-detail');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishTitle, setPublishTitle] = useState('');
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);

    // 分页相关状态
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [jumpPage, setJumpPage] = useState('');
    const [desktopJumpPage, setDesktopJumpPage] = useState('1');
    const [dateFilter, setDateFilter] = useState({ from: '', to: '' });
    const dateRangeRef = useRef<LocalHistoryDateRange>({});
    const [migrationProgress, setMigrationProgress] = useState<{ current: number; total: number } | null>(null);
    
    // 缓存管理
    const [pageCache, setPageCache] = useState<Record<number, LocalGenItem[]>>({});
    const pageCacheRef = useRef<Record<number, LocalGenItem[]>>({});
    const inflightPagesRef = useRef<Record<string, Promise<LocalHistoryPage>>>({});
    const currentPageRef = useRef(1);
    const loadRequestRef = useRef(0);
    const refreshPageRef = useRef<(page: number, force?: boolean) => Promise<void>>(async () => undefined);

    // 清理相关状态
    const [showCleanMenu, setShowCleanMenu] = useState(false);
    const [showPageMenu, setShowPageMenu] = useState(false);
    const [showDateFilter, setShowDateFilter] = useState(false);
    const [showCleanModal, setShowCleanModal] = useState(false);
    const [cleanMode, setCleanMode] = useState<'days' | 'count'>('days');
    const [cleanDays, setCleanDays] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_DAYS);
    const [cleanCount, setCleanCount] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_COUNT);
    const [cleanPreviewCount, setCleanPreviewCount] = useState(0);
    const [isPreparingImport, setIsPreparingImport] = useState(false);

    const getHistoryNegativePrompt = (item: LocalGenItem) => {
        return item.negativePrompt ?? '';
    };

    const getImportDataFromHistoryItem = async (item: LocalGenItem) => {
        const fallbackData = {
            prompt: item.prompt,
            negativePrompt: getHistoryNegativePrompt(item),
            params: item.params,
        };

        if (typeof item.basePrompt === 'string' || typeof item.subjectPrompt === 'string' || Array.isArray(item.modules)) {
            return {
                ...fallbackData,
                basePrompt: item.basePrompt || '',
                subjectPrompt: item.subjectPrompt || '',
                modules: item.modules || [],
            };
        }

        // Old local records did not store the split fields. If their linked
        // source chain still produces exactly the saved prompt, we can safely
        // recover the original split instead of guessing from tag wording.
        const source = item.sourceChainId && item.sourceChainId !== 'playground'
            ? chains.find(chain => chain.id === item.sourceChainId)
            : undefined;
        if (source) {
            const sourceSubject = source.variableValues?.subject || '';
            const compiled = compilePrompt(source, sourceSubject);
            const normalize = (value: string) => value.split(',').map(tag => tag.trim()).filter(Boolean).join(',');
            if (normalize(compiled) === normalize(item.prompt)) {
                return {
                    ...fallbackData,
                    basePrompt: source.basePrompt || '',
                    subjectPrompt: sourceSubject,
                    modules: source.modules || [],
                };
            }
        }

        if (Object.prototype.hasOwnProperty.call(item, 'negativePrompt')) {
            return fallbackData;
        }

        try {
            const response = await fetch(item.imageUrl);
            const blob = await response.blob();
            const file = new File([blob], 'history.png', { type: blob.type || 'image/png' });
            const rawMeta = await extractMetadata(file);
            if (!rawMeta) {
                return fallbackData;
            }

            return parseNovelAIMetadata(rawMeta, item.params);
        } catch (e) {
            console.warn('Failed to read history image metadata', e);
            return fallbackData;
        }
    };

    const { PAGE_SIZE } = PAGINATION_CONFIG;

    const setCacheState = (nextCache: Record<number, LocalGenItem[]>) => {
        pageCacheRef.current = nextCache;
        setPageCache(nextCache);
    };

    const trimCacheAroundPage = (centerPage: number, totalPages: number, extraPages: Record<number, LocalGenItem[]> = {}) => {
        const validPages = [centerPage - 1, centerPage, centerPage + 1].filter(page => page >= 1 && page <= totalPages);
        const nextCache: Record<number, LocalGenItem[]> = {};

        validPages.forEach(page => {
            const data = extraPages[page] ?? pageCacheRef.current[page];
            if (data) {
                nextCache[page] = data;
            }
        });

        setCacheState(nextCache);
    };

    // 获取页面数据（优先从缓存）
    const getPageData = async (page: number, force = false, includeCount = false): Promise<LocalHistoryPage> => {
        const cached = pageCacheRef.current[page];
        if (!force && cached && !includeCount) {
            return { items: cached };
        }

        const cacheKey = `${page}:${includeCount ? 'count' : 'items'}`;
        const inflight = inflightPagesRef.current[cacheKey];
        if (!force && inflight) {
            return inflight;
        }

        let request: Promise<LocalHistoryPage>;
        request = localHistory.getPage(page - 1, PAGE_SIZE, dateRangeRef.current, includeCount)
            .then(data => {
                if (inflightPagesRef.current[cacheKey] === request) {
                    delete inflightPagesRef.current[cacheKey];
                }
                return data;
            })
            .catch(error => {
                if (inflightPagesRef.current[cacheKey] === request) {
                    delete inflightPagesRef.current[cacheKey];
                }
                throw error;
            });

        inflightPagesRef.current[cacheKey] = request;
        return request;
    };

    const preloadPage = async (page: number, totalPages: number, centerPage: number) => {
        if (page < 1 || page > totalPages) {
            return;
        }

        try {
            const { items: data } = await getPageData(page);

            if (currentPageRef.current !== centerPage) {
                return;
            }

            if (!pageCacheRef.current[page]) {
                const nextCache = {
                    ...pageCacheRef.current,
                    [page]: data,
                };
                setCacheState(nextCache);
                trimCacheAroundPage(centerPage, totalPages, nextCache);
            }
            window.setTimeout(() => {
                if (currentPageRef.current === centerPage) void prewarmHistoryThumbnails(data);
            }, 2500);
        } catch (e) {
            console.warn('预加载页面失败:', e);
        }
    };

    // 跳转到指定页
    const goToPage = async (page: number, force: boolean = false) => {
        const requestId = ++loadRequestRef.current;
        setIsLoading(true);

        try {
            const requestedPage = Math.max(1, page);
            let pageResult = await getPageData(requestedPage, force, true);
            const count = Number(pageResult.count || 0);
            const calculatedTotalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
            const targetPage = Math.max(1, Math.min(page, calculatedTotalPages));

            if (requestId !== loadRequestRef.current) return;

            currentPageRef.current = targetPage;
            setCurrentPage(targetPage);
            setTotalPages(calculatedTotalPages);
            setTotalCount(count);

            if (targetPage !== requestedPage) pageResult = await getPageData(targetPage, force);
            const data = pageResult.items;
            if (requestId !== loadRequestRef.current) return;

            setItems(data);
            
            // 更新缓存并清理
            const nextCache = {
                ...pageCacheRef.current,
                [targetPage]: data,
            };
            setCacheState(nextCache);
            trimCacheAroundPage(targetPage, calculatedTotalPages, nextCache);
            
            // 预加载相邻页面（当前页 +1 和 -1）
            if (targetPage > 1) {
                void preloadPage(targetPage - 1, calculatedTotalPages, targetPage);
            }
            if (targetPage < calculatedTotalPages) {
                void preloadPage(targetPage + 1, calculatedTotalPages, targetPage);
            }
            
        } catch (e) {
            console.error('加载页面失败:', e);
            if (requestId === loadRequestRef.current) {
                notify('加载失败，请重试', 'error');
            }
        } finally {
            if (requestId === loadRequestRef.current) {
                setIsLoading(false);
            }
        }
    };

    refreshPageRef.current = goToPage;

    const applyDateFilter = (next: { from: string; to: string }) => {
        const from = next.from ? new Date(`${next.from}T00:00:00`).getTime() : undefined;
        const to = next.to ? new Date(`${next.to}T23:59:59.999`).getTime() : undefined;
        dateRangeRef.current = { from, to };
        setDateFilter(next);
        setCacheState({});
        inflightPagesRef.current = {};
        currentPageRef.current = 1;
        setShowDateFilter(false);
        void goToPage(1, true);
    };

    const submitDesktopPageJump = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const page = Number.parseInt(desktopJumpPage, 10);
        if (!Number.isInteger(page) || page < 1 || page > totalPages) {
            notify(`请输入 1 到 ${totalPages} 之间的页码`, 'error');
            setDesktopJumpPage(String(currentPage));
            return;
        }
        void goToPage(page);
    };

    useEffect(() => {
        setDesktopJumpPage(String(currentPage));
    }, [currentPage]);

    useEffect(() => {
        const unsubscribe = localHistory.subscribe(change => {
            if (change.type !== 'add' && !change.external) return;

            setCacheState({});
            inflightPagesRef.current = {};
            setLightbox(current => (
                change.type === 'clear' || change.type === 'cleanup' || current?.id === change.id
                    ? null
                    : current
            ));
            const targetPage = change.type === 'add' ? 1 : currentPageRef.current;
            void refreshPageRef.current(targetPage, true);
        });

        const initialize = async () => {
            setMigrationProgress({ current: 0, total: 0 });
            try {
                const migratedCount = await localHistory.prepare(setMigrationProgress);
                if (migratedCount > 0) {
                    notify(`已将 ${migratedCount} 张历史图片迁移到本地数据目录`);
                }
            } catch (e: any) {
                notify('历史图片迁移失败，浏览器原数据已保留: ' + (e?.message || '未知错误'), 'error');
            } finally {
                setMigrationProgress(null);
                void refreshPageRef.current(1, true);
            }
        };

        const refreshAgentChanges = () => {
            setCacheState({});
            inflightPagesRef.current = {};
            void refreshPageRef.current(currentPageRef.current, true);
        };
        window.addEventListener('nai-project-data-changed', refreshAgentChanges);
        void initialize();
        return () => {
            unsubscribe();
            window.removeEventListener('nai-project-data-changed', refreshAgentChanges);
        };
    }, []);

    // 生成页码按钮
    const getPageButtons = (): number[] => {
        const buttons: number[] = [];
        const maxButtons = 7; // 最多显示7个页码按钮
        
        if (totalPages <= maxButtons) {
            // 总页数较少，显示所有页码
            for (let i = 1; i <= totalPages; i++) {
                buttons.push(i);
            }
        } else {
            // 总页数较多，显示当前页附近的页码
            const start = Math.min(
                Math.max(1, currentPage - 3),
                totalPages - maxButtons + 1
            );
            const end = Math.min(totalPages, start + maxButtons - 1);
            
            for (let i = start; i <= end; i++) {
                buttons.push(i);
            }
        }
        
        return buttons;
    };

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
    };

    const getDisplayedRange = () => {
        if (items.length === 0 || totalCount === 0) {
            return { start: 0, end: 0 };
        }

        const start = Math.min((currentPage - 1) * PAGE_SIZE + 1, totalCount);
        return {
            start,
            end: Math.min(start + items.length - 1, totalCount),
        };
    };

    const handleDelete = async (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (await confirmAction({
            title: '删除这张历史图片？',
            message: '图片记录和本地图片文件将被永久删除，此操作无法撤销。',
            confirmLabel: '确认删除',
            tone: 'danger',
        })) {
            try {
                await localHistory.delete(id);
                if (lightbox?.id === id) setLightbox(null);
                // 清空缓存并强制刷新当前页
                setCacheState({});
                inflightPagesRef.current = {};
                await goToPage(currentPageRef.current, true);
                void db.logClientEvent({
                    category: 'history',
                    action: 'history_delete',
                    resourceType: 'local_history',
                    resourceId: id,
                    message: '删除本地生图历史记录',
                }).catch(console.error);
            } catch (e: any) {
                notify('删除失败: ' + (e?.message || '未知错误'), 'error');
            }
        }
    };

    const handleBulkDelete = async () => {
        if (!selectedIds.size) return;
        if (!await confirmAction({ title: `删除选中的 ${selectedIds.size} 张图片？`, message: '这些历史记录和本地图片文件将被永久删除。', confirmLabel: '批量删除', tone: 'danger' })) return;
        for (const id of selectedIds) await localHistory.delete(id);
        setSelectionMode(false);
        setSelectedIds(new Set());
        setCacheState({});
        inflightPagesRef.current = {};
        await goToPage(currentPageRef.current, true);
        notify('选中的历史图片已删除');
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedIds(new Set());
    };

    const selectCurrentPage = () => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            items.forEach(item => next.add(item.id));
            return next;
        });
    };

    const invertCurrentPageSelection = () => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            items.forEach(item => next.has(item.id) ? next.delete(item.id) : next.add(item.id));
            return next;
        });
    };

    const handleClearAll = async () => {
        if (await confirmAction({
            title: '清空全部生成历史？',
            message: '所有历史记录和本地历史图片都将被永久删除，此操作无法撤销。',
            confirmLabel: '确认清空',
            tone: 'danger',
        })) {
            try {
                const countBefore = await localHistory.getCount();
                await localHistory.clear();
                loadRequestRef.current++;
                setItems([]);
                setTotalCount(0);
                setTotalPages(1);
                currentPageRef.current = 1;
                setCurrentPage(1);
                setCacheState({});
                inflightPagesRef.current = {};
                setLightbox(null);
                setShowCleanMenu(false);
                void db.logClientEvent({
                    category: 'history',
                    action: 'history_clear_all',
                    resourceType: 'local_history',
                    message: '清空所有本地生图历史',
                    metadata: { countBefore },
                }).catch(console.error);
            } catch (e: any) {
                notify('清空失败: ' + (e?.message || '未知错误'), 'error');
            }
        }
    };

    const handleCleanMenuClick = (mode: 'days' | 'count') => {
        setCleanMode(mode);
        setShowCleanMenu(false);
        setShowCleanModal(true);
        
        // 预览将删除的数量
        if (mode === 'days') {
            localHistory.countOlderThan(cleanDays).then(setCleanPreviewCount);
        } else {
            localHistory.getCount().then(count => {
                setCleanPreviewCount(Math.max(0, count - cleanCount));
            });
        }
    };

    const handleCleanConfirm = async () => {
        try {
            const normalizedValue = Math.floor(cleanMode === 'days' ? cleanDays : cleanCount);
            if (!Number.isFinite(normalizedValue) || normalizedValue < 1) {
                notify(cleanMode === 'days' ? '请输入有效天数' : '请输入有效保留数量', 'error');
                return;
            }

            let deletedCount = 0;
            if (cleanMode === 'days') {
                deletedCount = await localHistory.deleteOlderThan(normalizedValue);
            } else {
                deletedCount = await localHistory.keepOnly(normalizedValue);
            }
            setShowCleanModal(false);
            // 清空缓存，强制刷新页面数据和总数
            setCacheState({});
            inflightPagesRef.current = {};
            await goToPage(1, true); // 强制重新加载第一页，刷新总数
            notify('清理完成');
            void db.logClientEvent({
                category: 'history',
                action: 'history_cleanup',
                resourceType: 'local_history',
                message: cleanMode === 'days' ? `删除 ${normalizedValue} 天前的本地历史` : `本地历史只保留最近 ${normalizedValue} 张`,
                metadata: {
                    mode: cleanMode,
                    days: cleanMode === 'days' ? normalizedValue : undefined,
                    keepCount: cleanMode === 'count' ? normalizedValue : undefined,
                    deletedCount,
                },
            }).catch(console.error);
        } catch (e: any) {
            notify('清理失败: ' + e.message, 'error');
            void db.logClientEvent({
                category: 'history',
                action: 'history_cleanup',
                status: 'error',
                resourceType: 'local_history',
                message: '本地历史清理失败',
                metadata: { mode: cleanMode, days: cleanDays, keepCount: cleanCount, error: e.message },
            }).catch(console.error);
        }
    };

    const handlePublish = async () => {
        if (!lightbox) return;
        if (!publishTitle.trim()) {
            notify('请输入标题', 'error');
            return;
        }
        setIsPublishing(true);
        try {
            const importData = await getImportDataFromHistoryItem(lightbox);
            await db.saveInspiration({
                id: createUuid(),
                title: publishTitle,
                imageUrl: lightbox.imageUrl,
                prompt: importData.prompt,
                negativePrompt: importData.negativePrompt,
                params: importData.params,
                userId: currentUser.id,
                username: currentUser.username,
                createdAt: Date.now()
            });
            notify('发布成功！已加入灵感图库');
            setIsPublishing(false);
            setPublishTitle('');
            setLightbox(null);
            setShowSuccessModal(true);
            onRefreshInspiration?.();
            void db.logClientEvent({
                category: 'history',
                action: 'history_publish_inspiration',
                resourceType: 'local_history',
                resourceId: lightbox.id,
                message: `从历史发布到灵感：${publishTitle}`,
                metadata: {
                    title: publishTitle,
                    promptLength: importData.prompt.length,
                    negativeLength: importData.negativePrompt.length,
                    seed: importData.params.seed ?? 'random',
                },
            }).catch(console.error);
        } catch (e: any) {
            notify('发布失败: ' + e.message, 'error');
            setIsPublishing(false);
        }
    };

    const handleImportToEditor = async () => {
        if (!lightbox || isPreparingImport) return;

        setIsPreparingImport(true);
        try {
            const importData = await getImportDataFromHistoryItem(lightbox);
            sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(importData));
            void db.logClientEvent({
                category: 'history',
                action: 'history_import_playground',
                resourceType: 'local_history',
                resourceId: lightbox.id,
                message: '从历史导入参数到实验室',
                metadata: {
                    promptLength: importData.prompt.length,
                    negativeLength: importData.negativePrompt.length,
                    width: importData.params.width,
                    height: importData.params.height,
                    seed: importData.params.seed ?? 'random',
                },
            }).catch(console.error);
            setLightbox(null);
            notify('参数已准备就绪，正在跳转到编辑器...');
            onNavigateToPlayground?.();
        } catch (e: any) {
            notify('导入失败: ' + e.message, 'error');
        } finally {
            setIsPreparingImport(false);
        }
    };

    const handleRefresh = async () => {
        setCacheState({});
        inflightPagesRef.current = {};
        await goToPage(currentPageRef.current, true);
    };

    const historyGroups = useMemo(() => {
        const groups = new Map<string, LocalGenItem[]>();
        items.forEach(item => {
            const key = toDateInputValue(new Date(item.createdAt));
            const group = groups.get(key) || [];
            group.push(item);
            groups.set(key, group);
        });
        return Array.from(groups, ([key, groupItems]) => ({ key, label: formatHistoryDay(key), items: groupItems }));
    }, [items]);

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <WorkspaceToolbar>
                    {migrationProgress && <span className="hidden truncate text-xs text-indigo-600 dark:text-indigo-400 md:block">{migrationProgress.total > 0 ? `正在迁移浏览器历史 ${migrationProgress.current}/${migrationProgress.total}，请勿关闭页面…` : '正在检查浏览器历史…'}</span>}
                    <div className="ml-auto flex items-center gap-2">
                        <ToolbarButton onClick={() => setShowDateFilter(true)}><CalendarDays className="h-4 w-4" />筛选日期</ToolbarButton>
                        <button onClick={() => setShowCleanMenu(true)} className="mobile-touch flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white p-0 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 md:hidden" aria-label="历史管理"><SlidersHorizontal className="h-[18px] w-[18px]" /></button>
                        <div className="relative hidden md:block">
                            <button 
                                onClick={() => setShowCleanMenu(!showCleanMenu)} 
                                disabled={migrationProgress !== null}
                                className="flex h-10 items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                            >
                                <Trash2 className="h-4 w-4" />管理<ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            {showCleanMenu && (
                                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                                    <button
                                        onClick={() => { setSelectionMode(true); setSelectedIds(new Set()); setShowCleanMenu(false); }}
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                                    >
                                        <ListChecks className="h-4 w-4" />批量选择图片
                                    </button>
                                    <button 
                                        onClick={handleClearAll} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <Trash2 className="h-4 w-4" />清空全部
                                    </button>
                                    <button 
                                        onClick={() => handleCleanMenuClick('days')} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <Clock3 className="h-4 w-4" />删除 X 天前的...
                                    </button>
                                    <button 
                                        onClick={() => handleCleanMenuClick('count')} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-b-lg"
                                    >
                                        <SlidersHorizontal className="h-4 w-4" />只保留最近 N 张...
                                    </button>
                                </div>
                            )}
                        </div>
                        <IconButton label="刷新历史" onClick={handleRefresh} disabled={isLoading || migrationProgress !== null}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></IconButton>
                        <div className="hidden rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400 md:flex">{totalCount} 张</div>
                    </div>
            </WorkspaceToolbar>

            <MobileBottomSheet open={showDateFilter} title="筛选历史日期" onClose={() => setShowDateFilter(false)}>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm font-bold dark:text-white">开始日期<input type="date" value={dateFilter.from} onChange={event => setDateFilter(previous => ({ ...previous, from: event.target.value }))} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-800" /></label>
                        <label className="text-sm font-bold dark:text-white">结束日期<input type="date" value={dateFilter.to} onChange={event => setDateFilter(previous => ({ ...previous, to: event.target.value }))} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-800" /></label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => { const today = toDateInputValue(new Date()); setDateFilter({ from: today, to: today }); }} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">今天</button>
                        <button onClick={() => { const end = new Date(); const start = new Date(Date.now() - 6 * 86400000); setDateFilter({ from: toDateInputValue(start), to: toDateInputValue(end) }); }} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">近 7 天</button>
                        <button onClick={() => setDateFilter({ from: '', to: '' })} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">清除</button>
                    </div>
                    <button onClick={() => applyDateFilter(dateFilter)} className="mobile-touch w-full rounded-xl bg-indigo-600 font-bold text-white">应用筛选</button>
                </div>
            </MobileBottomSheet>

            {showDateFilter && <div className="fixed inset-0 z-[1100] hidden items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm md:flex" onPointerDown={event => {
                if (event.target === event.currentTarget) setShowDateFilter(false);
            }}>
                <section role="dialog" aria-modal="true" aria-label="筛选历史日期" className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" onPointerDown={event => event.stopPropagation()}>
                    <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
                        <h2 className="font-bold text-gray-900 dark:text-white">筛选历史日期</h2>
                        <button type="button" onClick={() => setShowDateFilter(false)} className="rounded-lg px-2.5 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">关闭</button>
                    </header>
                    <div className="space-y-4 p-5">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-sm font-bold dark:text-white">开始日期<input type="date" value={dateFilter.from} onChange={event => setDateFilter(previous => ({ ...previous, from: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-800" /></label>
                            <label className="text-sm font-bold dark:text-white">结束日期<input type="date" value={dateFilter.to} onChange={event => setDateFilter(previous => ({ ...previous, to: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-800" /></label>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => { const today = toDateInputValue(new Date()); setDateFilter({ from: today, to: today }); }} className="h-10 rounded-xl bg-gray-100 text-sm font-bold hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">今天</button>
                            <button type="button" onClick={() => { const end = new Date(); const start = new Date(Date.now() - 6 * 86400000); setDateFilter({ from: toDateInputValue(start), to: toDateInputValue(end) }); }} className="h-10 rounded-xl bg-gray-100 text-sm font-bold hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">近 7 天</button>
                            <button type="button" onClick={() => setDateFilter({ from: '', to: '' })} className="h-10 rounded-xl bg-gray-100 text-sm font-bold hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">清除</button>
                        </div>
                        <button type="button" onClick={() => applyDateFilter(dateFilter)} className="h-11 w-full rounded-xl bg-indigo-600 font-bold text-white hover:bg-indigo-500">应用筛选</button>
                    </div>
                </section>
            </div>}

            <MobileBottomSheet open={showCleanMenu} title="历史管理" onClose={() => setShowCleanMenu(false)}>
                <div className="space-y-2">
                            <button onClick={() => { setSelectionMode(true); setSelectedIds(new Set()); setShowCleanMenu(false); }} className="mobile-touch w-full rounded-xl bg-indigo-50 px-4 text-left text-sm font-bold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">批量选择图片</button>
                            <button onClick={() => handleCleanMenuClick('days')} className="mobile-touch w-full rounded-xl bg-gray-100 px-4 text-left text-sm dark:bg-gray-800">删除指定天数以前的历史</button>
                            <button onClick={() => handleCleanMenuClick('count')} className="mobile-touch w-full rounded-xl bg-gray-100 px-4 text-left text-sm dark:bg-gray-800">只保留最近指定数量</button>
                            <button onClick={handleClearAll} className="mobile-touch w-full rounded-xl bg-red-50 px-4 text-left text-sm font-bold text-red-600 dark:bg-red-950/40 dark:text-red-400">清空全部历史</button>
                </div>
            </MobileBottomSheet>

            <MobileBottomSheet open={showPageMenu} title="跳转页码" onClose={() => setShowPageMenu(false)}>
                <div className="space-y-3">
                    <div className="grid grid-cols-[auto_1fr_auto] gap-2">
                        <button onClick={() => { void goToPage(1); setShowPageMenu(false); }} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-600">首页</button>
                        <input type="number" min="1" max={totalPages} value={jumpPage} onChange={event => setJumpPage(event.target.value)} placeholder={`${currentPage} / ${totalPages}`} className="min-w-0 rounded-xl border border-gray-300 bg-white px-3 text-center dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
                        <button onClick={() => { void goToPage(totalPages); setShowPageMenu(false); }} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-600">尾页</button>
                    </div>
                    <button onClick={() => { const page = Number(jumpPage); if (page >= 1 && page <= totalPages) void goToPage(page); setJumpPage(''); setShowPageMenu(false); }} className="mobile-touch w-full rounded-xl bg-indigo-600 font-bold text-white">跳转</button>
                </div>
            </MobileBottomSheet>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
                {selectionMode && <div className="mb-5 hidden items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-900/60 dark:bg-indigo-950/30 md:flex">
                    <span className="mr-auto text-sm font-bold text-indigo-700 dark:text-indigo-200">多选模式 · 已选 {selectedIds.size} 张</span>
                    <button type="button" onClick={selectCurrentPage} className="rounded-lg px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/50">全选本页</button>
                    <button type="button" onClick={invertCurrentPageSelection} className="rounded-lg px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/50">反选本页</button>
                    <button type="button" onClick={exitSelectionMode} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800">退出</button>
                    <button type="button" onClick={() => void handleBulkDelete()} disabled={!selectedIds.size} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-40">删除选中</button>
                </div>}
                {isLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <RefreshCw className="mb-3 h-8 w-8 animate-spin" />
                        <p>加载中...</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <Clock3 className="mb-3 h-10 w-10" />
                        <p>暂无生成记录</p>
                        <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
                    </div>
                ) : (
                    <>
                        <div className="space-y-6">
                          {historyGroups.map(group => <section key={group.key}>
                            <div className="mb-2 flex items-center gap-2 py-1.5">
                              <CalendarDays className="h-4 w-4 text-indigo-500" />
                              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200">{group.label}</h2>
                              <span className="text-xs text-gray-400">{group.items.length} 张</span>
                            </div>
                            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-history-grid md:grid md:grid-cols-4 xl:grid-cols-5 md:gap-4`} style={mobileGalleryStyle(imageDisplay)}>
                            {group.items.map(item => (
                                <div
                                    key={item.id}
                                    className={`mobile-gallery-item group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border hover:border-indigo-500 transition-colors ${selectedIds.has(item.id) ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}
                                    onPointerDown={() => {
                                        longPressTriggeredRef.current = false;
                                        longPressTimerRef.current = window.setTimeout(() => {
                                            longPressTriggeredRef.current = true;
                                            setSelectionMode(true);
                                            setSelectedIds(previous => new Set(previous).add(item.id));
                                        }, 550);
                                    }}
                                    onPointerUp={() => { if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current); }}
                                    onPointerCancel={() => { if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current); }}
                                    onClick={() => {
                                        if (longPressTriggeredRef.current) return;
                                        if (selectionMode) setSelectedIds(previous => { const next = new Set(previous); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; });
                                        else setLightbox(item);
                                    }}
                                >
                                    <div className="mobile-gallery-frame md:aspect-square relative w-full overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': `${item.params.width || 832} / ${item.params.height || 1216}` } as React.CSSProperties}>
                                      <SmartImage src={item.imageUrl} thumbnailVariant={HISTORY_THUMBNAIL_VARIANT} alt={`生成于 ${new Date(item.createdAt).toLocaleString()} 的图片`} className="w-full h-full object-cover" />
                                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                      {selectionMode && <div className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white shadow">{selectedIds.has(item.id) ? '✓' : ''}</div>}
                                      <div className="absolute top-2 right-2 hidden md:block opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={(e) => handleDelete(item.id, e)} className="p-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                      <div className="absolute bottom-0 left-0 right-0 hidden p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] md:block md:opacity-0 group-hover:opacity-100 transition-opacity truncate">
                                        {new Date(item.createdAt).toLocaleString()}
                                      </div>
                                    </div>
                                    <div className="truncate px-2 py-2 text-[11px] text-gray-600 dark:text-gray-300 md:hidden">{new Date(item.createdAt).toLocaleString()}</div>
                                </div>
                            ))}
                            </div>
                          </section>)}
                        </div>
                        {selectionMode && <div className="mobile-safe-bottom fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 border-t border-gray-200 bg-white/95 p-2 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 md:hidden"><div className="mb-1 text-center text-xs font-bold dark:text-white">多选模式 · 已选 {selectedIds.size} 张</div><div className="grid grid-cols-4 gap-2"><button onClick={exitSelectionMode} className="mobile-touch rounded-xl bg-gray-100 text-sm font-bold dark:bg-gray-800">退出</button><button onClick={selectCurrentPage} className="mobile-touch rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">全选</button><button onClick={invertCurrentPageSelection} className="mobile-touch rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">反选</button><button onClick={() => void handleBulkDelete()} disabled={!selectedIds.size} className="mobile-touch rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-40">删除</button></div></div>}
                        
                        {/* 底部分页信息 */}
                        <div className="mt-12 md:mt-16">
                            {totalCount > 0 && <div className="mx-auto mb-4 grid max-w-sm grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2">
                                <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1 || isLoading} aria-label="上一页" className="mobile-touch rounded-full text-2xl text-gray-500 disabled:opacity-30 dark:text-gray-300">‹</button>
                                <button onClick={() => setShowPageMenu(true)} className="mobile-touch rounded-lg text-sm font-bold text-indigo-600 dark:text-indigo-300 md:hidden">{currentPage} / {totalPages}</button>
                                <form onSubmit={submitDesktopPageJump} className="hidden items-center justify-center gap-1.5 md:flex">
                                    <input type="number" min="1" max={totalPages} value={desktopJumpPage} onChange={event => setDesktopJumpPage(event.target.value)} onFocus={event => event.currentTarget.select()} aria-label="输入页码跳转" className="h-10 w-16 rounded-lg border border-indigo-200 bg-white px-2 text-center text-sm font-bold text-indigo-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 dark:border-indigo-900/60 dark:bg-gray-800 dark:text-indigo-300" />
                                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-300">/ {totalPages}</span>
                                </form>
                                <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages || isLoading} aria-label="下一页" className="mobile-touch rounded-full text-2xl text-gray-500 disabled:opacity-30 dark:text-gray-300">›</button>
                            </div>}
                            <div className="flex flex-col items-center justify-center py-6">
                                {isLoading ? (
                                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />加载中...</div>
                                ) : (
                                    <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                        <p>当前显示第 {getDisplayedRange().start} - {getDisplayedRange().end} 张</p>
                                        <p className="mt-1">共 {totalCount} 张，已缓存 {Object.keys(pageCache).length} 页</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Lightbox */}
            {lightbox && (
                <div className="fixed inset-0 z-[1050] bg-black/90 backdrop-blur-sm flex items-center justify-center p-0 md:p-8" onClick={closeLightbox}>
                    <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[100dvh] md:h-[90vh] rounded-none md:rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                        {/* Image Area */}
                        <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative h-[45%] md:h-auto border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800">
                            <OriginalImage src={lightbox.imageUrl} alt="历史生成图片预览" className="max-w-full max-h-full object-contain shadow-lg" decoding="async" />
                        </div>

                        {/* Details Area */}
                        <div className="w-full md:w-[400px] bg-white dark:bg-gray-900 flex flex-col p-4 md:p-6 h-[55%] md:h-auto overflow-hidden">
                            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">图片详情</h2>
                                <button onClick={closeLightbox} className="mobile-touch text-gray-500 hover:text-gray-900 dark:hover:text-white p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                                <ParamsViewer
                                    params={lightbox.params}
                                    prompt={lightbox.prompt}
                                    negativePrompt={getHistoryNegativePrompt(lightbox)}
                                    notify={notify}
                                />
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4 space-y-3 flex-shrink-0">
                                {/* 导入到编辑器 */}
                                <button
                                    onClick={handleImportToEditor}
                                    disabled={isPreparingImport}
                                className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
                                >
                                    <Save className="h-4 w-4" />
                                    {isPreparingImport ? '正在读取元数据...' : '导入到编辑器'}
                                </button>

                                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                                    <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">发布到灵感图库</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="为这张图取个标题..."
                                            className="flex-1 px-3 py-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 text-sm outline-none dark:text-white focus:border-indigo-500 transition-colors"
                                            value={publishTitle}
                                            onChange={e => setPublishTitle(e.target.value)}
                                        />
                                        <button
                                            onClick={handlePublish}
                                            disabled={isPublishing}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold whitespace-nowrap disabled:opacity-50 transition-colors shadow-sm"
                                        >
                                            {isPublishing ? '发布中' : '发布'}
                                        </button>
                                    </div>
                                </div>
                                <a
                                    href={lightbox.imageUrl}
                                    download={getDownloadFilename()}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800 hover:bg-gray-700 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-bold transition-colors shadow-lg"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    下载原图
                                </a>
                                <button onClick={event => void handleDelete(lightbox.id, event)} className="mobile-touch w-full rounded-lg bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 md:hidden">删除这张历史图片</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* Clean Modal */}
            {showCleanModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white"><AlertTriangle className="h-5 w-5 text-amber-500" />确认清理</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            {cleanMode === 'days' 
                                ? `将删除 ${cleanDays} 天前的 ${cleanPreviewCount} 张图片`
                                : `当前共 ${totalCount} 张，将删除 ${cleanPreviewCount} 张，只保留最近 ${cleanCount} 张`
                            }
                        </p>
                        <p className="text-xs text-red-500 mb-4">此操作无法恢复</p>
                        
                        <div className="mb-4">
                            {cleanMode === 'days' ? (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">天数</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanDays}
                                        onChange={e => {
                                            const value = Number(e.target.value);
                                            setCleanDays(value);
                                            if (Number.isFinite(value) && value >= 1) {
                                                localHistory.countOlderThan(value).then(setCleanPreviewCount);
                                            } else {
                                                setCleanPreviewCount(0);
                                            }
                                        }}
                                        className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">保留数量</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanCount}
                                        onChange={e => {
                                            const value = Number(e.target.value);
                                            setCleanCount(value);
                                            if (Number.isFinite(value) && value >= 1) {
                                                localHistory.getCount().then(count => {
                                                    setCleanPreviewCount(Math.max(0, count - value));
                                                });
                                            } else {
                                                setCleanPreviewCount(0);
                                            }
                                        }}
                                        className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            )}
                        </div>
                        
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCleanModal(false)}
                                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg font-bold"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCleanConfirm}
                                disabled={!Number.isFinite(cleanMode === 'days' ? cleanDays : cleanCount) || (cleanMode === 'days' ? cleanDays : cleanCount) < 1}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {showSuccessModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center animate-bounce-in">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center text-3xl mb-4">
                            ✨
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">发布成功！</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            您的作品已添加到灵感图库，其他用户可以查看并引用您的 Prompt。
                        </p>
                        <button
                            onClick={() => setShowSuccessModal(false)}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-all"
                        >
                            确定
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
