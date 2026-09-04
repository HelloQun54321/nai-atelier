import React, { useState } from 'react';
import { ImageEditOperation, NAIParams } from '../types';
import { DEFAULT_NAI_MODEL, getModelFollowDefaultSteps, getRuntimeNaiModelInfo, getSelectableNaiModels } from '../services/naiModels';
import { getNaiRuntimeModelCapability, useNaiRuntime } from '../services/naiRuntime';
import {
    BUILTIN_ASPECT_RATIOS,
    calculateDimensionsForRatio,
    detectClosestAspectRatio,
    getMaxDimensionsForRatio,
    OPUS_FREE_PIXEL_LIMIT,
} from '../services/aspectRatio';

interface ChainEditorParamsProps {
    params: NAIParams;
    setParams: (p: NAIParams) => void;
    canEdit: boolean;
    markChange: () => void;
    presetSource?: { name: string; modified: boolean };
    hideResolution?: boolean;
    mode?: 'text-to-image' | ImageEditOperation;
    forceEmptySeed?: boolean;
    /** 免费步数上限开关（全局设置）；开启时步数锁定在官方同步的免费门槛内，关闭后放宽到 NovelAI 硬上限 50。 */
    enforceFreeStepLimit?: boolean;
}

export { OPUS_FREE_PIXEL_LIMIT };

export const ChainEditorParams: React.FC<ChainEditorParamsProps> = ({
    params,
    setParams,
    canEdit,
    markChange,
    presetSource,
    hideResolution = false,
    mode = 'text-to-image',
    forceEmptySeed = false,
    enforceFreeStepLimit = true,
}) => {
    // 网关自动同步的官方模型清单（未来新模型无需改代码即可出现在下拉里）。
    const runtime = useNaiRuntime();
    // NovelAI 采样步数硬上限 50；免费上限取官方运行时同步值（默认 28），随官方调整自动更新。
    const maxSteps = enforceFreeStepLimit ? Math.max(1, Math.floor(runtime.freeMaxSteps) || 28) : 50;
    const freeMaxArea = runtime.freeMaxArea || OPUS_FREE_PIXEL_LIMIT;
    const selectableModels = getSelectableNaiModels(runtime);

    // 比例模式与缩放状态
    const [resolutionMode, setResolutionMode] = useState<string>(() => {
        const detected = detectClosestAspectRatio(Number(params.width) || 832, Number(params.height) || 1216);
        return detected.preset.id;
    });
    const [scaleMultiplier, setScaleMultiplier] = useState<number>(() => {
        const detected = detectClosestAspectRatio(Number(params.width) || 832, Number(params.height) || 1216);
        return detected.scale || 1.0;
    });

    const activeBuiltinRatio = BUILTIN_ASPECT_RATIOS.find(item => item.id === resolutionMode) || BUILTIN_ASPECT_RATIOS[1];
    const activeRatioMax = getMaxDimensionsForRatio(activeBuiltinRatio);

    const handleRatioSelectChange = (value: string) => {
        if (!canEdit) return;
        setResolutionMode(value);

        const builtin = BUILTIN_ASPECT_RATIOS.find(item => item.id === value);
        if (builtin) {
            const maxInfo = getMaxDimensionsForRatio(builtin);
            const clampedScale = Math.min(maxInfo.maxScale, Math.max(1.0, scaleMultiplier));
            setScaleMultiplier(clampedScale);
            const nextDims = calculateDimensionsForRatio(builtin, clampedScale);
            setParams({ ...params, width: nextDims.width, height: nextDims.height });
            markChange();
        }
    };

    const handleScaleChange = (nextScale: number) => {
        if (!canEdit) return;
        const builtin = BUILTIN_ASPECT_RATIOS.find(item => item.id === resolutionMode) || activeBuiltinRatio;
        const maxInfo = getMaxDimensionsForRatio(builtin);
        const clampedScale = Math.min(maxInfo.maxScale, Math.max(1.0, nextScale));
        setScaleMultiplier(clampedScale);
        const nextDims = calculateDimensionsForRatio(builtin, clampedScale);
        setParams({ ...params, width: nextDims.width, height: nextDims.height });
        markChange();
    };

    const resolvedModelId = params.model?.trim() || DEFAULT_NAI_MODEL;
    const currentModelInfo = getRuntimeNaiModelInfo(resolvedModelId, runtime);
    const modelCapability = getNaiRuntimeModelCapability(runtime, resolvedModelId);
    const officialQualityOptions = modelCapability?.qualityPresets?.filter(item => item.id !== 'none') || [];
    const qualityOptions = [{ id: 'none', name: 'none' }, ...officialQualityOptions];
    const officialUcOptions = modelCapability?.ucPresets || [];
    const noneUcOption = officialUcOptions.find(item => item.id === 'none') || { id: 'none', name: 'none' };
    const ucOptions = [noneUcOption, ...officialUcOptions.filter(item => item.id !== 'none')];
    const legacyQualityId = params.qualityToggle === false ? 'none' : 'standard';
    const requestedQualityId = params.qualityPresetId || legacyQualityId;
    const qualityPresetId = qualityOptions.some(item => item.id === requestedQualityId) ? requestedQualityId : qualityOptions[0].id;
    const legacyUcId = Number.isInteger(params.ucPreset) ? ['heavy', 'light', 'furryFocus', 'humanFocus', 'none'][Math.max(0, Math.min(4, params.ucPreset as number))] : 'heavy';
    const requestedUcId = params.ucPresetId || legacyUcId;
    const ucPresetId = ucOptions.some(item => item.id === requestedUcId) ? requestedUcId : ucOptions[0].id;
    const updatePreset = (patch: Partial<NAIParams>) => {
        const { qualityToggle: _qualityToggle, ucPreset: _ucPreset, ...rest } = params;
        setParams({ ...rest, ...patch });
        markChange();
    };

    const currentWidth = Number(params.width) || 832;
    const currentHeight = Number(params.height) || 1216;
    const totalPixels = currentWidth * currentHeight;
    const isOpusFree = totalPixels <= freeMaxArea;

    return (
        <div className="space-y-4">
            {presetSource && (
                <div className="mb-3 flex min-w-0 items-center gap-2">
                    <span className="max-w-48 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-micro font-medium normal-case tracking-normal text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-64" title={`来自：${presetSource.name}${presetSource.modified ? ' · 已修改' : ''}`}>来自：{presetSource.name}{presetSource.modified ? ' · 已修改' : ''}</span>
                </div>
            )}

            {/* Official model-specific quality and UC presets */}
            <div className="mb-4 grid grid-cols-1 gap-4 border-b border-gray-200 pb-4 dark:border-gray-700 sm:grid-cols-2">
                <div>
                    <label className="mb-1 block text-xs text-gray-500 dark:text-gray-500">正面质量预设</label>
                    <select
                        aria-label="正面质量预设"
                        disabled={!canEdit}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none dark:border-gray-700 dark:bg-gray-900"
                        value={qualityPresetId}
                        onChange={event => updatePreset({ qualityPresetId: event.target.value })}
                    >
                        {qualityOptions.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                    </select>
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

            {/* Model and Resolution row (2 columns symmetric) */}
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block font-medium">生成模型</label>
                    <select
                        aria-label="生成模型"
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        value={resolvedModelId}
                        onChange={(e) => {
                            const nextModelId = e.target.value;
                            const nextModel = getRuntimeNaiModelInfo(nextModelId, runtime);
                            const nextSupportsVibes = mode === 'text-to-image' || mode === 'image-to-image'
                                ? nextModel.supportsVibes
                                : false;
                            const nextSupportsCharacterReferences = mode === 'inpaint' || mode === 'outpaint'
                                ? nextModel.supportsCharacterReferenceInpainting
                                : nextModel.supportsCharacterReferences;
                            // 当前步数是官方默认之一（23/28）或未设置时跟随新模型的默认步数（V5 系列 23 步、其他 28 步）；自定义步数原样保留。
                            const nextSteps = getModelFollowDefaultSteps(nextModelId, params.steps);
                            const nextParams: NAIParams = {
                                ...params,
                                model: nextModelId,
                                steps: nextSteps,
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

                {!hideResolution && (
                    <div className="flex min-w-0 flex-col gap-1">
                        <label className="text-xs text-gray-500 dark:text-gray-500 block font-medium">图片画幅比例</label>
                        <select
                            aria-label="图片画幅比例"
                            disabled={!canEdit}
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                            value={resolutionMode}
                            onChange={(e) => handleRatioSelectChange(e.target.value)}
                        >
                            {BUILTIN_ASPECT_RATIOS.map(item => (
                                <option key={item.id} value={item.id}>
                                    {item.label} ({item.baseWidth}x{item.baseHeight}) · {item.description}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Resolution control panel: Aspect ratio scale slider */}
            {!hideResolution && (
                <div className="mb-4 rounded-2xl border border-gray-200 bg-white/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/60 sm:p-4">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                尺寸清晰度放大（Scale）
                            </span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    min="1"
                                    max={activeRatioMax.maxScale}
                                    step="0.01"
                                    aria-label="尺寸清晰度倍率数值"
                                    disabled={!canEdit}
                                    value={Number(scaleMultiplier.toFixed(2))}
                                    onChange={(e) => {
                                        const val = Math.min(activeRatioMax.maxScale, Math.max(1, parseFloat(e.target.value) || 1));
                                        handleScaleChange(val);
                                    }}
                                    className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
                                />
                                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">x</span>
                                {scaleMultiplier >= activeRatioMax.maxScale && (
                                    <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-micro font-normal text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">已达画幅极限</span>
                                )}
                            </div>
                        </div>
                        <div className="relative flex items-center">
                            <input
                                type="range"
                                min="1.0"
                                max={activeRatioMax.maxScale}
                                step="0.01"
                                aria-label="尺寸缩放滑块"
                                disabled={!canEdit}
                                value={Math.min(activeRatioMax.maxScale, scaleMultiplier)}
                                onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
                                className="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                        <div className="flex items-center justify-between text-micro text-gray-400">
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">1.0x Opus 免费基准（0点）</span>
                            <span>{activeRatioMax.maxScale.toFixed(2)}x 官方封顶（{activeRatioMax.width}×{activeRatioMax.height}）</span>
                        </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                        <div
                            role="status"
                            className={`rounded-xl px-2.5 py-1 text-meta font-medium leading-relaxed tabular-nums border ${
                                isOpusFree
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40'
                                    : 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40'
                            }`}
                        >
                            当前输出 {currentWidth.toLocaleString()} × {currentHeight.toLocaleString()} = {totalPixels.toLocaleString()} 像素 · {isOpusFree ? '在 Opus 免费像素范围内' : `超过免费像素上限 ${freeMaxArea.toLocaleString()}`}
                        </div>
                    </div>
                </div>
            )}

            {/* Generation parameters: Sampler, Steps, Seed (3 columns) */}
            <div className="chain-editor-param-grid mb-4 grid grid-cols-1 gap-3 border-b border-gray-100 pb-4 dark:border-gray-800 sm:grid-cols-3 md:gap-4">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 block font-medium">采样器</label>
                    <select
                        aria-label="采样器"
                        disabled={!canEdit}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
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
                    <label className="text-xs text-gray-500 dark:text-gray-500 block font-medium">
                        <span className="flex items-center justify-between">
                            生成步数
                            {!enforceFreeStepLimit && <span className="text-micro text-amber-600 dark:text-amber-400 font-normal" title="已在全局设置中解除免费步数上限，超出免费门槛的步数将消耗 Anlas">已解除上限</span>}
                        </span>
                    </label>
                    <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        disabled={!canEdit}
                        value={params.steps ?? Math.min(maxSteps, 28)}
                        max={maxSteps}
                        onChange={(e) => {
                            const val = Math.min(maxSteps, Math.max(1, parseInt(e.target.value) || 0));
                            setParams({ ...params, steps: val });
                            markChange();
                        }}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 flex items-center justify-between font-medium">
                        <span>随机种子</span>
                        {forceEmptySeed && (
                            <span className="text-micro text-amber-600 dark:text-amber-400 font-normal" title={params.seed !== undefined && params.seed !== null ? `原保存种子: ${params.seed}（关闭设置后恢复）` : '当前已在全局设置中强制随机'}>
                                已强制置空
                            </span>
                        )}
                    </label>
                    <input
                        type="number"
                        className={`w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 ${forceEmptySeed ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}`}
                        disabled={!canEdit}
                        placeholder={forceEmptySeed ? '已强制置空 (随机)' : '随机'}
                        value={forceEmptySeed ? '' : (params.seed === undefined || params.seed === null ? '' : params.seed)}
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
                        <span className="min-w-0"><b className="block text-xs text-gray-700 dark:text-gray-200">透明背景</b><span className="mt-0.5 block text-micro text-gray-400">生成透明背景 PNG 图片</span></span>
                        <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${params.transparent ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${params.transparent ? 'translate-x-5' : ''}`} /></span>
                    </button>
                )}

                {(params.characters?.length || 0) > currentModelInfo.maxCharacters && (
                    <p className="col-span-full rounded-md bg-amber-50 px-2.5 py-1.5 text-meta leading-4 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {currentModelInfo.label} 最多支持 {currentModelInfo.maxCharacters} 个角色提示词；当前保留了 {params.characters?.length} 个，请删除多余角色后再生成。
                    </p>
                )}
            </div>

            {/* Guidance controls: CFG Scale and CFG Rescale with click-to-edit numbers */}
            <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">引导控制</h4>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={params.variety ?? false}
                        disabled={!canEdit}
                        onClick={() => {
                            setParams({ ...params, variety: !(params.variety ?? false) });
                            markChange();
                        }}
                        className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700 sm:w-[calc(50%-0.5rem)]"
                    >
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">Variety+（多样性）</span>
                        <span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${params.variety ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                            <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${params.variety ? 'translate-x-4' : ''}`} />
                        </span>
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <div className="mb-1 flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">CFG Scale</label>
                            <input
                                type="number"
                                min="0"
                                max="10"
                                step="0.1"
                                aria-label="CFG Scale 数值"
                                disabled={!canEdit}
                                value={params.scale ?? 5}
                                onChange={(e) => {
                                    const val = Math.min(10, Math.max(0, parseFloat(e.target.value) || 0));
                                    setParams({ ...params, scale: val });
                                    markChange();
                                }}
                                className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
                            />
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="10"
                            step="0.1"
                            aria-label="CFG Scale"
                            disabled={!canEdit}
                            value={params.scale ?? 5}
                            onChange={(e) => {
                                setParams({ ...params, scale: parseFloat(e.target.value) });
                                markChange();
                            }}
                            className="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <div className="mb-1 flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">CFG Rescale</label>
                            <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                                aria-label="CFG Rescale 数值"
                                disabled={!canEdit}
                                value={params.cfgRescale ?? 0}
                                onChange={(e) => {
                                    const val = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
                                    setParams({ ...params, cfgRescale: val });
                                    markChange();
                                }}
                                className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
                            />
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            aria-label="CFG Rescale"
                            disabled={!canEdit}
                            value={params.cfgRescale ?? 0}
                            onChange={(e) => {
                                setParams({ ...params, cfgRescale: parseFloat(e.target.value) });
                                markChange();
                            }}
                            className="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
