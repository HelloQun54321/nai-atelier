import { type PromptPurposeId } from '../../services/promptPurposes.mjs';
import { t, useLanguage } from '../../services/i18n';
import React, { useId, useRef } from 'react';
import { LabPageLayout } from '../../services/appearancePreferences';
import { mergePromptSections } from '../../services/labWorkspace';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PresetSection, PresetSource, PresetSourceBadges, PromptCopyButton } from './PresetSourceBadges';
import type { PromptFragmentKind } from '../../services/promptLibraryEntries';
import type { PromptSectionSource, PromptSections } from '../../types';
import { getEditableGlobalPrompt } from '../../services/promptUtils';

interface PromptFieldProps {
    label: string;
    value: string;
    placeholder: string;
    library?: PromptFragmentKind;
    directoryId?: string; purposeId?: PromptPurposeId; roleId?: string; negativeLabel?: string;
    disabled: boolean;
    tagAssistEnabled: boolean;
    onChange: (value: string, source?: PromptSectionSource) => void;
    onCopy?: (value: string, label: string) => void;
    /** 该栏现有来源（条目名），显示在标签旁做追溯 */
    sourceName?: string;
    negative?: string;
    negativeLocked?: boolean;
    onNegativeChange?: (value: string) => void;
}

export const PromptField: React.FC<PromptFieldProps> = ({ label, value, placeholder, library, directoryId, purposeId, roleId, negativeLabel, disabled, tagAssistEnabled, onChange, onCopy, sourceName, negative, negativeLocked, onNegativeChange }) => {
    const id = useId();
    const clearSlot = useRef<HTMLSpanElement>(null);
    const negativeContent = onNegativeChange && <div className={negativeLocked ? 'nai-model-locked' : undefined} title={negativeLocked ? t('Medium 不支持负面提示词') : undefined}>
        <label htmlFor={`${id}-negative`} className="mb-1 block text-micro font-semibold text-gray-500">{t('内容负面')}</label>
        <TagAutocompleteTextarea id={`${id}-negative`} aria-label={negativeLabel || `${t(label)} · ${t('内容负面')}`} libraryField={{ kind: library, directoryId, purposeId, roleId, negative: true }}
            tagAssistEnabled={tagAssistEnabled && !negativeLocked} showTranslations={!!negative?.trim()} disabled={disabled || negativeLocked} value={negative || ''} onValueChange={onNegativeChange}
            className="min-h-10 w-full rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
    </div>;
    return <div role="group" aria-label={t(label)} className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
            <label htmlFor={id} className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t(label)}
                {sourceName ? <span className="ml-1 text-micro font-normal text-gray-400">{t('来源：{0}', [sourceName])}</span> : null}
            </label>
            <div className="flex shrink-0 items-center gap-1">
                <span ref={clearSlot} />
                {onCopy && <PromptCopyButton onClick={() => onCopy(value, label)} title={t('复制{0}', [t(label)])} />}
            </div>
        </div>
        <TagAutocompleteTextarea id={id} aria-label={t(label)} clearActionSlotRef={clearSlot}
            libraryField={{ kind: library, directoryId, purposeId, roleId }}
            tagAssistEnabled={tagAssistEnabled} showTranslations={!!value.trim()} disabled={disabled} value={value} onValueChange={onChange}
            placeholder={t(placeholder)}
            className={`min-h-20 w-full rounded-lg border p-3 font-mono text-sm font-normal leading-relaxed outline-none ${disabled
                ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-800'
                : 'border-gray-200 bg-gray-50 text-gray-900 focus:ring-1 focus:ring-indigo-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200'}`} />
        {negativeContent}
    </div>;
};

export interface ChainEditorPromptInputsProps {
    prompt: string;
    setPrompt: (value: string) => void;
    sections?: PromptSections | null;
    setSections?: (sections: PromptSections) => void;
    supplementPrompt?: string;
    setSupplementPrompt?: (value: string) => void;
    presetSources: Partial<Record<PresetSection, PresetSource>>;
    tagAssistEnabled: boolean;
    canEdit: boolean;
    onPlainPromptChange?: (value: string) => void;
    embedded?: boolean;
    copyPromptToClipboard: (value: string, label: string) => void;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'reference' | 'params';
}

export const ChainEditorPromptInputs: React.FC<ChainEditorPromptInputsProps> = ({
    prompt, setPrompt, sections, setSections, supplementPrompt = mergePromptSections(sections), setSupplementPrompt,
    presetSources, tagAssistEnabled, canEdit, copyPromptToClipboard,
    onPlainPromptChange, embedded = false,
    markPresetSectionModified, markChange, activeLabLayout, mobileEditorTab,
}) => {
    useLanguage();
    const content = <section hidden={mobileEditorTab !== 'global'} className={mobileEditorTab === 'global' ? 'block' : 'hidden'}>
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <PresetSourceBadges sources={Object.fromEntries(Object.entries({ base: presetSources.base, subject: presetSources.subject })
                    .filter((entry): entry is [string, PresetSource] => Boolean(entry[1])))} />
            </div>
            <div className="flex flex-col gap-3">
                <PromptField label="全局正面提示词" value={getEditableGlobalPrompt(prompt, supplementPrompt)} placeholder="全局正面提示词" disabled={!canEdit}
                    tagAssistEnabled={tagAssistEnabled} onCopy={copyPromptToClipboard} onChange={value => {
                        if (onPlainPromptChange) onPlainPromptChange(value);
                        else { setPrompt(value); setSupplementPrompt?.(''); setSections?.({}); }
                        markPresetSectionModified('base'); markPresetSectionModified('subject'); markChange();
                    }} />
            </div>
        </section>;
    return embedded ? content : <LabModuleSection moduleId="prompt" label={t('全局正面提示词')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.prompt)}
        className={mobileEditorTab === 'global' ? 'block' : 'hidden'}>{content}</LabModuleSection>;
};
