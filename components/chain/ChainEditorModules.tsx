import React from 'react';
import { PromptModule } from '../../types';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PresetSource, PresetSourceBadges } from './PresetSourceBadges';

export interface ChainEditorModulesProps {
    modules: PromptModule[];
    activeModules: Record<string, boolean>;
    handleModuleChange: (index: number, key: keyof PromptModule, value: any) => void;
    addModule: () => void;
    removeModule: (index: number) => void;
    toggleModuleActive: (id: string) => void;
    canEdit: boolean;
    tagAssistEnabled: boolean;
    modulePresetSources: Record<string, PresetSource>;
    mobileEditorTab: 'global' | 'character' | 'params';
}

export const ChainEditorModules: React.FC<ChainEditorModulesProps> = ({
    modules,
    activeModules,
    handleModuleChange,
    addModule,
    removeModule,
    toggleModuleActive,
    canEdit,
    tagAssistEnabled,
    modulePresetSources,
    mobileEditorTab,
}) => (
    <section className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">提示词模块</label>
                <PresetSourceBadges sources={modulePresetSources} />
            </div>
            {canEdit && (
                <button onClick={addModule} className="text-xs flex items-center bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700">
                    添加
                </button>
            )}
        </div>
        <div className="space-y-3">
            {(modules || []).map((mod, idx) => (
                <div key={mod.id} className={`bg-gray-50 dark:bg-gray-800/40 border rounded-lg p-3 ${activeModules[mod.id] !== false ? 'border-gray-300 dark:border-gray-700' : 'border-gray-200 dark:border-gray-800 opacity-60'}`}>
                    <div className="flex flex-wrap gap-2 mb-2 items-center">
                        <input type="checkbox" checked={activeModules[mod.id] !== false} onChange={() => toggleModuleActive(mod.id)} className="rounded bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-0 flex-shrink-0" />
                        <input
                            type="text"
                            disabled={!canEdit}
                            className="bg-transparent border-b border-transparent focus:border-indigo-500 text-indigo-600 dark:text-indigo-300 font-medium text-sm outline-none px-1 flex-1 min-w-[120px]"
                            value={mod.name}
                            onChange={(e) => handleModuleChange(idx, 'name', e.target.value)}
                        />
                        {/* Mobile optimized: Group Input and Position Toggles together on right */}
                        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                            <input
                                type="text"
                                placeholder="分组"
                                disabled={!canEdit}
                                className="bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-indigo-500 text-gray-500 dark:text-gray-400 text-xs outline-none px-1 w-12 text-center"
                                value={mod.group || ''}
                                onChange={(e) => handleModuleChange(idx, 'group', e.target.value)}
                                title="分组 (Group)"
                            />
                            <div className="flex bg-gray-200 dark:bg-gray-700 rounded p-0.5">
                                <button
                                    onClick={() => handleModuleChange(idx, 'position', 'pre')}
                                    disabled={!canEdit}
                                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mod.position === 'pre' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                >
                                    前
                                </button>
                                <button
                                    onClick={() => handleModuleChange(idx, 'position', 'post')}
                                    disabled={!canEdit}
                                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${(mod.position === 'post' || !mod.position) ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                >
                                    后
                                </button>
                            </div>
                            {canEdit && (
                                <button onClick={() => removeModule(idx)} className="text-gray-400 hover:text-red-500 ml-1">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            )}
                        </div>
                    </div>
                    <TagAutocompleteTextarea
                        tagAssistEnabled={tagAssistEnabled}
                        disabled={!canEdit}
                        className={`w-full rounded p-2 outline-none font-mono text-xs h-16 resize-none ${!canEdit ? 'bg-transparent text-gray-500' : 'bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700/30 text-gray-800 dark:text-gray-300 focus:ring-1 focus:ring-indigo-500/50'}`}
                        value={mod.content}
                        onValueChange={(nextValue) => handleModuleChange(idx, 'content', nextValue)}
                    />
                </div>
            ))}
        </div>
    </section>
);
