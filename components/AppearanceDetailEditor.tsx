import React, { useEffect, useState } from 'react';
import { t } from '../services/i18n';
import { normalizeThemeDetails, resolveThemeDetails, THEME_DETAIL_NUMBERS, ThemeDetailNumber, ThemeDetails } from '../services/themeDetails';

const LABELS: Record<ThemeDetailNumber, string> = {
  fontSize: '基础字号', strongWeight: '标题字重', lineHeight: '文字行高', letterSpacing: '字间距', iconStroke: '图标线宽',
  controlHeight: '控件高度', controlRadius: '控件圆角', panelRadius: '面板圆角', cardRadius: '卡片圆角',
  spacing: '间距基准', toolbarHeight: '工具栏高度', chromeInset: '导航留边',
  blur: '玻璃模糊', saturation: '玻璃饱和度', opacity: '玻璃不透明度', highlight: '边缘高光',
  shadow: '阴影强度', refraction: '边缘折射', duration: '过渡时长',
  globalOpacity: '全局不透明度',
  sidebarOpacity: '侧栏不透明度', toolbarOpacity: '工具栏不透明度', panelOpacity: '弹窗不透明度', labEditorOpacity: '实验室编辑面板不透明度', borderOpacity: '边框强度', controlShadow: '控件阴影',
};

const DetailNumber: React.FC<{ field: ThemeDetailNumber; value?: number; inheritedValue?: number; disabled?: boolean; onChange: (value: number | undefined) => void }> = ({ field, value, inheritedValue, disabled, onChange }) => {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  const [min, max, fallback, step] = THEME_DETAIL_NUMBERS[field];
  if (field === 'labEditorOpacity' || field === 'globalOpacity') {
    const percent = Math.round((value ?? inheritedValue ?? fallback) * 100);
    return <label className="flex flex-col gap-2 text-meta text-gray-600 dark:text-gray-300 sm:col-span-2">
      <span className="flex items-center justify-between gap-2"><span>{t(LABELS[field])}</span><output className="tabular-nums">{percent}%</output></span>
      <input type="range" aria-label={t(LABELS[field])} aria-valuetext={`${percent}%`} min={0} max={100} step={1} value={percent} onChange={event => onChange(Number(event.target.value) / 100)} className="mobile-touch w-full accent-[var(--nai-accent)]" />
    </label>;
  }
  const unit = ['fontSize', 'controlHeight', 'controlRadius', 'panelRadius', 'cardRadius', 'toolbarHeight', 'chromeInset', 'blur', 'refraction'].includes(field) ? 'px' : field === 'duration' ? 'ms' : field === 'spacing' ? 'rem' : field === 'letterSpacing' ? 'em' : field === 'saturation' ? '%' : '';
  const valid = draft === '' || (Number.isFinite(Number(draft)) && Number(draft) >= min && Number(draft) <= max);
  return <label className="flex items-center justify-between gap-2 text-meta text-gray-600 dark:text-gray-300"><span>{t(LABELS[field])}{unit && <small className="ml-1 text-micro text-gray-400">{unit}</small>}</span><input type="number" disabled={disabled} aria-label={t(LABELS[field])} aria-invalid={!valid} min={min} max={max} step={step} value={draft} placeholder={String(fallback)} onChange={event => {
    const next = event.target.value;
    setDraft(next);
    if (next === '' || (Number.isFinite(Number(next)) && Number(next) >= min && Number(next) <= max)) onChange(next === '' ? undefined : Number(next));
  }} onBlur={() => setDraft(value === undefined ? '' : String(value))} className="w-24 rounded-lg border border-gray-300 bg-transparent px-2 disabled:opacity-40 aria-invalid:border-red-500 dark:border-gray-600" /></label>;
};

export const AppearanceDetailEditor: React.FC<{ details?: ThemeDetails; onChange: (details: ThemeDetails | undefined) => void }> = ({ details, onChange }) => {
  const [scope, setScope] = useState<'common' | 'light' | 'dark'>('common');
  const [fontDraft, setFontDraft] = useState(details?.fontFamily || '');
  useEffect(() => setFontDraft(details?.fontFamily || ''), [details?.fontFamily]);
  const update = (patch: Partial<ThemeDetails>) => onChange(normalizeThemeDetails({ ...details, ...patch }));
  const values = scope === 'common' ? details : details?.[scope];
  const effective = scope === 'common' ? details : resolveThemeDetails(details, scope === 'dark');
  const updateNumber = (field: ThemeDetailNumber, value: number | undefined) => update(scope === 'common' ? { [field]: value } : { [scope]: { ...details?.[scope], [field]: value } });
  return <details className="mt-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
    <summary className="cursor-pointer text-xs font-bold text-gray-700 dark:text-gray-200">{t('控件、排版与玻璃细节')}</summary>
    <label className="mt-3 flex items-center justify-between text-meta text-gray-600 dark:text-gray-300">{t('编辑范围')}<select aria-label={t('编辑范围')} value={scope} onChange={event => setScope(event.target.value as typeof scope)} className="rounded-lg border border-gray-300 bg-transparent px-2 dark:border-gray-600"><option value="common">{t('共用')}</option><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option></select></label>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <DetailNumber field="globalOpacity" value={values?.globalOpacity} inheritedValue={effective?.globalOpacity ?? effective?.opacity ?? .85} onChange={value => updateNumber('globalOpacity', value)} />
      <div className="flex items-center justify-between gap-2 text-meta text-gray-500 dark:text-gray-400 sm:col-span-2">
        <span>{t('覆盖分层透明度（实验室面板独立）')}</span>
        {values?.globalOpacity !== undefined && <button type="button" onClick={() => updateNumber('globalOpacity', undefined)} className="mobile-touch shrink-0 text-indigo-600 dark:text-indigo-300">{t('清除全局覆盖')}</button>}
      </div>
      <DetailNumber field="labEditorOpacity" value={values?.labEditorOpacity} inheritedValue={scope === 'common' ? undefined : resolveThemeDetails(details, scope === 'dark')?.labEditorOpacity ?? (scope === 'dark' ? .6 : .425)} onChange={value => updateNumber('labEditorOpacity', value)} />
      {scope === 'common' && <><label className="text-meta text-gray-600 dark:text-gray-300">{t('界面字体')}<input aria-label={t('界面字体')} value={fontDraft} placeholder="system-ui, sans-serif" onChange={event => {
        const value = event.target.value;
        setFontDraft(value);
        if (!value || (value === value.trim() && normalizeThemeDetails({ fontFamily: value }))) update({ fontFamily: value || undefined });
      }} onBlur={() => setFontDraft(details?.fontFamily || '')} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-2 dark:border-gray-600" /></label>
      <label className="text-meta text-gray-600 dark:text-gray-300">{t('材质效果')}<select aria-label={t('材质效果')} value={details?.material || 'frosted'} onChange={event => update({ material: event.target.value as ThemeDetails['material'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-2 dark:border-gray-600"><option value="frosted">{t('磨砂')}</option><option value="glass">{t('液态玻璃')}</option></select></label>
      <label className="text-meta text-gray-600 dark:text-gray-300">{t('控件风格')}<select aria-label={t('控件风格')} value={details?.controlStyle || 'outlined'} onChange={event => update({ controlStyle: event.target.value as ThemeDetails['controlStyle'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-2 dark:border-gray-600"><option value="outlined">{t('描边')}</option><option value="filled">{t('填充')}</option></select></label></>}
      {scope !== 'common' && <label className="flex items-center justify-between text-meta text-gray-600 dark:text-gray-300">{t('强调色')}<input type="color" aria-label={t('版本强调色')} value={details?.[scope]?.accentColor || '#007aff'} onChange={event => update({ [scope]: { ...details?.[scope], accentColor: event.target.value } })} /></label>}
      {(Object.keys(THEME_DETAIL_NUMBERS) as ThemeDetailNumber[]).filter(key => key !== 'labEditorOpacity' && key !== 'globalOpacity').map(key => <DetailNumber key={`${scope}-${key}`} field={key} value={values?.[key]} disabled={effective?.globalOpacity !== undefined && ['opacity', 'sidebarOpacity', 'toolbarOpacity', 'panelOpacity'].includes(key)} onChange={value => updateNumber(key, value)} />)}
      {scope === 'common' && <label className="text-meta text-gray-600 dark:text-gray-300">{t('过渡曲线')}<select aria-label={t('过渡曲线')} value={details?.motionCurve || 'smooth'} onChange={event => update({ motionCurve: event.target.value as ThemeDetails['motionCurve'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-2 dark:border-gray-600"><option value="smooth">{t('平滑')}</option><option value="spring">{t('弹性')}</option></select></label>}
    </div>
    {scope !== 'common' && details?.[scope] && <button type="button" onClick={() => update({ [scope]: undefined })} className="mobile-touch mt-2 rounded-lg px-2 py-1 text-meta text-indigo-600 dark:text-indigo-300">{t('清除当前明暗覆盖')}</button>}
    {details && <button type="button" onClick={() => onChange(undefined)} className="mobile-touch mt-2 rounded-lg px-2 py-1 text-meta text-indigo-600 dark:text-indigo-300">{t('恢复基础控件外观')}</button>}
  </details>;
};
