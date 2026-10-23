import { PromptLibraryWorkspace } from '../PromptLibraryAccess';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { mergePromptFields } from '../../services/promptUtils';
import React, { useEffect, useState } from 'react';
import { Dice5, LockKeyhole, X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { createDefaultRollTemplate, getRollArtistRange, getRollPinnedArtists, validateRollExperiment, DEFAULT_ROLL_CHARACTER_PROMPT, DEFAULT_ROLL_NEGATIVE, DEFAULT_ROLL_PROMPT, LEGACY_ROLL_PROMPTS, type RollExperiment, type RollPreset } from '../../services/styleRoll';
import { loadRollPresets, saveRollPreset, deleteRollPreset } from '../../services/styleRollApi';
import { useNaiRuntime } from '../../services/naiRuntime';
import { createUuid } from '../../services/id';
import { useConfirmDialog } from '../ConfirmDialog';
import { StyleRollArtistDialog } from './StyleRollArtistDialog';
import { StyleRollRuleFields } from './StyleRollRuleFields';
import type { ArtistDictionaryEntry } from '../../services/tagDictionary';
import { ChainEditorParams } from '../ChainEditorParams';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton, ToolbarSelect } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

const field = 'mobile-touch min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950';

interface Props { initial: RollExperiment; libraryCount?: number; libraryLoading?: boolean; blockedTags?: string[]; library?: ArtistDictionaryEntry[]; onBlockedChange: (tags: string[]) => Promise<void>; enforceFreeStepLimit: boolean; onSave: (value: RollExperiment) => Promise<void>; onClose: () => void }

export const StyleRollSetup: React.FC<Props> = props => <ImagePreviewPortal><SetupForm {...props} /></ImagePreviewPortal>;

const SetupForm: React.FC<Props> = ({ initial, libraryCount = 0, libraryLoading = false, blockedTags = [], library = [], onBlockedChange, enforceFreeStepLimit, onSave, onClose }) => {
  useLanguage();
  const runtime = useNaiRuntime();
  const confirm = useConfirmDialog();
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
  const [presets, setPresets] = useState<RollPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetLoading, setPresetLoading] = useState(true);
  const [presetsReady, setPresetsReady] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState('');
  const editingBusy = busy || presetBusy;
  const selectedPreset = presets.find(preset => preset.id === presetId);
  const loadPresets = async () => {
    setPresetLoading(true); setPresetsReady(false); setPresetError('');
    try { setPresets(await loadRollPresets()); setPresetsReady(true); }
    catch (cause) { setPresetError((cause as Error).message); }
    finally { setPresetLoading(false); }
  };
  useEffect(() => { void loadPresets(); }, []);
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
  const savePreset = async (update: boolean) => {
    if (busy || presetBusy || presetLoading || !presetsReady || !presetName.trim() || (update && !selectedPreset)) return;
    setPresetBusy(true); setPresetError('');
    const now = Date.now();
    const snapshot: RollPreset = { ...(update ? selectedPreset! : { id: createUuid(), revision: 0, createdAt: now }),
      name: presetName.trim(), template: structuredClone(draft.template), updatedAt: now };
    try {
      if (update && !await confirm({ title: t('更新这个 Roll 预设？'), message: t('将用当前提示词与参数覆盖“{0}”，已有记录保持不变。', [selectedPreset!.name]), confirmLabel: t('确认更新') })) return;
      const saved = await saveRollPreset(snapshot);
      setPresets(current => [...current.filter(preset => preset.id !== saved.id), saved]);
      setPresetId(saved.id); setPresetName(saved.name);
    } catch (cause) { setPresetError((cause as Error).message); }
    finally { setPresetBusy(false); }
  };
  const deletePreset = async () => {
    if (!selectedPreset || busy || presetBusy || !presetsReady) return;
    setPresetBusy(true); setPresetError('');
    try {
      if (!await confirm({ title: t('删除这个 Roll 预设？'), message: t('将删除“{0}”，当前配置和已有记录保持不变。', [selectedPreset.name]), confirmLabel: t('确认删除'), tone: 'danger' })) return;
      await deleteRollPreset(selectedPreset);
      setPresets(current => current.filter(preset => preset.id !== selectedPreset.id));
      setPresetId(''); setPresetName('');
    } catch (cause) { setPresetError((cause as Error).message); }
    finally { setPresetBusy(false); }
  };
  return <PromptLibraryWorkspace active={!frozen && !editingBusy} state={{ base: draft.template.prompt, subject: '', negative: draft.template.negativePrompt, params: draft.template.params, classified: false }} onChange={next => setDraft({ ...draft, template: { ...draft.template, prompt: mergePromptFields(next.base, next.subject), negativePrompt: next.negative, params: next.params } })}><div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('Roll 串配置')} className="appearance-panel flex h-[min(800px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 p-3 dark:border-gray-800">
        <input aria-label={t('记录名称')} className={`${field} flex-1 font-semibold`} value={draft.name} maxLength={120} disabled={editingBusy} onChange={event => setDraft({ ...draft, name: event.target.value })} />
        <IconButton label="关闭" disabled={busy || presetBusy} onClick={close}><X /></IconButton>
      </header>
      <div className="flex flex-none gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <ToolbarButton active={section === 'pool'} onClick={() => setSection('pool')}>{t('抽取设置')}</ToolbarButton>
        <ToolbarButton active={section === 'template'} onClick={() => setSection('template')}>{t('生成配置')}</ToolbarButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {section === 'pool' ? <div className="space-y-4">
          <p role="status" className="text-sm text-gray-500">{libraryLoading ? t('正在读取画师词库…') : t('从画师库自动抽取 · {0} 位画师', [libraryCount])}</p>
          <StyleRollRuleFields rules={draft.rules} disabled={editingBusy} onChange={rules => setDraft({ ...draft, rules })} />
          <ToolbarButton disabled={editingBusy} onClick={() => setArtistDialogOpen(true)}>{t('管理画师与偏好')} · {t('固定 {0} 位', [draft.pinnedArtists?.length ?? 0])}</ToolbarButton>
        </div> : <div className="space-y-4">
          {frozen && <p className="flex items-center gap-2 text-xs text-gray-500"><LockKeyhole className="h-4 w-4" />{t('配置已随候选固定；修改模型、提示词或 Seed 请新建画风记录。')}</p>}
          {legacyUpgraded && draft.template.prompt === DEFAULT_ROLL_PROMPT && draft.template.negativePrompt === DEFAULT_ROLL_NEGATIVE && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300">{t('已把旧的默认提示词换成质量词模板，保存后生效。')}</p>}
          <div className="space-y-2">
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
              <ToolbarSelect label={t('生成配置预设')} containerClassName="min-w-0 max-w-full w-full sm:w-56" className="truncate" value={presetId} disabled={editingBusy || frozen} onChange={event => {
                const id = event.target.value;
                const preset = presets.find(item => item.id === id);
                setPresetId(id); setPresetName(preset?.name || '');
                if (id === 'recommended') setDraft(current => ({ ...current, template: structuredClone(createDefaultRollTemplate(runtime)) }));
                else if (preset) setDraft(current => ({ ...current, template: structuredClone(preset.template) }));
              }}>
                <option value="">{t('当前配置')}</option><option value="recommended">{t('推荐质量词与参数')}</option>
                {presets.map(preset => <option key={preset.id} value={preset.id} disabled={!presetsReady}>{preset.name}</option>)}
              </ToolbarSelect>
              <input aria-label={t('预设名称')} placeholder={t('预设名称')} maxLength={120} className={`${field} sm:!w-40 sm:flex-1`} value={presetName} disabled={busy || presetBusy} onChange={event => setPresetName(event.target.value)} />
              <div className="col-span-2 grid min-w-0 grid-cols-3 gap-2 sm:flex">
                <ToolbarButton className="!px-2" disabled={busy || presetBusy || presetLoading || !presetsReady || !presetName.trim()} onClick={() => void savePreset(false)}>{t('另存新预设')}</ToolbarButton>
                <ToolbarButton className="!px-2" disabled={editingBusy || !presetsReady || !selectedPreset || !presetName.trim()} onClick={() => void savePreset(true)}>{t('更新当前预设')}</ToolbarButton>
                <ToolbarButton className="!px-2" disabled={editingBusy || !presetsReady || !selectedPreset} onClick={() => void deletePreset()}>{t('删除当前预设')}</ToolbarButton>
              </div>
            </div>
            {presetLoading && <p role="status" className="text-xs text-gray-500">{t('正在读取 Roll 预设…')}</p>}
            {presetError && <div role="alert" className="flex items-center gap-2 text-xs text-red-500"><span>{t(presetError)}</span><ToolbarButton disabled={busy || presetBusy || presetLoading} onClick={() => void loadPresets()}>{t('重新读取预设')}</ToolbarButton></div>}
          </div>
          <label className="block text-xs font-semibold">{t('公共提示词（{style} 为画风位置）')}<TagAutocompleteTextarea aria-label={t('公共提示词')} showTranslations={false} className={`${field} mt-1 min-h-28 resize-y font-mono`} value={draft.template.prompt} disabled={editingBusy || frozen} onValueChange={value => setDraft({ ...draft, template: { ...draft.template, prompt: value } })} /></label>
          <label className="block text-xs font-semibold">{t('角色提示词（可选）')}<TagAutocompleteTextarea libraryField={{ textOnly: true }} showTranslations={false} aria-label={t('角色提示词（可选）')} className={`${field} mt-1 min-h-20 resize-y font-mono`} value={draft.template.characterPrompt || ''} disabled={editingBusy || frozen} onValueChange={value => setDraft({ ...draft, template: { ...draft.template, characterPrompt: value } })} /><span className="mt-1 block text-micro font-normal text-gray-400">{t('自动接在画师串之后；也可在公共提示词里用 {character} 指定位置')}</span></label>
          <label className="block text-xs font-semibold">{t('负面提示词')}<textarea className={`${field} mt-1 min-h-20 resize-y font-mono`} value={draft.template.negativePrompt} disabled={editingBusy || frozen} onChange={event => setDraft({ ...draft, template: { ...draft.template, negativePrompt: event.target.value } })} /></label>
          <ChainEditorParams params={draft.template.params} prompt={draft.template.prompt} setParams={params => setDraft({ ...draft, template: { ...draft.template, params } })} canEdit={!editingBusy && !frozen} markChange={() => {}} enforceFreeStepLimit={enforceFreeStepLimit} />
          {!frozen && <div className="flex flex-wrap gap-2">
            <ToolbarButton disabled={editingBusy} onClick={() => setDraft({ ...draft, template: { ...draft.template, params: { ...draft.template.params, seed: crypto.getRandomValues(new Uint32Array(1))[0] } } })}><Dice5 />{t('换一个固定 Seed')}</ToolbarButton>
          </div>}
          {!!draft.template.params.characters?.length && <p className="text-xs text-gray-500">{t('保留 {0} 个角色的完整提示词与位置', [draft.template.params.characters.length])}</p>}
        </div>}
      </div>
      <footer className="flex flex-none items-center justify-end gap-3 border-t border-gray-200 p-3 dark:border-gray-800">
        {error && <p role="alert" className="min-w-0 flex-1 text-xs text-red-500">{t(error)}</p>}
        <ToolbarButton disabled={busy || presetBusy} onClick={close}>{t('取消')}</ToolbarButton>
        <ToolbarButton className="!border-emerald-600 !bg-emerald-700 !text-white" disabled={busy || presetBusy} onClick={() => void save()}>{t(busy ? '正在保存…' : '保存配置')}</ToolbarButton>
      </footer>
      {artistDialogOpen && <StyleRollArtistDialog library={library} loading={libraryLoading} pinned={draft.pinnedArtists ?? []} onPinnedChange={pinnedArtists => setDraft(current => ({ ...current, pinnedArtists }))} blocked={blockedTags} onBlockedChange={onBlockedChange} excluded={draft.artists.filter(artist => artist.excluded).map(artist => artist.tag)} onExcludedChange={tags => setDraft(current => ({ ...current, artists: current.artists.map(artist => ({ ...artist, excluded: tags.includes(artist.tag) })) }))} sampledOnly={draft.sampledOnly ?? false} onSampledOnlyChange={sampledOnly => setDraft(current => ({ ...current, sampledOnly }))} rules={draft.rules} onRulesChange={rules => setDraft(current => ({ ...current, rules }))} onClose={() => setArtistDialogOpen(false)} />}

    </div>
  </div></PromptLibraryWorkspace>;
};
