import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import { t, useLanguage } from '../services/i18n';
import {
  getArtistSampleData, getDefaultArtistSampleTemplate, normalizeArtistSampleTemplate,
  saveArtistSampleTemplate, validateArtistSampleTemplate, artistSampleModelMatches,
  type ArtistSampleTemplate,
} from '../services/artistSampleDrafts';
import { getNaiRuntimeConfig, useNaiRuntime } from '../services/naiRuntime';
import type { ArtistSamplePack } from '../services/artistSamples';
import type { RollTemplate } from '../services/styleRoll';
import GenerationTemplateEditor from './GenerationTemplateEditor';

export const ArtistSampleSettingsDialog: React.FC<{
  tag?: string;
  pack: ArtistSamplePack;
  generateAfterSave: boolean;
  enforceFreeStepLimit?: boolean;
  onSaved: (template: ArtistSampleTemplate) => void;
  onClose: () => void;
}> = ({ tag, pack, generateAfterSave, enforceFreeStepLimit = true, onSaved, onClose }) => {
  useLanguage();
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
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const busy = saving || presetBusy;
  const allowedModel = (id: string) => artistSampleModelMatches(pack, id);
  const recommendedTemplate = useMemo(() => getDefaultArtistSampleTemplate(pack, runtime), [pack, runtime]);
  const validationError = useMemo(() => {
    if (!template) return '';
    try {
      if (!allowedModel(template.params.model || '')) throw new Error(pack === 'v5' ? '画师样张仅支持 V5 Full' : '样张配置的模型与所选版本不一致');
      validateArtistSampleTemplate(pack, template as ArtistSampleTemplate);
      return '';
    } catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
  }, [pack, template]);
  const close = useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'artist-sample-settings');

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setTemplate(undefined);
    setLoading(true);
    setError('');
    void getArtistSampleData().then(data => {
      return getNaiRuntimeConfig().catch(() => runtimeRef.current).then(latestRuntime => {
        if (cancelled) return;
        const saved = data.templates[pack];
        setTemplate(saved ? normalizeArtistSampleTemplate(saved) : getDefaultArtistSampleTemplate(pack, latestRuntime));
      });
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; active.current = false; };
  }, [pack, retry]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) { event.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [close, dialogRef]);

  const save = async () => {
    if (!template || busy || validationError) return;
    setSaving(true);
    setError('');
    try {
      const value = template as ArtistSampleTemplate;
      validateArtistSampleTemplate(pack, value);
      if (active.current) {
        await saveArtistSampleTemplate(pack, value);
        if (active.current) onSaved(value);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (active.current) setSaving(false); }
  };

  return <ImagePreviewPortal><div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('补图生成设置')} className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="appearance-panel flex h-[min(800px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700"><div className="min-w-0 flex-1"><h2 className="font-bold dark:text-white">{t('补图生成设置')}</h2><p className="mt-1 break-words text-xs text-gray-500">{tag ? `${tag} · ` : ''}NovelAI {pack === 'v45' ? 'V4.5' : 'V5 Full'}</p></div><button type="button" aria-label={t('关闭')} disabled={busy} onClick={close} className="mobile-touch rounded-lg p-2 text-gray-500"><X className="h-4 w-4" /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {loading ? <p className="text-sm text-gray-500">{t('正在读取配置…')}</p> : template && <fieldset disabled={saving} className="min-w-0"><GenerationTemplateEditor
          value={template}
          onChange={value => setTemplate(value)}
          disabled={saving}
          enforceFreeStepLimit={enforceFreeStepLimit}
          recommendedTemplate={recommendedTemplate}
          modelFilter={allowedModel}
          onBusyChange={setPresetBusy}
        /></fieldset>}
        {validationError && <p role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{t(validationError)}</p>}
        {error && <p role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{t(error)}{!template && <button type="button" disabled={busy} className="mobile-touch ml-2 underline" onClick={() => setRetry(value => value + 1)}>{t('重试读取配置')}</button>}</p>}
      </div>
      <footer className="flex flex-none justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700"><button type="button" disabled={busy} onClick={close} className="mobile-touch rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:text-gray-300">{t('取消')}</button><button type="button" disabled={loading || busy || !template || Boolean(validationError)} data-agent-action={generateAfterSave ? 'business' : undefined} onClick={() => void save()} className="mobile-touch rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? t('保存中…') : generateAfterSave ? t('保存并生成样张') : t('保存配置')}</button></footer>
    </div>
  </div></ImagePreviewPortal>;
};
