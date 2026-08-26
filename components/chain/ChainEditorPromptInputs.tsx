import React from 'react';
import { PromptModule } from '../../types';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PresetSection, PresetSource, PresetSourceBadge, PresetSourceBadges, PromptCopyButton } from './PresetSourceBadges';
import { ChainEditorModules } from './ChainEditorModules';

export interface ChainEditorPromptInputsProps {
    splitPromptFields: boolean;
    basePrompt: string;
    setBasePrompt: (value: string) => void;
    subjectPrompt: string;
    setSubjectPrompt: (value: string) => void;
    globalPrompt: string;
    presetSources: Partial<Record<PresetSection, PresetSource>>;
    modulePresetSources: Record<string, PresetSource>;
    tagAssistEnabled: boolean;
    canEdit: boolean;
    copyPromptToClipboard: (value: string, label: string) => void;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'params';
    modules: PromptModule[];
    activeModules: Record<string, boolean>;
    handleModuleChange: (index: number, key: keyof PromptModule, value: any) => void;
    addModule: () => void;
    removeModule: (index: number) => void;
    toggleModuleActive: (id: string) => void;
}

export const ChainEditorPromptInputs: React.FC<ChainEditorPromptInputsProps> = ({
    splitPromptFields,
    basePrompt,
    setBasePrompt,
    subjectPrompt,
    setSubjectPrompt,
    globalPrompt,
    presetSources,
    modulePresetSources,
    tagAssistEnabled,
    canEdit,
    copyPromptToClipboard,
    markPresetSectionModified,
    markChange,
    activeLabLayout,
    mobileEditorTab,
    modules,
    activeModules,
    handleModuleChange,
    addModule,
    removeModule,
    toggleModuleActive,
}) => (
    <LabModuleSection
        moduleId="prompt"
        label="提示词输入"
        order={activeLabLayout.order.indexOf('prompt')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.prompt)}
        className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}
    >
        {/* Base Prompt */}
        <section className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {splitPromptFields && (
                        <label className="flex flex-col items-center text-sm font-semibold text-indigo-500 dark:text-indigo-400 md:block md:text-left">
                            <span>基础画风</span><span className="text-[10px] font-normal opacity-70 md:inline md:text-sm md:font-semibold md:opacity-100">（风格串）</span>
                        </label>
                    )}
                    {splitPromptFields
                        ? <PresetSourceBadge source={presetSources.base} />
                        : <PresetSourceBadges sources={Object.fromEntries(Object.entries({ base: presetSources.base, subject: presetSources.subject }).filter((entry): entry is [string, PresetSource] => Boolean(entry[1])))} />}
                </div>

                <PromptCopyButton
                    onClick={() => copyPromptToClipboard(splitPromptFields ? basePrompt : globalPrompt, splitPromptFields ? '基础画风' : '全局提示词')}
                    title={splitPromptFields ? '复制基础画风' : '复制全局提示词'}
                />
            </div>
            <TagAutocompleteTextarea
                tagAssistEnabled={tagAssistEnabled}
                disabled={!canEdit}
                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm font-normal leading-relaxed min-h-[100px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500'}`}
                value={splitPromptFields ? basePrompt : globalPrompt}
                placeholder={splitPromptFields ? '画风标签，如 masterpiece、best quality、画师tag等，英文逗号分隔' : '输入完整的正面提示词，英文逗号分隔'}
                onValueChange={(nextValue) => {
                    setBasePrompt(nextValue);
                    if (!splitPromptFields) setSubjectPrompt('');
                    markPresetSectionModified('base');
                    if (!splitPromptFields) markPresetSectionModified('subject');
                    markChange();
                }}
            />
        </section>

        {splitPromptFields && <section className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <label className="text-sm font-semibold text-indigo-500 dark:text-indigo-400">主体／变量提示词</label>
                    <PresetSourceBadge source={presetSources.subject} />
                </div>
                <PromptCopyButton onClick={() => copyPromptToClipboard(subjectPrompt, '主体／变量提示词')} title="复制主体／变量提示词" />
            </div>
            <p className="mb-2 text-[10px] text-gray-400">放置风格串固定提示词以外的内容，比如人物、场景。</p>
            <TagAutocompleteTextarea
                tagAssistEnabled={tagAssistEnabled}
                disabled={!canEdit}
                className={`min-h-[100px] w-full resize-none rounded-lg border p-3 font-mono text-sm font-normal leading-relaxed outline-none ${!canEdit ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-800' : 'border-gray-300 bg-gray-50 text-gray-900 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'}`}
                placeholder="输入动态主体描述，例如：1girl, blue hair, sitting..."
                value={subjectPrompt}
                onValueChange={(value) => { setSubjectPrompt(value); markPresetSectionModified('subject'); markChange(); }}
            />
        </section>}

        <ChainEditorModules
            modules={modules}
            activeModules={activeModules}
            handleModuleChange={handleModuleChange}
            addModule={addModule}
            removeModule={removeModule}
            toggleModuleActive={toggleModuleActive}
            canEdit={canEdit}
            tagAssistEnabled={tagAssistEnabled}
            modulePresetSources={modulePresetSources}
            mobileEditorTab={mobileEditorTab}
        />
    </LabModuleSection>
);
