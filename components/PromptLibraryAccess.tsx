import { PromptPurposePicker } from './PromptPurposePicker';
import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES, getEntryPurposes, promptPurposeLabel, type PromptPurposeId } from '../services/promptPurposes.mjs';
import { promptLibraryCategoryLabel, type PromptLibraryCategoryTreeState } from '../services/promptLibraryCategoryTree';
import { promptLibraryCategoryNames } from '../services/promptLibraryCategories';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, BookmarkPlus, Dice5, RotateCcw, X } from 'lucide-react';
import type { NAIParams, PromptChain } from '../types';
import { t } from '../services/i18n';
import { contentRead, isContentRecord, type RollRow } from '../services/contentRoll';
import { parsePromptLibraryTags, applyLibraryText, createCombinationData, createFragmentData, fragmentKindOf, FRAGMENT_LABELS, libraryEntryText, librarySectionOf, workspacePicks, type PromptFragmentKind, type PromptLibraryField, type PromptLibrarySection } from '../services/promptLibraryEntries';
import { applyLibrarySelection, applyRollSelection, planLibrarySelection, type LibraryCompletionEdit, type PromptLibraryWorkspaceState, type RollApplyReceipt } from '../services/promptLibraryApply';
import { prepareCollectedPrompt } from '../services/collectedPrompt';
import type { PromptApplyMode } from '../services/promptApply';
import type { ContentRollTarget, ContentRollEntryTarget } from '../services/contentRollApply';
import { IconButton, ToolbarButton, ToolbarActionRow, WorkspacePageState, PageSpinner } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageActivityContext } from './SmartImage';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import { ContentRollWorkspace } from './ContentRollWorkspace';
import { CollectionTagInput } from './inspiration/CollectionControls';
import { PromptCaptureDialog } from './PromptCaptureDialog';
import { resolvePromptSections } from '../services/labWorkspace';
import { CHARACTER_SECTION_KEYS, compileCharacterContent } from '../services/characterPrompts';
import { getEditableGlobalPrompt, getEditableGlobalNegative, mergePromptFields } from '../services/promptUtils';
import { createUuid } from '../services/id';
import { PromptLibraryDirectoryPicker } from './PromptLibraryDirectoryPicker';
import { getPromptLibraryEntryDirectoryIds, LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, selectPromptLibraryDirectoryEntries, type PromptLibraryTreeState } from '../services/promptLibraryDirectories';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { LAB_PICTURE_PURPOSES, LAB_SUBJECT_PURPOSES } from '../services/labPromptLayout';
import { diffPromptText } from '../services/agentPromptChanges.mjs';

export interface PromptLibraryReadState {
  chainsLoading?: boolean;
  chainsError?: string;
  onRetryChains?: () => void;
}

export function PromptLibraryReadStatus({ chainsLoading, chainsError, onRetryChains }: PromptLibraryReadState) {
  if (chainsLoading) return <WorkspacePageState className="py-8"><PageSpinner label={t('加载中…')} /></WorkspacePageState>;
  if (!chainsError) return null;
  return <WorkspacePageState role="alert" className="items-center gap-2 py-8 text-center text-sm text-gray-500"><span>{t(chainsError)}</span>{onRetryChains && <ToolbarButton onClick={onRetryChains}>{t('重试')}</ToolbarButton>}</WorkspacePageState>;
}

interface LibraryAccess extends PromptLibraryReadState {
  chains: PromptChain[];
  categoryNames?: string[];
  categoryTree?: PromptLibraryCategoryTreeState;
  directories?: PromptLibraryTreeState;
  directoriesError?: string;
  reloadDirectories?: () => Promise<void>;
  onCreateDirectory?: (parentId: string | null) => void;
  onRenameDirectory?: (id: string) => void;
  onDeleteDirectory?: (id: string) => void;
  onMoveDirectory?: (id: string, parentId: string | null) => void;
  directoriesBusy?: boolean;
  save: (data: Partial<PromptChain>) => Promise<void>;
  useEntry?: (entry: PromptChain) => void;
  requestedEntry?: PromptChain | null;
  clearRequest?: () => void;
  registerWorkspace?: (access: WorkspaceAccess | null) => void;
}
export const PromptLibraryContext = createContext<LibraryAccess | null>(null);
export const PromptLibraryRequestEnabledContext = createContext(false);
export const usePromptLibrary = () => useContext(PromptLibraryContext);
function DirectoryStatus() {
  const library = usePromptLibrary();
  if (!library?.reloadDirectories || library.directories && !library.directoriesError) return null;
  return <p role={library.directoriesError ? 'alert' : 'status'} className="text-sm text-gray-500">{library.directoriesError || t('正在读取目录…')}{library.directoriesError && <ToolbarButton onClick={() => void library.reloadDirectories?.().catch(() => {})}>{t('重试')}</ToolbarButton>}</p>;
}
export interface WorkspaceAccess { state: PromptLibraryWorkspaceState; change: (next: PromptLibraryWorkspaceState) => void | Promise<void>; canUndo: boolean; undo: () => void;
  rollReceipt?: RollApplyReceipt; applyRoll?: (picks: Record<string, RollRow>, target: ContentRollTarget) => Promise<string[]>;
}
const WorkspaceContext = createContext<WorkspaceAccess | null>(null);

export function PromptLibraryWorkspace({ state, onChange, active = true, register = false, onExternalChange, children }: {
  state: PromptLibraryWorkspaceState; onChange: WorkspaceAccess['change']; active?: boolean; register?: boolean; onExternalChange?: () => void | Promise<void>; children: React.ReactNode;
}) {
  const library = usePromptLibrary();
  const requestEnabled = useContext(PromptLibraryRequestEnabledContext);
  const runtime = useNaiRuntime();
  const [requested, setRequested] = useState<PromptChain | null>(null);
  const [rollReceipt, setRollReceipt] = useState<RollApplyReceipt>();
  const [lastChange, setLastChange] = useState<{ before: PromptLibraryWorkspaceState; after: PromptLibraryWorkspaceState; receiptBefore?: RollApplyReceipt } | null>(null);
  const canUndo = !!lastChange && state.params === lastChange.after.params && state.base === lastChange.after.base && state.subject === lastChange.after.subject && state.negative === lastChange.after.negative && state.classified === lastChange.after.classified;
  const latest = useRef({ state, onChange, onExternalChange, canUndo, lastChange, rollReceipt });
  latest.current = { state, onChange, onExternalChange, canUndo, lastChange, rollReceipt };
  const change = useCallback(async (next: PromptLibraryWorkspaceState) => {
    const current = latest.current;
    await current.onChange(next);
    setLastChange({ before: current.state, after: next, receiptBefore: current.rollReceipt });
  }, []);
  const applyRoll = useCallback(async (picks: Record<string, RollRow>, target: ContentRollTarget) => {
    const current = latest.current;
    const result = applyRollSelection(current.state, picks, target, current.rollReceipt);
    await change(result.state);
    setRollReceipt(result.receipt);
    return result.conflicts;
  }, [change]);
  const externalChange = useCallback(async (next: PromptLibraryWorkspaceState) => {
    await latest.current.onExternalChange?.();
    await change(next);
  }, [change]);
  const undo = useCallback(() => {
    const current = latest.current;
    if (current.canUndo && current.lastChange) {
      void current.onChange(current.lastChange.before);
      setRollReceipt(current.lastChange.receiptBefore);
    }
    setLastChange(null);
  }, []);
  const maxCharacters = getRuntimeNaiModelInfo(state.params.model, runtime).maxCharacters;
  const workspaceState = useMemo(() => ({ params: state.params, base: state.base, subject: state.subject, negative: state.negative, classified: state.classified, maxCharacters }), [state.params, state.base, state.subject, state.negative, state.classified, maxCharacters]);
  const access = useMemo(() => ({ state: workspaceState, change, canUndo, undo, rollReceipt, applyRoll }), [workspaceState, change, canUndo, undo, rollReceipt, applyRoll]);
  const registeredAccess = useMemo(() => ({ ...access, change: externalChange }), [access, externalChange]);
  const registerWorkspace = library?.registerWorkspace;
  useEffect(() => {
    if (requestEnabled && register) registerWorkspace?.(registeredAccess);
  }, [requestEnabled, register, registerWorkspace, registeredAccess]);
  useEffect(() => {
    if (!requestEnabled || !register) return;
    return () => registerWorkspace?.(null);
  }, [requestEnabled, register, registerWorkspace]);
  useEffect(() => {
    if (!active || !requestEnabled || !library?.requestedEntry) return;
    setRequested(library.requestedEntry); library.clearRequest?.();
  }, [active, requestEnabled, library?.requestedEntry]);
  return <WorkspaceContext.Provider value={active ? access : null}>
    {children}
    {active && requested && <PromptLibraryChooser initialEntry={requested} field={{ negative: (requested.params as unknown as Record<string, unknown>)?._promptLibraryPolarity === 'negative' }} value="" onText={() => {}} onClose={() => setRequested(null)} whole />}
  </WorkspaceContext.Provider>;
}

/** 库页确认并写入后才进入实验室，复用字段入口的应用逻辑。 */
export function PromptLibraryUseDialog({ entry, state, onChange, onApplied, onClose }: {
  entry: PromptChain; state: PromptLibraryWorkspaceState;
  onChange: WorkspaceAccess['change']; onApplied: () => void; onClose: () => void;
}) {
  const runtime = useNaiRuntime();
  return <WorkspaceContext.Provider value={{ state: { ...state, maxCharacters: getRuntimeNaiModelInfo(state.params.model, runtime).maxCharacters }, change: onChange, canUndo: false, undo: () => {} }}>
    <PromptLibraryChooser initialEntry={entry} field={{ negative: (entry.params as unknown as Record<string, unknown>)?._promptLibraryPolarity === 'negative' }} value="" onText={() => {}} onClose={onClose} whole onApplied={onApplied} />
  </WorkspaceContext.Provider>;
}

export function LibraryDialog({ title, onClose, children, busy = false, wide = false, caption, historyLayer = true, headerActions, className = '', bodyClassName = 'space-y-3 overflow-y-auto p-4' }: { title: string; onClose: () => void | boolean; children: React.ReactNode; busy?: boolean; wide?: boolean; caption?: React.ReactNode; historyLayer?: boolean; headerActions?: React.ReactNode; className?: string; bodyClassName?: string }) {
  const active = useContext(ImageActivityContext);
  const ref = useModalA11y<HTMLDivElement>(active);
  useMobileHistoryLayer(active && historyLayer, () => { if (busy) return false; return onClose(); }, 'prompt-library');
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => {
      if (!busy && event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(ref.current)) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [active, busy, onClose, ref]);
  return <ImagePreviewPortal><div hidden={!active} className={active ? 'fixed inset-0 z-[1900] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm' : 'hidden'}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(title)} className={`content-library appearance-panel flex max-h-[90dvh] w-full ${wide ? 'max-w-[1400px]' : 'max-w-2xl'} flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 ${className}`}>
      <header data-toolbar-caption-host={caption ? 'true' : undefined} className={`flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700 ${caption ? 'relative' : ''}`}><h2 className="min-w-0 flex-1 truncate font-semibold">{t(title)}</h2>{caption}{headerActions}<IconButton data-agent-action="browse" label="关闭" disabled={busy} onClick={onClose}><X /></IconButton></header>
      <div className={`min-h-0 ${bodyClassName}`}>{children}</div>
    </div>
  </div></ImagePreviewPortal>;
}

const SECTION_LABELS: Record<PromptLibrarySection, string> = { items: '片段', saved: '组合', originals: '原文' };
const MODE_LABELS: Record<PromptApplyMode, string> = { append: '追加', replace: '替换', 'fill-missing': '仅填空白' };

export function PromptLibraryChooser({ value, onText, onClose, field = {}, initialEntry, completion, whole = false, onApplied }: {
  value: string; onText: (value: string) => void; onClose: () => void; field?: PromptLibraryField;
  initialEntry?: PromptChain; completion?: LibraryCompletionEdit; whole?: boolean; onApplied?: () => void;
}) {
  const library = usePromptLibrary();
  const workspace = useContext(WorkspaceContext);
  const [section, setSection] = useState<PromptLibrarySection>(initialEntry ? librarySectionOf(initialEntry) || 'items' : 'items');
  const [kind, setKind] = useState(field.kind || '');
  const [directoryIds, setDirectoryIds] = useState<string[]>(field.directoryId ? [field.directoryId] : field.kind && library?.directories?.nodes.some(node => node.id === LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS[field.kind!]) ? [LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS[field.kind]] : []);
  const [allDirectories, setAllDirectories] = useState(!field.directoryId);
  const [unclassified, setUnclassified] = useState(false);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>(field.purposeId || '');
  const [mode, setMode] = useState<PromptApplyMode>('append');
  const [entry, setEntry] = useState(initialEntry || null);
  const [roleIndex, setRoleIndex] = useState(-1);
  const [targetId, setTargetId] = useState(field.roleId || (field.kind || field.purposeId || initialEntry && !isContentRecord(initialEntry) ? 'global' : 'new'));
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const pending = useRef(false);
  const snapshot = entry && contentRead((entry.params as unknown as Record<string, unknown>)?._rollContentSnapshot);
  const target: ContentRollTarget = targetId === 'global' ? { mode: 'global' } : targetId === 'new' ? { mode: 'new' } : { mode: 'existing', id: targetId };
  const [completionDone, setCompletionDone] = useState(false);
  const structured = !!(workspace && entry && !field.textOnly && !field.negative && (isContentRecord(entry) || !field.kind && !field.directoryId && fragmentKindOf(entry) && getEntryPurposes(entry).length === 1));
  let selection: ReturnType<typeof planLibrarySelection> | null = null;
  let planningError = '';
  if (structured) {
    try { if (snapshot && snapshot.roles.length > 1 && roleIndex < 0) throw new Error('请先选择组合中的角色'); selection = planLibrarySelection(workspace!.state, entry!, target, mode, whole ? {} : field, Math.max(0, roleIndex), completionDone ? undefined : completion, library?.directories); }
    catch (cause) { planningError = (cause as Error).message; }
  }
  const entries = (library?.chains || []).filter(item => librarySectionOf(item) === section);
  const tags = section === 'saved' ? promptLibraryCategoryNames(entries, [...(library?.categoryNames || []), ...(library?.categoryTree?.nodes.map(node => node.name) || [])]) : PROMPT_PURPOSES.map(item => item.id);
  const directoryEntries = library?.directories && section === 'items' && !allDirectories ? unclassified ? entries.filter(item => !getPromptLibraryEntryDirectoryIds(item, library.directories!).length) : selectPromptLibraryDirectoryEntries(entries, library.directories, directoryIds) : entries;
  const shown = directoryEntries.filter(item => (libraryEntryText(item, field).trim() || !field.negative && !field.purposeId && isContentRecord(item)) && (library?.directories || !kind || section !== 'items' || fragmentKindOf(item) === kind) && (!tag || (section === 'saved' ? item.tags?.includes(tag) : getEntryPurposes(item).includes(tag as PromptPurposeId)))
    && [item.name, item.basePrompt, ...(item.tags || []), libraryEntryText(item)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const captionTotal = entries.filter(item => libraryEntryText(item, field).trim() || !field.negative && !field.purposeId && isContentRecord(item)).length;
  const captionFiltered = !!(query || section === 'items' && (library?.directories ? !allDirectories : kind) || tag);
  let currentText = value;
  if (whole && workspace) {
    const current = workspace.state;
    if (target.mode === 'global') {
      currentText = field.negative ? current.classified ? current.negative : Object.entries(current.params._promptSections?.sectionNegatives || {}).reduce((text, [kind, addition]) => (current.params._promptSections as Record<string, unknown>)[kind] ? mergePromptFields(text, addition) : text, current.negative)
        : getEditableGlobalPrompt(current.base, current.subject);
    } else {
      const role = current.params.characters?.find(item => target.mode === 'existing' && item.id === target.id);
      const compiled = role ? compileCharacterContent(role, (current.params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives) : null;
      currentText = (field.negative ? compiled?.negativePrompt : compiled?.prompt) || '';
    }
  }
  const countCaption = (library?.chains.length || 0) > 0 && (shown.length > 0 || !library?.chainsLoading && !library?.chainsError) ? <ToolbarCountCaption>{captionFiltered
    ? t('匹配 {0} 条 · 共 {1} 条', [shown.length, captionTotal])
    : t('共 {0} 条', [captionTotal])}</ToolbarCountCaption> : null;
  const apply = async () => {
    if (!entry || pending.current) return;
    pending.current = true; setApplying(true);
    try {
      if (structured) {
        if (!selection || !selection.plan.written.length) throw new Error(planningError || '这条内容没有适合当前目标的栏位');
        await workspace!.change(applyLibrarySelection(selection)); setCompletionDone(true);
        if (onApplied) { onClose(); onApplied(); } else setEntry(null);
      } else {
        if (completion && value !== completion.value) throw new Error('提示词已改变，请重新选择组合');
        const text = libraryEntryText(entry, field);
        const contentNegative = section === 'items' && !field.negative ? entry.negativePrompt || '' : '';
        const base = completion ? value.slice(0, completion.start) + value.slice(completion.end) : value;
        if (whole && workspace) {
          const current = workspace.state;
          if (target.mode === 'global') {
            const negative = Object.entries(current.params._promptSections?.sectionNegatives || {}).reduce((text, [kind, addition]) => (current.params._promptSections as Record<string, unknown>)[kind] ? mergePromptFields(text, addition) : text, current.negative);
            if (field.negative) await workspace.change({ ...current, negative: applyLibraryText(current.classified ? current.negative : negative, text, mode, true), params: current.classified ? current.params : { ...current.params, _promptSections: { ...current.params._promptSections, sectionNegatives: undefined } } });
            else await workspace.change({ ...current, base: applyLibraryText(getEditableGlobalPrompt(current.base, current.subject), text, mode, section === 'originals'), subject: '', negative: contentNegative.trim() ? applyLibraryText(negative, contentNegative, mode) : negative, params: { ...current.params, _promptSections: {} } });
          } else {
            if (target.mode === 'new' && (current.params.characters?.length || 0) >= (current.maxCharacters ?? getRuntimeNaiModelInfo(current.params.model).maxCharacters)) throw new Error('当前模型的角色数量已达上限');
            const oldRole = current.params.characters?.find(role => target.mode === 'existing' && role.id === target.id);
            if (target.mode === 'existing' && !oldRole) throw new Error('目标角色已不存在，请重新选择');
            const role = oldRole || { id: createUuid(), prompt: '', x: 0.5, y: 0.5 };
            const compiled = compileCharacterContent(role, (current.params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives);
            const nextRole = { ...role, prompt: field.negative ? compiled.prompt : applyLibraryText(compiled.prompt, text, mode, section === 'originals'), negativePrompt: field.negative ? applyLibraryText(compiled.negativePrompt || '', text, mode, true) : contentNegative.trim() ? applyLibraryText(compiled.negativePrompt || '', contentNegative, mode) : compiled.negativePrompt, sections: undefined, sectionNegatives: undefined, sectionMeta: Object.fromEntries(CHARACTER_SECTION_KEYS.map(kind => [kind, { source: 'manual' }])) };
            await workspace.change({ ...current, params: { ...current.params, characters: oldRole ? current.params.characters!.map(item => item.id === role.id ? nextRole : item) : [...(current.params.characters || []), nextRole] } });
          }
          onClose(); onApplied?.();
        } else { onText(completion ? value.slice(0, completion.start) + text + value.slice(completion.end) : applyLibraryText(base, text, mode, section === 'originals')); onClose(); }
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { pending.current = false; setApplying(false); }
  };
  return <LibraryDialog busy={applying} title="使用提示词" onClose={onClose} caption={onApplied ? undefined : countCaption}>
    <DirectoryStatus />
    {!onApplied && <><div className="flex flex-wrap gap-2" role="tablist" aria-label={t('提示词类型')}>{Object.entries(SECTION_LABELS).map(([key, label]) => <ToolbarButton key={key} role="tab" active={section === key} aria-selected={section === key} onClick={() => { setSection(key as PromptLibrarySection); setTag(key === 'saved' ? '' : field.purposeId || ''); setEntry(null); }}>{t(label)}</ToolbarButton>)}</div>
    <input type="search" aria-label={t('搜索提示词库')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜索名称、标签或提示词')} className={TOOLBAR_FIELD_CLASS} />
    <div className="flex gap-2">{section === 'items' && library?.directories && <PromptLibraryDirectoryPicker state={library.directories} selectedIds={directoryIds} onChange={ids => { setDirectoryIds(ids); setUnclassified(false); }} includeAll allSelected={allDirectories} onAllChange={value => { setAllDirectories(value); setUnclassified(false); }} includeUnclassified unclassifiedSelected={unclassified} onUnclassifiedChange={value => { setUnclassified(value); setAllDirectories(false); setDirectoryIds([]); }} />}{section === 'items' && !library?.directories && <select aria-label={t('用途类别')} value={kind} onChange={event => setKind(event.target.value as PromptFragmentKind | '')} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部')}</option>{Object.entries(FRAGMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select>}
      <select aria-label={t(section === 'saved' ? '文件夹' : '用途 Tag')} value={tag} onChange={event => setTag(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部标签')}</option>{section === 'saved' ? tags.map(value => <option key={value} value={value}>{promptLibraryCategoryLabel(library?.categoryTree, value)}</option>) : PROMPT_PURPOSE_GROUPS.map(group => <optgroup key={group.id} label={t(group.label)}>{group.purposes.map(id => <option key={id} value={id}>{t(promptPurposeLabel(id))}</option>)}</optgroup>)}</select></div>
    <div className="max-h-52 space-y-1 overflow-y-auto">{shown.map(item => <button key={item.id} type="button" aria-pressed={entry?.id === item.id} onClick={() => { setEntry(item); setRoleIndex(-1); setError(''); }} className={`w-full rounded-lg border p-2 text-left ${entry?.id === item.id ? 'border-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}><span className="block truncate font-semibold">{item.name}</span><span className="line-clamp-2 break-words font-mono text-xs text-gray-500">{libraryEntryText(item, field)}</span></button>)}{!shown.length && (library?.chainsLoading || library?.chainsError ? <PromptLibraryReadStatus {...library} /> : <p className="text-sm text-gray-500">{t('没有匹配的条目')}</p>)}</div></>}
    {onApplied && entry && <p className="text-sm font-semibold">{entry.name}</p>}
    {entry && <>
      <div role="group" aria-label={t('应用方式')} className="flex gap-2">{Object.entries(MODE_LABELS).map(([key, label]) => <ToolbarButton key={key} active={mode === key} onClick={() => setMode(key as PromptApplyMode)}>{t(label)}</ToolbarButton>)}</div>
      {(structured || whole && workspace) && !field.roleId && !field.kind && !field.purposeId && <label className="block text-sm">{t('目标')}<select aria-label={t('取用目标')} value={targetId} onChange={event => setTargetId(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="global">{t('仅全局栏位')}</option><option value="new">{t('新建角色及全局场景')}</option>{workspace!.state.params.characters?.filter(role => role.enabled !== false).map((role, index) => <option key={role.id} value={role.id}>{t('角色 {0}', [index + 1])}</option>)}</select></label>}
      {snapshot && snapshot.roles.length > 1 && <select aria-label={t('组合中的角色')} value={roleIndex} onChange={event => setRoleIndex(Number(event.target.value))} className={TOOLBAR_FIELD_CLASS}><option value={-1} disabled>{t('请选择角色')}</option>{snapshot.roles.map((role, index) => <option key={role.key} value={index}>{role.name}</option>)}</select>}
      {selection?.plan.rows.filter(row => row.current || row.next).map(row => {
        const negative = row.targetScope === 'global' ? selection.plan.globalNegatives[row.kind] : selection.plan.roleWrites.find(write => write.kind === row.kind)?.negative;
        return <div key={row.itemId || row.kind} className="border-t border-gray-200 pt-2 text-xs dark:border-gray-700"><b>{t(FRAGMENT_LABELS[row.kind as PromptFragmentKind] || row.title)}{row.itemId && row.itemId !== row.kind ? ` · ${t(row.targetScope === 'global' ? '全局' : '角色')}` : ''}</b><p className="whitespace-pre-wrap break-words text-gray-500">{row.current || t('空白')} → {row.action === 'keep' ? row.current : row.next}</p>{negative && <p className="whitespace-pre-wrap break-words text-amber-600 dark:text-amber-400">{t('内容负面：')}{negative}</p>}</div>;
      })}
      {!structured && <><p className="text-xs text-gray-500">{t(whole ? '使用前 → 使用后' : '填入当前输入框')}</p><p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs">{currentText || t('空白')} → {applyLibraryText(currentText, libraryEntryText(entry, field), mode, section === 'originals')}</p></>}
      <ToolbarButton tone="primary" disabled={applying || !!library?.directoriesError || !!library?.reloadDirectories && !library.directories || !!planningError || structured && !selection?.plan.written.length} onClick={() => void apply()}>{t(applying ? '写入中…' : '使用')}</ToolbarButton>
    </>}
    {workspace?.canUndo && <ToolbarButton onClick={workspace.undo}>{t('撤销上次填入')}</ToolbarButton>}
    {(error || planningError) && <p role="alert" className="text-sm text-red-600">{t(error || planningError)}</p>}
  </LibraryDialog>;
}

export function PromptLibrarySaveDialog({ text, field = {}, onClose, initialParams }: { text: string; field?: PromptLibraryField; onClose: () => void; initialParams?: Partial<NAIParams> }) {
  const library = usePromptLibrary();
  const workspace = useContext(WorkspaceContext);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [purposes, setPurposes] = useState<PromptPurposeId[]>(field.purposeId ? [field.purposeId] : []);
  const [category, setCategory] = useState<string>(field.negative ? '' : field.kind || field.directoryId || field.purposeId ? library?.directories ? 'general' : field.kind || 'general' : '');
  const [roleId, setRoleId] = useState(field.roleId || '');
  const [directoryIds, setDirectoryIds] = useState<string[]>(field.directoryId ? [field.directoryId] : []);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const params = initialParams || workspace?.state.params;
  const save = async () => {
    if (!library || pending.current || library.directoriesError || library.reloadDirectories && !library.directories) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (category === 'combination' && params?.characters?.length && !roleId) throw new Error('请选择要保存的角色');
      const data = category === 'combination' && params ? createCombinationData(name, workspacePicks(params, roleId, library.directories))
        : category ? createFragmentData(text, name, library.directories ? 'general' : category as PromptFragmentKind, '', library.directories ? directoryIds : undefined) : prepareCollectedPrompt(text, name);
      if (field.negative) data.params = { ...data.params, _promptLibraryPolarity: 'negative' } as NAIParams;
      if (category !== 'combination') data.params = { ...data.params, _promptLibraryPurposes: purposes } as NAIParams;
      await library.save({ ...data, tags: category === 'combination' ? parsePromptLibraryTags(tags) : [] }); onClose();
    } catch (cause) { setError((cause as Error).message); }
    finally { pending.current = false; setBusy(false); }
  };
  if (!params && !field.negative && library?.reloadDirectories && !library.directories && !library.directoriesError) return <LibraryDialog title="收录到提示词库" onClose={onClose}><DirectoryStatus /></LibraryDialog>;
  if (!params && !field.negative) return <ImagePreviewPortal><div className="fixed inset-0 z-[2000]"><PromptCaptureDialog open initialText={text} initialPurposes={purposes} initialCategory={field.kind || (field.directoryId || field.purposeId ? 'general' : '')} directories={library?.directories} directoriesError={library?.directoriesError} reloadDirectories={library?.reloadDirectories} initialDirectoryIds={field.directoryId ? [field.directoryId] : undefined} onClose={onClose}
    onSave={async (text, name, category, tags, ids, purposes) => {
      if (!library) throw new Error('提示词库尚未就绪');
      await library.save({ ...prepareCollectedPrompt(text, name, category), tags, params: { ...prepareCollectedPrompt(text, name, category).params, _promptLibraryPurposes: purposes || [], ...(ids ? { _promptLibraryDirectoryIds: ids } : {}) } as NAIParams });
    }} /></div></ImagePreviewPortal>;
  return <LibraryDialog title="收录到提示词库" onClose={onClose} busy={busy}>
    <DirectoryStatus />
    <label className="block text-sm">{t('名称（可选）')}<input aria-label={t('名称（可选）')} value={name} onChange={event => setName(event.target.value)} className={TOOLBAR_FIELD_CLASS} /></label>
    <select aria-label={t('保存为')} value={category} disabled={busy} onChange={event => setCategory(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="">{t('原文')}</option>{!field.negative && library?.directories && <option value="general">{t('片段')}</option>}{!field.negative && !library?.directories && Object.entries(FRAGMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{t('片段')} · {t(label)}</option>)}{params && !field.negative && <option value="combination">{t('组合（保存已分栏内容）')}</option>}</select>
    {category && category !== 'combination' && library?.directories && <PromptLibraryDirectoryPicker state={library.directories} selectedIds={directoryIds} onChange={setDirectoryIds} disabled={busy} />}
    {category === 'combination' && !!params?.characters?.length && <select aria-label={t('保存哪个角色')} value={roleId} onChange={event => setRoleId(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="">{t('请选择角色')}</option>{params.characters.map((role, index) => <option key={role.id} value={role.id}>{t('角色 {0}', [index + 1])}</option>)}</select>}
    {category !== 'combination' ? <PromptPurposePicker value={purposes} onChange={setPurposes} disabled={busy} /> : <label className="block text-sm">{t('文件夹')}<CollectionTagInput inlineSuggestions aria-label={t('自定义标签')} value={tags} suggestionLabel={category === 'combination' ? value => promptLibraryCategoryLabel(library?.categoryTree, value) : undefined} suggestions={category === 'combination' ? promptLibraryCategoryNames(library?.chains || [], [...(library?.categoryNames || []), ...(library?.categoryTree?.nodes.map(node => node.name) || [])]) : [...new Set((library?.chains || []).flatMap(chain => chain.tags || []))].sort()} onPick={setTags} onChange={event => setTags(event.target.value)} placeholder={t('用逗号分隔')} disabled={busy} className={TOOLBAR_FIELD_CLASS} /></label>}
    <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-gray-500">{text}</p>
    {error && <p role="alert" className="text-sm text-red-600">{t(error)}</p>}
    <ToolbarButton tone="save" disabled={busy || !!library?.directoriesError || !!library?.reloadDirectories && !library.directories || !text.trim() && category !== 'combination'} onClick={() => void save()}>{t(busy ? '保存中…' : '保存')}</ToolbarButton>
  </LibraryDialog>;
}

export function PromptLibraryCaptureButton({ text, params }: { text: string; params?: Partial<NAIParams> }) {
  const library = usePromptLibrary();
  const [open, setOpen] = useState(false);
  if (!library) return null;
  return <><ToolbarButton disabled={!text.trim()} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }} title={t('收录到提示词库')}><BookmarkPlus /><span>{t('收录提示词')}</span></ToolbarButton>{open && <PromptLibrarySaveDialog text={text} initialParams={params} onClose={() => setOpen(false)} />}</>;
}

export function PromptLibraryFieldActions({ value, onText, field, disabled }: { value: string; onText: (text: string) => void; field?: PromptLibraryField; disabled?: boolean }) {
  const library = usePromptLibrary();
  const [open, setOpen] = useState<'use' | 'save' | null>(null);
  if (!library) return null;
  return <><IconButton label="使用提示词" disabled={disabled} onClick={() => setOpen('use')}><BookOpen className="h-4 w-4" /></IconButton><IconButton label="收录提示词" disabled={disabled || !value.trim()} onClick={() => setOpen('save')}><BookmarkPlus className="h-4 w-4" /></IconButton>
    {open === 'use' && <PromptLibraryChooser value={value} onText={onText} field={field} onClose={() => setOpen(null)} />}
    {open === 'save' && <PromptLibrarySaveDialog text={value} field={field} onClose={() => setOpen(null)} />}
  </>;
}

export interface PromptToolbarSlot { element: HTMLDivElement; variant: 'icon' | 'menu' }

export function PromptLibraryRandomButton({ roleId, purposes, disabled, fallback, variant = 'toolbar', toolbarSlot: triggerSlot }: { roleId?: string; purposes?: readonly PromptPurposeId[]; disabled?: boolean; fallback?: () => void; variant?: 'toolbar' | 'icon' | 'menu'; toolbarSlot?: PromptToolbarSlot | null }) {
  const library = usePromptLibrary();
  const workspace = useContext(WorkspaceContext);
  const active = useContext(ImageActivityContext);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [rollConflict, setRollConflict] = useState(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const entryTarget = useMemo<ContentRollEntryTarget>(() => roleId ? { mode: 'existing', id: roleId } : { mode: 'global' }, [roleId]);
  if ((!library || !workspace) && !fallback) return null;
  variant = triggerSlot?.variant || variant;
  const onClick = () => { if (library && workspace) setOpen(true); else fallback?.(); };
  const trigger = variant === 'menu' ? <ToolbarActionRow icon={<Dice5 className="h-4 w-4" />} label={t('随机搭配')} disabled={disabled} onClick={onClick} />
    : variant === 'icon' ? <IconButton label={t('随机搭配')} disabled={disabled} onClick={onClick}><Dice5 /></IconButton>
    : <ToolbarButton aria-label={t('随机搭配')} title={t('随机搭配')} disabled={disabled} onClick={onClick}><Dice5 /><span>{t('随机搭配')}</span></ToolbarButton>;
  const placeTrigger = (content: React.ReactNode) => triggerSlot ? createPortal(content, triggerSlot.element) : triggerSlot === null ? null : content;
  if (!library || !workspace) return placeTrigger(trigger);
  const params = { ...workspace.state.params, _promptSections: resolvePromptSections(workspace.state.params._promptSections, workspace.state.subject) };
  return <>{placeTrigger(<>{!roleId && workspace.canUndo && (variant === 'menu'
    ? <ToolbarActionRow icon={<RotateCcw className="h-4 w-4" />} label="撤销上次填入" onClick={workspace.undo} />
    : <IconButton label="撤销上次填入" onClick={workspace.undo}><RotateCcw /></IconButton>)}{trigger}</>)}
    {open && <LibraryDialog wide title="提示词搭配" className="content-roll-dialog" bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden" headerActions={<span className="content-roll-target truncate rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">{roleId ? t('角色 {0}', [String((params.characters || []).findIndex(role => role.id === roleId) + 1)]) : t('全局提示词')}</span>} onClose={() => setOpen(false)}><DirectoryStatus /><div ref={setToolbarSlot} className="content-roll-dialog-tools border-b border-gray-200 dark:border-gray-800" />{!library.directoriesError && (!library.reloadDirectories || library.directories) && <ContentRollWorkspace active={active} chains={library.chains} chainsLoading={library.chainsLoading} chainsError={library.chainsError} onRetryChains={library.onRetryChains} categoryNames={library.categoryNames} categoryTree={library.categoryTree} directories={library.directories} embedded toolbarSlot={toolbarSlot} notify={setNotice} notice={rollConflict ? t('已保留手动修改的内容') : notice}
      playgroundParams={params} entryTarget={entryTarget} allowedPurposes={purposes ?? (roleId ? LAB_SUBJECT_PURPOSES : LAB_PICTURE_PURPOSES)}
      renderApplyPreview={(picks, target) => {
        const result = applyRollSelection(workspace.state, picks, target, workspace.rollReceipt);
        const blocks = roleId ? workspace.state.params.characters?.filter(role => role.id === roleId).flatMap(role => {
          const next = result.state.params.characters?.find(item => item.id === role.id);
          const before = compileCharacterContent(role);
          return [{ key: `${role.id}:positive`, label: t('角色提示词'), before: before.prompt ?? '', after: next?.prompt || '' },
            { key: `${role.id}:negative`, label: t('角色负面提示词'), before: before.negativePrompt ?? '', after: next?.negativePrompt || '' }];
        }) || [] : [{ key: 'global:positive', label: t('全局正面提示词'), before: getEditableGlobalPrompt(workspace.state.base, workspace.state.subject), after: getEditableGlobalPrompt(result.state.base, result.state.subject) },
          { key: 'global:negative', label: t('全局负面提示词'), before: getEditableGlobalNegative(workspace.state.negative, workspace.state.params._promptSections), after: result.state.negative }];
        return <>{blocks.map(block => <div key={block.key} data-content-roll-apply-row={block.key} className="min-w-0"><span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{block.label}</span><p className="mt-1 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-gray-800 dark:text-gray-100">{block.after ? diffPromptText(block.before, block.after).filter(part => part.kind !== 'delete').map((part, index) => <span key={index} data-roll-insert={part.kind === 'insert' || undefined} className={part.kind === 'insert' ? 'text-indigo-600 dark:text-indigo-300' : undefined}>{part.text}</span>) : t('空白')}</p></div>)}{result.conflicts.length > 0 && <p role="status" className="text-xs text-amber-600 dark:text-amber-400">{t('已保留手动修改的内容')}</p>}</>;
      }}
      onApplyRoll={async (_plan, picks) => {
        if (!workspace.applyRoll) return false;
        const conflicts = await workspace.applyRoll(picks, entryTarget);
        setRollConflict(conflicts.length > 0);
        return true;
      }}
      canUndo={workspace.canUndo} onUndoApply={async () => { workspace.undo(); return true; }}
      onSaveRoll={async (name, picks, _seed, _seeds, _copy, tags) => { await library.save(createCombinationData(name, picks, tags)); return name; }} />}
      </LibraryDialog>}
  </>;
}
