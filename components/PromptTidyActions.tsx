import { t, useLanguage } from '../services/i18n';
import React, { useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, SpellCheck, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { FilterPill } from './DesignSystem';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import { isPromptTidyRewrite, PROMPT_TIDY_INSTRUCTION_LIMIT, resolvePromptTidyMethod, tidyPrompt, type PromptTidyDropped, type PromptTidyKeep, type PromptTidySettings } from '../services/promptTidy';
import { proofreadPrompt, type PromptProofreadCorrection } from '../services/tagProofread';
import { addPromptTidyPreset, PROMPT_TIDY_NAME_LIMIT, PROMPT_TIDY_PRESET_LIMIT, removePromptTidyPreset, setPromptTidyDraft, usePromptTidyState } from '../services/promptTidyPresets';
import type { PromptSampleBridge } from '../services/promptSampleSettings';
import { PromptSampleButton } from './PromptSampleButton';

export type PromptTidyNotify = (message: string, type?: 'success' | 'error') => void;
/** 提示词框接入整理时的选项；sample 只在能出图的编辑器里提供。 */
export interface PromptTidyOptions { notify: PromptTidyNotify; sample?: PromptSampleBridge }
export interface PromptTidyActionsProps extends PromptTidyOptions {
  value: string;
  disabled?: boolean;
  /** 覆盖原提示词并记入撤销历史。 */
  onApply: (next: string) => void;
  /** 校对结果覆盖原文，作为单独一次可撤销动作记录。 */
  onProofread?: (next: string) => void;
  /** 最近一次覆盖是可撤销的整理还是校对，决定撤销按钮与改动清单属于谁。 */
  lastAction?: 'tidy' | 'proofread';
  /** 最近一次整理或校对还能撤销时显示撤销按钮。 */
  canUndo: boolean;
  onUndo: () => void;
}

const ICON_CLASS = 'mobile-touch flex h-7 w-7 items-center justify-center rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100';
const LEGEND_CLASS = 'mb-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400';
const HINT_CLASS = 'mt-1 text-micro leading-relaxed text-gray-400';
const FIELD_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const CHECK_CLASS = 'flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200';

/** 提示词工具栏里的「整理」与「校对」：设置面板、自定义快捷按钮、改动清单与撤销。 */
export const PromptTidyActions: React.FC<PromptTidyActionsProps> = ({ value, disabled = false, notify, sample, onApply, onProofread, lastAction = 'tidy', canUndo, onUndo }) => {
  useLanguage();
  const { draft, presets } = usePromptTidyState();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  // 最近一次整理去掉的段：和撤销按钮同生同灭，撤销或继续编辑后就不再显示。
  const [dropped, setDropped] = useState<PromptTidyDropped[]>([]);
  const [droppedOpen, setDroppedOpen] = useState(false);
  const droppedRef = useRef<HTMLButtonElement>(null);
  // 最近一次校对改动的词：同样跟着撤销状态走，撤回或继续编辑后收起。
  const [proofread, setProofread] = useState<{ corrections: PromptProofreadCorrection[]; punctuation: number } | null>(null);
  const [proofreadOpen, setProofreadOpen] = useState(false);
  const proofreadRef = useRef<HTMLButtonElement>(null);
  const keepOptions: Array<{ value: PromptTidyKeep; label: string; hint: string }> = [
    { value: 'style', label: t('画风串'), hint: t('保留画师、画风、线条、质量词等整段配方，去掉人物、场景和光照') },
    { value: 'artists', label: t('只留画师'), hint: t('只保留画师，连同原来的权重') },
    { value: 'content', label: t('去掉画风'), hint: t('去掉画风配方，只留人物、场景等画面内容') },
    { value: 'all', label: t('只整理格式'), hint: t('不删内容，只去重、补前缀，并用逗号连成一行') },
    { value: 'custom', label: t('自定义要求'), hint: t('用一句话告诉 AI 想怎么整理') },
  ];
  const method = resolvePromptTidyMethod(draft);
  const rewrite = isPromptTidyRewrite(draft);
  const update = (patch: Partial<PromptTidySettings>) => setPromptTidyDraft({ ...draft, ...patch });
  const describe = (settings: PromptTidySettings) => {
    const parts = [resolvePromptTidyMethod(settings) === 'ai' ? 'AI' : t('规则'), keepOptions.find(option => option.value === settings.keep)?.label || ''];
    if (settings.keep === 'custom') parts.push(settings.instruction.length > 40 ? `${settings.instruction.slice(0, 40)}…` : settings.instruction);
    if (isPromptTidyRewrite(settings)) parts.push(t('允许改写'));
    else {
      if (settings.dedupe) parts.push(t('去重'));
      if (settings.artistPrefix) parts.push(t('补 artist:'));
    }
    if (settings.sample && sample) parts.push(t('出样张'));
    return parts.filter(Boolean).join(' · ');
  };

  const run = async (settings: PromptTidySettings, id: string) => {
    if (busy || disabled) return false;
    const base = valueRef.current;
    if (!base.trim()) { notify(t('没有可整理的提示词'), 'error'); return false; }
    setBusy(id);
    try {
      const result = await tidyPrompt(base, settings);
      // 模型调用期间用户可能继续编辑，旧结果不能盖掉新内容。
      if (valueRef.current !== base) { notify(t('整理期间提示词有改动，这次结果没有覆盖'), 'error'); return false; }
      if (!result.text) { notify(t('没有找到要保留的内容，提示词没有改动'), 'error'); return false; }
      if (result.text === base) notify(t('整理后没有变化'), 'success');
      else {
        setDropped(result.dropped);
        setDroppedOpen(false);
        onApply(result.text);
        notify(result.rewritten ? t('已按要求改写，可以撤销') : t('已整理：保留 {0} 段，去掉 {1} 段，可以撤销', [result.kept, result.removed]), 'success');
      }
      if (settings.sample && sample) {
        // 先收起面板再出图，扣费确认框不会被面板挡住；出图结果由编辑器的生成流程提示。
        setOpen(false);
        void sample.generate(result.text);
      }
      return true;
    } catch (error) {
      notify(t((error as Error).message), 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };
  const savePreset = () => {
    try { addPromptTidyPreset(presetName, draft); setPresetName(''); }
    catch (error) { notify(t((error as Error).message), 'error'); }
  };
  /**
   * 校对：规则对齐词库写法、统一英文标点，不删词、不调模型。
   * 词库未就绪时只统一标点并如实提示，不冒充已校对。
   */
  const runProofread = async () => {
    if (busy || disabled) return;
    const base = valueRef.current;
    if (!base.trim()) { notify(t('没有可校对的提示词'), 'error'); return; }
    setBusy('proofread');
    try {
      const result = await proofreadPrompt(base);
      if (valueRef.current !== base) { notify(t('校对期间提示词有改动，这次结果没有覆盖'), 'error'); return; }
      if (result.text === base) {
        notify(result.dictionaryUnavailable ? t('Tag 词库未就绪，没有可校对的词；请先在全局设置更新词库') : t('提示词没有需要校对的地方'), result.dictionaryUnavailable ? 'error' : 'success');
        return;
      }
      setProofread({ corrections: result.corrections, punctuation: result.punctuation });
      setProofreadOpen(false);
      (onProofread ?? onApply)(result.text);
      if (result.dictionaryUnavailable) notify(t('Tag 词库未就绪，只统一了 {0} 处标点', [result.punctuation]), 'error');
      else if (result.corrections.length && result.punctuation) notify(t('已校对 {0} 个 Tag、{1} 处标点，可以撤销', [result.corrections.length, result.punctuation]), 'success');
      else if (result.corrections.length) notify(t('已校对 {0} 个 Tag，可以撤销', [result.corrections.length]), 'success');
      else notify(t('已统一 {0} 处中文标点，可以撤销', [result.punctuation]), 'success');
    } catch (error) {
      notify(t((error as Error).message), 'error');
    } finally {
      setBusy(null);
    }
  };
  const spinner = <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />;
  const full = presets.length >= PROMPT_TIDY_PRESET_LIMIT;
  const showDropped = canUndo && lastAction === 'tidy' && dropped.length > 0;
  const duplicates = dropped.filter(item => item.duplicate).length;
  const proofreadCount = proofread ? proofread.corrections.length + (proofread.punctuation > 0 ? 1 : 0) : 0;
  const showProofread = canUndo && lastAction === 'proofread' && proofreadCount > 0;

  return <span className="flex items-center gap-1">
    <span ref={anchorRef} className="inline-flex">
      <button type="button" disabled={disabled} aria-label={t('整理提示词')} title={t('整理提示词：提取画风、清洗格式')} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(!open)} className={ICON_CLASS}>
        {busy === 'draft' ? spinner : <WandSparkles aria-hidden="true" className="h-4 w-4" />}
      </button>
    </span>
    <button type="button" disabled={disabled || Boolean(busy)} aria-label={t('校对 Tag')} title={t('校对 Tag：对齐词库写法，统一英文标点')}
      onClick={() => { void runProofread(); }} className={ICON_CLASS}>
      {busy === 'proofread' ? spinner : <SpellCheck aria-hidden="true" className="h-4 w-4" />}
    </button>
    {canUndo && lastAction === 'tidy' && <button type="button" disabled={disabled} aria-label={t('撤销整理')} title={t('撤销整理')} onMouseDown={event => event.preventDefault()} onClick={onUndo} className={`${ICON_CLASS} text-[var(--nai-accent)]`}>
      <RotateCcw aria-hidden="true" className="h-4 w-4" />
    </button>}
    {showDropped && <button ref={droppedRef} type="button" aria-label={t('查看去掉的 {0} 段', [dropped.length])} title={t('查看去掉的 {0} 段', [dropped.length])} aria-haspopup="dialog" aria-expanded={droppedOpen}
      onClick={() => setDroppedOpen(!droppedOpen)}
      className="mobile-touch inline-flex h-7 flex-none items-center rounded px-1.5 text-xs font-medium tabular-nums text-[var(--nai-accent)] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-gray-700">
      {t('去掉 {0}', [dropped.length])}
    </button>}
    {showProofread && <button ref={proofreadRef} type="button" aria-label={t('查看改动的 {0} 处', [proofreadCount])} title={t('查看改动的 {0} 处', [proofreadCount])} aria-haspopup="dialog" aria-expanded={proofreadOpen}
      onClick={() => setProofreadOpen(!proofreadOpen)}
      className="mobile-touch inline-flex h-7 flex-none items-center rounded px-1.5 text-xs font-medium tabular-nums text-[var(--nai-accent)] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-gray-700">
      {t('改动 {0}', [proofreadCount])}
    </button>}
    {showDropped && droppedOpen && <AnchoredToolbarPopover anchorRef={droppedRef} title={t('这次去掉的内容')} width={340} allowMobile onClose={() => setDroppedOpen(false)}>
      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('这次去掉的内容')}</div>
          <p className={HINT_CLASS}>{duplicates ? t('按原文顺序共 {0} 段，其中 {1} 段是重复词。', [dropped.length, duplicates]) : t('按原文顺序共 {0} 段。', [dropped.length])}</p>
        </div>
        <ul aria-label={t('去掉的段')} className="flex flex-wrap gap-1.5">{dropped.map((item, index) => <li key={index}
          className="appearance-group max-w-full break-words rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
          {item.text}{item.duplicate && <span className="ml-1.5 font-sans text-micro text-gray-400">{t('重复')}</span>}
        </li>)}</ul>
        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <button type="button" disabled={disabled} onClick={() => { setDroppedOpen(false); onUndo(); }}
            className="mobile-touch inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            <RotateCcw aria-hidden="true" className="h-4 w-4" />{t('撤销整理')}
          </button>
        </div>
      </div>
    </AnchoredToolbarPopover>}
    {showProofread && proofreadOpen && proofread && <AnchoredToolbarPopover anchorRef={proofreadRef} title={t('这次改动的 Tag')} width={360} allowMobile onClose={() => setProofreadOpen(false)}>
      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('这次改动的 Tag')}</div>
          <p className={HINT_CLASS}>{proofread.corrections.length === 0
            ? t('没有 Tag 需要改写法，{0} 处中文标点换成英文。', [proofread.punctuation])
            : proofread.punctuation > 0
              ? t('按原文顺序共 {0} 个 Tag；另有 {1} 处中文标点换成英文。', [proofread.corrections.length, proofread.punctuation])
              : t('按原文顺序共 {0} 个 Tag。', [proofread.corrections.length])}</p>
        </div>
        {proofread.corrections.length > 0 && <ul aria-label={t('改动的 Tag')} className="space-y-1">{proofread.corrections.map((item, index) => <li key={index}
          className="flex items-start gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950">
          <span className="min-w-0 break-all font-mono text-gray-500 line-through dark:text-gray-400">{item.from}</span>
          <span aria-hidden="true" className="flex-none text-gray-400">→</span>
          <span className="min-w-0 break-all font-mono font-semibold text-gray-800 dark:text-gray-100">{item.to}</span>
        </li>)}</ul>}
        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <button type="button" disabled={disabled} onClick={() => { setProofreadOpen(false); onUndo(); }}
            className="mobile-touch inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            <RotateCcw aria-hidden="true" className="h-4 w-4" />{t('撤销校对')}
          </button>
        </div>
      </div>
    </AnchoredToolbarPopover>}
    {presets.map(preset => <button key={preset.id} type="button" disabled={disabled || Boolean(busy)} aria-label={t('快捷整理：{0}', [preset.name])} title={describe(preset.settings)}
      onClick={() => { void run(preset.settings, preset.id); }}
      className="mobile-touch hidden h-7 max-w-[7rem] items-center gap-1 rounded px-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 sm:inline-flex">
      {busy === preset.id ? spinner : resolvePromptTidyMethod(preset.settings) === 'ai' ? <Sparkles aria-hidden="true" className="h-3.5 w-3.5 flex-none" /> : null}
      <span className="truncate">{preset.name}</span>
    </button>)}
    {sample && <PromptSampleButton value={value} disabled={disabled} notify={notify} sample={sample} />}
    {open && <AnchoredToolbarPopover anchorRef={anchorRef} title={t('整理提示词')} width={360} allowMobile onClose={() => setOpen(false)}>
      <div className="space-y-4">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('整理提示词')}</div>
        <fieldset>
          <legend className={LEGEND_CLASS}>{t('保留什么')}</legend>
          <div className="flex flex-wrap gap-1.5">{keepOptions.map(option => <FilterPill key={option.value} title={option.hint} active={draft.keep === option.value} onClick={() => update({ keep: option.value })}>{option.label}</FilterPill>)}</div>
        </fieldset>
        <fieldset>
          <legend className={LEGEND_CLASS}>{t('识别方式')}</legend>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={method === 'rules'} disabled={draft.keep === 'custom'} onClick={() => update({ method: 'rules' })}>{t('规则（本地）')}</FilterPill>
            <FilterPill active={method === 'ai'} disabled={draft.keep === 'artists' || draft.keep === 'all'} onClick={() => update({ method: 'ai' })}><Sparkles aria-hidden="true" className="h-3.5 w-3.5" />{t('AI 精准')}</FilterPill>
          </div>
          {method === 'ai' && <p className={HINT_CLASS}>{t('调用创作助手模型，可能产生费用')}</p>}
        </fieldset>
        {draft.keep === 'custom' && <div className="space-y-2">
          <textarea aria-label={t('整理要求')} rows={3} maxLength={PROMPT_TIDY_INSTRUCTION_LIMIT} value={draft.instruction} placeholder={t('例如：只保留画师和光影，去掉质量词')}
            onChange={event => update({ instruction: event.target.value })} className={`${FIELD_CLASS} resize-y`} />
          <label className={CHECK_CLASS}><input type="checkbox" className="mt-0.5" checked={draft.rewrite} onChange={event => update({ rewrite: event.target.checked })} />
            <span>{t('允许 AI 改写词句')}</span></label>
        </div>}
        {!rewrite && <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className={CHECK_CLASS}><input type="checkbox" className="mt-0.5" checked={draft.dedupe} onChange={event => update({ dedupe: event.target.checked })} />{t('去掉重复词')}</label>
          <label className={CHECK_CLASS}><input type="checkbox" className="mt-0.5" checked={draft.artistPrefix} onChange={event => update({ artistPrefix: event.target.checked })} />{t('给画师补 artist: 前缀')}</label>
        </div>}
        {sample && <label className={CHECK_CLASS}><input type="checkbox" className="mt-0.5" checked={draft.sample} onChange={event => update({ sample: event.target.checked })} />
          <span>{t('整理后生成样张')}</span></label>}
        <div>
          <button type="button" disabled={disabled || Boolean(busy)} onClick={() => { void run(draft, 'draft').then(done => { if (done) setOpen(false); }); }}
            className="mobile-touch inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 disabled:cursor-not-allowed disabled:opacity-50">
            {busy === 'draft' ? spinner : <WandSparkles aria-hidden="true" className="h-4 w-4" />}{t('整理并覆盖')}
          </button>
        </div>
        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <div className={`${LEGEND_CLASS} flex items-center justify-between`}>
            <span>{t('快捷按钮')}</span>
            <span className="font-normal tabular-nums text-gray-400">{presets.length}/{PROMPT_TIDY_PRESET_LIMIT}</span>
          </div>
          <div className="flex gap-2">
            <input aria-label={t('快捷按钮名称')} value={presetName} maxLength={PROMPT_TIDY_NAME_LIMIT} disabled={full} placeholder={full ? t('快捷按钮已满，请先删掉一个') : t('按钮名称')}
              onChange={event => setPresetName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && presetName.trim()) { event.preventDefault(); savePreset(); } }} className={`${FIELD_CLASS} min-w-0 flex-1`} />
            <button type="button" disabled={full || !presetName.trim() || (draft.keep === 'custom' && !draft.instruction.trim())} onClick={savePreset}
              className="mobile-touch h-9 flex-none rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">{t('存为快捷按钮')}</button>
          </div>
          {presets.length > 0 && <ul className="mt-2 space-y-1">{presets.map(preset => <li key={preset.id} className="flex items-center gap-1">
            <button type="button" disabled={disabled || Boolean(busy)} onClick={() => { void run(preset.settings, preset.id).then(done => { if (done) setOpen(false); }); }} aria-label={t('快捷整理：{0}', [preset.name])}
              className="mobile-touch flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800">
              {busy === preset.id && spinner}
              <span className="flex-none text-sm font-medium text-gray-800 dark:text-gray-100">{preset.name}</span>
              <span className="min-w-0 truncate text-micro text-gray-400">{describe(preset.settings)}</span>
            </button>
            <button type="button" aria-label={t('删除快捷按钮：{0}', [preset.name])} title={t('删除快捷按钮：{0}', [preset.name])} onClick={() => removePromptTidyPreset(preset.id)} className={ICON_CLASS}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
          </li>)}</ul>}
        </div>
      </div>
    </AnchoredToolbarPopover>}
  </span>;
};
