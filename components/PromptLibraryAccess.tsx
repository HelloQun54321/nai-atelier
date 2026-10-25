import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, BookmarkPlus, Dice5, RotateCcw, X } from 'lucide-react';
import type { NAIParams, PromptChain } from '../types';
import { t } from '../services/i18n';
import { contentRead, isContentRecord } from '../services/contentRoll';
import { parsePromptLibraryTags, applyLibraryText, createCombinationData, createFragmentData, fragmentKindOf, FRAGMENT_LABELS, libraryEntryText, librarySectionOf, workspacePicks, type PromptFragmentKind, type PromptLibraryField, type PromptLibrarySection } from '../services/promptLibraryEntries';
import { applyLibrarySelection, planLibrarySelection, type LibraryCompletionEdit, type PromptLibraryWorkspaceState } from '../services/promptLibraryApply';
import { prepareCollectedPrompt } from '../services/collectedPrompt';
import type { PromptApplyMode } from '../services/promptApply';
import type { ContentRollTarget, ContentRollEntryTarget } from '../services/contentRollApply';
import { IconButton, ToolbarButton, ToolbarActionRow } from './DesignSystem';
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
import { getEditableGlobalPrompt, mergePromptFields } from '../services/promptUtils';
import { createUuid } from '../services/id';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';

interface LibraryAccess {
  chains: PromptChain[];
  save: (data: Partial<PromptChain>) => Promise<void>;
  useEntry?: (entry: PromptChain) => void;
  requestedEntry?: PromptChain | null;
  clearRequest?: () => void;
  registerWorkspace?: (access: WorkspaceAccess | null) => void;
}
export const PromptLibraryContext = createContext<LibraryAccess | null>(null);
export const PromptLibraryRequestEnabledContext = createContext(false);
export const usePromptLibrary = () => useContext(PromptLibraryContext);
export interface WorkspaceAccess { state: PromptLibraryWorkspaceState; change: (next: PromptLibraryWorkspaceState) => void | Promise<void>; canUndo: boolean; undo: () => void; }
const WorkspaceContext = createContext<WorkspaceAccess | null>(null);

export function PromptLibraryWorkspace({ state, onChange, active = true, register = false, onExternalChange, children }: {
  state: PromptLibraryWorkspaceState; onChange: WorkspaceAccess['change']; active?: boolean; register?: boolean; onExternalChange?: () => void | Promise<void>; children: React.ReactNode;
}) {
  const library = usePromptLibrary();
  const requestEnabled = useContext(PromptLibraryRequestEnabledContext);
  const runtime = useNaiRuntime();
  const [requested, setRequested] = useState<PromptChain | null>(null);
  const [lastChange, setLastChange] = useState<{ before: PromptLibraryWorkspaceState; after: PromptLibraryWorkspaceState } | null>(null);
  const canUndo = !!lastChange && state.params === lastChange.after.params && state.base === lastChange.after.base && state.subject === lastChange.after.subject && state.negative === lastChange.after.negative && state.classified === lastChange.after.classified;
  const latest = useRef({ state, onChange, onExternalChange, canUndo, lastChange });
  latest.current = { state, onChange, onExternalChange, canUndo, lastChange };
  const change = useCallback(async (next: PromptLibraryWorkspaceState) => {
    const current = latest.current;
    await current.onChange(next);
    setLastChange({ before: current.state, after: next });
  }, []);
  const externalChange = useCallback(async (next: PromptLibraryWorkspaceState) => {
    await latest.current.onExternalChange?.();
    await change(next);
  }, [change]);
  const undo = useCallback(() => {
    const current = latest.current;
    if (current.canUndo && current.lastChange) void current.onChange(current.lastChange.before);
    setLastChange(null);
  }, []);
  const maxCharacters = getRuntimeNaiModelInfo(state.params.model, runtime).maxCharacters;
  const workspaceState = useMemo(() => ({ params: state.params, base: state.base, subject: state.subject, negative: state.negative, classified: state.classified, maxCharacters }), [state.params, state.base, state.subject, state.negative, state.classified, maxCharacters]);
  const access = useMemo(() => ({ state: workspaceState, change, canUndo, undo }), [workspaceState, change, canUndo, undo]);
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

export function LibraryDialog({ title, onClose, children, busy = false, wide = false, caption, historyLayer = true }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean; wide?: boolean; caption?: React.ReactNode; historyLayer?: boolean }) {
  const active = useContext(ImageActivityContext);
  const ref = useModalA11y<HTMLDivElement>(active);
  useMobileHistoryLayer(active && historyLayer, () => { if (busy) return false; onClose(); }, 'prompt-library');
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => {
      if (!busy && event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(ref.current)) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [active, busy, onClose, ref]);
  return <ImagePreviewPortal><div hidden={!active} className={active ? 'fixed inset-0 z-[1900] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm' : 'hidden'}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(title)} className={`content-library appearance-panel flex max-h-[90dvh] w-full ${wide ? 'max-w-[1400px]' : 'max-w-2xl'} flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900`}>
      <header data-toolbar-caption-host={caption ? 'true' : undefined} className={`flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700 ${caption ? 'relative' : ''}`}><h2 className="flex-1 font-semibold">{t(title)}</h2>{caption}<IconButton label="关闭" disabled={busy} onClick={onClose}><X /></IconButton></header>
      <div className="space-y-3 overflow-y-auto p-4">{children}</div>
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
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState<PromptApplyMode>('append');
  const [entry, setEntry] = useState(initialEntry || null);
  const [roleIndex, setRoleIndex] = useState(-1);
  const [targetId, setTargetId] = useState(field.roleId || (field.kind || initialEntry && !isContentRecord(initialEntry) ? 'global' : 'new'));
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const pending = useRef(false);
  const snapshot = entry && contentRead((entry.params as unknown as Record<string, unknown>)?._rollContentSnapshot);
  const target: ContentRollTarget = targetId === 'global' ? { mode: 'global' } : targetId === 'new' ? { mode: 'new' } : { mode: 'existing', id: targetId };
  const [completionDone, setCompletionDone] = useState(false);
  const structured = !!(workspace && entry && !field.textOnly && !field.negative && (isContentRecord(entry) || fragmentKindOf(entry) && fragmentKindOf(entry) !== 'general'));
  let selection: ReturnType<typeof planLibrarySelection> | null = null;
  let planningError = '';
  if (structured) {
    try { if (snapshot && snapshot.roles.length > 1 && roleIndex < 0) throw new Error('请先选择组合中的角色'); selection = planLibrarySelection(workspace!.state, entry!, target, mode, whole ? {} : field, Math.max(0, roleIndex), completionDone ? undefined : completion); }
    catch (cause) { planningError = (cause as Error).message; }
  }
  const entries = (library?.chains || []).filter(item => librarySectionOf(item) === section);
  const tags = [...new Set(entries.flatMap(item => item.tags || []))].sort();
  const shown = entries.filter(item => (libraryEntryText(item, field).trim() || !field.negative && isContentRecord(item)) && (!kind || section !== 'items' || fragmentKindOf(item) === kind) && (!tag || item.tags?.includes(tag))
    && [item.name, item.basePrompt, ...(item.tags || []), libraryEntryText(item)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const captionTotal = entries.filter(item => libraryEntryText(item, field).trim() || !field.negative && isContentRecord(item)).length;
  const captionFiltered = !!(query || section === 'items' && kind || tag);
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
  const countCaption = (library?.chains.length || 0) > 0 ? <ToolbarCountCaption>{captionFiltered
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
        const base = completion ? value.slice(0, completion.start) + value.slice(completion.end) : value;
        if (whole && workspace) {
          const current = workspace.state;
          if (target.mode === 'global') {
            const negative = Object.entries(current.params._promptSections?.sectionNegatives || {}).reduce((text, [kind, addition]) => (current.params._promptSections as Record<string, unknown>)[kind] ? mergePromptFields(text, addition) : text, current.negative);
            if (field.negative) await workspace.change({ ...current, negative: applyLibraryText(current.classified ? current.negative : negative, text, mode, true), params: current.classified ? current.params : { ...current.params, _promptSections: { ...current.params._promptSections, sectionNegatives: undefined } } });
            else await workspace.change({ ...current, base: applyLibraryText(getEditableGlobalPrompt(current.base, current.subject), text, mode, section === 'originals'), subject: '', negative, params: { ...current.params, _promptSections: {} } });
          } else {
            if (target.mode === 'new' && (current.params.characters?.length || 0) >= (current.maxCharacters ?? getRuntimeNaiModelInfo(current.params.model).maxCharacters)) throw new Error('当前模型的角色数量已达上限');
            const oldRole = current.params.characters?.find(role => target.mode === 'existing' && role.id === target.id);
            if (target.mode === 'existing' && !oldRole) throw new Error('目标角色已不存在，请重新选择');
            const role = oldRole || { id: createUuid(), prompt: '', x: 0.5, y: 0.5 };
            const compiled = compileCharacterContent(role, (current.params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives);
            const nextRole = { ...role, prompt: field.negative ? compiled.prompt : applyLibraryText(compiled.prompt, text, mode, section === 'originals'), negativePrompt: field.negative ? applyLibraryText(compiled.negativePrompt || '', text, mode, true) : compiled.negativePrompt, sections: undefined, sectionNegatives: undefined, sectionMeta: Object.fromEntries(CHARACTER_SECTION_KEYS.map(kind => [kind, { source: 'manual' }])) };
            await workspace.change({ ...current, params: { ...current.params, characters: oldRole ? current.params.characters!.map(item => item.id === role.id ? nextRole : item) : [...(current.params.characters || []), nextRole] } });
          }
          onClose(); onApplied?.();
        } else { onText(completion ? value.slice(0, completion.start) + text + value.slice(completion.end) : applyLibraryText(base, text, mode, section === 'originals')); onClose(); }
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { pending.current = false; setApplying(false); }
  };
  return <LibraryDialog busy={applying} title="使用提示词" onClose={onClose} caption={onApplied ? undefined : countCaption}>
    {!onApplied && <><div className="flex flex-wrap gap-2" role="tablist" aria-label={t('提示词类型')}>{Object.entries(SECTION_LABELS).map(([key, label]) => <ToolbarButton key={key} role="tab" active={section === key} aria-selected={section === key} onClick={() => { setSection(key as PromptLibrarySection); setEntry(null); }}>{t(label)}</ToolbarButton>)}</div>
    <input type="search" aria-label={t('搜索提示词库')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜索名称、标签或提示词')} className={TOOLBAR_FIELD_CLASS} />
    <div className="flex gap-2">{section === 'items' && <select aria-label={t('用途类别')} value={kind} onChange={event => setKind(event.target.value as PromptFragmentKind | '')} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部')}</option>{Object.entries(FRAGMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select>}
      <select aria-label={t('自定义标签')} value={tag} onChange={event => setTag(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部标签')}</option>{tags.map(value => <option key={value}>{value}</option>)}</select></div>
    <div className="max-h-52 space-y-1 overflow-y-auto">{shown.map(item => <button key={item.id} type="button" aria-pressed={entry?.id === item.id} onClick={() => { setEntry(item); setRoleIndex(-1); setError(''); }} className={`w-full rounded-lg border p-2 text-left ${entry?.id === item.id ? 'border-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}><span className="block truncate font-semibold">{item.name}</span><span className="line-clamp-2 break-words font-mono text-xs text-gray-500">{libraryEntryText(item, field)}</span></button>)}{!shown.length && <p className="text-sm text-gray-500">{t('没有匹配的条目')}</p>}</div></>}
    {onApplied && entry && <p className="text-sm font-semibold">{entry.name}</p>}
    {entry && <>
      <div role="group" aria-label={t('应用方式')} className="flex gap-2">{Object.entries(MODE_LABELS).map(([key, label]) => <ToolbarButton key={key} active={mode === key} onClick={() => setMode(key as PromptApplyMode)}>{t(label)}</ToolbarButton>)}</div>
      {(structured || whole && workspace) && !field.roleId && !field.kind && <label className="block text-sm">{t('目标')}<select aria-label={t('取用目标')} value={targetId} onChange={event => setTargetId(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="global">{t('仅全局栏位')}</option><option value="new">{t('新建角色及全局场景')}</option>{workspace!.state.params.characters?.filter(role => role.enabled !== false).map((role, index) => <option key={role.id} value={role.id}>{t('角色 {0}', [index + 1])}</option>)}</select></label>}
      {snapshot && snapshot.roles.length > 1 && <select aria-label={t('组合中的角色')} value={roleIndex} onChange={event => setRoleIndex(Number(event.target.value))} className={TOOLBAR_FIELD_CLASS}><option value={-1} disabled>{t('请选择角色')}</option>{snapshot.roles.map((role, index) => <option key={role.key} value={index}>{role.name}</option>)}</select>}
      {selection?.plan.rows.filter(row => row.current || row.next).map(row => {
        const negative = selection.plan.roleWrites.find(write => write.kind === row.kind)?.negative ?? selection.plan.globalNegatives[row.kind];
        return <div key={row.kind} className="border-t border-gray-200 pt-2 text-xs dark:border-gray-700"><b>{t(FRAGMENT_LABELS[row.kind as PromptFragmentKind] || row.title)}</b><p className="whitespace-pre-wrap break-words text-gray-500">{row.current || t('空白')} → {row.action === 'keep' ? row.current : row.next}</p>{negative && <p className="whitespace-pre-wrap break-words text-amber-600 dark:text-amber-400">{t('内容负面：')}{negative}</p>}</div>;
      })}
      {!structured && <><p className="text-xs text-gray-500">{t(whole ? '使用前 → 使用后' : '填入当前输入框')}</p><p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs">{currentText || t('空白')} → {applyLibraryText(currentText, libraryEntryText(entry, field), mode, section === 'originals')}</p></>}
      <ToolbarButton tone="primary" disabled={applying || !!planningError || structured && !selection?.plan.written.length} onClick={() => void apply()}>{t(applying ? '写入中…' : '使用')}</ToolbarButton>
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
  const [category, setCategory] = useState<string>(field.negative ? '' : field.kind || '');
  const [roleId, setRoleId] = useState(field.roleId || '');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const params = initialParams || workspace?.state.params;
  const save = async () => {
    if (!library || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (category === 'combination' && params?.characters?.length && !roleId) throw new Error('请选择要保存的角色');
      const data = category === 'combination' && params ? createCombinationData(name, workspacePicks(params, roleId))
        : category ? createFragmentData(text, name, category as PromptFragmentKind) : prepareCollectedPrompt(text, name);
      if (field.negative) data.params = { ...data.params, _promptLibraryPolarity: 'negative' } as NAIParams;
      await library.save({ ...data, tags: parsePromptLibraryTags(tags) }); onClose();
    } catch (cause) { setError((cause as Error).message); }
    finally { pending.current = false; setBusy(false); }
  };
  if (!params && !field.negative) return <ImagePreviewPortal><div className="fixed inset-0 z-[2000]"><PromptCaptureDialog open initialText={text} initialCategory={field.kind || ''} onClose={onClose}
    onSave={async (text, name, category, tags) => {
      if (!library) throw new Error('提示词库尚未就绪');
      await library.save({ ...prepareCollectedPrompt(text, name, category), tags });
    }} /></div></ImagePreviewPortal>;
  return <LibraryDialog title="收录到提示词库" onClose={onClose} busy={busy}>
    <label className="block text-sm">{t('名称（可选）')}<input aria-label={t('名称（可选）')} value={name} onChange={event => setName(event.target.value)} className={TOOLBAR_FIELD_CLASS} /></label>
    <select aria-label={t('保存为')} value={category} disabled={busy} onChange={event => setCategory(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="">{t('原文')}</option>{!field.negative && Object.entries(FRAGMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{t('片段')} · {t(label)}</option>)}{params && !field.negative && <option value="combination">{t('组合（保存已分栏内容）')}</option>}</select>
    {category === 'combination' && !!params?.characters?.length && <select aria-label={t('保存哪个角色')} value={roleId} onChange={event => setRoleId(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="">{t('请选择角色')}</option>{params.characters.map((role, index) => <option key={role.id} value={role.id}>{t('角色 {0}', [index + 1])}</option>)}</select>}
    <label className="block text-sm">{t('自定义标签')}<CollectionTagInput inlineSuggestions aria-label={t('自定义标签')} value={tags} suggestions={[...new Set((library?.chains || []).flatMap(chain => chain.tags || []))].sort()} onPick={setTags} onChange={event => setTags(event.target.value)} placeholder={t('用逗号分隔')} disabled={busy} className={TOOLBAR_FIELD_CLASS} /></label>
    <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-gray-500">{text}</p>
    {error && <p role="alert" className="text-sm text-red-600">{t(error)}</p>}
    <ToolbarButton tone="primary" disabled={busy || !text.trim() && category !== 'combination'} onClick={() => void save()}>{t(busy ? '保存中…' : '保存')}</ToolbarButton>
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

export function PromptLibraryRandomButton({ roleId, disabled, fallback, variant = 'toolbar', toolbarSlot: triggerSlot }: { roleId?: string; disabled?: boolean; fallback?: () => void; variant?: 'toolbar' | 'icon' | 'menu'; toolbarSlot?: PromptToolbarSlot | null }) {
  const library = usePromptLibrary();
  const workspace = useContext(WorkspaceContext);
  const active = useContext(ImageActivityContext);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const entryTarget = useMemo<ContentRollEntryTarget>(() => roleId ? { mode: 'existing', id: roleId } : { mode: 'global' }, [roleId]);
  if (workspace && !workspace.state.classified) return null;
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
    {open && <LibraryDialog wide title="搭配" onClose={() => setOpen(false)}><div ref={setToolbarSlot} className="flex items-center gap-2" /><ContentRollWorkspace active={active} chains={library.chains} embedded toolbarSlot={toolbarSlot} notify={setNotice}
      playgroundParams={params} entryTarget={entryTarget}
      onApplyRoll={async plan => { workspace.change(applyLibrarySelection({ before: workspace.state, params, plan })); return true; }}
      canUndo={workspace.canUndo} onUndoApply={async () => { workspace.undo(); return true; }}
      onSaveRoll={async (name, picks, _seed, _seeds, _copy, tags) => { await library.save(createCombinationData(name, picks, tags)); return name; }} />
      {notice && <p role="status" className="text-xs text-gray-500">{notice}</p>}</LibraryDialog>}
  </>;
}
