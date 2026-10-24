import GenerationTemplateEditor from '../GenerationTemplateEditor';
import React, { useEffect, useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { getRollArtistRange, getRollPinnedArtists, validateRollExperiment, DEFAULT_ROLL_CHARACTER_PROMPT, DEFAULT_ROLL_NEGATIVE, DEFAULT_ROLL_PROMPT, LEGACY_ROLL_PROMPTS, type RollExperiment } from '../../services/styleRoll';
import { StyleRollArtistDialog } from './StyleRollArtistDialog';
import { StyleRollRuleFields } from './StyleRollRuleFields';
import type { ArtistDictionaryEntry } from '../../services/tagDictionary';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

const field = 'mobile-touch min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950';

interface Props { initial: RollExperiment; libraryCount?: number; libraryLoading?: boolean; blockedTags?: string[]; library?: ArtistDictionaryEntry[]; onBlockedChange: (tags: string[]) => Promise<void>; enforceFreeStepLimit: boolean; onSave: (value: RollExperiment) => Promise<void>; onClose: () => void }

export const StyleRollSetup: React.FC<Props> = props => <ImagePreviewPortal><SetupForm {...props} /></ImagePreviewPortal>;

const SetupForm: React.FC<Props> = ({ initial, libraryCount = 0, libraryLoading = false, blockedTags = [], library = [], onBlockedChange, enforceFreeStepLimit, onSave, onClose }) => {
  useLanguage();
  const legacyUpgraded = !initial.candidates.length && LEGACY_ROLL_PROMPTS.includes(initial.template.prompt) && !initial.template.negativePrompt.trim()
    && initial.template.characterPrompt === undefined && !initial.template.params.characters?.length;
  const [draft, setDraft] = useState(() => {
    const value = structuredClone({ ...initial, drawPlan: undefined, pinnedArtists: getRollPinnedArtists(initial), rules: { ...initial.rules, ...getRollArtistRange(initial) } });
    if (legacyUpgraded) { value.template.prompt = DEFAULT_ROLL_PROMPT; value.template.negativePrompt = DEFAULT_ROLL_NEGATIVE; value.template.characterPrompt = DEFAULT_ROLL_CHARACTER_PROMPT; }
    return value;
  });
  const [artistDialogOpen, setArtistDialogOpen] = useState(false);
  const [section, setSection] = useState<'pool' | 'template'>('pool');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const editingBusy = busy || presetBusy;
  const dialog = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busy || presetBusy) return false; onClose(); }, 'roll-setup');
  const frozen = draft.candidates.length > 0;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [close, dialog]);
  const save = async () => {
    if (busy || presetBusy) return;
    setBusy(true); setError('');
    try {
      validateRollExperiment(draft); await onSave(draft); onClose();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('Roll 串配置')} className="appearance-panel flex h-[min(800px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 p-3 dark:border-gray-800">
        <input aria-label={t('记录名称')} className={`${field} flex-1 font-semibold`} value={draft.name} maxLength={120} disabled={editingBusy} onChange={event => setDraft({ ...draft, name: event.target.value })} />
        <IconButton label="关闭" disabled={busy || presetBusy} onClick={close}><X /></IconButton>
      </header>
      <div className="flex flex-none gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <ToolbarButton disabled={editingBusy} active={section === 'pool'} onClick={() => setSection('pool')}>{t('抽取设置')}</ToolbarButton>
        <ToolbarButton disabled={editingBusy} active={section === 'template'} onClick={() => setSection('template')}>{t('生成配置')}</ToolbarButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {section === 'pool' && <div className="space-y-4">
          <p role="status" className="text-sm text-gray-500">{libraryLoading ? t('正在读取画师词库…') : t('从画师库自动抽取 · {0} 位画师', [libraryCount])}</p>
          <StyleRollRuleFields rules={draft.rules} disabled={editingBusy} onChange={rules => setDraft({ ...draft, rules })} />
          <ToolbarButton disabled={editingBusy} onClick={() => setArtistDialogOpen(true)}>{t('管理画师与偏好')} · {t('固定 {0} 位', [draft.pinnedArtists?.length ?? 0])}</ToolbarButton>
        </div>}
        <div className={section === 'template' ? 'space-y-4' : 'hidden'}>
          {frozen && <p className="flex items-center gap-2 text-xs text-gray-500"><LockKeyhole className="h-4 w-4" />{t('配置已随候选固定；修改模型、提示词或 Seed 请新建画风记录。')}</p>}
          {legacyUpgraded && draft.template.prompt === DEFAULT_ROLL_PROMPT && draft.template.negativePrompt === DEFAULT_ROLL_NEGATIVE && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300">{t('已把旧的默认提示词换成质量词模板，保存后生效。')}</p>}
          <GenerationTemplateEditor value={draft.template} onChange={template => setDraft(current => ({ ...current, template }))} disabled={busy} readOnly={frozen} enforceFreeStepLimit={enforceFreeStepLimit} onBusyChange={setPresetBusy} />
        </div>
      </div>
      <footer className="flex flex-none items-center justify-end gap-3 border-t border-gray-200 p-3 dark:border-gray-800">
        {error && <p role="alert" className="min-w-0 flex-1 text-xs text-red-500">{t(error)}</p>}
        <ToolbarButton disabled={busy || presetBusy} onClick={close}>{t('取消')}</ToolbarButton>
        <ToolbarButton className="!border-emerald-600 !bg-emerald-700 !text-white" disabled={busy || presetBusy} onClick={() => void save()}>{t(busy ? '正在保存…' : '保存配置')}</ToolbarButton>
      </footer>
      {artistDialogOpen && <StyleRollArtistDialog library={library} loading={libraryLoading} pinned={draft.pinnedArtists ?? []} onPinnedChange={pinnedArtists => setDraft(current => ({ ...current, pinnedArtists }))} blocked={blockedTags} onBlockedChange={onBlockedChange} excluded={draft.artists.filter(artist => artist.excluded).map(artist => artist.tag)} onExcludedChange={tags => setDraft(current => ({ ...current, artists: current.artists.map(artist => ({ ...artist, excluded: tags.includes(artist.tag) })) }))} sampledOnly={draft.sampledOnly ?? false} onSampledOnlyChange={sampledOnly => setDraft(current => ({ ...current, sampledOnly }))} rules={draft.rules} onRulesChange={rules => setDraft(current => ({ ...current, rules }))} onClose={() => setArtistDialogOpen(false)} />}

    </div>
  </div>;
};
