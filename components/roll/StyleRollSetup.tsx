import React, { useEffect, useState } from 'react';
import { Dice5, LockKeyhole, Plus, Search, Sparkles, Users, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { mergeRollArtists, parseRollArtists, validateRollExperiment, DEFAULT_ROLL_NEGATIVE, DEFAULT_ROLL_PROMPT, LEGACY_ROLL_PROMPTS, ROLL_MAX_ARTISTS, type RollDrawMode, type RollExperiment } from '../../services/styleRoll';
import { StyleRollPartyDialog } from './StyleRollPartyDialog';
import { compilePrompt } from '../../services/promptUtils';
import { parsePromptTags, removePromptTagTokens } from '../../services/tagTranslations';
import { searchArtistDictionary, type ArtistDictionaryEntry } from '../../services/tagDictionary';
import { DEFAULT_NAI_MODEL } from '../../services/naiModels';
import { ChainEditorParams } from '../ChainEditorParams';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

const field = 'mobile-touch min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-950';

interface Props { initial: RollExperiment; chains: PromptChain[]; library?: string[]; libraryCount?: number; libraryLoading?: boolean; blockedTags?: string[]; onBlock?: (tags: string[]) => Promise<void>; enforceFreeStepLimit: boolean; onSave: (value: RollExperiment) => Promise<void>; onClose: () => void }

export const StyleRollSetup: React.FC<Props> = props => <ImagePreviewPortal><SetupForm {...props} /></ImagePreviewPortal>;

const SetupForm: React.FC<Props> = ({ initial, chains, library = [], libraryCount = 0, libraryLoading = false, blockedTags = [], onBlock, enforceFreeStepLimit, onSave, onClose }) => {
  useLanguage();
  const legacyUpgraded = !initial.candidates.length && LEGACY_ROLL_PROMPTS.includes(initial.template.prompt) && !initial.template.negativePrompt.trim();
  const [draft, setDraft] = useState(() => {
    const value = structuredClone(initial);
    if (legacyUpgraded) { value.template.prompt = DEFAULT_ROLL_PROMPT; value.template.negativePrompt = DEFAULT_ROLL_NEGATIVE; }
    return value;
  });
  const [section, setSection] = useState<'pool' | 'template'>('pool');
  const [text, setText] = useState(''), [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<ArtistDictionaryEntry[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const plan = draft.drawPlan ?? { mode: 'random' as const };
  const changeMode = (mode: RollDrawMode) => {
    if (mode === 'fixedWeight') setDraft(current => ({ ...current, drawPlan: { mode }, rules: { ...current.rules, maxWeight: current.rules.minWeight } }));
    else if (mode === 'pinnedArtists') setDraft(current => ({ ...current, drawPlan: { mode, pinnedArtists: current.drawPlan?.pinnedArtists ?? [] } }));
    else setDraft(current => ({ ...current, drawPlan: { mode } }));
  };
  const dialog = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'roll-setup');
  const frozen = draft.candidates.length > 0;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [close, dialog]);
  useEffect(() => {
    let current = true;
    if (!search.trim()) { setSuggestions([]); return; }
    const timer = setTimeout(() => { void searchArtistDictionary(search, 12).then(items => { if (current) setSuggestions(items); }).catch(() => { if (current) setSuggestions([]); }); }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [search]);
  const add = (value: string) => {
    try { const incoming = parseRollArtists(value); setDraft({ ...draft, artists: mergeRollArtists(draft.artists, incoming) }); setText(''); setError(''); }
    catch (cause) { setError((cause as Error).message); }
  };
  const importChain = (id: string) => {
    const chain = chains.find(item => item.id === id); if (!chain) return;
    const prompt = compilePrompt(chain, chain.variableValues?.subject || '');
    const artists = parsePromptTags(prompt).filter(token => /artist\s*:/i.test(prompt.slice(token.start, token.end)));
    if (frozen) { add(artists.map(token => token.displayTag).join('\n')); return; }
    // 只取用明确的 artist: 标签，普通内容和角色参数保持原样。
    const common = removePromptTagTokens(prompt, artists).trim();
    try {
      setDraft({ ...draft, artists: mergeRollArtists(draft.artists, parseRollArtists(artists.map(token => token.displayTag).join('\n'))),
        template: { prompt: `{style}${common ? ', ' + common : ''}`, negativePrompt: chain.negativePrompt,
          params: { ...structuredClone(chain.params), model: chain.params.model || DEFAULT_NAI_MODEL, seed: chain.params.seed === undefined || chain.params.seed < 0 ? draft.template.params.seed : chain.params.seed } } });
      setError('');
    } catch (cause) { setError((cause as Error).message); }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = text.trim() ? { ...draft, artists: mergeRollArtists(draft.artists, parseRollArtists(text)) } : draft;
      validateRollExperiment(next); await onSave(next); onClose();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
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
          <div className="space-y-2">
            <p className="text-xs font-semibold">{t('默认抽取方式')}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {(['random', 'pinnedArtists', 'fixedWeight'] as const).map(mode => <ToolbarButton key={mode} active={plan.mode === mode} onClick={() => changeMode(mode)} className="!px-1 !text-xs">{t(mode === 'random' ? '全随机' : mode === 'pinnedArtists' ? '固定画师' : '固定权重')}</ToolbarButton>)}
            </div>
            {plan.mode === 'pinnedArtists' && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 p-2 dark:bg-gray-800/50">
              <span className="min-w-0 flex-1 text-xs text-gray-500">{plan.pinnedArtists?.length ? t('已固定 {0} 位画师', [plan.pinnedArtists.length]) : t('尚未固定画师，先选择固定画师再随机权重')}</span>
              <ToolbarButton disabled={busy} onClick={() => setPartyOpen(true)}><Users />{t('选择固定画师')}</ToolbarButton>
            </div>}
            {plan.mode === 'fixedWeight' && <p className="text-xs text-gray-500">{t('所有权重固定为 {0}', [draft.rules.minWeight.toFixed(1)])}</p>}
            <p className="text-xs text-gray-400">{t('之后每轮默认使用；在「本轮设置」里可以临时改。')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['minArtists', '最少画师'], ['maxArtists', '最多画师']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold">{t(label)}<input type="number" className={`${field} mt-1 tabular-nums`} value={draft.rules[key]} min={1} max={ROLL_MAX_ARTISTS} step={1} disabled={busy || plan.mode === 'pinnedArtists'} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, [key]: Number(event.target.value) } })} /></label>)}
            {plan.mode === 'fixedWeight'
              ? <label className="text-xs font-semibold">{t('固定权重')}<input aria-label={t('固定权重')} type="number" className={`${field} mt-1 tabular-nums`} value={draft.rules.minWeight} min={0.1} max={3} step={0.1} disabled={busy} onChange={event => { const value = Number(event.target.value); setDraft({ ...draft, rules: { ...draft.rules, minWeight: value, maxWeight: value } }); }} /></label>
              : ([['minWeight', '最低权重'], ['maxWeight', '最高权重']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold">{t(label)}<input type="number" className={`${field} mt-1 tabular-nums`} value={draft.rules[key]} min={0.1} max={3} step={0.1} disabled={busy} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, [key]: Number(event.target.value) } })} /></label>)}
          </div>
          <details className="rounded-xl border border-gray-200 p-3 dark:border-gray-700"><summary className="mobile-touch cursor-pointer text-sm font-semibold">{t('锁定／排除画师（可选）')}</summary><div className="mt-3 space-y-4">
          <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs font-semibold">{t('指定画师（逗号或换行分隔）')}<textarea className={`${field} mt-1 min-h-20 resize-y font-mono`} value={text} onChange={event => setText(event.target.value)} placeholder="artist:..." disabled={busy} /></label><IconButton label="添加画师" disabled={busy || !text.trim()} onClick={() => add(text)}><Plus /></IconButton></div>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" /><input aria-label={t('搜索画师词库')} className={`${field} !pl-9`} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索画师词库')} />
            {!!suggestions.length && <div className="mt-2 flex flex-wrap gap-2">{suggestions.map(artist => <button key={artist.name} type="button" className="mobile-touch rounded-lg border border-gray-200 px-2 py-1 text-xs hover:border-indigo-400 dark:border-gray-700" disabled={busy || draft.artists.some(item => item.tag === artist.name)} onClick={() => add(artist.name)}>{artist.name}{artist.chinese ? ` · ${artist.chinese}` : ''}</button>)}</div>}
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_3rem_3rem] items-center gap-2 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800"><span>{t('画师')}</span><span>{t('锁定权重')}</span><span>{t('锁定')}</span><span>{t('排除')}</span></div>
            {draft.artists.map((artist, index) => <div key={artist.tag} className={`grid grid-cols-[minmax(0,1fr)_4.5rem_3rem_3rem] items-center gap-2 border-t border-gray-100 px-3 py-1 dark:border-gray-800 ${artist.excluded ? 'opacity-50' : ''}`}>
              <span className="min-w-0 truncate text-sm" title={artist.tag}>{artist.tag}</span>
              <input aria-label={t('锁定权重：{0}', [artist.tag])} type="number" className={`${field} !px-2`} min={0.1} max={3} step={0.1} value={artist.weight} disabled={busy || !artist.locked || artist.excluded} onChange={event => setDraft({ ...draft, artists: draft.artists.map((item, i) => i === index ? { ...item, weight: Number(event.target.value) } : item) })} />
              <label className="mobile-touch flex items-center justify-center"><input type="checkbox" aria-label={t('锁定画师：{0}', [artist.tag])} checked={artist.locked} disabled={busy || artist.excluded} onChange={event => setDraft({ ...draft, artists: draft.artists.map((item, i) => i === index ? { ...item, locked: event.target.checked } : item) })} /></label>
              <label className="mobile-touch flex items-center justify-center"><input type="checkbox" aria-label={t('排除画师：{0}', [artist.tag])} checked={artist.excluded} disabled={busy} onChange={event => setDraft({ ...draft, artists: draft.artists.map((item, i) => i === index ? { ...item, excluded: event.target.checked } : item) })} /></label>
            </div>)}
            {!draft.artists.length && <p className="p-6 text-center text-sm text-gray-400">{t('未指定锁定或排除项')}</p>}
          </div>
          </div></details>
        </div> : <div className="space-y-4">
          {frozen && <p className="flex items-center gap-2 text-xs text-gray-500"><LockKeyhole className="h-4 w-4" />{t('配置已随候选固定；修改模型、提示词或 Seed 请新建画风记录。')}</p>}
          {!frozen && <label className="block text-xs font-semibold">{t('载入风格串')}<select aria-label={t('载入生成配置')} className={`${field} mt-1`} value="" onChange={event => importChain(event.target.value)}><option value="">{t('选择已有风格串')}</option>{chains.filter(chain => chain.type === 'style').map(chain => <option key={chain.id} value={chain.id}>{chain.name}</option>)}</select></label>}
          {legacyUpgraded && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300">{t('已把旧的默认提示词换成质量词模板，保存后生效。')}</p>}
          {!frozen && <div className="flex flex-wrap gap-2"><ToolbarButton disabled={busy} onClick={() => setDraft({ ...draft, template: { ...draft.template, prompt: DEFAULT_ROLL_PROMPT, negativePrompt: DEFAULT_ROLL_NEGATIVE } })}><Sparkles />{t('套用常用质量词')}</ToolbarButton></div>}
          <label className="block text-xs font-semibold">{t('公共提示词（{style} 为画风位置）')}<textarea className={`${field} mt-1 min-h-28 resize-y font-mono`} value={draft.template.prompt} disabled={busy || frozen} onChange={event => setDraft({ ...draft, template: { ...draft.template, prompt: event.target.value } })} /></label>
          <label className="block text-xs font-semibold">{t('角色提示词（可选）')}<textarea aria-label={t('角色提示词（可选）')} className={`${field} mt-1 min-h-20 resize-y font-mono`} value={draft.template.characterPrompt || ''} disabled={busy || frozen} onChange={event => setDraft({ ...draft, template: { ...draft.template, characterPrompt: event.target.value } })} /><span className="mt-1 block text-micro font-normal text-gray-400">{t('自动接在画师串之后；也可在公共提示词里用 {character} 指定位置')}</span></label>
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
        <ToolbarButton className="!border-emerald-600 !bg-emerald-600 !text-white" disabled={busy} onClick={() => void save()}>{t(busy ? '正在保存…' : '保存配置')}</ToolbarButton>
      </footer>
      {partyOpen && <StyleRollPartyDialog library={library} count={draft.rules.maxArtists} initial={plan.pinnedArtists ?? []} blocked={blockedTags}
        onBlock={onBlock ?? (async () => {})}
        onSave={tags => setDraft(current => ({ ...current, drawPlan: { mode: 'pinnedArtists', pinnedArtists: tags } }))}
        onClose={() => setPartyOpen(false)} />}
    </div>
  </div>;
};
