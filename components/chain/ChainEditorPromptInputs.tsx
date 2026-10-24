import { t, useLanguage } from '../../services/i18n';
import React, { useId, useRef } from 'react';
import { LabPageLayout } from '../../services/appearancePreferences';
import { mergePromptSections, resolvePromptSections } from '../../services/labWorkspace';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptLibraryRandomButton, type PromptToolbarSlot } from '../PromptLibraryAccess';
import { PresetSection, PresetSource, PresetSourceBadges, PromptCopyButton } from './PresetSourceBadges';
import type { PromptFragmentKind } from '../../services/promptLibraryEntries';
import type { PromptSectionSource, PromptSections } from '../../types';
import { getEditableGlobalPrompt } from '../../services/promptUtils';

/** 文本型栏位（排除只用于追溯的 sectionMeta） */
type SectionKey = Exclude<keyof PromptSections, 'sectionMeta' | 'sectionNegatives'>;

const SECTION_FIELDS: { key: SectionKey; label: string; library: PromptFragmentKind; placeholder: string }[] = [
    { key: 'appearance', label: '外貌', library: 'appearance', placeholder: '外貌特征，如发色、瞳色与体型' },
    { key: 'wardrobe', label: '服饰', library: 'wardrobe', placeholder: '服装、鞋袜与配饰' },
    { key: 'pose', label: '动作', library: 'pose', placeholder: '身体姿态、动作与互动' },
    { key: 'scene', label: '场景', library: 'scene', placeholder: '地点、时间、天气与氛围' },
    { key: 'camera', label: '镜头', library: 'camera', placeholder: '景别、视角、构图与成像效果' },
    { key: 'extra', label: '补充', library: 'general', placeholder: '人数、道具与其他补充' },
];

interface PromptFieldProps {
    label: string;
    value: string;
    placeholder: string;
    library?: PromptFragmentKind;
    disabled: boolean;
    tagAssistEnabled: boolean;
    onChange: (value: string, source?: PromptSectionSource) => void;
    onCopy: (value: string, label: string) => void;
    /** 该栏现有来源（条目名），显示在标签旁做追溯 */
    sourceName?: string;
}

const PromptField: React.FC<PromptFieldProps> = ({ label, value, placeholder, library, disabled, tagAssistEnabled, onChange, onCopy, sourceName }) => {
    const id = useId();
    const clearSlot = useRef<HTMLSpanElement>(null);
    return <div role="group" aria-label={t(label)} className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
            <label htmlFor={id} className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t(label)}
                {sourceName ? <span className="ml-1 text-micro font-normal text-gray-400">{t('来源：{0}', [sourceName])}</span> : null}
            </label>
            <div className="flex shrink-0 items-center gap-1">
                <span ref={clearSlot} />
                <PromptCopyButton onClick={() => onCopy(value, label)} title={t('复制{0}', [t(label)])} />
            </div>
        </div>
        <TagAutocompleteTextarea id={id} aria-label={t(label)} clearActionSlotRef={clearSlot}
            libraryField={{ kind: library }}
            tagAssistEnabled={tagAssistEnabled} disabled={disabled} value={value} onValueChange={onChange}
            placeholder={t(placeholder)}
            className={`min-h-[100px] w-full rounded-lg border p-3 font-mono text-sm font-normal leading-relaxed outline-none ${disabled
                ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-800'
                : 'border-gray-200 bg-gray-50 text-gray-900 focus:ring-1 focus:ring-indigo-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200'}`} />
    </div>;
};

export interface ChainEditorPromptInputsProps {
    prompt: string;
    setPrompt: (value: string) => void;
    sections?: PromptSections | null;
    /** 就地发起「随机搭配」 */
    onContentRollForGlobal?: () => void;
    toolbarSlot?: PromptToolbarSlot | null;
    setSections?: (sections: PromptSections) => void;
    supplementPrompt?: string;
    setSupplementPrompt?: (value: string) => void;
    presetSources: Partial<Record<PresetSection, PresetSource>>;
    tagAssistEnabled: boolean;
    canEdit: boolean;
    promptClassificationEnabled?: boolean;
    onPlainPromptChange?: (value: string) => void;
    embedded?: boolean;
    copyPromptToClipboard: (value: string, label: string) => void;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'params';
}

export const ChainEditorPromptInputs: React.FC<ChainEditorPromptInputsProps> = ({
    prompt, setPrompt, sections, setSections, supplementPrompt = '', setSupplementPrompt, onContentRollForGlobal, toolbarSlot,
    presetSources, tagAssistEnabled, canEdit, copyPromptToClipboard,
    promptClassificationEnabled = false, onPlainPromptChange, embedded = false,
    markPresetSectionModified, markChange, activeLabLayout, mobileEditorTab,
}) => {
    useLanguage();
    const current = resolvePromptSections(sections, supplementPrompt);
        const writeSection = (key: SectionKey, value: string, source?: PromptSectionSource) => {
        const meta = { ...(current.sectionMeta || {}) } as Record<string, PromptSectionSource>;
        if (source) meta[key] = source;
        else if (String(value || '').trim()) meta[key] = { source: 'manual' };
        else delete meta[key];
        const next = { ...current, [key]: value, sectionMeta: meta } as PromptSections;
        setSections?.(next);
        setSupplementPrompt?.(mergePromptSections(next));
        markPresetSectionModified('subject');
        markChange();
    };
    const content = <section className={mobileEditorTab === 'global' ? 'block' : 'hidden'}>
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <PresetSourceBadges sources={Object.fromEntries(Object.entries({ base: presetSources.base, subject: presetSources.subject })
                    .filter((entry): entry is [string, PresetSource] => Boolean(entry[1])))} />
            </div>
            <div className="flex flex-col gap-3">
                {promptClassificationEnabled && <PromptLibraryRandomButton toolbarSlot={toolbarSlot ?? null} disabled={!canEdit} fallback={canEdit ? onContentRollForGlobal : undefined} />}
                {!promptClassificationEnabled ? <PromptField label="全局正面提示词" value={getEditableGlobalPrompt(prompt, supplementPrompt)} placeholder="全局正面提示词" disabled={!canEdit}
                    tagAssistEnabled={tagAssistEnabled} onCopy={copyPromptToClipboard} onChange={value => {
                        if (onPlainPromptChange) onPlainPromptChange(value);
                        else { setPrompt(value); setSupplementPrompt?.(''); setSections?.({}); }
                        markPresetSectionModified('base'); markPresetSectionModified('subject'); markChange();
                    }} /> : <>
                <PromptField label="画师串" value={prompt} placeholder="画师标签与固定画风" disabled={!canEdit}
                    tagAssistEnabled={tagAssistEnabled} onCopy={copyPromptToClipboard} onChange={value => {
                        setPrompt(value); markPresetSectionModified('base'); markChange();
                    }} />
                {SECTION_FIELDS.map(field => <PromptField key={field.key} label={field.label} library={field.library}
                    value={String(current[field.key] || '')} placeholder={field.placeholder} disabled={!canEdit}
                    sourceName={current.sectionMeta?.[field.key]?.entryName}
                    tagAssistEnabled={tagAssistEnabled} onCopy={copyPromptToClipboard}
                    onChange={(value, source) => writeSection(field.key, value, source)} />)}
                </>}
            </div>
        </section>;
    return embedded ? content : <LabModuleSection moduleId="prompt" label={t('全局正面提示词')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.prompt)}
        className={mobileEditorTab === 'global' ? 'block' : 'hidden'}>{content}</LabModuleSection>;
};
