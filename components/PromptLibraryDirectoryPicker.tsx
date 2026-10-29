import React from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import { getPromptLibraryDescendantIds, getPromptLibraryDirectoryPath, getPromptLibraryDirectoryTarget, normalizePromptLibraryDirectorySelection, type PromptLibraryDirectoryTarget, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { t, useLanguage } from '../services/i18n';
import { DirectoryTreeChecklist } from './DirectoryTreeChecklist';
import { ToolbarPopover } from './ToolbarPopover';

export const PromptLibraryDirectoryPicker: React.FC<{
  state: PromptLibraryTreeState;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allSelected?: boolean;
  onAllChange?: (selected: boolean) => void;
  disabled?: boolean;
  className?: string;
  popover?: boolean;
  mode?: 'single' | 'multiple';
  includeAll?: boolean;
  includeUnclassified?: boolean;
  unclassifiedSelected?: boolean;
  onUnclassifiedChange?: (selected: boolean) => void;
  target?: PromptLibraryDirectoryTarget;
  directoryIds?: string[];
  allDirectoryIds?: string[];
}> = ({ state, selectedIds, onChange, allSelected = false, onAllChange, disabled = false, className = '', popover = false, mode = 'multiple', includeAll = true, includeUnclassified = false, unclassifiedSelected = false, onUnclassifiedChange, target, directoryIds, allDirectoryIds }) => {
  useLanguage();
  const allowed = (id: string) => (!directoryIds || directoryIds.includes(id)) && (!target || getPromptLibraryDirectoryTarget(state, id) === target
    && getPromptLibraryDescendantIds(state, id).every(childId => getPromptLibraryDirectoryTarget(state, childId) === target));
  const selectableIds = new Set(state.nodes.filter(node => allowed(node.id)).map(node => node.id));
  const all = normalizePromptLibraryDirectorySelection(state, (allDirectoryIds || state.nodes.filter(node => node.parentId === null).map(node => node.id)).filter(id => selectableIds.has(id)));
  const selected = allSelected ? all : normalizePromptLibraryDirectorySelection(state, selectedIds.filter(id => selectableIds.has(id)));
  const covered = (id: string) => allSelected || getPromptLibraryDirectoryPath(state, id).some(node => selected.includes(node.id));
  const toggle = (id: string) => {
    if (disabled || !selectableIds.has(id)) return;
    if (mode === 'single') { onAllChange?.(false); onChange(selected.includes(id) ? [] : [id]); return; }
    if (allSelected) { onAllChange?.(false); onChange([id]); return; }
    const current = selected;
    const path = getPromptLibraryDirectoryPath(state, id);
    const covering = [...path].reverse().find(node => current.includes(node.id));
    if (covering) {
      const next = current.filter(value => value !== covering.id);
      const pathIds = path.map(node => node.id);
      const start = pathIds.indexOf(covering.id);
      for (let index = start; index < path.length - 1; index++) {
        const parent = path[index];
        const branch = path[index + 1];
        next.push(...state.nodes.filter(node => node.parentId === parent.id && node.id !== branch.id && selectableIds.has(node.id)).map(node => node.id));
      }
      onChange(normalizePromptLibraryDirectorySelection(state, next));
    } else {
      onChange(normalizePromptLibraryDirectorySelection(state, [...current, id]));
    }
  };
  const summary = allSelected ? t('全部目录') : [...selected.map(id => getPromptLibraryDirectoryPath(state, id).map(node => node.name).join(' / ')), ...(unclassifiedSelected ? [t('未归类')] : [])].filter(Boolean).join('、') || t('未归类');
  const allChecked = onAllChange ? allSelected : allSelected || all.length > 0 && all.length === selected.length && all.every(id => selected.includes(id));
  const checklist = <div className={`${popover ? 'max-h-[45dvh]' : 'max-h-64'} space-y-1 overflow-y-auto overscroll-contain`}>
    {includeAll && <label className="mobile-touch flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
      <input type="checkbox" disabled={disabled} checked={allChecked} onChange={() => {
        const next = !allChecked;
        if (onAllChange) { onAllChange(next); if (!next) onChange([]); }
        else onChange(next ? all : []);
      }} />
      <span>{t('全部目录')}</span>
    </label>}
      <DirectoryTreeChecklist collapsible nodes={state.nodes} selectedIds={state.nodes.filter(node => covered(node.id)).map(node => node.id)}
        disabled={disabled} disabledIds={state.nodes.filter(node => !selectableIds.has(node.id)).map(node => node.id)}
        onToggle={id => toggle(id)} />
    {includeUnclassified && <label className="mobile-touch flex min-h-10 items-center gap-2 rounded-lg border-t border-gray-200 px-2 pt-1 text-sm dark:border-gray-700">
      <input type="checkbox" disabled={disabled} checked={unclassifiedSelected} onChange={event => onUnclassifiedChange?.(event.target.checked)} />
      <span>{t('未归类')}</span>
    </label>}
    </div>;
  if (popover) return <div className={`content-roll-directory min-w-0 ${className}`} title={summary}>
    <ToolbarPopover label={summary} title={t('选择目录')} icon={<Folder />} width={360} zIndex={2100} disabled={disabled}>
      {(close, mobile) => <>{!mobile && <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-semibold">{t('选择目录')}</span><button data-agent-action="browse" type="button" className="mobile-touch px-2 text-sm" onClick={close}>{t('完成')}</button></div>}{checklist}</>}
    </ToolbarPopover>
  </div>;
  return <details className={`min-w-0 ${className}`}>
    <summary data-agent-action="browse" className="appearance-input mobile-touch flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 [&::-webkit-details-marker]:hidden">
      <Folder className="h-4 w-4 shrink-0" /><span className="shrink-0">{t('选择目录')}</span><span className="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400" title={summary}>{summary}</span><ChevronDown className="h-4 w-4 shrink-0" />
    </summary>
    <div className="mt-2">{checklist}</div>
  </details>;
};
