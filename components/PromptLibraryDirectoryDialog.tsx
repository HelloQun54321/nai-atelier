import React, { useRef, useState } from 'react';
import { createUuid } from '../services/id';
import { t, useLanguage } from '../services/i18n';
import { getPromptLibraryDirectoryPurpose, PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY, readPromptLibraryTree, type PromptLibraryDirectory, type PromptLibraryDirectoryPurpose, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { normalizePromptPurposeId, PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES, promptPurposeLabel } from '../services/promptPurposes.mjs';
import { DirectoryNodeDialog } from './DirectoryNodeDialog';
import { ToolbarButton } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';

export interface PromptLibraryDirectoryDialogProps {
  state: PromptLibraryTreeState;
  editingId?: string;
  initialParentId?: string | null;
  onSave: (state: PromptLibraryTreeState) => Promise<PromptLibraryTreeState>;
  onReload?: () => Promise<void>;
  onClose: () => void;
}

/** 目录操作复用共用窗口，一次保存即生效。 */
export function PromptLibraryDirectoryDialog({ state, editingId, initialParentId, onSave, onReload, onClose }: PromptLibraryDirectoryDialogProps) {
  useLanguage();
  const existing = state.nodes.find(node => node.id === editingId);
  const [createdId] = useState(createUuid);
  const [name, setName] = useState(existing?.name || '');
  const [parentId, setParentId] = useState(existing ? existing.parentId || '' : initialParentId || '');
  const [target, setTarget] = useState<'' | 'global' | 'character'>(existing?.target || '');
  const [purpose, setPurpose] = useState<'' | PromptLibraryDirectoryPurpose>(existing?.purpose || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const presetFallback = editingId && editingId in PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY
    ? normalizePromptPurposeId(PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY[editingId as keyof typeof PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY])
    : undefined;
  const parentInherited = parentId ? getPromptLibraryDirectoryPurpose(state, parentId) : undefined;
  const defaultPurpose = presetFallback ?? parentInherited;
  const save = async () => {
    if (pending.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (editingId && !existing) throw new Error('目录不存在');
      const id = editingId || createdId;
      const node: PromptLibraryDirectory = {
        id,
        name: name.trim(),
        parentId: parentId || null,
        ...(target ? { target } : {}),
        ...(purpose ? { purpose } : {}),
      };
      const nodes = state.nodes.some(item => item.id === id) ? state.nodes.map(item => item.id === id ? node : item) : [...state.nodes, node];
      await onSave(readPromptLibraryTree({ ...state, nodes }));
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const reload = async () => {
    if (!onReload || pending.current) return;
    pending.current = true; setBusy(true);
    try { await onReload(); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <DirectoryNodeDialog title={editingId ? '编辑目录' : '新建目录'} nodes={state.nodes} editingId={editingId}
    name={name} parentId={parentId} onNameChange={setName} onParentChange={setParentId} maxLength={100}
    onSubmit={save} onClose={onClose} busy={busy} error={error}>
    <label className="mt-3 block text-xs text-gray-500">
      <span>{t('默认用途')}</span>
      <select aria-label={t('默认用途')} value={purpose} disabled={busy} onChange={event => setPurpose(event.target.value as typeof purpose)} className={`${TOOLBAR_FIELD_CLASS} mt-2!`}>
        <option value="">
          {presetFallback
            ? `${t('预设默认')}（${t(promptPurposeLabel(presetFallback))}）`
            : parentInherited
              ? `${t('跟随上级')}（${t(promptPurposeLabel(parentInherited))}）`
              : t('不绑定（仅作文件夹）')}
        </option>
        {(defaultPurpose || purpose === 'none') && (
          <option value="none">{t(presetFallback ? '不绑定（关闭预设默认）' : '不绑定（不继承上级）')}</option>
        )}
        {PROMPT_PURPOSE_GROUPS.map(group => (
          <optgroup key={group.id} label={t(group.label)}>
            {group.purposes.map(id => {
              const item = PROMPT_PURPOSES.find(candidate => candidate.id === id);
              return item ? <option key={item.id} value={item.id}>{t(item.label)}</option> : null;
            })}
          </optgroup>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{t('供随机搭配、实验室分栏与 AI 识别使用；未单独指定的子目录和片段自动继承。')}</p>
    </label>
    <details className="mt-3 text-xs text-gray-500">
      <summary className="cursor-pointer">{t('目录目标范围')}</summary>
      <select aria-label={t('目录目标范围')} value={target} disabled={busy} onChange={event => setTarget(event.target.value as typeof target)} className={`${TOOLBAR_FIELD_CLASS} mt-2!`}>
        <option value="">{t('继承上级范围')}</option><option value="global">{t('全局内容')}</option><option value="character">{t('人物内容')}</option>
      </select>
    </details>
    {error && onReload && <ToolbarButton className="mt-3" disabled={busy} onClick={() => void reload()}>{t('重新读取目录')}</ToolbarButton>}
  </DirectoryNodeDialog>;
}
