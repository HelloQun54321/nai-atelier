
import React from 'react';
import { ImageEditMetadata, NAIParams } from '../types';
import { getNaiModelDisplayLabel } from '../services/naiModels';

/**
 * UC Preset 的人类可读标签映射
 */
const UC_LABELS: Record<number, string> = {
    0: 'Heavy',
    1: 'Light',
    2: 'Furry',
    3: 'Human Focus',
    4: 'None',
};

/**
 * 单个参数展示卡片
 */
const ParamItem = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-100 dark:border-gray-700/50">
        <div className="text-[10px] text-gray-400 uppercase font-bold text-ellipsis overflow-hidden mb-0.5">
            {label}
        </div>
        <div
            className="text-xs font-mono text-gray-800 dark:text-gray-200 font-medium truncate"
            title={String(value)}
        >
            {value}
        </div>
    </div>
);

/**
 * 通用 NovelAI 生成参数详情面板
 *
 * 展示所有非 Boilerplate 的生成参数，包括：
 * - 分辨率、步数、Scale、采样器、种子
 * - Quality Tags 开关、UC Preset
 * - Variety+、CFG Rescale、坐标模式
 * - 多角色列表（含坐标与专属负面）
 *
 * Boilerplate 参数（sm, sm_dyn, noise_schedule 等）不展示。
 */
interface ParamsViewerProps {
    /** 生成参数 */
    params: NAIParams;
    /** 正面提示词（可选展示） */
    prompt?: string;
    /** 负面提示词（可选展示） */
    negativePrompt?: string;
    /** 图片编辑元数据；历史列表只传轻量字段，不传蒙版 Base64。 */
    edit?: ImageEditMetadata;
    /** 通知回调（用于复制按钮） */
    notify?: (msg: string) => void;
}

export const ParamsViewer: React.FC<ParamsViewerProps> = ({
    params,
    prompt,
    negativePrompt,
    edit,
    notify,
}) => {
    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        notify?.(`${label} 已复制`);
    };

    return (
        <div className="space-y-4">
            {/* 正面提示词 */}
            {prompt !== undefined && (
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            Prompt
                        </label>
                        <button
                            onClick={() => handleCopy(prompt, 'Prompt')}
                            className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                        >
                            复制
                        </button>
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300 font-mono break-words bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 p-3 rounded-lg leading-relaxed select-text max-h-32 overflow-y-auto custom-scrollbar">
                        {prompt || <span className="text-gray-400 italic">（空）</span>}
                    </div>
                </div>
            )}

            {/* 负面提示词 */}
            {negativePrompt !== undefined && (
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            Negative
                        </label>
                        {negativePrompt && (
                            <button
                                onClick={() => handleCopy(negativePrompt, '负面提示词')}
                                className="text-xs bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 px-2 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                            >
                                复制
                            </button>
                        )}
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300 font-mono break-words bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 p-3 rounded-lg leading-relaxed select-text max-h-24 overflow-y-auto custom-scrollbar">
                        {negativePrompt || <span className="text-gray-400 italic">（空）</span>}
                    </div>
                </div>
            )}

            {/* 核心参数网格 */}
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    Parameters
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <ParamItem label="Model" value={getNaiModelDisplayLabel(params.model)} />
                    <ParamItem label="Resolution" value={`${params.width} × ${params.height}`} />
                    <ParamItem label="Steps" value={params.steps} />
                    <ParamItem label="Scale (CFG)" value={params.scale} />
                    <ParamItem
                        label="Sampler"
                        value={typeof params.sampler === 'string' && params.sampler ? params.sampler.replace(/_/g, ' ') : '-'}
                    />
                    <ParamItem label="Seed" value={params.seed ?? 'Random'} />
                    <ParamItem
                        label="Quality Tags"
                        value={params.qualityToggle ? '✅ On' : '❌ Off'}
                    />
                    <ParamItem
                        label="UC Preset"
                        value={
                            params.ucPreset !== undefined
                                ? UC_LABELS[params.ucPreset] ?? `Custom (${params.ucPreset})`
                                : '-'
                        }
                    />
                    <ParamItem
                        label="Variety+"
                        value={params.variety ? '✅ On' : '❌ Off'}
                    />
                    {params.transparent && (
                        <ParamItem label="透明背景" value={params.alphaMode === 'premultiplied' ? '预乘 Alpha' : 'Straight Alpha'} />
                    )}
                    {/* CFG Rescale 仅在非零时展示 */}
                    {(params.cfgRescale !== undefined && params.cfgRescale > 0) && (
                        <ParamItem label="CFG Rescale" value={params.cfgRescale} />
                    )}
                    {/* 坐标模式仅在有角色时展示 */}
                    {params.characters && params.characters.length > 0 && (
                        <ParamItem
                            label="Coords Mode"
                            value={params.useCoords ? 'Manual' : "AI's Choice"}
                        />
                    )}
                </div>
            </div>

            {params.characterReferences?.enabled && params.characterReferences.slots.length > 0 && (
                <div>
                    <label className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                        角色参考 ({params.characterReferences.slots.length}) · +{params.characterReferences.slots.length * 5} Anlas
                    </label>
                    <div className="space-y-2">
                        {params.characterReferences.slots.map((slot, index) => (
                            <div key={`${slot.assetId}-${index}`} className="rounded-lg border border-cyan-100 bg-cyan-50/60 p-2.5 dark:border-cyan-900/60 dark:bg-cyan-950/20">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-bold text-cyan-700 dark:text-cyan-300">{slot.assetName || `角色参考 ${index + 1}`}</span>
                                    <span className="flex-none text-[10px] text-gray-500">{slot.type === 'character' ? '角色' : slot.type === 'style' ? '画风' : '角色与画风'}</span>
                                </div>
                                <p className="mt-1 text-[10px] text-gray-500">强度 {slot.strength.toFixed(2)} · 保真 {slot.fidelity.toFixed(2)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {params.vibes?.enabled && params.vibes.slots.length > 0 && (
                <div>
                    <label className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-violet-500">
                        Vibe Transfer ({params.vibes.slots.length})
                    </label>
                    <div className="space-y-2">
                        {params.vibes.slots.map((slot, index) => (
                            <div key={`${slot.vibeId}-${slot.encodingId}-${index}`} className="rounded-lg border border-violet-100 bg-violet-50/60 p-2.5 dark:border-violet-900/60 dark:bg-violet-950/20">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-bold text-violet-700 dark:text-violet-300">{slot.vibeName || `Vibe ${index + 1}`}</span>
                                    <span className="flex-none text-[10px] font-mono text-gray-500">IE {slot.informationExtracted.toFixed(2)}</span>
                                </div>
                                <p className="mt-1 text-[10px] text-gray-500">原始强度 {slot.strength.toFixed(2)} · 实际发送 {(slot.effectiveStrength ?? slot.strength).toFixed(2)}</p>
                            </div>
                        ))}
                        {params.vibes.sourceGroupName && <p className="text-[10px] text-gray-500">来源组合：{params.vibes.sourceGroupName}</p>}
                    </div>
                </div>
            )}

            {edit && (
                <div>
                    <label className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        图片编辑
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <ParamItem label="Operation" value={edit.operation === 'image-to-image' ? '图生图' : edit.operation === 'inpaint' ? '局部重绘' : '扩图'} />
                        {edit.strength !== undefined && <ParamItem label="Strength" value={edit.strength.toFixed(2)} />}
                        {edit.noise !== undefined && <ParamItem label="Noise" value={edit.noise.toFixed(2)} />}
                        {edit.focused && <ParamItem label="Focused" value={edit.focusedArea ? `${Math.round(edit.focusedArea.width)} × ${Math.round(edit.focusedArea.height)}` : 'On'} />}
                        {edit.contextArea !== undefined && <ParamItem label="Context" value={`${edit.contextArea}px`} />}
                        {edit.canvasExpansion && (edit.canvasExpansion.top || edit.canvasExpansion.right || edit.canvasExpansion.bottom || edit.canvasExpansion.left) > 0 && <ParamItem label="Canvas Expansion" value={`上 ${edit.canvasExpansion.top} · 右 ${edit.canvasExpansion.right} · 下 ${edit.canvasExpansion.bottom} · 左 ${edit.canvasExpansion.left}`} />}
                        {edit.requestWidth && edit.requestHeight && <ParamItem label="Request Size" value={`${edit.requestWidth} × ${edit.requestHeight}`} />}
                        {edit.maskAvailable !== undefined && <ParamItem label="Mask" value={edit.maskAvailable ? (edit.fullSizeMask ? '独立蒙版 · 全尺寸' : '独立蒙版') : '无'} />}
                        {edit.estimatedCost !== undefined && <ParamItem label="本地结算估算" value={`${edit.estimatedCost} Anlas`} />}
                        {edit.settlementStatus && <ParamItem label="Settlement" value={edit.settlementStatus === 'estimated' ? '本地估算' : edit.settlementStatus === 'synced' ? '已同步' : '未知'} />}
                        {edit.keyHash && <ParamItem label="Key" value={`${edit.keyHash.slice(0, 8)}…`} />}
                    </div>
                </div>
            )}

            {/* 多角色列表 */}
            {params.characters && params.characters.length > 0 && (
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        Characters ({params.characters.length})
                    </label>
                    <div className="space-y-2">
                        {params.characters.map((char, idx) => (
                            <div
                                key={char.id || idx}
                                className="bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 rounded-lg p-2.5"
                            >
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase">
                                        Character {idx + 1}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-mono">
                                        ({char.x.toFixed(2)}, {char.y.toFixed(2)})
                                    </span>
                                </div>
                                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono break-words leading-relaxed">
                                    {char.prompt || <span className="text-gray-400 italic">（空）</span>}
                                </p>
                                {char.negativePrompt && (
                                    <p className="text-xs text-red-400 font-mono break-words leading-relaxed mt-1 border-t border-gray-200 dark:border-gray-700 pt-1">
                                        <span className="text-[9px] uppercase font-bold">UC:</span>{' '}
                                        {char.negativePrompt}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
