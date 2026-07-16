import React, { useState } from 'react';
import { NAIParams } from '../types';
import { estimateAnlas, getAnlasRemaining } from '../services/anlasService';

interface ChainEditorParamsProps {
    params: NAIParams;
    setParams: (p: NAIParams) => void;
    canEdit: boolean;
    markChange: () => void;
    presetSource?: { name: string; modified: boolean };
}

const RESOLUTIONS = {
    Portrait: { width: 832, height: 1216, label: '竖屏 832×1216' },
    Landscape: { width: 1216, height: 832, label: '横屏 1216×832' },
    Square: { width: 1024, height: 1024, label: '方形 1024×1024' },
    SmallPortrait: { width: 512, height: 768, label: '小竖图 512×768' },
};

const SAMPLERS = [
    ['k_euler_ancestral', 'Euler Ancestral'], ['k_euler', 'Euler'],
    ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'], ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'],
    ['k_dpmpp_2m', 'DPM++ 2M'], ['k_dpmpp_sde', 'DPM++ SDE'],
    ['k_dpm_2', 'DPM2'], ['k_dpm_2_ancestral', 'DPM2 Ancestral'],
    ['k_dpm_fast', 'DPM Fast'], ['ddim', 'DDIM'],
] as const;

export const ChainEditorParams: React.FC<ChainEditorParamsProps> = ({ params, setParams, canEdit, markChange, presetSource }) => {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const update = (changes: Partial<NAIParams>) => { setParams({ ...params, ...changes }); markChange(); };
    const currentPreset = Object.entries(RESOLUTIONS).find(([, value]) => value.width === params.width && value.height === params.height)?.[0] || 'Custom';
    const estimate = estimateAnlas(params);

    return (
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">参数设置</h3>
                {presetSource && <span className="max-w-40 truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">来自：{presetSource.name}{presetSource.modified ? ' · 已修改' : ''}</span>}
                <span className={`ml-auto rounded-full px-2 py-1 text-[11px] font-bold ${estimate.free ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>{estimate.free ? 'Opus 免费' : `预计 ${estimate.cost} Anlas · 余 ${getAnlasRemaining()}`}</span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 border-b border-gray-200 pb-4 dark:border-gray-700 md:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-gray-500"><span>模型</span><select disabled={!canEdit} value={params.model ?? 'nai-diffusion-4-5-full'} onChange={e => update({ model: e.target.value as NAIParams['model'], ucPreset: e.target.value === 'nai-diffusion-4-5-curated' && params.ucPreset === 2 ? 0 : params.ucPreset })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><option value="nai-diffusion-4-5-full">V4.5 Full</option><option value="nai-diffusion-4-5-curated">V4.5 Curated</option></select></label>
                <label className="flex flex-col gap-1 text-xs text-gray-500"><span>负面预设</span><select disabled={!canEdit} value={params.ucPreset ?? 0} onChange={e => update({ ucPreset: Number(e.target.value) })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"><option value={0}>Heavy</option><option value={1}>Light</option>{params.model !== 'nai-diffusion-4-5-curated' && <option value={2}>Furry Focus</option>}<option value={3}>Human Focus</option><option value={4}>None</option></select></label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" disabled={!canEdit} checked={params.qualityToggle ?? true} onChange={e => update({ qualityToggle: e.target.checked })} className="h-4 w-4 rounded text-indigo-600" />质量标签</label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" disabled={!canEdit} checked={params.variety ?? false} onChange={e => update({ variety: e.target.checked })} className="h-4 w-4 rounded text-pink-600" />Variety+</label>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-gray-500"><span>尺寸预设</span><select disabled={!canEdit} value={currentPreset} onChange={e => { const preset = RESOLUTIONS[e.target.value as keyof typeof RESOLUTIONS]; if (preset) update(preset); }} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{Object.entries(RESOLUTIONS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}<option value="Custom">自定义</option></select></label>
                <div className="grid grid-cols-2 gap-2"><label className="flex flex-col gap-1 text-xs text-gray-500"><span>宽</span><input type="number" min={64} step={64} disabled={!canEdit} value={params.width} onChange={e => update({ width: Math.max(64, Number(e.target.value) || 64) })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" /></label><label className="flex flex-col gap-1 text-xs text-gray-500"><span>高</span><input type="number" min={64} step={64} disabled={!canEdit} value={params.height} onChange={e => update({ height: Math.max(64, Number(e.target.value) || 64) })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" /></label></div>
                <label className="flex flex-col gap-1 text-xs text-gray-500"><span>采样器</span><select disabled={!canEdit} value={params.sampler || 'k_euler_ancestral'} onChange={e => update({ sampler: e.target.value })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{SAMPLERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2"><label className="flex flex-col gap-1 text-xs text-gray-500"><span>步数 {params.steps > 28 && <b className="text-amber-500">付费</b>}</span><input type="number" min={1} max={50} disabled={!canEdit} value={params.steps} onChange={e => update({ steps: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" /></label><label className="flex flex-col gap-1 text-xs text-gray-500"><span>张数</span><select disabled={!canEdit} value={params.nSamples ?? 1} onChange={e => update({ nSamples: Number(e.target.value) })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">{[1,2,3,4].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
            </div>

            <button type="button" onClick={() => setAdvancedOpen(open => !open)} className="mt-4 flex min-h-11 w-full items-center justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300"><span>高级参数</span><span>{advancedOpen ? '收起' : '展开'}</span></button>
            {advancedOpen && <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
                <div><div className="mb-1 flex justify-between text-xs text-gray-500"><span>CFG Scale</span><b>{params.scale}</b></div><input type="range" min="0" max="10" step="0.1" disabled={!canEdit} value={params.scale} onChange={e => update({ scale: Number(e.target.value) })} className="w-full accent-indigo-600" /></div>
                <div><div className="mb-1 flex justify-between text-xs text-gray-500"><span>CFG Rescale</span><b>{params.cfgRescale ?? 0}</b></div><input type="range" min="0" max="1" step="0.05" disabled={!canEdit} value={params.cfgRescale ?? 0} onChange={e => update({ cfgRescale: Number(e.target.value) })} className="w-full accent-pink-600" /></div>
                <label className="flex flex-col gap-1 text-xs text-gray-500"><span>SMEA</span><select disabled={!canEdit} value={params.smea ?? 'off'} onChange={e => update({ smea: e.target.value as NAIParams['smea'] })} className="rounded border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="off">关闭</option><option value="auto">自动</option><option value="smea">SMEA</option><option value="smea_dyn">SMEA DYN</option></select></label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" disabled={!canEdit} checked={params.decrisper ?? false} onChange={e => update({ decrisper: e.target.checked })} className="h-4 w-4 rounded text-indigo-600" />Decrisper（高 Guidance 辅助）</label>
                <label className="flex flex-col gap-1 text-xs text-gray-500"><span>Seed（空=随机）</span><div className="flex gap-2"><input type="number" disabled={!canEdit} value={params.seed ?? ''} onChange={e => update({ seed: e.target.value === '' ? undefined : Number(e.target.value) })} className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" /><button type="button" onClick={() => update({ seed: undefined })} className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-600">随机</button></div></label>
            </div>}
        </section>
    );
};
