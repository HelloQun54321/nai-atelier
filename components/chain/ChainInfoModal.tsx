import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y, isTopmostModal } from '../useModalA11y';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { getCustomChainTags, isCustomChainTag, replaceCustomChainTags } from '../../services/chainTags';

export type ChainInfoUpdate = Pick<PromptChain, 'name' | 'description' | 'tags'>;
export type UpdateChainInfo = (id: string, updates: ChainInfoUpdate) => Promise<void> | void;

interface ChainInfoModalProps {
  chain: PromptChain;
  onSave: UpdateChainInfo;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

/** Portal 就绪后再挂载表单，保证焦点管理能够取得真实节点。 */
export const ChainInfoModal: React.FC<ChainInfoModalProps> = props => <ImagePreviewPortal><ChainInfoForm {...props} /></ImagePreviewPortal>;

/** 资料信息在卡片上编辑；只提交名称、描述和标签，不触碰工作台草稿或生成参数。 */
const ChainInfoForm: React.FC<ChainInfoModalProps> = ({ chain, onSave, onClose, notify }) => {
  useLanguage();
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description);
  const [tags, setTags] = useState(() => getCustomChainTags(chain.tags));
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useModalA11y<HTMLFormElement>(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const label = chain.type === 'character' ? '自定义角色' : '风格串';
  const close = () => { if (!savingRef.current) onClose(); };

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current && isTopmostModal(dialogRef.current)) { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !isCustomChainTag(tag)) { notify('来源、图片类型和状态不用作自定义标签', 'error'); return; }
    if (tag && !tags.includes(tag)) setTags(previous => [...previous, tag]);
    setNewTag('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const tag = newTag.trim();
      if (tag && !isCustomChainTag(tag)) { notify('来源、图片类型和状态不用作自定义标签', 'error'); return; }
      await onSave(chain.id, { name: name.trim(), description, tags: replaceCustomChainTags(chain.tags, tag && !tags.includes(tag) ? [...tags, tag] : tags) });
      notify(`${label}信息已保存`, 'success');
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存信息失败', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const fieldClass = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

  return <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("编辑{0}信息", [label])} onSubmit={event => void save(event)} className="appearance-panel max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-bold text-gray-900 dark:text-white">{t("编辑{0}信息", [t(label)])}</h2><IconButton label={t("关闭")} disabled={saving} onClick={close}><X /></IconButton></div>
      <label className="block text-xs font-semibold text-gray-500">{t("名称")}<input ref={nameRef} value={name} disabled={saving} onChange={event => setName(event.target.value)} className={fieldClass} /></label>
      <label className="mt-4 block text-xs font-semibold text-gray-500">{t("描述")}<textarea value={description} disabled={saving} onChange={event => setDescription(event.target.value)} className={`${fieldClass} min-h-20 resize-y`} /></label>
      <div className="mt-4 text-xs font-semibold text-gray-500">{t("自定义标签")}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{tag}<button type="button" aria-label={t("移除标签 {0}", [tag])} disabled={saving} onClick={() => setTags(previous => previous.filter(value => value !== tag))}><X className="h-3 w-3" /></button></span>)}</div>
      <input aria-label={t("添加标签")} value={newTag} disabled={saving} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTag(); } }} placeholder={t("添加标签，回车确认")} className={fieldClass} />
      <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={saving} onClick={close}>{t("取消")}</ToolbarButton><ToolbarButton type="submit" disabled={saving || !name.trim()} className="!border-emerald-300 !bg-emerald-50 !text-emerald-600 dark:!border-emerald-900 dark:!bg-emerald-950/40 dark:!text-emerald-300">{saving ? t("保存中…") : t("保存")}</ToolbarButton></div>
    </form>
  </div>;
};
