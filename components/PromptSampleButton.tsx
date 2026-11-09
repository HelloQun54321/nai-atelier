import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ImagePlay, Plus, Trash2 } from 'lucide-react';
import { FilterPill } from './DesignSystem';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import { BUILTIN_ASPECT_RATIOS } from '../services/aspectRatio';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { createPromptSampleSnapshot, getPromptSampleSettings, PROMPT_SAMPLE_CHARACTER_LIMIT, PROMPT_SAMPLE_TEXT_LIMIT, updatePromptSampleSettings, usePromptSampleSettings, type PromptSampleBridge } from '../services/promptSampleSettings';
import type { NAIParams } from '../types';

const ICON_CLASS = 'mobile-touch flex h-7 w-7 items-center justify-center rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700 dark:hover:text-gray-200';
const LEGEND_CLASS = 'mb-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400';
const HINT_CLASS = 'mt-1 text-micro leading-relaxed text-gray-400';
const FIELD_CLASS = 'w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-800 outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const SELECT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const PARAM_LABEL_CLASS = 'flex min-w-0 flex-col gap-1 text-micro font-medium text-gray-500 dark:text-gray-400';
const SAMPLERS: Array<[string, string]> = [['k_euler_ancestral', 'Euler Ancestral'], ['k_euler', 'Euler'], ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'], ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'], ['k_dpmpp_2m', 'DPM++ 2M'], ['k_dpmpp_sde', 'DPM++ SDE']];

/** 数字框边输入边保存：只提交合法值，中间态（空白、「2.」）留在框里，离开时回到已保存的值。 */
const NumberField: React.FC<{ label: string; value: number | undefined; min: number; max: number; step: number; integer?: boolean; optional?: boolean; placeholder?: string; onChange: (value: number | undefined) => void }> = ({ label, value, min, max, step, integer, optional, placeholder, onChange }) => {
  const shown = value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => { setText(current => (current.trim() === '' ? undefined : Number(current)) === value ? current : shown); }, [value, shown]);
  return <label className={PARAM_LABEL_CLASS}>{label}
    <input type="number" inputMode="decimal" min={min} max={max} step={step} value={text} placeholder={placeholder} className={SELECT_CLASS}
      onChange={event => {
        const raw = event.target.value, next = Number(raw);
        setText(raw);
        if (raw.trim() === '') { if (optional) onChange(undefined); return; }
        if (Number.isFinite(next) && next >= min && next <= max && (!integer || Number.isInteger(next))) onChange(next);
      }}
      onBlur={() => setText(shown)} />
  </label>;
};

/** 提示词工具栏里的「样张」：当前提示词原样接上 main 与角色出一张图。 */
export const PromptSampleButton: React.FC<{ value: string; disabled?: boolean; notify: (message: string, type?: 'success' | 'error') => void; sample: PromptSampleBridge }> = ({ value, disabled = false, notify, sample }) => {
  useLanguage();
  const settings = usePromptSampleSettings();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const mainId = useId();
  const valueRef = useRef(value);
  valueRef.current = value;
  const [open, setOpen] = useState(false);
  // 负面词默认留空，出图时沿用每串原图自己的负面词。
  const fromCurrent = () => createPromptSampleSnapshot(sample.current().params, '');
  // 第一次用「我的样张设置」时先按当前参数填好，之后直接在面板里改。
  useEffect(() => {
    if (open && settings.source === 'mine' && !settings.snapshot) updatePromptSampleSettings({ snapshot: fromCurrent() });
  });
  const snapshot = settings.snapshot;
  const patchSnapshot = (params: Partial<NAIParams>, negativePrompt?: string) => {
    const base = getPromptSampleSettings().snapshot ?? fromCurrent();
    updatePromptSampleSettings({ snapshot: { params: { ...base.params, ...params }, negativePrompt: negativePrompt ?? base.negativePrompt, savedAt: Date.now() } });
  };
  const sizeValue = snapshot ? `${snapshot.params.width}x${snapshot.params.height}` : '';
  const originalSizeValue = settings.originalSize ? `${settings.originalSize.width}x${settings.originalSize.height}` : '';
  const isBuiltinSize = (value: string) => BUILTIN_ASPECT_RATIOS.some(item => `${item.baseWidth}x${item.baseHeight}` === value);
  const ratioOptions = BUILTIN_ASPECT_RATIOS.map(item => <option key={item.id} value={`${item.baseWidth}x${item.baseHeight}`}>{t(item.label)} · {item.baseWidth}×{item.baseHeight}</option>);

  // 提示词框里的内容原样当画风串用，不再自动整理：整理会改动用户手动调好的写法（如数字结尾权重前的空格）。
  // 要先提取画风串，用整理面板的「整理后生成样张」。
  const generate = () => {
    if (disabled) return;
    const style = valueRef.current.trim();
    if (!style) { notify(t('提示词是空的，先写好画风串再生成样张'), 'error'); return; }
    setOpen(false);
    // 扣费确认、出图与保存由编辑器的生成流程负责，失败也在那里提示。
    void sample.generate(style);
  };
  const setCharacter = (index: number, prompt: string) => updatePromptSampleSettings({ characters: settings.characters.map((item, current) => current === index ? prompt : item) });

  return <span ref={anchorRef} className="inline-flex">
    <button type="button" disabled={disabled} aria-label={t('生成样张')} title={t('生成样张：用当前提示词接上 main 与角色出一张图')} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(!open)} className={ICON_CLASS}>
      <ImagePlay aria-hidden="true" className="h-4 w-4" />
    </button>
    {open && <AnchoredToolbarPopover anchorRef={anchorRef} title={t('生成样张')} width={380} allowMobile onClose={() => setOpen(false)}>
      <div className="space-y-4">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('生成样张')}</div>
        <fieldset>
          <legend className={LEGEND_CLASS}>{t('参数来源')}</legend>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={settings.source === 'original'} onClick={() => updatePromptSampleSettings({ source: 'original' })}>{t('沿用原图设置')}</FilterPill>
            <FilterPill active={settings.source === 'mine'} onClick={() => updatePromptSampleSettings({ source: 'mine', ...(settings.snapshot ? {} : { snapshot: fromCurrent() }) })}>{t('用我的样张设置')}</FilterPill>
          </div>
          {settings.source === 'original'
            ? <div className="mt-2 space-y-1.5">
              <label className={PARAM_LABEL_CLASS}>{t('尺寸')}
                <select value={originalSizeValue} onChange={event => { const [width, height] = event.target.value.split('x').map(Number); updatePromptSampleSettings({ originalSize: event.target.value ? { width, height } : null }); }} className={SELECT_CLASS}>
                  <option value="">{t('跟原图一致')}</option>
                  {ratioOptions}
                  {originalSizeValue && !isBuiltinSize(originalSizeValue) && <option value={originalSizeValue}>{t('自定义尺寸')} · {originalSizeValue.replace('x', '×')}</option>}
                </select>
              </label>
              <p className={HINT_CLASS}>{t('其余沿用当前编辑器里的模型、步数、采样器、种子、负面词和氛围参考，也就是这串原图的设置。')}</p>
            </div>
            : snapshot && <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className={PARAM_LABEL_CLASS}>{t('模型')}
                  <select value={snapshot.params.model || ''} onChange={event => patchSnapshot({ model: event.target.value })} className={SELECT_CLASS}>
                    {sample.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                    {!sample.models.some(model => model.id === snapshot.params.model) && <option value={snapshot.params.model || ''}>{getNaiModelDisplayLabel(snapshot.params.model)}</option>}
                  </select>
                </label>
                <label className={PARAM_LABEL_CLASS}>{t('尺寸')}
                  <select value={sizeValue} onChange={event => { const [width, height] = event.target.value.split('x').map(Number); patchSnapshot({ width, height }); }} className={SELECT_CLASS}>
                    {ratioOptions}
                    {!isBuiltinSize(sizeValue) && <option value={sizeValue}>{t('自定义尺寸')} · {snapshot.params.width}×{snapshot.params.height}</option>}
                  </select>
                </label>
                <NumberField label={t('步数')} value={snapshot.params.steps} min={1} max={50} step={1} integer onChange={steps => patchSnapshot({ steps })} />
                <NumberField label="CFG" value={snapshot.params.scale} min={0} max={10} step={0.1} onChange={scale => patchSnapshot({ scale })} />
                <label className={PARAM_LABEL_CLASS}>{t('采样器')}
                  <select value={snapshot.params.sampler} onChange={event => patchSnapshot({ sampler: event.target.value })} className={SELECT_CLASS}>
                    {SAMPLERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    {!SAMPLERS.some(([id]) => id === snapshot.params.sampler) && <option value={snapshot.params.sampler}>{snapshot.params.sampler}</option>}
                  </select>
                </label>
                <NumberField label={t('种子')} value={snapshot.params.seed} min={0} max={4294967295} step={1} integer optional placeholder={t('留空为随机')} onChange={seed => patchSnapshot({ seed })} />
              </div>
              <label className={PARAM_LABEL_CLASS}>{t('负面提示词')}
                <textarea rows={2} maxLength={PROMPT_SAMPLE_TEXT_LIMIT} value={snapshot.negativePrompt} placeholder={t('留空沿用原图的负面词')} onChange={event => patchSnapshot({}, event.target.value)} className={FIELD_CLASS} />
              </label>
              <div className="flex items-start justify-between gap-2">
                <p className={`${HINT_CLASS} !mt-0`}>{t('只用于样张，不含角色、氛围参考与精准参考；第一次切换时已按当前参数填好。')}</p>
                <button type="button" onClick={() => { updatePromptSampleSettings({ snapshot: fromCurrent() }); notify(t('已填入当前参数'), 'success'); }}
                  className="mobile-touch h-7 flex-none rounded-lg px-2 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">{t('从当前参数填入')}</button>
              </div>
            </div>}
        </fieldset>
        <div>
          <label className={`${LEGEND_CLASS} block`} htmlFor={mainId}>{t('main 提示词')}</label>
          <textarea id={mainId} rows={2} maxLength={PROMPT_SAMPLE_TEXT_LIMIT} value={settings.main} placeholder={t('例如：1girl, solo, upper body, simple background')}
            onChange={event => updatePromptSampleSettings({ main: event.target.value })} className={FIELD_CLASS} />
        </div>
        <fieldset>
          <legend className={LEGEND_CLASS}>{t('角色')}</legend>
          <label className="mb-1.5 flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200"><input type="checkbox" className="mt-0.5" checked={settings.keepOriginalCharacters} onChange={event => updatePromptSampleSettings({ keepOriginalCharacters: event.target.checked })} />
            <span>{t('沿用原图角色')}<span className={`block ${HINT_CLASS}`}>{t('角色、站位和精准参考都按原图来；下面填的样张角色先不用，取消勾选即恢复。')}</span></span></label>
          {!settings.keepOriginalCharacters && <div className="space-y-1.5">
            {settings.characters.map((prompt, index) => <div key={index} className="flex items-start gap-1">
              <textarea rows={1} aria-label={t('角色 {0} 提示词', [index + 1])} maxLength={PROMPT_SAMPLE_TEXT_LIMIT} value={prompt} onChange={event => setCharacter(index, event.target.value)} className={`${FIELD_CLASS} min-w-0 flex-1`} />
              <button type="button" aria-label={t('删除角色 {0}', [index + 1])} title={t('删除角色 {0}', [index + 1])} onClick={() => updatePromptSampleSettings({ characters: settings.characters.filter((_, current) => current !== index) })} className={ICON_CLASS}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
            </div>)}
            <button type="button" disabled={settings.characters.length >= PROMPT_SAMPLE_CHARACTER_LIMIT} onClick={() => updatePromptSampleSettings({ characters: [...settings.characters, ''] })}
              className="mobile-touch inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />{t('添加角色')}
            </button>
          </div>}
        </fieldset>
        <div>
          <button type="button" disabled={disabled} onClick={generate}
            className="mobile-touch inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 disabled:cursor-not-allowed disabled:opacity-50">
            <ImagePlay aria-hidden="true" className="h-4 w-4" />{t('生成样张')}
          </button>
          <p className={HINT_CLASS}>{t('提示词框里的内容原样接上 main，不会先整理；想先提取画风串，可在整理面板勾选「整理后生成样张」。角色放进角色栏，图片进当前预览和历史，扣费前照常确认。')}</p>
        </div>
      </div>
    </AnchoredToolbarPopover>}
  </span>;
};
