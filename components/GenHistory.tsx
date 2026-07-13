
import React, { useState, useEffect, useRef } from 'react';
import { localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, User } from '../types';
import { PAGINATION_CONFIG } from '../config/pagination';
import { extractMetadata, IMPORT_SESSION_KEY, parseNovelAIMetadata } from '../services/metadataService';
import { ParamsViewer } from './ParamsViewer';

interface GenHistoryProps {
    currentUser: User;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
    onRefreshInspiration?: () => void;
}

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser, notify, onNavigateToPlayground, onRefreshInspiration }) => {
    const [items, setItems] = useState<LocalGenItem[]>([]);
    const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishTitle, setPublishTitle] = useState('');
    const [showSuccessModal, setShowSuccessModal] = useState(false);

    // 分页相关状态
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [jumpPage, setJumpPage] = useState('');
    
    // 缓存管理
    const [pageCache, setPageCache] = useState<Record<number, LocalGenItem[]>>({});
    const pageCacheRef = useRef<Record<number, LocalGenItem[]>>({});
    const inflightPagesRef = useRef<Record<number, Promise<LocalGenItem[]>>>({});
    const currentPageRef = useRef(1);
    const loadRequestRef = useRef(0);
    const refreshPageRef = useRef<(page: number, force?: boolean) => Promise<void>>(async () => undefined);

    // 清理相关状态
    const [showCleanMenu, setShowCleanMenu] = useState(false);
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
    const getPageData = async (page: number, force = false): Promise<LocalGenItem[]> => {
        const cached = pageCacheRef.current[page];
        if (!force && cached) {
            return cached;
        }

        const inflight = inflightPagesRef.current[page];
        if (!force && inflight) {
            return inflight;
        }

        let request: Promise<LocalGenItem[]>;
        request = localHistory.getPage(page - 1, PAGE_SIZE)
            .then(data => {
                if (inflightPagesRef.current[page] === request) {
                    delete inflightPagesRef.current[page];
                }
                return data;
            })
            .catch(error => {
                if (inflightPagesRef.current[page] === request) {
                    delete inflightPagesRef.current[page];
                }
                throw error;
            });

        inflightPagesRef.current[page] = request;
        return request;
    };

    const preloadPage = async (page: number, totalPages: number, centerPage: number) => {
        if (page < 1 || page > totalPages) {
            return;
        }

        try {
            const data = await getPageData(page);

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
        } catch (e) {
            console.warn('预加载页面失败:', e);
        }
    };

    // 跳转到指定页
    const goToPage = async (page: number, force: boolean = false) => {
        const requestId = ++loadRequestRef.current;
        setIsLoading(true);

        try {
            const count = await localHistory.getCount();
            const calculatedTotalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
            const targetPage = Math.max(1, Math.min(page, calculatedTotalPages));

            if (requestId !== loadRequestRef.current) return;

            currentPageRef.current = targetPage;
            setCurrentPage(targetPage);
            setTotalPages(calculatedTotalPages);
            setTotalCount(count);

            const data = await getPageData(targetPage, force);
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

        void refreshPageRef.current(1, true);
        return unsubscribe;
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

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('确定删除这张图片记录吗？(无法恢复)')) {
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

    const handleClearAll = async () => {
        if (confirm('确定清空所有本地生图历史吗？')) {
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
                id: crypto.randomUUID(),
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

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <header className="p-4 md:p-6 bg-white dark:bg-gray-800 shadow-md border-b border-gray-200 dark:border-gray-700 z-10 flex-shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">本地生图历史</h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400">仅存储在您的浏览器中</p>
                    </div>
                    <div className="flex gap-2 md:gap-3 items-center">
                        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">共 {totalCount} 张</div>
                        <div className="relative">
                            <button 
                                onClick={() => setShowCleanMenu(!showCleanMenu)} 
                                className="px-3 py-1 md:px-4 md:py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs md:text-sm hover:bg-red-200 dark:hover:bg-red-900/50 flex items-center gap-1"
                            >
                                清理
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showCleanMenu && (
                                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                                    <button 
                                        onClick={handleClearAll} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                                    >
                                        🗑️ 清空全部
                                    </button>
                                    <button 
                                        onClick={() => handleCleanMenuClick('days')} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        ⏰ 删除 X 天前的...
                                    </button>
                                    <button 
                                        onClick={() => handleCleanMenuClick('count')} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-b-lg"
                                    >
                                        📊 只保留最近 N 张...
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={isLoading}
                            className="px-3 py-1 md:px-4 md:py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs md:text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-wait"
                        >
                            {isLoading ? '刷新中…' : '刷新'}
                        </button>
                    </div>
                </div>

                {/* 分页控件 */}
                {totalCount > 0 && (
                    <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        {/* 分页按钮 */}
                        <div className="flex items-center gap-2">
                            {/* 首页 */}
                            <button
                                onClick={() => goToPage(1)}
                                disabled={currentPage === 1 || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                首页
                            </button>

                            {/* 上一页 */}
                            <button
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage === 1 || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                上一页
                            </button>

                            {/* 页码按钮 */}
                            <div className="flex gap-1">
                                {getPageButtons().map(page => (
                                    <button
                                        key={page}
                                        onClick={() => goToPage(page)}
                                        disabled={isLoading}
                                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                                            page === currentPage
                                                ? 'bg-indigo-500 text-white border-indigo-500'
                                                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        {page}
                                    </button>
                                ))}
                            </div>

                            {/* 下一页 */}
                            <button
                                onClick={() => goToPage(currentPage + 1)}
                                disabled={currentPage === totalPages || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                下一页
                            </button>

                            {/* 末页 */}
                            <button
                                onClick={() => goToPage(totalPages)}
                                disabled={currentPage === totalPages || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                末页
                            </button>
                        </div>

                        {/* 页码输入框 */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 dark:text-gray-300">跳至</span>
                            <input
                                type="number"
                                min="1"
                                max={totalPages}
                                placeholder="页码"
                                value={jumpPage}
                                disabled={isLoading}
                                onChange={e => setJumpPage(e.target.value)}
                                className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const page = parseInt((e.target as HTMLInputElement).value);
                                        if (page >= 1 && page <= totalPages) {
                                            void goToPage(page);
                                            setJumpPage('');
                                        }
                                    }
                                }}
                            />
                            <button
                                onClick={() => {
                                    const page = parseInt(jumpPage);
                                    if (page >= 1 && page <= totalPages) {
                                        void goToPage(page);
                                        setJumpPage('');
                                    }
                                }}
                                disabled={isLoading}
                                className="px-2 py-1 text-xs bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors disabled:opacity-50"
                            >
                                跳转
                            </button>
                        </div>
                    </div>
                )}
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
                {isLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="text-4xl mb-2 animate-spin">⏳</div>
                        <p>加载中...</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="text-4xl mb-2">🕰️</div>
                        <p>暂无生成记录</p>
                        <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                            {items.map(item => (
                                <div
                                    key={item.id}
                                    className="group relative aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
                                    onClick={() => setLightbox(item)}
                                >
                                    <img
                                        src={item.imageUrl}
                                        alt={`生成于 ${new Date(item.createdAt).toLocaleString()} 的图片`}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                    <div className="absolute top-2 right-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={(e) => handleDelete(item.id, e)} className="p-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity truncate">
                                        {new Date(item.createdAt).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        {/* 底部分页信息 */}
                        <div className="flex flex-col items-center justify-center py-6">
                            {isLoading ? (
                                <div className="text-gray-500 dark:text-gray-400">⏳ 加载中...</div>
                            ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                    <p>当前显示第 {getDisplayedRange().start} - {getDisplayedRange().end} 张</p>
                                    <p className="mt-1">共 {totalCount} 张，已缓存 {Object.keys(pageCache).length} 页</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Lightbox */}
            {lightbox && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={() => setLightbox(null)}>
                    <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[85vh] md:h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                        {/* Image Area */}
                        <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative h-[45%] md:h-auto border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800">
                            <img src={lightbox.imageUrl} alt="历史生成图片预览" className="max-w-full max-h-full object-contain shadow-lg" decoding="async" />
                        </div>

                        {/* Details Area */}
                        <div className="w-full md:w-[400px] bg-white dark:bg-gray-900 flex flex-col p-4 md:p-6 h-[55%] md:h-auto overflow-hidden">
                            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">图片详情</h2>
                                <button onClick={() => setLightbox(null)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
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
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg disabled:opacity-60 disabled:cursor-wait"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
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
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                    下载原图
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* Clean Modal */}
            {showCleanModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">⚠️ 确认清理</h3>
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
