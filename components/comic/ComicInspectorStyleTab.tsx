import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Dices, Lock, Search, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t } from '../../services/i18n';
import { COMIC_V5_MODELS } from '../../services/comic/comicPromptBuilder';
import {
  buildStyleWarningTagMap,
  detectStyleCharacterTags,
  inspectStyleCharacterTags,
  type StyleCharacterHit,
} from '../../services/comic/comicStyleGuard';
import type {
  ComicColorMode,
  ComicDialogueMode,
  ComicPageDraft,
  ComicV5ModelId,
} from '../../services/comic/comicTypes';
import type { PromptTidyOptions } from '../PromptTidyActions';
import {
  ChainThumb,
  ComicPromptField,
  type ComicInspectorTab,
  NEGATIVE_LIBRARY_FIELD,
  POSITIVE_LIBRARY_FIELD,
  shortModelLabel,
} from './ComicInspectorShared';

interface ComicInspectorStyleTabProps {
  draft: ComicPageDraft;
  chains: PromptChain[];
  lastGeneratedSeed?: number;
  promptTidyOption?: PromptTidyOptions;
  copyPrompt: (value: string, label: string) => void;
  onApplyStyleChain: (chain: PromptChain) => void;
  onUpdateDraft: (updater: (current: ComicPageDraft) => ComicPageDraft, commit?: boolean) => void;
  onSelectTab: (tab: ComicInspectorTab) => void;
}

/** 漫画工作台步骤 1：画风设定、模型档位、色彩模式与低频生图参数。 */
export const ComicInspectorStyleTab: React.FC<ComicInspectorStyleTabProps> = ({
  draft,
  chains,
  lastGeneratedSeed,
  promptTidyOption,
  copyPrompt,
  onApplyStyleChain,
  onUpdateDraft,
  onSelectTab,
}) => {
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [styleQuery, setStyleQuery] = useState('');
  const syncStyleHits = useMemo(() => detectStyleCharacterTags(draft.globalBasePrompt), [draft.globalBasePrompt]);
  const [dictStyleHits, setDictStyleHits] = useState<{ prompt: string; hits: StyleCharacterHit[] } | null>(null);

  useEffect(() => {
    const prompt = draft.globalBasePrompt;
    if (!prompt.trim()) {
      setDictStyleHits(null);
      return;
    }
    let cancelled = false;
    void inspectStyleCharacterTags(prompt).then(hits => {
      if (!cancelled) setDictStyleHits({ prompt, hits });
    });
    return () => { cancelled = true; };
  }, [draft.globalBasePrompt]);

  const styleCharacterHits = dictStyleHits?.prompt === draft.globalBasePrompt ? dictStyleHits.hits : syncStyleHits;
  const styleWarningMap = useMemo(() => buildStyleWarningTagMap(styleCharacterHits), [styleCharacterHits]);

  const styleChains = useMemo(() => {
    const named = chains.filter(item =>
      item.type === 'style'
      && item.id !== 'playground'
      && item.name.trim()
      && item.name.trim() !== '生图实验室',
    );
    const q = styleQuery.trim().toLowerCase();
    if (!q) return named.slice(0, 60);
    return named.filter(item =>
      item.name.toLowerCase().includes(q)
      || item.basePrompt?.toLowerCase().includes(q)
      || item.tags?.some(tag => tag.toLowerCase().includes(q)),
    ).slice(0, 60);
  }, [chains, styleQuery]);

  const boundStyleChain = useMemo(
    () => draft.styleChainId ? chains.find(item => item.id === draft.styleChainId) : undefined,
    [chains, draft.styleChainId],
  );

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--nai-canvas,#eef1f7)] p-3 pb-6 text-xs dark:bg-[var(--nai-canvas,#0d0f14)]">
        {/* 卡片 1：载入风格串（带封面缩略图）+ 全页公共正画风词 + 折叠负面词 */}
        <div className="space-y-3 rounded-xl border border-gray-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-1.5">
            <span className="block font-semibold text-gray-700 dark:text-gray-200">{t('载入风格串画风')}</span>
            <div className="flex min-w-0 items-center rounded-lg border border-gray-200 bg-gray-50/70 transition focus-within:border-indigo-400 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800/80 dark:hover:border-indigo-500">
              <button
                type="button"
                aria-label={t('选择风格串')}
                aria-expanded={stylePickerOpen}
                onClick={() => setStylePickerOpen(open => !open)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-gray-800 dark:text-gray-100"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {boundStyleChain?.previewImage && (
                    <img src={boundStyleChain.previewImage} alt="" className="h-5 w-5 flex-none rounded object-cover" />
                  )}
                  <span className={`truncate ${boundStyleChain ? 'font-medium' : 'text-gray-400'}`}>
                    {boundStyleChain ? boundStyleChain.name : t('从风格串选择画风…')}
                  </span>
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 flex-none text-gray-400 transition-transform ${stylePickerOpen ? 'rotate-180 text-indigo-500' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {boundStyleChain && (
                <button
                  type="button"
                  aria-label={t('解除风格串绑定')}
                  title={t('解除风格串绑定')}
                  onClick={() => onUpdateDraft(cur => ({ ...cur, styleChainId: undefined }), true)}
                  className="mr-1 flex h-6 w-6 flex-none items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            {stylePickerOpen && (
              <div className="space-y-1.5 rounded-xl border border-indigo-200 bg-white p-2 shadow-sm dark:border-indigo-800 dark:bg-gray-900">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    autoFocus
                    aria-label={t('搜索风格串')}
                    value={styleQuery}
                    onChange={e => setStyleQuery(e.target.value)}
                    placeholder={t('按名称、画师或标签筛选风格串…')}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-xs text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {styleChains.map(chain => (
                    <button
                      key={chain.id}
                      type="button"
                      onClick={() => {
                        onApplyStyleChain(chain);
                        setStylePickerOpen(false);
                        setStyleQuery('');
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${draft.styleChainId === chain.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                    >
                      <ChainThumb image={chain.previewImage} kind="style" sizeClass="h-8 w-8" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-gray-800 dark:text-gray-100">{chain.name}</span>
                        {chain.basePrompt && <span className="block truncate text-[10px] text-gray-400">{chain.basePrompt}</span>}
                      </span>
                    </button>
                  ))}
                  {!styleChains.length && (
                    <div className="py-3 text-center text-[11px] text-gray-400">{t('没有找到匹配的风格串')}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <ComicPromptField
            label={t('全页公共画风提示词')}
            rows={3}
            libraryField={POSITIVE_LIBRARY_FIELD}
            promptTidy={promptTidyOption}
            warningTags={styleWarningMap}
            value={draft.globalBasePrompt}
            onChange={val => onUpdateDraft(cur => ({ ...cur, globalBasePrompt: val }), false)}
            onCopy={copyPrompt}
            placeholder={t('输入画师串与全页统一画风，每格生图自动带上')}
          />

          <details className="group rounded-lg border border-gray-200/80 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-800/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 select-none hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-300">
              <span className="inline-flex items-center gap-1">
                <ChevronDown className="h-3 w-3 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
                <span>{t('全页公共负面词（选填）')}</span>
              </span>
              {draft.globalNegativePrompt.trim() && (
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                  {t('已填')}
                </span>
              )}
            </summary>
            <div className="border-t border-gray-200/70 p-2 dark:border-gray-800">
              <ComicPromptField
                label={t('全页公共负面词')}
                rows={2}
                compact
                libraryField={NEGATIVE_LIBRARY_FIELD}
                value={draft.globalNegativePrompt}
                onChange={val => onUpdateDraft(cur => ({ ...cur, globalNegativePrompt: val }), false)}
                onCopy={copyPrompt}
                placeholder={t('全页公共排除词（自动过滤压制网点的冲突词）')}
              />
            </div>
          </details>
        </div>

        {/* 卡片 2：模型档位 / 色彩模式（带视觉色标，精简掉与顶栏的重复和低频对白策略） */}
        <div className="space-y-2.5 rounded-xl border border-gray-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold text-gray-600 dark:text-gray-300">{t('V5 模型档位')}</span>
            <div className="grid grid-cols-3 gap-1">
              {COMIC_V5_MODELS.map(model => {
                const active = draft.v5Model === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onUpdateDraft(cur => ({
                      ...cur,
                      v5Model: model.id as ComicV5ModelId,
                      steps: model.id === 'nai-diffusion-5-full-medium' ? 14 : 23,
                    }), true)}
                    className={`rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-semibold transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                  >
                    {shortModelLabel(model.id)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold text-gray-600 dark:text-gray-300">{t('色彩模式')}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { id: 'color', label: '全彩漫画' },
                { id: 'monochrome', label: '黑白网点漫' },
              ] as Array<{ id: ComicColorMode; label: string }>).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onUpdateDraft(cur => ({ ...cur, colorMode: item.id }), true)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 font-semibold transition ${draft.colorMode === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                >
                  {item.id === 'color' ? (
                    <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full bg-gradient-to-tr from-rose-400 via-amber-300 to-sky-400 ring-1 ring-black/10" />
                  ) : (
                    <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full bg-gradient-to-r from-gray-900 from-50% to-white to-50% ring-1 ring-gray-400" />
                  )}
                  <span>{t(item.label)}</span>
                </button>
              ))}
            </div>
            {draft.colorMode === 'monochrome' && (
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {t('生图时自动剥离彩色词并压制色相')}
              </p>
            )}
          </div>
        </div>

        {/* 卡片 3：低频生图参数微调与对白策略（默认折叠） */}
        <details className="group rounded-xl border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-gray-700 select-none hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300">
            <span className="inline-flex items-center gap-1.5">
              <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition group-open:rotate-180" aria-hidden="true" />
              <span>{t('生图参数微调')}</span>
            </span>
            <span className="truncate font-mono text-[11px] font-normal text-gray-400">
              {draft.v5Model === 'nai-diffusion-5-full-medium' ? 14 : draft.steps}{t('步')} · CFG {draft.scale.toFixed(1)}{draft.seed !== undefined ? ` · #${draft.seed}` : ''}
            </span>
          </summary>

          <div className="space-y-3 border-t border-gray-100 px-3 pt-2.5 pb-3 dark:border-gray-800">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('对白与气泡策略')}</span>
              <select
                aria-label={t('对白与气泡策略')}
                value={draft.dialogueMode}
                onChange={e => onUpdateDraft(cur => ({ ...cur, dialogueMode: e.target.value as ComicDialogueMode }), true)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-indigo-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="clean-vector">{t('无气泡纯画面 + 画布矢量气泡')}</option>
                <option value="empty-bubble">{t('空白气泡直出 + 后期嵌字')}</option>
                <option value="ai-text">{t('AI 锚点直出短字 / 拟声词')}</option>
              </select>
            </label>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{t('随机种子 (Seed)')}</span>
                {lastGeneratedSeed !== undefined && (
                  <button
                    type="button"
                    onClick={() => onUpdateDraft(cur => ({ ...cur, seed: lastGeneratedSeed }), true)}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                  >
                    <Lock className="h-2.5 w-2.5" />
                    <span>{t('锁上次 Seed')} ({lastGeneratedSeed})</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={4294967295}
                  aria-label={t('随机种子')}
                  value={draft.seed ?? ''}
                  onChange={e => {
                    const raw = e.target.value.trim();
                    onUpdateDraft(cur => ({
                      ...cur,
                      seed: raw === '' ? undefined : Math.max(0, Math.min(4294967295, Math.floor(Number(raw) || 0))),
                    }), false);
                  }}
                  onBlur={() => onUpdateDraft(cur => cur, true)}
                  placeholder={t('留空每次随机')}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1 text-xs font-mono text-gray-800 outline-none focus:border-indigo-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
                <button
                  type="button"
                  title={t('清空 Seed，恢复随机')}
                  aria-label={t('随机 Seed')}
                  onClick={() => onUpdateDraft(cur => ({ ...cur, seed: undefined }), true)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  <Dices className="h-3.5 w-3.5" /> {t('随机')}
                </button>
              </div>
            </div>

            {(() => {
              const isMedium = draft.v5Model === 'nai-diffusion-5-full-medium';
              return (
                <>
                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
                      <span>{t('步数 (Steps)')}</span>
                      <span className="font-mono">{isMedium ? '14' : draft.steps}</span>
                    </span>
                    <input
                      type="range"
                      aria-label={t('生图步数')}
                      min={10}
                      max={28}
                      disabled={isMedium}
                      value={isMedium ? 14 : draft.steps}
                      onChange={e => onUpdateDraft(cur => ({ ...cur, steps: Number(e.target.value) }), false)}
                      className="w-full accent-indigo-600 disabled:opacity-40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
                      <span>{t('引导强度 (CFG)')}</span>
                      <span className="font-mono">{draft.scale.toFixed(1)}</span>
                    </span>
                    <input
                      type="range"
                      aria-label={t('引导强度')}
                      min={1}
                      max={12}
                      step={0.5}
                      value={draft.scale}
                      onChange={e => onUpdateDraft(cur => ({ ...cur, scale: Number(e.target.value) }), false)}
                      className="w-full accent-indigo-600"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">{t('采样器')}</span>
                      <select
                        aria-label={t('采样器')}
                        disabled={isMedium}
                        value={isMedium ? 'k_euler_ancestral' : draft.sampler}
                        onChange={e => onUpdateDraft(cur => ({ ...cur, sampler: e.target.value }), true)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1 text-[11px] text-gray-800 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="k_euler_ancestral">Euler Ancestral</option>
                        <option value="k_euler">Euler</option>
                        <option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
                        <option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option>
                        <option value="k_dpmpp_sde">DPM++ SDE</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">{t('噪声调度')}</span>
                      <select
                        aria-label={t('噪声调度')}
                        value={draft.noiseSchedule}
                        onChange={e => onUpdateDraft(cur => ({ ...cur, noiseSchedule: e.target.value as ComicPageDraft['noiseSchedule'] }), true)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1 text-[11px] text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="karras">Karras</option>
                        <option value="exponential">Exponential</option>
                        <option value="polyexponential">Polyexponential</option>
                        <option value="native">Native</option>
                      </select>
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
                      <span>{t('提示词引导重缩放 (CFG Rescale)')}</span>
                      <span className="font-mono">{(isMedium ? 0 : draft.cfgRescale).toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      aria-label={t('CFG 重缩放')}
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={isMedium}
                      value={isMedium ? 0 : draft.cfgRescale}
                      onChange={e => onUpdateDraft(cur => ({ ...cur, cfgRescale: Number(e.target.value) }), false)}
                      className="w-full accent-indigo-600 disabled:opacity-40"
                    />
                  </label>
                  {isMedium && (
                    <p className="text-[10px] text-gray-400">
                      {t('V5 Medium 固定 14 步与 Euler Ancestral')}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </details>
      </div>

      <div className="appearance-surface flex-none border-t border-gray-200/80 p-3 dark:border-gray-800/80">
        <button
          type="button"
          onClick={() => onSelectTab('panel')}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500"
        >
          <span>{t('下一步：分镜生图')}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </>
  );
};
