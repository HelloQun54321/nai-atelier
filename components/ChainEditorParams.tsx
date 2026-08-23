
import React from 'react';
import { NAIParams } from '../types';
import { getNaiModelInfo, getSelectableNaiModels } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';

interface ChainEditorParamsProps {
    params: NAIParams;
    setParams: (p: NAIParams) => void;
    canEdit: boolean;
    markChange: () => void;
    presetSource?: { name: string; modified: boolean };
}

const RESOLUTIONS = {
    Portrait: { width: 832, height: 1216, label: "竖屏 (832x1216)" },
    Landscape: { width: 1216, height: 832, label: "横屏 (1216x832)" },
    Square: { width: 1024, height: 1024, label: "方形 (1024x1024)" },
};

export const ChainEditorParams: React.FC<ChainEditorParamsProps> = ({ params, setParams, canEdit, markChange, presetSource }) => {
    // 网关自动同步的官方模型清单（未来新模型无需改代码即可出现在下拉里）。
    const runtime = useNaiRuntime();
    const selectableModels = getSelectableNaiModels(runtime);

    const handleResolutionChange = (mode: string) => {
        if (!canEdit && mode !== 'Custom') return;
        if (canEdit && mode !== 'Custom') {
            const res = RESOLUTIONS[mode as keyof typeof RESOLUTIONS];
            setParams({ ...params, width: res.width, height: res.height });
            markChange();
        }
    };

    const getCurrentResolutionMode = () => {
        const w = params.width;
        const h = params.height;
        if (w === 832 && h === 1216) return 'Portrait';
        if (w === 1216 && h === 832) return 'Landscape';
        if (w === 1024 && h === 1024) return 'Square';
        return 'Custom';
    };

    const currentModelInfo = getNaiModelInfo(params.model);
    const missingModelFeatures = currentModelInfo.id === (params.model ?? currentModelInfo.id)
        ? [
            !currentModelInfo.supportsVibes ? 'Vibe Transfer' : null,
            !currentModelInfo.supportsCharacterReferences ? '角色参考' : null,
        ].filter((value): value is string => Boolean(value))
        : [];

    return (
        <section className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">参数设置</h3>
                {presetSource && <span className="max-w-28 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-40" title={`来自：${presetSource.name}${presetSource.modified ? ' · 已修改' : ''}`}>来自：{presetSource.name}{presetSource.modified ? ' · 已修改' : ''}</span>}
            </div>

            {/* V4.5 Quality & Preset */}
            <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="qualityToggle"
                            disabled={!canEdit}
                            checked={params.qualityToggle ?? true}
                            onChange={(e) => {
                                setParams({ ...params, qualityToggle: e.target.checked });
                                markChange();
                            }}
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                        <label htmlFor="qualityToggle" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                            正面质量预设
                        </label>
                    </div>
                    {/* Variety+ Toggle */}
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="variety"
                            disabled={!canEdit}
                            checked={params.variety ?? false}
                            onChange={(e) => {
                                setParams({ ...params, variety: e.target.checked });
                                markChange();
                            }}
                            className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                        />
                        <label htmlFor="variety" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none flex items-center gap-1">
                            <span>Variety+ (多样性)</span>
                        </label>
                    </div>
                </div>
                <div>
                    <label className="text-xs text-gray-500 dark:text-gray-500 block mb-1">负面预设</label>
                    <select
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        value={params.ucPreset ?? 0}
                        onChange={(e) => {
                            setParams({ ...params, ucPreset: parseInt(e.target.value) });
                            markChange();
                        }}
                    >
                        <option value={0}>Heavy (Default)</option>
                        <option value={1}>Light</option>
                        <option value={2}>Furry Focus</option>
                        <option value={3}>Human Focus</option>
                        <option value={4}>None</option>
                    </select>
                </div>
            </div>

            <div className="chain-editor-param-grid mb-4 grid grid-cols-2 gap-2 border-b border-gray-100 pb-4 dark:border-gray-700 md:gap-4 lg:grid-cols-3">
                <div className="col-span-2 flex min-w-0 flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block">生成模型</label>
                    <select
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        value={params.model ?? 'nai-diffusion-4-5-full'}
                        onChange={(e) => {
                            setParams({ ...params, model: e.target.value });
                            markChange();
                        }}
                    >
                        {selectableModels.map(model => (
                            <option key={model.id} value={model.id}>NovelAI {model.label}</option>
                        ))}
                        {params.model && !selectableModels.some(model => model.id === params.model) && (
                            <option value={params.model}>未知模型（{params.model}）</option>
                        )}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block">图片尺寸</label>
                    <select
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        value={getCurrentResolutionMode()}
                        onChange={(e) => handleResolutionChange(e.target.value)}
                    >
                        {Object.entries(RESOLUTIONS).map(([key, val]) => (
                            <option key={key} value={key}>{val.label}</option>
                        ))}
                    </select>
                    {/* Width/Height inputs could go here if Custom is selected, but currently not requested/implemented fully in UI */}
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block">采样器</label>
                    <select
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        value={params.sampler || 'k_euler_ancestral'}
                        onChange={(e) => {
                            setParams({ ...params, sampler: e.target.value });
                            markChange();
                        }}
                    >
                        <option value="k_euler_ancestral">Euler Ancestral</option>
                        <option value="k_euler">Euler</option>
                        <option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
                        <option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option>
                        <option value="k_dpmpp_2m">DPM++ 2M</option>
                        <option value="k_dpmpp_sde">DPM++ SDE</option>
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block">步数 (Max 28)</label>
                    <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        disabled={!canEdit}
                        value={params.steps}
                        max={28}
                        onChange={(e) => {
                            const val = Math.min(28, parseInt(e.target.value) || 0);
                            setParams({ ...params, steps: val });
                            markChange();
                        }}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block">Seed (空=随机)</label>
                    <input
                        type="number"
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        disabled={!canEdit}
                        placeholder="随机"
                        value={params.seed === undefined || params.seed === null ? '' : params.seed}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                                setParams({ ...params, seed: undefined });
                            } else {
                                setParams({ ...params, seed: parseInt(val) });
                            }
                            markChange();
                        }}
                    />
                </div>

                {currentModelInfo.supportsTransparentBackground && (
                    <button
                        type="button"
                        disabled={!canEdit}
                        aria-pressed={params.transparent === true}
                        onClick={() => {
                            setParams({ ...params, transparent: !params.transparent, alphaMode: 'straight' });
                            markChange();
                        }}
                        className="col-span-full flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700"
                    >
                        <span className="min-w-0"><b className="block text-xs text-gray-700 dark:text-gray-200">透明背景</b><span className="mt-0.5 block text-[10px] text-gray-400">生成带 Alpha 通道的 PNG；自动保留原图，不转换为 JPG。</span></span>
                        <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${params.transparent ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${params.transparent ? 'translate-x-5' : ''}`} /></span>
                    </button>
                )}

                {missingModelFeatures.length > 0 && (
                    <p className="col-span-full rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {currentModelInfo.label} 暂不支持 {missingModelFeatures.join(' / ')}
                    </p>
                )}
            </div>

            {/* Advanced Scales */}
            <div className="md:col-span-2 grid grid-cols-2 gap-4 pt-2 border-t border-gray-100 dark:border-gray-700">
                {/* Scale Controls */}
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-gray-500 dark:text-gray-500 block">CFG Scale</label>
                        <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">{params.scale}</span>
                    </div>
                    <input
                        type="range" min="0" max="10" step="0.1"
                        disabled={!canEdit}
                        value={params.scale}
                        onChange={(e) => { setParams({ ...params, scale: parseFloat(e.target.value) }); markChange(); }}
                        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-indigo-600"
                    />
                </div>
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-gray-500 dark:text-gray-500 block">CFG Rescale</label>
                        <span className="text-xs font-mono text-pink-600 dark:text-pink-400">{params.cfgRescale ?? 0}</span>
                    </div>
                    <input
                        type="range" min="0" max="1" step="0.05"
                        disabled={!canEdit}
                        value={params.cfgRescale ?? 0}
                        onChange={(e) => { setParams({ ...params, cfgRescale: parseFloat(e.target.value) }); markChange(); }}
                        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-pink-600"
                    />
                </div>
            </div>
        </section>
    );
};
