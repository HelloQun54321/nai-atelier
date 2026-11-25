import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { PromptAgentDraft, PromptAgentGenerationResult, PromptChain } from '../../types';
import type { AgentPromptChange } from '../../services/agentPromptChanges.mjs';
import type { AgentPromptApplied, AgentPromptBeforeApply } from '../../services/promptAgent';

const PromptAgentPanel = React.lazy(() => import('../PromptAgentPanel').then(module => ({ default: module.PromptAgentPanel })));

export const PromptCopyButton: React.FC<{ onClick: () => void; title: string; disabled?: boolean }> = ({ onClick, title, disabled = false }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={title}
        title={title}
        className="mobile-touch flex h-7 w-7 items-center justify-center rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
        <Copy aria-hidden="true" className="h-4 w-4" />
    </button>
);

export type PresetSource = { name: string; modified: boolean };
export type PresetSection = 'base' | 'subject' | 'negative' | 'settings';

export const PresetSourceBadge: React.FC<{ source?: PresetSource }> = ({ source }) => source ? (
    <span className="max-w-28 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-micro font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-40" title={t("来自：{0}{1}", [source.name, source.modified ? t(' · 已修改') : ''])}>{t("来自：{0}{1}", [source.name, source.modified ? t(" · 已修改") : ''])}</span>
) : null;

export const PresetSourceBadges: React.FC<{ sources: Record<string, PresetSource> }> = ({ sources }) => {
  useLanguage();
    const merged = Object.values(sources).reduce<Record<string, PresetSource>>((result, source) => {
        result[source.name] = {
            name: source.name,
            modified: Boolean(result[source.name]?.modified || source.modified),
        };
        return result;
    }, {});
    const values = Object.values(merged);
    return values.length > 0 ? <div className="flex min-w-0 flex-wrap items-center gap-1">{values.map(source => <PresetSourceBadge key={source.name} source={source} />)}</div> : null;
};

interface PromptAgentOverlayControllerProps {
    chainId: string;
    openToken?: number;
    draft: PromptAgentDraft;
    apiKey: string;
    onRunStart: (snapshot: PromptAgentDraft) => void;
    onFinalDraft: (draft: PromptAgentDraft, reviewOnly?: boolean, onApplied?: AgentPromptApplied, beforeApply?: AgentPromptBeforeApply) => void | Promise<void>;
    onPromptChange: (change: AgentPromptChange, direction: 'undo' | 'redo', beforeApply?: AgentPromptBeforeApply) => void | Promise<void>;
    onRequestGeneration: (draft: PromptAgentDraft, reason?: string, onApproved?: () => Promise<void>, count?: number, placement?: 'end' | 'next') => Promise<boolean | PromptAgentGenerationResult>;
    onGenerationInterrupted?: () => void;
    tagAssistEnabled: boolean;
    splitPromptFields?: boolean;
    promptClassificationEnabled?: boolean;
    /** 角色库（含自定义角色），供对话输入框 @ 引用。 */
    characters?: PromptChain[];
}

/** Keep the overlay's visibility local so opening it does not rerender the editor. */
export const PromptAgentOverlayController: React.FC<PromptAgentOverlayControllerProps> = ({
    chainId,
    openToken,
    draft,
    apiKey,
    onRunStart,
    onFinalDraft,
    onRequestGeneration,
    onGenerationInterrupted,
    onPromptChange,
    tagAssistEnabled,
    splitPromptFields,
    promptClassificationEnabled,
    characters,
}) => {
  useLanguage();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (openToken) setOpen(true);
    }, [openToken]);

    useEffect(() => {
        const handleOpen = (event: Event) => {
            const requestedChainId = (event as CustomEvent<{ chainId?: string }>).detail?.chainId;
            if (requestedChainId === chainId) setOpen(true);
        };
        window.addEventListener('nai-open-prompt-agent', handleOpen);
        return () => window.removeEventListener('nai-open-prompt-agent', handleOpen);
    }, [chainId]);

    if (!open) return null;

    return (
        <React.Suspense fallback={null}><PromptAgentPanel
            open={open}
            onClose={() => setOpen(false)}
            draft={draft}
            apiKey={apiKey}
            onRunStart={onRunStart}
            onFinalDraft={onFinalDraft}
            onRequestGeneration={onRequestGeneration}
            onGenerationInterrupted={onGenerationInterrupted}
            onPromptChange={onPromptChange}
            tagAssistEnabled={tagAssistEnabled}
            splitPromptFields={splitPromptFields}
            promptClassificationEnabled={promptClassificationEnabled}
            characters={characters}
        /></React.Suspense>
    );
};
