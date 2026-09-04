import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { PromptAgentDraft } from '../../types';

const PromptAgentPanel = React.lazy(() => import('../PromptAgentPanel').then(module => ({ default: module.PromptAgentPanel })));

export const PromptCopyButton: React.FC<{ onClick: () => void; title: string }> = ({ onClick, title }) => (
    <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-200"
        title={title}
    >
        <Copy className="h-4 w-4" />
        复制
    </button>
);

export type PresetSource = { name: string; modified: boolean };
export type PresetSection = 'base' | 'subject' | 'negative' | 'settings';

export const PresetSourceBadge: React.FC<{ source?: PresetSource }> = ({ source }) => source ? (
    <span className="max-w-28 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-micro font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-40" title={`来自：${source.name}${source.modified ? ' · 已修改' : ''}`}>
        来自：{source.name}{source.modified ? ' · 已修改' : ''}
    </span>
) : null;

export const PresetSourceBadges: React.FC<{ sources: Record<string, PresetSource> }> = ({ sources }) => {
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
    onFinalDraft: (draft: PromptAgentDraft) => void;
    onRequestGeneration: (draft: PromptAgentDraft, reason?: string) => Promise<boolean>;
    canUndo: boolean;
    onUndo: () => void;
    tagAssistEnabled: boolean;
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
    canUndo,
    onUndo,
    tagAssistEnabled,
}) => {
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
            onRequestGeneration={async (nextDraft, reason) => {
                const started = await onRequestGeneration(nextDraft, reason);
                if (started) setOpen(false);
                return started;
            }}
            canUndo={canUndo}
            onUndo={onUndo}
            tagAssistEnabled={tagAssistEnabled}
        /></React.Suspense>
    );
};
