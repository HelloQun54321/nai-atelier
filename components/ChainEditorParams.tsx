
import React from 'react';
import { ImageEditOperation, NAIParams } from '../types';
import { DEFAULT_NAI_MODEL, getModelFollowDefaultSteps, getRuntimeNaiModelInfo, getSelectableNaiModels } from '../services/naiModels';
import { getNaiRuntimeModelCapability, useNaiRuntime } from '../services/naiRuntime';

interface ChainEditorParamsProps {
    params: NAIParams;
    setParams: (p: NAIParams) => void;
    canEdit: boolean;
    markChange: () => void;
    presetSource?: { name: string; modified: boolean };
    hideResolution?: boolean;
    mode?: 'text-to-image' | ImageEditOperation;
    forceEmptySeed?: boolean;
}

const RESOLUTIONS = {
    Portrait: { width: 832, height: 1216, label: "竖屏 (832x1216)" },
    Landscape: { width: 1216, height: 832, label: "横屏 (1216x832)" },
    Square: { width: 1024, height: 1024, label: "方形 (1024x1024)" },
};
const RESOLUTION_STEP = 64;
const GENERATION_MAX_DIMENSION = 4096;
// 标准竖图／横图恰好使用 1,011,712 像素；联动模式保持在这一 Opus 免费像素档内。
export const OPUS_FREE_PIXEL_LIMIT = 832 * 1216;

const resolutionModeFor = (params?: NAIParams) => {
    const width = Number(params?.width);
    const height = Number(params?.height);
    if (width === 832 && height === 1216) return 'Portrait';
    if (width === 1216 && height === 832) return 'Landscape';
    if (width === 1024 && height === 1024) return 'Square';
    if (width && height) return 'Custom';
    return 'Portrait';
};

const normalizeCustomDimension = (value: number) => {
    const finite = Number.isFinite(value) ? value : RESOLUTION_STEP;
    return Math.min(GENERATION_MAX_DIMENSION, Math.max(RESOLUTION_STEP, Math.floor(finite / RESOLUTION_STEP) * RESOLUTION_STEP));
};

const linkedDimensionFor = (dimension: number) => normalizeCustomDimension(Math.floor(OPUS_FREE_PIXEL_LIMIT / dimension / RESOLUTION_STEP) * RESOLUTION_STEP);

export const ChainEditorParams: React.FC<ChainEditorParamsProps> = ({ params, setParams, canEdit, markChange, presetSource, hideResolution = false, mode = 'text-to-image', forceEmptySeed = false }) => {
    // 网关自动同步的官方模型清单（未来新模型无需改代码即可出现在下拉里）。
    const runtime = useNaiRuntime();
    const selectableModels = getSelectableNaiModels(runtime);
    const [resolutionMode, setResolutionMode] = React.useState(() => resolutionModeFor(params));
    const [linkCustomDimensions, setLinkCustomDimensions] = React.useState(true);

    React.useEffect(() => {
        const nextMode = resolutionModeFor(params);
        if (nextMode !== 'Custom') setResolutionMode(nextMode);
    }, [params.width, params.height]);

    const handleResolutionChange = (nextMode: string) => {
        if (!canEdit) return;
        setResolutionMode(nextMode);
        if (nextMode !== 'Custom') {
            const res = RESOLUTIONS[nextMode as keyof typeof RESOLUTIONS];
            setParams({ ...params, width: res.width, height: res.height });
            markChange();
        }
    };

    const updateCustomDimension = (field: 'width' | 'height', rawValue: number) => {
        if (!canEdit) return;
        const value = normalizeCustomDimension(rawValue);
        const counterpart = field === 'width' ? 'height' : 'width';
        setParams({
            ...params,
            [field]: value,
            ...(linkCustomDimensions ? { [counterpart]: linkedDimensionFor(value) } : {}),
        });
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

    return (
        <div className="space-y-4">
            {presetSource && (
                <div className="mb-3 flex min-w-0 items-center gap-2">
                    <span className="max-w-48 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:max-w-64" title={`来自：${presetSource.name}${presetSource.modified ? ' · 已修改' : ''}`}>来自：{presetSource.name}{presetSource.modified ? ' · 已修改' : ''}</span>
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
                        <label className="text-xs text-gray-500 dark:text-gray-500 block font-medium">图片尺寸</label>
                        <select
                            aria-label="图片尺寸"
                            disabled={!canEdit}
                            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                            value={resolutionMode}
                            onChange={(e) => handleResolutionChange(e.target.value)}
                        >
                            {Object.entries(RESOLUTIONS).map(([key, val]) => (
                                <option key={key} value={key}>{val.label}</option>
                            ))}
                            <option value="Custom">自定义</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Full-width custom resolution expandable panel */}
            {!hideResolution && resolutionMode === 'Custom' && (
                <div className="mb-4 rounded-2xl border border-gray-200 bg-white/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/60 sm:p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {/* Left column: Width & Height inputs */}
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                宽度 (px)
                                <input
                                    aria-label="自定义宽度"
                                    type="number"
                                    min={RESOLUTION_STEP}
                                    max={GENERATION_MAX_DIMENSION}
                                    step={RESOLUTION_STEP}
                                    disabled={!canEdit}
                                    value={params.width ?? 832}
                                    onChange={event => updateCustomDimension('width', Number(event.target.value))}
                                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs md:text-sm font-normal text-gray-800 dark:text-gray-200 dark:border-gray-800 dark:bg-gray-950 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                                />
                            </label>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                高度 (px)
                                <input
                                    aria-label="自定义高度"
                                    type="number"
                                    min={RESOLUTION_STEP}
                                    max={GENERATION_MAX_DIMENSION}
                                    step={RESOLUTION_STEP}
                                    disabled={!canEdit}
                                    value={params.height ?? 1216}
                                    onChange={event => updateCustomDimension('height', Number(event.target.value))}
                                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs md:text-sm font-normal text-gray-800 dark:text-gray-200 dark:border-gray-800 dark:bg-gray-950 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                                />
                            </label>
                        </div>

                        {/* Right column: Opus free pixel link & status */}
                        <div className="flex flex-col justify-between gap-2.5">
                            <button
                                type="button"
                                role="switch"
                                aria-label="Opus 免费像素联动"
                                aria-checked={linkCustomDimensions}
                                disabled={!canEdit}
                                onClick={() => setLinkCustomDimensions(previous => !previous)}
                                className="flex items-center justify-between gap-2 text-left text-xs text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-60"
                            >
                                <span className="font-medium">Opus 免费像素联动</span>
                                <span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${linkCustomDimensions ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${linkCustomDimensions ? 'translate-x-4' : ''}`} />
                                </span>
                            </button>
                            {(() => {
                                const customWidth = Number(params.width) || 832;
                                const customHeight = Number(params.height) || 1216;
                                const totalPixels = customWidth * customHeight;
                                return (
                                    <div
                                        role="status"
                                        className={`rounded-xl px-2.5 py-1.5 text-[11px] font-medium leading-relaxed tabular-nums border ${
                                            totalPixels <= OPUS_FREE_PIXEL_LIMIT
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40'
                                                : 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40'
                                        }`}
                                    >
                                        当前 {customWidth.toLocaleString()} × {customHeight.toLocaleString()} = {totalPixels.toLocaleString()} 像素 · {totalPixels <= OPUS_FREE_PIXEL_LIMIT ? '在 Opus 免费像素范围内' : `超过免费像素上限 ${OPUS_FREE_PIXEL_LIMIT.toLocaleString()}`}
                                    </div>
                                );
                            })()}
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
                    <label className="text-xs text-gray-500 dark:text-gray-500 block font-medium">生成步数</label>
                    <input type="number" className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                        disabled={!canEdit}
                        value={params.steps ?? 28}
                        max={28}
                        onChange={(e) => {
                            const val = Math.min(28, parseInt(e.target.value) || 0);
                            setParams({ ...params, steps: val });
                            markChange();
                        }}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-gray-500 flex items-center justify-between font-medium">
                        <span>随机种子</span>
                        {forceEmptySeed && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal" title={params.seed !== undefined && params.seed !== null ? `原保存种子: ${params.seed}（关闭设置后恢复）` : '当前已在全局设置中强制随机'}>
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
                        <span className="min-w-0"><b className="block text-xs text-gray-700 dark:text-gray-200">透明背景</b><span className="mt-0.5 block text-[10px] text-gray-400">生成透明背景 PNG 图片</span></span>
                        <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${params.transparent ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${params.transparent ? 'translate-x-5' : ''}`} /></span>
                    </button>
                )}

                {(params.characters?.length || 0) > currentModelInfo.maxCharacters && (
                    <p className="col-span-full rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {currentModelInfo.label} 最多支持 {currentModelInfo.maxCharacters} 个角色提示词；当前保留了 {params.characters?.length} 个，请删除多余角色后再生成。
                    </p>
                )}
            </div>

            {/* Guidance controls */}
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
                            <label className="block text-xs text-gray-500 dark:text-gray-500">CFG Scale</label>
                            <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">{params.scale ?? 5}</span>
                        </div>
                        <input
                            type="range" min="0" max="10" step="0.1"
                            disabled={!canEdit}
                            value={params.scale ?? 5}
                            onChange={(e) => { setParams({ ...params, scale: parseFloat(e.target.value) }); markChange(); }}
                            className="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <div className="mb-1 flex items-center justify-between">
                            <label className="block text-xs text-gray-500 dark:text-gray-500">CFG Rescale</label>
                            <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">{params.cfgRescale ?? 0}</span>
                        </div>
                        <input
                            type="range" min="0" max="1" step="0.05"
                            disabled={!canEdit}
                            value={params.cfgRescale ?? 0}
                            onChange={(e) => { setParams({ ...params, cfgRescale: parseFloat(e.target.value) }); markChange(); }}
                            className="w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
