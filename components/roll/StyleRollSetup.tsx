import { PromptLibraryWorkspace } from '../PromptLibraryAccess';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { mergePromptFields } from '../../services/promptUtils';
import React, { useEffect, useState } from 'react';
import { Dice5, LockKeyhole, Sparkles, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { getRollArtistRange, getRollPinnedArtists, validateRollExperiment, DEFAULT_ROLL_NEGATIVE, DEFAULT_ROLL_PROMPT, LEGACY_ROLL_PROMPTS, type RollExperiment } from '../../services/styleRoll';
import { StyleRollArtistDialog } from './StyleRollArtistDialog';
import { StyleRollRuleFields } from './StyleRollRuleFields';
import type { ArtistDictionaryEntry } from '../../services/tagDictionary';
import { rollSeedFromChain } from '../../services/styleRollSeed';
import { ChainEditorParams } from '../ChainEditorParams';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

const field = 'mobile-touch min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950';

interface Props { initial: RollExperiment; chains: PromptChain[]; libraryCount?: number; libraryLoading?: boolean; blockedTags?: string[]; library?: ArtistDictionaryEntry[]; onBlockedChange: (tags: string[]) => Promise<void>; enforceFreeStepLimit: boolean; onSave: (value: RollExperiment) => Promise<void>; onClose: () => void }

export const StyleRollSetup: React.FC<Props> = props => <ImagePreviewPortal><SetupForm {...props} /></ImagePreviewPortal>;

const SetupForm: React.FC<Props> = ({ initial, chains, libraryCount = 0, libraryLoading = false, blockedTags = [], library = [], onBlockedChange, enforceFreeStepLimit, onSave, onClose }) => {
  useLanguage();
  const legacyUpgraded = !initial.candidates.length && LEGACY_ROLL_PROMPTS.includes(initial.template.prompt) && !initial.template.negativePrompt.trim();
  const [draft, setDraft] = useState(() => {
    const value = structuredClone({ ...initial, drawPlan: undefined, pinnedArtists: getRollPinnedArtists(initial), rules: { ...initial.rules, ...getRollArtistRange(initial) } });
    if (legacyUpgraded) { value.template.prompt = DEFAULT_ROLL_PROMPT; value.template.negativePrompt = DEFAULT_ROLL_NEGATIVE; }
    return value;
  });
  const [artistDialogOpen, setArtistDialogOpen] = useState(false);
  const [section, setSection] = useState<'pool' | 'template'>('pool');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dialog = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'roll-setup');
  const frozen = draft.candidates.length > 0;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [close, dialog]);
  const importChain = (id: string) => {
    const chain = chains.find(item => item.id === id); if (!chain) return;
    try {
      const seed = rollSeedFromChain(chain, draft.template.params.seed);
      setDraft({ ...draft, template: seed.template, artists: seed.artists, pinnedArtists: seed.pinnedArtists, rules: seed.rules });
      setError('');
    } catch (cause) { setError((cause as Error).message); }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      validateRollExperiment(draft); await onSave(draft); onClose();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <PromptLibraryWorkspace active={!frozen && !busy} state={{ base: draft.template.prompt, subject: '', negative: draft.template.negativePrompt, params: draft.template.params, classified: false }} onChange={next => setDraft({ ...draft, template: { ...draft.template, prompt: mergePromptFields(next.base, next.subject), negativePrompt: next.negative, params: next.params } })}><div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('Roll 串配置')} className="appearance-panel flex h-[min(800px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 p-3 dark:border-gray-800">
        <input aria-label={t('记录名称')} className={`${field} flex-1 font-semibold`} value={draft.name} maxLength={120} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} />
        <IconButton label="关闭" disabled={busy} onClick={close}><X /></IconButton>
      </header>
      <div className="flex flex-none gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <ToolbarButton active={section === 'pool'} onClick={() => setSection('pool')}>{t('抽取设置')}</ToolbarButton>
        <ToolbarButton active={section === 'template'} onClick={() => setSection('template')}>{t('生成配置')}</ToolbarButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {section === 'pool' ? <div className="space-y-4">
          <p role="status" className="text-sm text-gray-500">{libraryLoading ? t('正在读取画师词库…') : t('从画师库自动抽取 · {0} 位画师', [libraryCount])}</p>
          <StyleRollRuleFields rules={draft.rules} disabled={busy} onChange={rules => setDraft({ ...draft, rules })} />
          <ToolbarButton disabled={busy} onClick={() => setArtistDialogOpen(true)}>{t('管理画师与偏好')} · {t('固定 {0} 位', [draft.pinnedArtists?.length ?? 0])}</ToolbarButton>
        </div> : <div className="space-y-4">
          {frozen && <p className="flex items-center gap-2 text-xs text-gray-500"><LockKeyhole className="h-4 w-4" />{t('配置已随候选固定；修改模型、提示词或 Seed 请新建画风记录。')}</p>}
          {!frozen && <label className="block text-xs font-semibold">{t('载入风格串')}<select aria-label={t('载入生成配置')} className={`${field} mt-1`} value="" onChange={event => importChain(event.target.value)}><option value="">{t('选择已有风格串')}</option>{chains.filter(chain => chain.type === 'style').map(chain => <option key={chain.id} value={chain.id}>{chain.name}</option>)}</select></label>}
          {legacyUpgraded && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300">{t('已把旧的默认提示词换成质量词模板，保存后生效。')}</p>}
          {!frozen && <div className="flex flex-wrap gap-2"><ToolbarButton disabled={busy} onClick={() => setDraft({ ...draft, template: { ...draft.template, prompt: DEFAULT_ROLL_PROMPT, negativePrompt: DEFAULT_ROLL_NEGATIVE } })}><Sparkles />{t('套用常用质量词')}</ToolbarButton></div>}
          <label className="block text-xs font-semibold">{t('公共提示词（{style} 为画风位置）')}<TagAutocompleteTextarea aria-label={t('公共提示词')} showTranslations={false} className={`${field} mt-1 min-h-28 resize-y font-mono`} value={draft.template.prompt} disabled={busy || frozen} onValueChange={value => setDraft({ ...draft, template: { ...draft.template, prompt: value } })} /></label>
          <label className="block text-xs font-semibold">{t('角色提示词（可选）')}<TagAutocompleteTextarea libraryField={{ textOnly: true }} showTranslations={false} aria-label={t('角色提示词（可选）')} className={`${field} mt-1 min-h-20 resize-y font-mono`} value={draft.template.characterPrompt || ''} disabled={busy || frozen} onValueChange={value => setDraft({ ...draft, template: { ...draft.template, characterPrompt: value } })} /><span className="mt-1 block text-micro font-normal text-gray-400">{t('自动接在画师串之后；也可在公共提示词里用 {character} 指定位置')}</span></label>
          <label className="block text-xs font-semibold">{t('负面提示词')}<textarea className={`${field} mt-1 min-h-20 resize-y font-mono`} value={draft.template.negativePrompt} disabled={busy || frozen} onChange={event => setDraft({ ...draft, template: { ...draft.template, negativePrompt: event.target.value } })} /></label>
          <ChainEditorParams params={draft.template.params} prompt={draft.template.prompt} setParams={params => setDraft({ ...draft, template: { ...draft.template, params } })} canEdit={!busy && !frozen} markChange={() => {}} enforceFreeStepLimit={enforceFreeStepLimit} />
          {!frozen && <div className="flex flex-wrap gap-2">
            <ToolbarButton disabled={busy} onClick={() => setDraft({ ...draft, template: { ...draft.template, params: { ...draft.template.params, seed: crypto.getRandomValues(new Uint32Array(1))[0] } } })}><Dice5 />{t('换一个固定 Seed')}</ToolbarButton>
          </div>}
          {!!draft.template.params.characters?.length && <p className="text-xs text-gray-500">{t('保留 {0} 个角色的完整提示词与位置', [draft.template.params.characters.length])}</p>}
        </div>}
      </div>
      <footer className="flex flex-none items-center justify-end gap-3 border-t border-gray-200 p-3 dark:border-gray-800">
        {error && <p role="alert" className="min-w-0 flex-1 text-xs text-red-500">{t(error)}</p>}
        <ToolbarButton disabled={busy} onClick={close}>{t('取消')}</ToolbarButton>
        <ToolbarButton className="!border-emerald-600 !bg-emerald-700 !text-white" disabled={busy} onClick={() => void save()}>{t(busy ? '正在保存…' : '保存配置')}</ToolbarButton>
      </footer>
      {artistDialogOpen && <StyleRollArtistDialog library={library} loading={libraryLoading} pinned={draft.pinnedArtists ?? []} onPinnedChange={pinnedArtists => setDraft(current => ({ ...current, pinnedArtists }))} blocked={blockedTags} onBlockedChange={onBlockedChange} excluded={draft.artists.filter(artist => artist.excluded).map(artist => artist.tag)} onExcludedChange={tags => setDraft(current => ({ ...current, artists: current.artists.map(artist => ({ ...artist, excluded: tags.includes(artist.tag) })) }))} sampledOnly={draft.sampledOnly ?? false} onSampledOnlyChange={sampledOnly => setDraft(current => ({ ...current, sampledOnly }))} rules={draft.rules} onRulesChange={rules => setDraft(current => ({ ...current, rules }))} onClose={() => setArtistDialogOpen(false)} />}

    </div>
  </div></PromptLibraryWorkspace>;
};
