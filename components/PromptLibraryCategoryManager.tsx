import React, { useEffect, useRef, useState } from 'react';
import { db } from '../services/dbService';
import { promptLibraryCategoryUpdates, type PromptLibraryCategorySnapshot } from '../services/promptLibraryCategories';
import { emptyPromptLibraryCategoryTree, loadPromptLibraryCategoryTree, projectPromptLibraryCategoryTree, readPromptLibraryCategoryTree, removePromptLibraryCategory, renamePromptLibraryCategory, savePromptLibraryCategoryTree, type PromptLibraryCategoryTreeState } from '../services/promptLibraryCategoryTree';
import { getDirectoryDescendantIds } from '../services/directoryTree.mjs';
import { getCustomChainTags } from '../services/chainTags';
import { librarySectionOf } from '../services/promptLibraryEntries';
import { readPromptLibraryTagNames } from '../services/promptLibraryTags';
import { t, useLanguage } from '../services/i18n';
import { useConfirmDialog } from './ConfirmDialog';
import { ToolbarButton } from './DesignSystem';
import { DirectoryTreeSelect } from './DirectoryTreeSelect';
import { DirectoryNodeDialog } from './DirectoryNodeDialog';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';

type Snapshot = PromptLibraryCategorySnapshot & { tree: PromptLibraryCategoryTreeState };
type Edit = { from: string; value: string; parentId?: string | null };

export const PromptLibraryCategoryManager: React.FC<{
  onClose: () => void; onSnapshot: (snapshot: PromptLibraryCategorySnapshot) => void;
  onChanged: (from: string, to: string) => void; initialTree?: PromptLibraryCategoryTreeState; initialParentId?: string | null; initialEditingId?: string; initialDeletingId?: string;
}> = ({ onClose, onSnapshot, onChanged, initialTree, initialParentId, initialEditingId, initialDeletingId }) => {
  useLanguage();
  const confirm = useConfirmDialog(), pending = useRef(false);
  const [busy, setBusy] = useState(false), [snapshot, setSnapshot] = useState<Snapshot | null>(null), [blocked, setBlocked] = useState(false), [error, setError] = useState('');
  const [newName, setNewName] = useState(''), [newParent, setNewParent] = useState(initialParentId || ''), [mergeTarget, setMergeTarget] = useState('');
  const [editing, setEditing] = useState<Edit | null>(() => initialEditingId === undefined ? null : { from: initialEditingId, value: initialEditingId });
  const added = useRef<string | null>(null);
  const renameParent = useRef<{ from: string; to: string; parentId: string | null } | null>(null);
  const tree = snapshot?.tree || initialTree || emptyPromptLibraryCategoryTree();
  const editingParent = editing?.parentId !== undefined ? editing.parentId || '' : tree.nodes.find(node => node.id === initialEditingId)?.parentId || '';
  const publish = (next: Snapshot) => { setSnapshot(next); onSnapshot(next); setBlocked(false); return next; };
  const read = async () => {
    try {
      const [chains, names, stored] = await Promise.all([db.getAllChains(), db.getPromptLibraryTagNames(), loadPromptLibraryCategoryTree()]);
      return publish({ chains, names, tree: projectPromptLibraryCategoryTree(chains, names, stored) });
    } catch (cause) { setBlocked(true); throw cause; }
  };
  const reload = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await read(); } catch { setBlocked(true); setError(t('分类读取失败，请重新加载后再操作')); }
    finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => { void reload(); }, []);
  const nameOf = (value: string) => {
    try { return readPromptLibraryTagNames([value])[0]; }
    catch { throw new Error(t('分类名称无效：请勿使用空白、逗号、换行或内部保留标签')); }
  };
  const recover = async () => { try { await read(); } catch { setBlocked(true); } };
  const saveMove = async (current: Snapshot, from: string, parentId: string | null) => {
    const source = current.tree.nodes.find(node => node.id === from);
    if (!source) throw new Error(t('原分类已不存在，请重新选择'));
    if (source.parentId === parentId) return;
    if (parentId && getDirectoryDescendantIds(current.tree.nodes, from).has(parentId)) throw new Error(t('不能移动到自身或下级分类'));
    const next = readPromptLibraryCategoryTree({ ...current.tree, nodes: current.tree.nodes.map(node => node.id === from ? { ...node, parentId } : node) });
    await savePromptLibraryCategoryTree(next);
  };
  const add = async () => {
    if (pending.current || blocked || !snapshot) return;
    pending.current = true; setBusy(true); setError(''); let wrote = false;
    try {
      const name = nameOf(newName), current = await read();
      if (newParent && !current.tree.nodes.some(node => node.id === newParent)) throw new Error(t('上级分类已不存在'));
      if (current.tree.nodes.some(node => node.id === name) && added.current !== name) throw new Error(t('分类已存在'));
      wrote = true;
      const names = await db.savePromptLibraryTagNames([...current.names, name]); added.current = name;
      const nodes = current.tree.nodes.filter(node => node.id !== name).concat({ id: name, name, parentId: newParent || null });
      const savedTree = await savePromptLibraryCategoryTree({ ...current.tree, nodes });
      publish({ ...current, names, tree: savedTree }); added.current = null; setNewName(''); onClose();
    } catch (cause) { if (wrote) await recover(); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const update = async (mergeTo?: string) => {
    if (pending.current || blocked || !editing || !snapshot) return;
    pending.current = true; setBusy(true); setError(''); let wrote = false, completed = 0, total = 0;
    try {
      const current = await read(), from = editing.from;
      if (!current.tree.nodes.some(node => node.id === from)) throw new Error(t('原分类已不存在，请重新选择'));
      const to = mergeTo !== undefined || editing.value === from ? mergeTo ?? editing.value : nameOf(editing.value);
      if (from === to) {
        if (mergeTo !== undefined) throw new Error(t('请选择不同的目标分类'));
        wrote = true; await saveMove(current, from, editingParent || null); await read(); setEditing(null); onClose(); return;
      }
      const merging = current.tree.nodes.some(node => node.id === to);
      if (mergeTo !== undefined && !merging) throw new Error(t('目标分类已不存在，请重新选择'));
      const updates = promptLibraryCategoryUpdates(current.chains, from, to); total = updates.length;
      if (!await confirm({ rememberKey: merging ? 'prompt-library-category.merge' : 'prompt-library-category.rename', title: t(merging ? '将「{0}」合并到「{1}」？' : '将「{0}」重命名为「{1}」？', [from, to]), message: t('将更新 {0} 条组合的分类，其他标签、提示词、图片和参数保持原样。', [total]), confirmLabel: t(merging ? '合并分类' : '重命名'), tone: 'primary' })) return;
      if (!merging) renameParent.current = { from, to, parentId: current.tree.nodes.find(node => node.id === from)!.parentId };
      let nextTree = renamePromptLibraryCategory(current.tree, from, to);
      const prior = renameParent.current;
      if (prior?.from === from && prior.to === to) nextTree = readPromptLibraryCategoryTree({ ...nextTree, nodes: nextTree.nodes.map(node => node.id === to ? { ...node, parentId: prior.parentId } : node) });
      if (mergeTo === undefined) nextTree = readPromptLibraryCategoryTree({ ...nextTree, nodes: nextTree.nodes.map(node => node.id === to ? { ...node, parentId: editingParent || null } : node) });
      wrote = true;
      for (const { id, tags } of updates) { await db.updateChain(id, { tags }); completed++; }
      await savePromptLibraryCategoryTree(nextTree);
      await db.savePromptLibraryTagNames(mergeTo !== undefined ? current.names.filter(name => name !== from) : [...current.names.filter(name => name !== from), to]);
      await read(); onChanged(from, to); setEditing(null); renameParent.current = null; onClose();
    } catch (cause) {
      if (wrote) await recover(); const reason = cause instanceof Error ? cause.message : String(cause);
      setError(wrote ? t('已更新 {0}/{1} 条组合，操作尚未全部完成：{2}', [completed, total, reason]) : reason);
    } finally { pending.current = false; setBusy(false); }
  };
  const remove = async (from: string) => {
    if (pending.current || blocked || !snapshot) return;
    pending.current = true; setBusy(true); setError(''); let wrote = false, completed = 0, total = 0;
    try {
      const current = await read();
      const targets = current.chains.filter(chain => librarySectionOf(chain) === 'saved' && getCustomChainTags(chain.tags).includes(from)); total = targets.length;
      if (!await confirm({ rememberKey: 'prompt-library-category.delete', title: t('删除分类「{0}」？', [from]), message: t('将解除 {0} 条组合的此分类，子分类提升一级，组合内容和其他分类保留。', [total]), confirmLabel: t('删除分类'), tone: 'danger' })) { if (initialDeletingId !== undefined) onClose(); return; }
      wrote = true;
      for (const chain of targets) { await db.updateChain(chain.id, { tags: (chain.tags || []).filter(tag => tag.trim() !== from) }); completed++; }
      await savePromptLibraryCategoryTree(removePromptLibraryCategory(current.tree, from));
      await db.savePromptLibraryTagNames(current.names.filter(name => name !== from));
      await read(); onChanged(from, ''); if (editing?.from === from) setEditing(null); if (initialDeletingId !== undefined) onClose();
    } catch (cause) {
      if (wrote) await recover(); const reason = cause instanceof Error ? cause.message : String(cause);
      setError(wrote ? t('已更新 {0}/{1} 条组合，操作尚未全部完成：{2}', [completed, total, reason]) : reason);
    } finally { pending.current = false; setBusy(false); }
  };
  const deleteStarted = useRef(false), deleteFeedback = useRef(false);
  useEffect(() => {
    if (initialDeletingId === undefined || deleteStarted.current || busy || blocked || !snapshot) return;
    deleteStarted.current = true; void remove(initialDeletingId);
  }, [initialDeletingId, busy, blocked, snapshot]);
  useEffect(() => {
    if (initialDeletingId === undefined || !error || busy || deleteFeedback.current) return;
    deleteFeedback.current = true;
    void confirm({ title: t('删除分类'), message: error, confirmLabel: t('重试'), cancelLabel: t('关闭'), tone: 'danger' }).then(async retry => {
      deleteFeedback.current = false;
      if (retry) { deleteStarted.current = false; await reload(); }
      else onClose();
    });
  }, [initialDeletingId, error, busy, confirm]);
  if (initialDeletingId !== undefined) return null;
  return <DirectoryNodeDialog title={t(initialEditingId === undefined ? '新建目录' : '编辑目录')} nodes={tree.nodes} name={initialEditingId === undefined ? newName : editing?.value ?? initialEditingId} parentId={initialEditingId === undefined ? newParent : editingParent} editingId={initialEditingId} busy={busy} disabled={blocked || !snapshot} error={error} nameLabel={t(initialEditingId === undefined ? '新分类名称' : '分类名称')} parentLabel={t(initialEditingId === undefined ? '新分类上级' : '上级分类')} maxLength={200}
    onNameChange={value => initialEditingId === undefined ? setNewName(value) : setEditing(previous => previous ? { ...previous, value } : previous)} onParentChange={value => initialEditingId === undefined ? setNewParent(value) : setEditing(previous => previous ? { ...previous, parentId: value || null } : previous)} onSubmit={() => initialEditingId === undefined ? add() : update()} onClose={onClose}>
    {initialEditingId !== undefined && <details className="mt-3 text-xs text-gray-500">
      <summary className="cursor-pointer">{t('合并分类')}</summary>
      <div className="mt-2 flex items-center gap-2">
        <DirectoryTreeSelect aria-label={t('目标分类')} nodes={tree.nodes} rootLabel={t('请选择目标分类')} excludeIds={[initialEditingId]} value={mergeTarget} disabled={busy || blocked || !snapshot} onChange={event => setMergeTarget(event.target.value)} className={TOOLBAR_FIELD_CLASS + ' min-w-0 flex-1'} />
        <ToolbarButton disabled={busy || blocked || !snapshot || !mergeTarget} onClick={() => void update(mergeTarget)}>{t('合并')}</ToolbarButton>
      </div>
    </details>}
    {blocked && <ToolbarButton disabled={busy} onClick={() => void reload()}>{t('重新加载分类')}</ToolbarButton>}
  </DirectoryNodeDialog>;
};
