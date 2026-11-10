import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { InlineSpinner } from './DesignSystem';
import { t, useLanguage } from '../services/i18n';
import { PROMPT_LIBRARY_KIND_LABELS, type PromptLibraryKind } from '../services/promptAgent';
import { db } from '../services/dbService';
import type { PromptChain } from '../types';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { applyPromptText, coveredTagCount, kindConflictOf, PROMPT_APPLY_MODES, type PromptApplyMode } from '../services/promptApply';

export const appendPromptText = (current: string, addition: string): string => {
    const base = current.trim(), text = addition.trim();
    return !text || base.includes(text) ? base : base ? `${base}, ${text}` : text;
};

interface PromptLibraryPickerProps {
    kind: PromptLibraryKind;
    disabled?: boolean;
    /** 兼容旧调用：只回传英文片段 */
    onPick: (prompt: string) => void;
    /** 目标栏位所属库（与条目库不同即跨类应用，界面会提示） */
    targetKind?: PromptLibraryKind;
    /** 当前栏位内容：用于「会新增几项」与三种模式的预览 */
    current?: string;
    /** 新调用：回传模式与来源，方便调用方记录来源快照 */
    onPickEntry?: (result: { prompt: string; mode: PromptApplyMode; entryId: string; entryName: string; kind: PromptLibraryKind }) => void;
}

const MODE_LABELS: Record<PromptApplyMode, string> = {
    replace: '替换当前栏位',
    append: '追加到末尾',
    'fill-missing': '只填空白栏位',
};

const LibraryOptions: React.FC<PromptLibraryPickerProps & { close: () => void }> = ({ kind, onPick, onPickEntry, targetKind, current = '', close }) => {
    const [chains, setChains] = useState<PromptChain[] | null>(null);
    const [query, setQuery] = useState('');
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const [mode, setMode] = useState<PromptApplyMode>('append');
    useEffect(() => {
        let active = true;
        setChains(null); setFailed(false);
        void db.getAllChains().then(items => {
            if (active) setChains(items.filter(item => item.type === kind));
        }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [kind, retry]);
    const keyword = query.trim().toLowerCase();
    const shown = (chains || []).filter(item => [item.name, item.basePrompt, ...(item.tags || [])].join(' ').toLowerCase().includes(keyword));
    const conflict = kindConflictOf(kind, targetKind || kind);
    return <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('应用方式')}>
            {PROMPT_APPLY_MODES.map(value => (
                <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value}
                    className={`mobile-touch rounded-lg border px-2 py-1 text-xs ${mode === value
                        ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}>
                    {t(MODE_LABELS[value])}
                </button>
            ))}
        </div>
        {conflict ? (
            <p role="status" className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {t('这是「{0}」的条目，当前栏位属于「{1}」：跨类应用不阻止，但请确认内容是否合适', [
                    t(PROMPT_LIBRARY_KIND_LABELS[kind]), t(PROMPT_LIBRARY_KIND_LABELS[targetKind || kind]),
                ])}
            </p>
        ) : null}
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
            aria-label={t('搜索库条目')} placeholder={t('搜索名称、标签或提示词…')}
            className={TOOLBAR_FIELD_CLASS} />
        {failed ? <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('读取提示词库失败')} <button type="button" className="mobile-touch underline" onClick={() => setRetry(value => value + 1)}>{t('重试')}</button>
        </div> : chains === null ? <InlineSpinner label={t('正在读取…')} className="py-4 text-sm" />
            : shown.length ? <div className="max-h-80 space-y-1 overflow-y-auto">
                {shown.map(item => {
                    const prompt = item.basePrompt.trim();
                    const covered = coveredTagCount(current, prompt);
                    return <button type="button" key={item.id} disabled={!prompt}
                        onClick={() => {
                            const next = applyPromptText(current, prompt, mode);
                            if (onPickEntry) {
                                /* 只走带来源的回调：再调一次 onPick 会把 entryId / entryName 覆盖掉 */
                                onPickEntry({ prompt: next, mode, entryId: String(item.id), entryName: item.name || t('未命名'), kind });
                            } else {
                                onPick(next);
                            }
                            close();
                        }}
                        className="mobile-touch flex w-full flex-col gap-1 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-indigo-500 disabled:opacity-40 dark:border-gray-700">
                        <span className="max-w-full truncate text-sm font-semibold">{item.name || t('未命名')}</span>
                        <span className="line-clamp-2 break-words font-mono text-xs text-gray-500 dark:text-gray-400">{prompt || t('还没有提示词')}</span>
                        {covered ? <span className="text-micro text-gray-400">{t('其中 {0} 项已存在', [String(covered)])}</span> : null}
                    </button>;
                })}
            </div> : <p className="py-4 text-center text-sm text-gray-500">{t(chains.length ? '没有匹配的条目' : '这个提示词库还是空的')}</p>}
    </div>;
};

/** 复用共用弹层：桌面避让视口，手机底部面板，关闭后再次打开读取最新条目。 */
export const PromptLibraryPicker: React.FC<PromptLibraryPickerProps> = props => {
    useLanguage();
    return <ToolbarPopover label="库导入" title={t('从{0}库导入', [t(PROMPT_LIBRARY_KIND_LABELS[props.kind])])}
        icon={<BookOpen className="h-4 w-4" />} disabled={props.disabled} width={360}>
        {close => <LibraryOptions {...props} close={close} />}
    </ToolbarPopover>;
};
