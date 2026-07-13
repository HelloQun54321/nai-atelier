
import React from 'react';
import { NAIParams } from '../types';

interface ChainEditorParamsProps {
    params: NAIParams;
    setParams: (p: NAIParams) => void;
    canEdit: boolean;
    markChange: () => void;
}

const RESOLUTIONS = {
    Portrait: { width: 832, height: 1216, label: "竖屏 (832x1216)" },
    Landscape: { width: 1216, height: 832, label: "横屏 (1216x832)" },
    Square: { width: 1024, height: 1024, label: "方形 (1024x1024)" },
};

export const ChainEditorParams: React.FC<ChainEditorParamsProps> = ({ params, setParams, canEdit, markChange }) => {

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

    return (
        <section className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">参数设置</h3>

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

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 border-b border-gray-100 dark:border-gray-700 pb-4">
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