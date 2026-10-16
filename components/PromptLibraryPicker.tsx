import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { PROMPT_LIBRARY_KIND_LABELS, type PromptLibraryKind } from '../services/promptAgent';
import { db } from '../services/dbService';
import type { PromptChain } from '../types';

/**
 * 提示词库选择器：实验室提示词分栏旁的「库导入」按钮。
 * 打开后从人物形象 / 服饰 / 姿势库挑一条，把它的英文提示词交给调用方追加。
 *
 * 面板用 fixed 定位：编辑器主区域是 overflow-y-auto 容器，absolute 弹层会被裁剪，
 * 所以打开时按按钮的 getBoundingClientRect() 计算位置并夹取到视口内。
 */

/** 追加语义：空值直接用；内容里已包含同一段文本则不重复追加；否则用「, 」拼接。 */
export const appendPromptText = (current: string, addition: string): string => {
  const base = String(current || '').trim();
  const text = String(addition || '').trim();
  if (!text) return base;
  if (!base) return text;
  if (base.includes(text)) return base;
  return `${base}, ${text}`;
};

/** 三个库的固定顺序：人物形象 → 服饰 → 姿势，标签名与库常量保持一致。 */
const LIBRARY_KINDS: PromptLibraryKind[] = ['appearance', 'wardrobe', 'pose', 'scene'];

const chainTags = (chain: PromptChain): string[] => (Array.isArray(chain?.tags) ? chain.tags : [])
    .map(value => String(value || '').trim())
    .filter(Boolean);

function LibraryIcon({ className = 'h-4 w-4' }: { className?: string }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M4 19.5V6a2 2 0 0 1 2-2h9l5 5v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5z" />
        <path d="M14 4v5h5" />
        <path d="M8 13h7M8 16.5h4" />
    </svg>;
}

interface PanelPosition {
    top?: number;
    bottom?: number;
    right: number;
    width: number;
    maxHeight: number;
}

export interface PromptLibraryPickerProps {
    /** 指定时只显示该库（各分栏各用一库），不出现标签切换。 */
    kind?: PromptLibraryKind;
    label?: string;
    disabled?: boolean;
    onPick: (prompt: string) => void;
}

export const PromptLibraryPicker: React.FC<PromptLibraryPickerProps> = ({ kind, label = '库导入', disabled = false, onPick }) => {
    useLanguage();
    // kind 合法时锁定为单库模式：不渲染标签切换。
    const lockedKind = kind && LIBRARY_KINDS.includes(kind) ? kind : '';
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<PromptLibraryKind>(lockedKind || 'wardrobe');
    const [chains, setChains] = useState<PromptChain[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [position, setPosition] = useState<PanelPosition | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    // 面板每次打开都重新拉取；迟到的响应不能覆盖新一轮结果。
    const requestRef = useRef(0);

    const tabs = LIBRARY_KINDS.map(id => {
        const label = t('{0}库', [t(PROMPT_LIBRARY_KIND_LABELS[id])]);
        return { id, label, empty: t('{0}还是空的', [label]) };
    });
    const activeTab = tabs.find(item => item.id === (lockedKind || tab)) || tabs[0];

    const load = async () => {
        const request = requestRef.current + 1;
        requestRef.current = request;
        setLoading(true);
        try {
            const all = await db.getAllChains();
            if (request !== requestRef.current) return;
            setChains(Array.isArray(all) ? all : []);
        } catch {
            // 读取失败按空库处理，面板仍可正常关闭，不阻塞编辑。
            if (request === requestRef.current) setChains([]);
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    };

    const measure = (trigger: HTMLButtonElement): PanelPosition => {
        const rect = trigger.getBoundingClientRect();
        const GAP = 6;
        const MARGIN = 12;
        const MIN_VISIBLE = 140;
        const vh = window.innerHeight;
        const width = Math.round(Math.min(352, Math.max(248, window.innerWidth - MARGIN * 2)));
        const right = Math.max(MARGIN, Math.round(window.innerWidth - rect.right));
        const below = vh - rect.bottom - GAP - MARGIN;
        const above = rect.top - GAP - MARGIN;
        // 字段可能靠近屏幕底部：下方放不下且上方更宽裕时改为向上展开。
        const openUp = below < 200 && above >= below;
        const maxHeight = Math.max(120, Math.min(380, Math.round(openUp ? above : below)));
        if (openUp) {
            // 夹取到视口内：按钮被滚出视口时 vh - rect.top + GAP 可能为负。
            return { bottom: Math.max(MARGIN, Math.round(vh - rect.top + GAP)), right, width, maxHeight };
        }
        const top = Math.min(Math.round(rect.bottom + GAP), vh - MARGIN - Math.min(maxHeight, MIN_VISIBLE));
        return { top: Math.max(MARGIN, top), right, width, maxHeight };
    };

    const toggle = () => {
        if (open) {
            setOpen(false);
            return;
        }
        if (lockedKind) setTab(lockedKind);
        setQuery('');
        const trigger = triggerRef.current;
        setPosition(trigger ? measure(trigger) : null);
        setOpen(true);
        // 每次打开都重新读取：库里可能刚新增或删除了条目。
        // 不能用 if (!chains) 判断——空数组是 truthy，第一次为空后就再也不会刷新。
        void load();
    };

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && triggerRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest('.plp-panel')) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
        // 定位基于按钮位置，编辑器本体滚动后收起。capture 会连面板列表自身的滚动一起捕获，
        // 所以先排除面板内部的目标，否则滚动列表会把自己关掉。
        const onScroll = (event: Event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('.plp-panel')) return;
            setOpen(false);
        };
        const onResize = () => setOpen(false);
        document.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [open]);

    const items = (chains || []).filter(chain => chain && chain.type === activeTab.id);
    const keyword = query.trim().toLowerCase();
    const shown = keyword
        ? items.filter(chain => [chain.name, chain.basePrompt, chain.description, ...chainTags(chain)].join(' ').toLowerCase().includes(keyword))
        : items;

    const pick = (chain: PromptChain) => {
        const text = String(chain?.basePrompt || '').trim();
        if (!text) return;
        onPick(text);
        setOpen(false);
    };

    return <>
        <button
            type="button"
            ref={triggerRef}
            disabled={disabled}
            onClick={toggle}
            title={lockedKind ? t('从{0}导入提示词', [activeTab.label]) : t('从提示词库导入提示词')}
            aria-label={lockedKind ? t('从{0}导入提示词', [activeTab.label]) : t('从人物形象库、服饰库或姿势库导入提示词')}
            aria-expanded={open}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-200"
        >
            <LibraryIcon className="h-4 w-4" />
            <span>{t(label)}</span>
        </button>
        {open && <div
            className="plp-panel fixed z-[1900] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-700 shadow-[0_18px_44px_rgba(15,23,42,0.2)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            role="dialog"
            aria-modal={false}
            aria-label={t('从提示词库导入')}
            style={position ? { top: position.top, bottom: position.bottom, right: position.right, width: position.width, maxHeight: position.maxHeight } : undefined}
        >
            <div className="flex items-center gap-2 border-b border-gray-200 px-2.5 py-2 dark:border-gray-700">
                <span className="mr-auto text-xs font-semibold text-gray-800 dark:text-gray-100">{lockedKind ? t('从{0}导入', [activeTab.label]) : t('从库里导入')}</span>
                <button type="button" onClick={() => setOpen(false)} aria-label={t('关闭')} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">×</button>
            </div>
            {!lockedKind && <div className="flex gap-1 px-2.5 pt-2">
                {tabs.map(item => <button
                    type="button"
                    key={item.id}
                    data-active={tab === item.id}
                    onClick={() => setTab(item.id)}
                    className={`min-h-7 flex-1 whitespace-nowrap rounded-lg border px-1 text-xs transition-colors ${tab === item.id ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500'}`}
                >{`${item.label}（${chains === null ? '…' : (chains || []).filter(chain => chain && chain.type === item.id).length}）`}</button>)}
            </div>}
            <input
                className="mx-2.5 my-2 min-h-[30px] rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs text-gray-800 outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                type="search"
                value={query}
                aria-label={t('搜索库条目')}
                placeholder={t('搜索名称、标签或提示词…')}
                onChange={event => setQuery(event.target.value)}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-1.5">
                {loading && chains === null
                    ? <div className="px-2.5 py-5 text-center text-xs text-gray-400">{t('正在读取…')}</div>
                    : shown.length > 0
                        ? shown.map(chain => <button
                            type="button"
                            key={chain.id}
                            onClick={() => pick(chain)}
                            title={String(chain.basePrompt || '')}
                            className="flex w-full flex-col gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-indigo-500 hover:bg-indigo-50/60 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/30"
                        >
                            <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{chain.name || t('未命名')}</span>
                                {chainTags(chain).length > 0 && <span className="flex shrink-0 gap-1">
                                    {chainTags(chain).slice(0, 2).map(value => <span key={value} className="rounded bg-indigo-50 px-1.5 text-[10.5px] text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">{value}</span>)}
                                </span>}
                            </span>
                            <span className="line-clamp-2 break-words font-mono text-[11px] leading-snug text-gray-500 dark:text-gray-400">{String(chain.basePrompt || '').trim() || t('（这条还没有提示词）')}</span>
                        </button>)
                        : <div className="px-2.5 py-5 text-center text-xs text-gray-400">{items.length > 0 ? t('没有匹配的条目') : activeTab.empty}</div>}
            </div>
            <div className="border-t border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-400 dark:border-gray-700">{t('点一条即可追加到当前提示词末尾')}</div>
        </div>}
    </>;
};
