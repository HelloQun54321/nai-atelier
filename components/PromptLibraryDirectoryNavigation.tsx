import React, { useMemo, useState } from 'react';
import { Pencil, Tag } from 'lucide-react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { resetPromptLibraryDirectories } from '../services/promptLibraryDirectories';
import { getPromptLibraryDirectoryPath, getPromptLibraryDirectoryPurpose, getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry, PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { promptPurposeLabel } from '../services/promptPurposes.mjs';
import { librarySectionOf } from '../services/promptLibraryEntries';
import { useOptionalConfirmDialog } from './ConfirmDialog';
import { DirectoryTreeNavigation } from './DirectoryTreeNavigation';

export const PROMPT_LIBRARY_ENTRY_DRAG_TYPE = 'application/x-nai-prompt-library-entry-ids';

export interface PromptLibraryDirectorySelection {
  directoryIds: string[];
  allDirectories: boolean;
  unclassified: boolean;
}

interface PromptLibraryDirectoryNavigationProps {
  id?: string;
  state: PromptLibraryTreeState;
  entries: PromptChain[];
  selectedIds: string[];
  allSelected: boolean;
  unclassified: boolean;
  onSelect: (selection: PromptLibraryDirectorySelection) => void;
  expanded: boolean;
  onCreate?: (parentId: string | null) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, parentId: string | null) => void;
  onReset?: () => void;
  onDropEntries?: (ids: string[], targetDirectoryId: string) => Promise<void> | void;
  onRequestClose?: () => void;
  disabled?: boolean;
  embedded?: boolean;
  countsPending?: boolean;
}

export function PromptLibraryDirectoryNavigation({
  id,
  state,
  entries,
  selectedIds,
  allSelected,
  unclassified,
  onSelect,
  expanded,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onReset,
  onDropEntries,
  onRequestClose,
  disabled = false,
  embedded = false,
  countsPending = false,
}: PromptLibraryDirectoryNavigationProps) {
  useLanguage();
  const confirmAction = useOptionalConfirmDialog();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const nodeById = useMemo(() => new Map(state.nodes.map(node => [node.id, node])), [state.nodes]);
  const knownNodeIds = useMemo(() => new Set(state.nodes.map(node => node.id)), [state.nodes]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const describeNodePurpose = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node) return null;
    const effectivePurpose = getPromptLibraryDirectoryPurpose(state, nodeId);
    const explicitPurpose = Boolean(node.purpose && node.purpose !== 'none');
    const isPresetDirect = !node.purpose && Boolean(PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY[node.id as keyof typeof PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY]);
    const isInherited = !explicitPurpose && !isPresetDirect && Boolean(effectivePurpose);
    return { node, effectivePurpose, isInherited };
  };

  const counts = useMemo(() => {
    const values = new Map<string, Set<string>>([['*', new Set()], ['', new Set()], ...state.nodes.map(node => [node.id, new Set<string>()] as [string, Set<string>])]);
    for (const entry of entries) {
      const section = librarySectionOf(entry);
      if (!section) continue;
      values.get('*')!.add(entry.id);
      if (section === 'originals') { values.get('')!.add(entry.id); continue; }
      if (!isPromptLibraryFragmentEntry(entry)) continue;
      const directoryIds = getPromptLibraryEntryDirectoryIds(entry, state);
      if (!directoryIds.length) values.get('')!.add(entry.id);
      for (const directoryId of directoryIds) for (const node of getPromptLibraryDirectoryPath(state, directoryId)) values.get(node.id)?.add(entry.id);
    }
    return new Map<string, number | string>([...values].map(([key, ids]) => [key, countsPending && !ids.size ? '—' : ids.size]));
  }, [entries, state, countsPending]);

  const drop = (event: React.DragEvent, targetId: string) => {
    if (!event.dataTransfer.types.includes(PROMPT_LIBRARY_ENTRY_DRAG_TYPE)) return;
    event.preventDefault();
    setDragOver(null);
    if (disabled || !knownNodeIds.has(targetId) || !onDropEntries) return;
    try {
      const parsed: unknown = JSON.parse(event.dataTransfer.getData(PROMPT_LIBRARY_ENTRY_DRAG_TYPE));
      if (Array.isArray(parsed)) {
        const validIds = parsed.filter((item): item is string => typeof item === 'string' && Boolean(item));
        if (validIds.length) void onDropEntries(validIds, targetId);
      }
    } catch { /* 忽略非提示词条目拖拽载荷 */ }
  };

  const select = (value: string) => onSelect({ directoryIds: value && value !== '*' ? [value] : [], allDirectories: value === '*', unclassified: value === '' });
  const canReset = Boolean(onReset || onCreate || onRename || onDelete);
  const handleReset = async () => {
    if (disabled || resetting) return;
    if (onReset) { onReset(); return; }
    const message = t('将恢复为默认的 3 组 10 个分类目录：旧预设目录中的片段会自动迁入新分类，自定义或已移除目录中的片段会移至「未归类」并保留原有用途，所有提示词正文不会被修改或删除。');
    const confirmed = confirmAction
      ? await confirmAction({
          title: t('恢复默认目录树？'),
          message,
          confirmLabel: t('恢复默认'),
          cancelLabel: t('取消'),
          tone: 'danger',
        })
      : (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`${t('恢复默认目录树？')}\n${message}`) : false);
    if (!confirmed) return;
    setResetting(true);
    setResetError('');
    try {
      await resetPromptLibraryDirectories(state.revision);
      onSelect({ directoryIds: [], allDirectories: true, unclassified: false });
    } catch (error) {
      setResetError(error instanceof Error ? error.message : t('恢复默认目录树失败'));
    } finally {
      setResetting(false);
    }
  };
  if (!expanded) return null;
  return (
    <DirectoryTreeNavigation
      id={id}
      label={t('提示词目录导航')}
      title={t('提示词目录')}
      className="prompt-library-directory-navigation"
      nodes={state.nodes}
      selectedId={allSelected ? '*' : unclassified && !selectedIds.length ? '' : selectedIds.length === 1 && !unclassified ? selectedIds[0] : '#selected'}
      selectedIds={allSelected ? ['*'] : [...selectedIds, ...(unclassified ? [''] : [])]}
      onSelect={select}
      expanded={expanded}
      preferenceKey="nai-prompt-library-directory-branches"
      counts={counts}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      onMove={onMove}
      onReset={canReset ? () => { void handleReset(); } : undefined}
      onRequestClose={onRequestClose}
      disabled={disabled}
      actionDisabled={disabled || resetting}
      embedded={embedded}
      widthClassName="md:w-60"
      selectLabel={t('选择提示词目录')}
      renameLabel={t('编辑目录')}
      resetLabel={t('恢复默认目录树')}
      header={resetError ? <div role="alert" className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{resetError}</div> : undefined}
      nodeMeta={nodeId => {
        const info = describeNodePurpose(nodeId);
        if (!info) return null;
        if (info.effectivePurpose) {
          return (
            <span className={info.isInherited
              ? 'inline-flex max-w-full items-center gap-1 rounded border border-dashed border-gray-300/90 px-1.5 py-0.5 text-[10px] leading-none text-gray-500 dark:border-gray-600/80 dark:text-gray-400'
              : 'inline-flex max-w-full items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'}>
              <Tag className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t(promptPurposeLabel(info.effectivePurpose))}</span>
            </span>
          );
        }
        if (info.node.purpose === 'none') {
          return (
            <span className="inline-flex max-w-full items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] leading-none text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {t('仅文件夹')}
            </span>
          );
        }
        return null;
      }}
      nodeActions={onRename ? (nodeId, context) => {
        const node = nodeById.get(nodeId);
        if (!node) return null;
        const pathLabel = getPromptLibraryDirectoryPath(state, nodeId).map(item => item.name).join(' / ');
        const isSelected = selectedSet.has(nodeId);
        return (
          <button
            type="button"
            disabled={disabled}
            aria-label={t('编辑目录「{0}」', [pathLabel])}
            title={t('编辑目录（改名 / 设置默认用途）')}
            onClick={event => {
              event.stopPropagation();
              if (disabled) return;
              context?.closePicker?.();
              onRename(nodeId);
            }}
            className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-gray-200/70 hover:text-gray-900 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-gray-700/70 dark:hover:text-gray-100 ${isSelected ? 'text-indigo-600 opacity-90 dark:text-indigo-300' : 'text-gray-500 opacity-45 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-gray-400'}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      } : undefined}
      nodeProps={nodeId => {
        const info = describeNodePurpose(nodeId);
        const pathLabel = info ? getPromptLibraryDirectoryPath(state, nodeId).map(node => node.name).join(' / ') : '';
        const purposeText = info?.effectivePurpose ? t(promptPurposeLabel(info.effectivePurpose)) : '';
        const title = info
          ? (purposeText
            ? `${pathLabel} · ${t(info.isInherited ? '继承用途' : '默认用途')}：${purposeText}`
            : `${pathLabel} · ${t('未绑定用途（仅作文件夹）')}`)
          : undefined;
        return {
          ...(title ? { title } : {}),
          ...(onDropEntries ? {
            onDragOver: event => {
              if (!disabled && knownNodeIds.has(nodeId) && event.dataTransfer.types.includes(PROMPT_LIBRARY_ENTRY_DRAG_TYPE)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'link';
                setDragOver(nodeId);
              }
            },
            onDragLeave: () => setDragOver(current => (current === nodeId ? null : current)),
            onDrop: event => drop(event, nodeId),
            className: dragOver === nodeId ? 'ring-2 ring-indigo-500' : '',
          } : {}),
        };
      }}
    />
  );
}
