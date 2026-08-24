
import React from 'react';
import { ImageEditOperation, NAIParams } from '../types';
import { DEFAULT_NAI_MODEL, getRuntimeNaiModelInfo, getSelectableNaiModels } from '../services/naiModels';
import { getNaiRuntimeModelCapability, useNaiRuntime } from '../services/naiRuntime';

interface ChainEditorParamsProps {
    params: NAIParams;
    setParams: (p: NAIParams) => void;
    canEdit: boolean;
    markChange: () => void;
    presetSource?: { name: string; modified: boolean };
    hideResolution?: boolean;
    mode?: 'text-to-image' | ImageEditOperation;
}

const RESOLUTIONS = {
    Portrait: { width: 832, height: 1216, label: "竖屏 (832x1216)" },
    Landscape: { width: 1216, height: 832, label: "横屏 (1216x832)" },
    Square: { width: 1024, height: 1024, label: "方形 (1024x1024)" },
};

export const ChainEditorParams: React.FC<ChainEditorParamsProps> = ({ params, setParams, canEdit, markChange, presetSource, hideResolution = false, mode = 'text-to-image' }) => {
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

    const resolvedModelId = params.model?.trim() || DEFAULT_NAI_MODEL;
    const currentModelInfo = getRuntimeNaiModelInfo(resolvedModelId, runtime);
    const modelCapability = getNaiRuntimeModelCapability(runtime, resolvedModelId);
    const qualityOptions = modelCapability?.qualityPresets?.filter(item => item.id !== 'none') || [];
    const ucOptions = modelCapability?.ucPresets?.length
        ? modelCapability.ucPresets
        : [{ id: 'none', name: 'none' }];
    const legacyQualityId = params.qualityToggle === false ? 'none' : 'standard';
    const requestedQualityId = params.qualityPresetId || legacyQualityId;
    const qualityEnabled = requestedQualityId !== 'none' && qualityOptions.length > 0;
    const qualityPresetId = qualityOptions.some(item => item.id === requestedQualityId) ? requestedQualityId : qualityOptions[0]?.id || 'standard';
    const legacyUcId = Number.isInteger(params.ucPreset) ? ['heavy', 'light', 'furryFocus', 'humanFocus', 'none'][Math.max(0, Math.min(4, params.ucPreset as number))] : 'heavy';
    const requestedUcId = params.ucPresetId || legacyUcId;
    const ucPresetId = ucOptions.some(item => item.id === requestedUcId) ? requestedUcId : ucOptions[0].id;
    const updatePreset = (patch: Partial<NAIParams>) => {
        const { qualityToggle: _qualityToggle, ucPreset: _ucPreset, ...rest } = params;
        setParams({ ...rest, ...patch });
        markChange();
    };

    return (
        <section className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">参数设置</h3>
                {presetSource && <span className="max-w-28 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-40" title={`来自：${presetSource.name}${presetSource.modified ? ' · 已修改' : ''}`}>来自：{presetSource.name}{presetSource.modified ? ' · 已修改' : ''}</span>}
            </div>

            {/* Official model-specific quality and UC presets */}
            <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex flex-col gap-3">
                    {qualityOptions.length > 0 && <div className="space-y-2">
                        <button
                            type="button"
                            role="switch"
                            aria-label="正面质量预设"
                            aria-checked={qualityEnabled}
                            disabled={!canEdit}
                            onClick={() => updatePreset({ qualityPresetId: qualityEnabled ? 'none' : qualityPresetId })}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700"
                        >
                            <span className="min-w-0"><b className="block text-xs text-gray-700 dark:text-gray-200">正面质量预设</b><span className="mt-0.5 block text-[10px] text-gray-400">{qualityEnabled ? qualityOptions.find(item => item.id === qualityPresetId)?.name || qualityPresetId : '关闭'}</span></span>
                            <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${qualityEnabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${qualityEnabled ? 'translate-x-5' : ''}`} /></span>
                        </button>
                        {qualityEnabled && qualityOptions.length > 1 && <select
                            aria-label="正面质量预设类型"
                            disabled={!canEdit}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none dark:border-gray-700 dark:bg-gray-900"
                            value={qualityPresetId}
                            onChange={event => updatePreset({ qualityPresetId: event.target.value })}
                        >
                            {qualityOptions.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                        </select>}
                    </div>}
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
                        aria-label="负面预设"
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        value={ucPresetId}
                        onChange={e => updatePreset({ ucPresetId: e.target.value })}
                    >
                        {ucOptions.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                    </select>
                </div>
            </div>

            <div className="chain-editor-param-grid mb-4 grid grid-cols-2 gap-2 border-b border-gray-100 pb-4 dark:border-gray-700 md:gap-4 lg:grid-cols-3">
                <div className="col-span-2 flex min-w-0 flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block">生成模型</label>
                    <select
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm outline-none"
                        value={resolvedModelId}
                        onChange={(e) => {
                            const nextModel = getRuntimeNaiModelInfo(e.target.value, runtime);
                            const nextSupportsVibes = mode === 'text-to-image' || mode === 'image-to-image'
                                ? nextModel.supportsVibes
                                : false;
                            const nextSupportsCharacterReferences = mode === 'inpaint' || mode === 'outpaint'
                                ? nextModel.supportsCharacterReferenceInpainting
                                : nextModel.supportsCharacterReferences;
                            const nextParams: NAIParams = {
                                ...params,
                                model: e.target.value,
                                ...(nextModel.supportsTransparentBackground ? {} : { transparent: false }),
                                ...(nextSupportsVibes || !params.vibes?.enabled
                                    ? {}
                                    : { vibes: { ...params.vibes, enabled: false } }),
                                ...(nextSupportsCharacterReferences || !params.characterReferences?.enabled
                                    ? {}
                                    : { characterReferences: { ...params.characterReferences, enabled: false } }),
                            };
                            setParams(nextParams);
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

                {!hideResolution && <div className="flex flex-col gap-1">
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
                </div>}

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

                {(params.characters?.length || 0) > currentModelInfo.maxCharacters && (
                    <p className="col-span-full rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {currentModelInfo.label} 最多支持 {currentModelInfo.maxCharacters} 个角色提示词；当前保留了 {params.characters?.length} 个，请删除多余角色后再生成。
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
                        className="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="w-full cursor-pointer accent-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                </div>
            </div>
        </section>
    );
};
