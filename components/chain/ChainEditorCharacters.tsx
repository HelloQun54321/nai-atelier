import React from 'react';
import { CharacterParams, NAIParams } from '../../types';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PresetSection, PresetSource, PresetSourceBadges } from './PresetSourceBadges';

export interface ChainEditorCharactersProps {
    params: NAIParams;
    setParams: (params: NAIParams) => void;
    characters: CharacterParams[];
    canEdit: boolean;
    tagAssistEnabled: boolean;
    characterPresetSources: Record<string, PresetSource>;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    addCharacter: () => void;
    updateCharacter: (idx: number, updates: Partial<CharacterParams>) => void;
    removeCharacter: (idx: number) => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'params';
}

export const ChainEditorCharacters: React.FC<ChainEditorCharactersProps> = ({
    params,
    setParams,
    characters,
    canEdit,
    tagAssistEnabled,
    characterPresetSources,
    markPresetSectionModified,
    markChange,
    addCharacter,
    updateCharacter,
    removeCharacter,
    activeLabLayout,
    mobileEditorTab,
}) => (
    <LabModuleSection
        moduleId="characters"
        label="角色专属提示词"
        order={activeLabLayout.order.indexOf('characters')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.characters)}
        className={mobileEditorTab === 'character' ? 'block' : 'hidden lg:block'}
    >
        <section className={mobileEditorTab === 'character' ? 'block' : 'hidden lg:block'}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <PresetSourceBadges sources={characterPresetSources} />
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {/* AI Choice Toggle */}
                    <label className="flex items-center gap-1.5 cursor-pointer bg-white dark:bg-gray-700 px-2 py-1 rounded shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 border border-transparent dark:border-gray-600">
                        <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={!(params.useCoords ?? true)}
                            onChange={(e) => {
                                setParams({ ...params, useCoords: !e.target.checked });
                                markPresetSectionModified('settings');
                                markChange();
                            }}
                            className="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-0"
                        />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">AI 自动构图</span>
                    </label>

                    {canEdit && (
                        <button onClick={addCharacter} className="text-xs flex items-center bg-white dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-200">
                            + 添加角色
                        </button>
                    )}
                </div>
            </div>

            <div className="space-y-3">
                {(characters || []).length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-2">暂无角色，点击上方添加</div>
                )}
                {(characters || []).map((char, idx) => (
                    <div key={char.id} className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700 shadow-sm relative">
                        <div className="flex gap-3 items-start">
                            <div className="flex-1 space-y-2">
                                <div>
                                    <label className="text-micro text-gray-500 font-bold mb-1 block">角色提示词</label>
                                    <TagAutocompleteTextarea
                                        tagAssistEnabled={tagAssistEnabled}
                                        disabled={!canEdit}
                                        value={char.prompt}
                                        onValueChange={(nextValue) => updateCharacter(idx, { prompt: nextValue })}
                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-16 resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder="角色提示词"
                                    />
                                </div>
                                <div>
                                    <label className="text-micro text-gray-500 font-bold mb-1 block">角色负面提示词</label>
                                    <TagAutocompleteTextarea
                                        tagAssistEnabled={tagAssistEnabled}
                                        disabled={!canEdit}
                                        value={char.negativePrompt || ''}
                                        onValueChange={(nextValue) => updateCharacter(idx, { negativePrompt: nextValue })}
                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-10 resize-none focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-400"
                                        placeholder="选填"
                                    />
                                </div>
                            </div>
                            <div className="w-24 flex flex-col gap-2">
                                <div className={!(params.useCoords ?? true) ? "opacity-40 pointer-events-none grayscale" : ""}>
                                    <label className="text-micro text-gray-500 font-bold mb-1 block">水平位置 (X)</label>
                                    <input
                                        type="number" step="0.1" min="0" max="1"
                                        disabled={!canEdit}
                                        value={char.x}
                                        onChange={(e) => updateCharacter(idx, { x: parseFloat(e.target.value) })}
                                        className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                    />
                                </div>
                                <div className={!(params.useCoords ?? true) ? "opacity-40 pointer-events-none grayscale" : ""}>
                                    <label className="text-micro text-gray-500 font-bold mb-1 block">垂直位置 (Y)</label>
                                    <input
                                        type="number" step="0.1" min="0" max="1"
                                        disabled={!canEdit}
                                        value={char.y}
                                        onChange={(e) => updateCharacter(idx, { y: parseFloat(e.target.value) })}
                                        className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                    />
                                </div>
                            </div>
                            {canEdit && (
                                <button onClick={() => removeCharacter(idx)} className="text-gray-400 hover:text-red-500 mt-6">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    </LabModuleSection>
);
