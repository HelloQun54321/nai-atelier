import { t, useLanguage } from '../../services/i18n';
import React from 'react';
import { LabPageLayout } from '../../services/appearancePreferences';
import { mergePromptSections } from '../../services/labWorkspace';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { appendPromptText, PromptLibraryPicker } from '../PromptLibraryPicker';
import { PresetSection, PresetSource, PresetSourceBadges, PromptCopyButton, PromptClearButton } from './PresetSourceBadges';
import type { PromptLibraryKind } from '../../services/promptAgent';
import type { PromptSections } from '../../types';

type PromptSectionKey = keyof PromptSections;

interface PromptSectionField {
    key: PromptSectionKey;
    label: string;
    library?: PromptLibraryKind;
    libraryLabel?: string;
    placeholder: string;
}

/** 四栏顺序固定为 人物 → 服饰 → 姿势 → 补充，合并后写入 subjectPrompt（→ variableValues.subject）。 */
const PROMPT_SECTION_FIELDS: PromptSectionField[] = [
    { key: 'appearance', label: '人物', library: 'appearance', libraryLabel: '形象库', placeholder: '银发、红瞳、短发、娇小身材等外貌特征' },
    { key: 'wardrobe', label: '服饰', library: 'wardrobe', libraryLabel: '服饰库', placeholder: '白色连衣裙、草帽、吊带袜等服装与穿戴' },
    { key: 'pose', label: '姿势', library: 'pose', libraryLabel: '姿势库', placeholder: '站姿、看向镜头、双手叉腰等姿态动作' },
    { key: 'extra', label: '补充', library: 'scene', libraryLabel: '场景库', placeholder: '这次的人数、场景、构图、光线等其它补充' },
];

export interface ChainEditorPromptInputsProps {
    prompt: string;
    setPrompt: (value: string) => void;
    presetSources: Partial<Record<PresetSection, PresetSource>>;
    tagAssistEnabled: boolean;
    canEdit: boolean;
    copyPromptToClipboard: (value: string, label: string) => void;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'params';
    /** 四栏原文（params._promptSections）；缺省表示旧数据，此时「补充」栏显示现有 subject。 */
    sections?: PromptSections | null;
    setSections?: (sections: PromptSections) => void;
    /** 合并后的 subject 提示词，是落库 variableValues.subject 的唯一通道。 */
    supplementPrompt?: string;
    setSupplementPrompt?: (value: string) => void;
}
export const ChainEditorPromptInputs: React.FC<ChainEditorPromptInputsProps> = ({
    prompt,
    setPrompt,
    presetSources,
    tagAssistEnabled,
    canEdit,
    copyPromptToClipboard,
    markPresetSectionModified,
    markChange,
    activeLabLayout,
    mobileEditorTab,
    sections,
    setSections,
    supplementPrompt = '',
    setSupplementPrompt,
}) => {
    useLanguage();
    const promptSections = sections || {};
    const sectionText = (key: PromptSectionKey) => String(promptSections[key] || '');
    const hasSections = PROMPT_SECTION_FIELDS.some(({ key }) => sectionText(key).trim().length > 0);

    const writeSection = (key: PromptSectionKey, value: string) => {
        // 旧数据兼容：还没有分栏时，把现有 subject 整段并入「补充」再合并，首次编辑也不丢内容。
        const base = hasSections ? promptSections : { ...promptSections, extra: supplementPrompt };
        const next = { ...base, [key]: value };
        setSections?.(next);
        setSupplementPrompt?.(mergePromptSections(next));
        markPresetSectionModified('subject');
        markChange();
    };

    const inputClass = `w-full border rounded-lg p-3 outline-none font-mono text-sm font-normal leading-relaxed min-h-[100px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500'}`;

    const renderField = (options: { id: string; label: string; value: string; placeholder: string; onValueChange: (value: string) => void; library?: PromptLibraryKind; libraryLabel?: string }) => (
        <div key={options.id} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <label htmlFor={`atelier-prompt-${options.id}`} className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{t(options.label)}</label>
                <div className="flex shrink-0 items-center gap-1">
                    {options.library && <PromptLibraryPicker
                        kind={options.library}
                        label={options.libraryLabel || '库导入'}
                        disabled={!canEdit}
                        onPick={picked => options.onValueChange(appendPromptText(options.value, picked))}
                    />}
                    <PromptCopyButton onClick={() => copyPromptToClipboard(options.value, options.label)} title={t('复制{0}', [t(options.label)])} />
                    <PromptClearButton title={t('清空{0}', [t(options.label)])} disabled={!canEdit || !options.value.trim()} onClick={() => options.onValueChange('')} />
                </div>
            </div>
            <TagAutocompleteTextarea
                id={`atelier-prompt-${options.id}`}
                aria-label={t(options.label)}
                tagAssistEnabled={tagAssistEnabled}
                disabled={!canEdit}
                className={inputClass}
                value={options.value}
                placeholder={t(options.placeholder)}
                onValueChange={options.onValueChange}
            />
        </div>
    );

    return (
        <LabModuleSection
            moduleId="prompt"
            label={t("全局提示词")}
            order={activeLabLayout.order.indexOf('prompt')}
            defaultCollapsed={Boolean(activeLabLayout.collapsed.prompt)}
            className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}
        >
            {/* Prompt Sections：画师串单独保存（compilePrompt 里排在 subject 之前），其余四栏合并进 subject。 */}
            <section className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}>
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                    <PresetSourceBadges sources={Object.fromEntries(Object.entries({ base: presetSources.base, subject: presetSources.subject }).filter((entry): entry is [string, PresetSource] => Boolean(entry[1])))} />
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {renderField({
                        id: 'base',
                        label: '画师串',
                        value: prompt,
                        placeholder: '填写画师标签、线条、上色等固定风格；会排在提示词最前',
                        onValueChange: nextValue => {
                            setPrompt(nextValue);
                            markPresetSectionModified('base');
                            markChange();
                        },
                    })}
                    {PROMPT_SECTION_FIELDS.map(field => renderField({
                        id: field.key,
                        label: field.label,
                        // 旧数据没有分栏时，「补充」栏直接显示现有 subject，用户编辑时再并入 extra。
                        value: field.key === 'extra' && !hasSections ? supplementPrompt : sectionText(field.key),
                        placeholder: field.placeholder,
                        library: field.library,
                        libraryLabel: field.libraryLabel,
                        onValueChange: nextValue => writeSection(field.key, nextValue),
                    }))}
                </div>
            </section>
        </LabModuleSection>
    );
};
