import React from 'react';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PresetSection, PresetSource, PresetSourceBadge, PresetSourceBadges, PromptCopyButton } from './PresetSourceBadges';

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
}) => (
    <LabModuleSection
        moduleId="prompt"
        label="提示词输入"
        order={activeLabLayout.order.indexOf('prompt')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.prompt)}
        className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}
    >
        {/* Global Prompt */}
        <section className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <PresetSourceBadges sources={Object.fromEntries(Object.entries({ base: presetSources.base, subject: presetSources.subject }).filter((entry): entry is [string, PresetSource] => Boolean(entry[1])))} />
                </div>

                <PromptCopyButton
                    onClick={() => copyPromptToClipboard(prompt, '提示词')}
                    title="复制提示词"
                />
            </div>
            <TagAutocompleteTextarea
                tagAssistEnabled={tagAssistEnabled}
                disabled={!canEdit}
                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm font-normal leading-relaxed min-h-[100px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500'}`}
                value={prompt}
                placeholder="输入正面提示词，英文逗号分隔"
                onValueChange={(nextValue) => {
                    setPrompt(nextValue);
                    markPresetSectionModified('base');
                    markChange();
                }}
            />
        </section>
    </LabModuleSection>
);
