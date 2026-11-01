import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import { t, useLanguage } from '../services/i18n';
import {
  getDefaultPromptLibraryCoverTemplate, validatePromptLibraryCoverTemplate, type PromptLibraryCoverTemplate,
} from '../services/promptLibraryCoverTemplate';
import { getPromptLibraryCoverTemplate, savePromptLibraryCoverTemplate } from '../services/promptLibraryCoverApi';
import { getNaiRuntimeConfig, useNaiRuntime } from '../services/naiRuntime';
import type { RollTemplate } from '../services/styleRoll';
import GenerationTemplateEditor from './GenerationTemplateEditor';
import { ImageActivityContext } from './SmartImage';

interface PromptLibraryCoverSettingsDialogProps {
  generateAfterSave: boolean;
  enforceFreeStepLimit?: boolean;
  onSaved: (template: PromptLibraryCoverTemplate) => void;
  onClose: () => void;
}

export const PromptLibraryCoverSettingsDialog: React.FC<PromptLibraryCoverSettingsDialogProps> = props => (
  <ImagePreviewPortal><PromptLibraryCoverSettingsDialogContent {...props} /></ImagePreviewPortal>
);

const PromptLibraryCoverSettingsDialogContent: React.FC<PromptLibraryCoverSettingsDialogProps> = ({
  generateAfterSave, enforceFreeStepLimit = true, onSaved, onClose,
}) => {
  useLanguage();
  const pageActive = useContext(ImageActivityContext);
  const runtime = useNaiRuntime();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const [template, setTemplate] = useState<RollTemplate>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const dialogRef = useModalA11y<HTMLDivElement>(pageActive);
  const busy = saving || presetBusy;
  const recommendedTemplate = useMemo(() => getDefaultPromptLibraryCoverTemplate(runtime), [runtime]);
  const validationError = useMemo(() => {
    if (!template) return '';
    try {
      validatePromptLibraryCoverTemplate(template as PromptLibraryCoverTemplate);
      return '';
    } catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
  }, [template]);
  const close = useMobileHistoryLayer(pageActive, () => { if (busy) return false; onClose(); }, 'prompt-library-cover-settings');

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setTemplate(undefined);
    setLoading(true);
    setError('');
    void getPromptLibraryCoverTemplate().then(saved => {
      return getNaiRuntimeConfig().catch(() => runtimeRef.current).then(latestRuntime => {
        if (cancelled) return;
        setTemplate(saved || getDefaultPromptLibraryCoverTemplate(latestRuntime));
      });
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; active.current = false; };
  }, [retry]);

  useEffect(() => {
    if (!pageActive) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialogRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [pageActive, close, dialogRef]);

  const save = async () => {
    if (!template || busy || validationError) return;
    setSaving(true);
    setError('');
    try {
      const value = template as PromptLibraryCoverTemplate;
      validatePromptLibraryCoverTemplate(value);
      if (active.current) {
        await savePromptLibraryCoverTemplate(value);
        if (active.current) onSaved(value);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (active.current) setSaving(false); }
  };

  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('封面生成设置')} hidden={!pageActive} className={pageActive ? 'fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm' : 'hidden'} onMouseDown={event => { if (pageActive && event.target === event.currentTarget && isTopmostModal(dialogRef.current)) close(); }}>
    <div className="appearance-panel flex h-[min(800px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold dark:text-white">{t('封面生成设置')}</h2>
          <p className="mt-1 break-words text-xs text-gray-500">{t('用 {content} 插入条目正文；模板负面与参数不随条目变化')}</p>
        </div>
        <button type="button" aria-label={t('关闭')} disabled={busy} onClick={close} className="mobile-touch rounded-lg p-2 text-gray-500"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {loading ? <p className="text-sm text-gray-500">{t('正在读取配置…')}</p> : template && <fieldset disabled={saving} className="min-w-0"><GenerationTemplateEditor
          value={template}
          onChange={value => setTemplate(value)}
          disabled={saving}
          enforceFreeStepLimit={enforceFreeStepLimit}
          recommendedTemplate={recommendedTemplate}
          promptLabel="公共提示词（{content} 为条目正文位置）"
          characterHint="自动接在正文之后；也可在公共提示词里用 {character} 指定位置"
          onBusyChange={setPresetBusy}
        /></fieldset>}
        {validationError && <p role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{t(validationError)}</p>}
        {error && <p role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{t(error)}{!template && <button type="button" disabled={busy} className="mobile-touch ml-2 underline" onClick={() => setRetry(value => value + 1)}>{t('重试读取配置')}</button>}</p>}
      </div>
      <footer className="flex flex-none justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
        <button type="button" disabled={busy} onClick={close} className="mobile-touch rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:text-gray-300">{t('取消')}</button>
        <button type="button" disabled={loading || busy || !template || Boolean(validationError)} data-agent-action={generateAfterSave ? 'business' : undefined} onClick={() => void save()} className="mobile-touch rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? t('保存中…') : generateAfterSave ? t('保存并生成封面') : t('保存配置')}</button>
      </footer>
    </div>
  </div>;
};
