import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Tags, Upload, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y, isTopmostModal } from '../useModalA11y';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { api } from '../../services/api';
import { SmartImage } from '../SmartImage';
import { HistoryImagePicker } from '../HistoryImagePicker';
import { PromptField } from './ChainEditorPromptInputs';
import { useConfirmDialog } from '../ConfirmDialog';
import { useMobileHistoryLayer } from '../MobileUI';
import { getCustomChainTags, isCustomChainTag, replaceCustomChainTags } from '../../services/chainTags';

export type ChainInfoUpdate = Pick<PromptChain, 'name' | 'description' | 'tags'> & Partial<Pick<PromptChain, 'basePrompt' | 'negativePrompt' | 'previewImage' | 'variableValues' | 'params'>>;
export type UpdateChainInfo = (id: string, updates: ChainInfoUpdate) => Promise<void> | void;

interface ChainInfoModalProps {
  chain: PromptChain;
  catalogIdentity?: { tag: string; name: string };
  tagAssistEnabled?: boolean;
  onTagAssistEnabledChange?: (enabled: boolean) => void;
  onSave: UpdateChainInfo;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

/** Portal 就绪后再挂载表单，保证焦点管理能够取得真实节点。 */
export const ChainInfoModal: React.FC<ChainInfoModalProps> = props => <ImagePreviewPortal><ChainInfoForm {...props} /></ImagePreviewPortal>;

/** 资料在卡片就地编辑；角色可改正负文本，其余配方内容和生成参数保持原样。 */
const ChainInfoForm: React.FC<ChainInfoModalProps> = ({ chain, onSave, onClose, notify, tagAssistEnabled = true, onTagAssistEnabledChange, catalogIdentity }) => {
  useLanguage();
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description);
  const [tags, setTags] = useState(() => getCustomChainTags(chain.tags));
  const initialPrompt = catalogIdentity ? chain.variableValues?.subject || '' : chain.basePrompt;
  const [basePrompt, setBasePrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState(chain.negativePrompt);
  const [previewImage, setPreviewImage] = useState(chain.previewImage || '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverObjectUrl, setCoverObjectUrl] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const uploadedCover = useRef<{ file: File; url: string } | null>(null);
  const confirmAction = useConfirmDialog();
  const closingRef = useRef(false);
  const character = chain.type === 'character';
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useModalA11y<HTMLFormElement>(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const label = catalogIdentity ? '角色' : chain.type === 'character' ? '自定义角色' : '风格串';
  const sources = chain.type === 'style' && Array.isArray(chain.params._styleBundleSources)
    ? chain.params._styleBundleSources.filter(source => source && ['author', 'sourceUrl', 'note'].every(key => typeof source[key as keyof typeof source] === 'string')) : [];
  const dirty = character && (name !== chain.name || description !== chain.description || newTag.trim() !== ''
    || JSON.stringify(tags) !== JSON.stringify(getCustomChainTags(chain.tags)) || basePrompt !== initialPrompt || negativePrompt !== chain.negativePrompt || coverFile !== null || previewImage !== (chain.previewImage || ''));
  const requestClose = () => {
    if (historyOpen) { setHistoryOpen(false); return false; }
    if (savingRef.current || closingRef.current) return false;
    if (!dirty) { onClose(); return; }
    closingRef.current = true;
    void confirmAction({ title: t('放弃未保存的修改？'), message: t('返回{0}将丢弃本次编辑的改动。', [t('角色库')]), confirmLabel: t('放弃修改'), cancelLabel: t('继续编辑'), tone: 'danger', onSave: saveDraft })
      .then(confirmed => { if (confirmed) onClose(); })
      .finally(() => { closingRef.current = false; });
    return false;
  };
  const close = useMobileHistoryLayer(true, requestClose, 'chain-info');

  useEffect(() => {
    if (!coverFile) { setCoverObjectUrl(''); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !savingRef.current && isTopmostModal(dialogRef.current)) { event.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !isCustomChainTag(tag)) { notify('来源、图片类型和状态不用作自定义标签', 'error'); return; }
    if (tag && !tags.includes(tag)) setTags(previous => [...previous, tag]);
    setNewTag('');
  };
  async function saveDraft(): Promise<boolean> {
    if (!name.trim() || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const tag = newTag.trim();
      if (tag && !isCustomChainTag(tag)) { notify('来源、图片类型和状态不用作自定义标签', 'error'); return false; }
      let cover = previewImage;
      if (character && coverFile) {
        if (uploadedCover.current?.file !== coverFile) {
          const result = await api.uploadFile(coverFile, 'covers');
          uploadedCover.current = { file: coverFile, url: result.url };
        }
        cover = uploadedCover.current!.url;
      }
      await onSave(chain.id, { name: catalogIdentity?.name || name.trim(), description, tags: replaceCustomChainTags(chain.tags, tag && !tags.includes(tag) ? [...tags, tag] : tags),
        ...(character && basePrompt !== initialPrompt ? catalogIdentity ? { variableValues: { ...chain.variableValues, subject: basePrompt } } : { basePrompt } : {}),
        ...(character && negativePrompt !== chain.negativePrompt ? { negativePrompt } : {}),
        ...(character && cover !== (chain.previewImage || '') ? { previewImage: cover } : {}),
      });
      notify(`${label}信息已保存`, 'success');
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存信息失败', 'error');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const fieldClass = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

  return <div className={`fixed inset-0 ${character ? 'z-[1100]' : 'z-[1250]'} flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm`} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("编辑{0}信息", [label])} onSubmit={event => { event.preventDefault(); void saveDraft().then(saved => { if (saved) onClose(); }); }} className={`appearance-panel max-h-[calc(100dvh-2rem)] w-full ${character ? 'max-w-3xl' : 'max-w-md'} overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900`}>
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-bold text-gray-900 dark:text-white">{t("编辑{0}信息", [t(label)])}</h2><div className="flex shrink-0 gap-2">{character && onTagAssistEnabledChange && <IconButton label={tagAssistEnabled ? t('关闭 Tag 辅助') : t('开启 Tag 辅助')} aria-pressed={tagAssistEnabled} disabled={saving}
        onClick={() => { const enabled = !tagAssistEnabled; onTagAssistEnabledChange(enabled); notify(`Tag 辅助已${enabled ? '开启' : '关闭'}`); }}
        className={tagAssistEnabled ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!border-indigo-800 dark:!bg-indigo-950/40 dark:!text-indigo-300' : ''}>
        <span className="relative block"><Tags /><span aria-hidden="true" className="absolute -bottom-1.5 -right-1.5 text-mini font-black leading-none">{tagAssistEnabled ? 'o' : '−'}</span></span>
      </IconButton>}<IconButton label={t("关闭")} disabled={saving} onClick={close}><X /></IconButton></div></div>
      {character && <section aria-label={t('角色封面')} className="mb-4 space-y-3">
        {coverFile ? coverObjectUrl && <SmartImage src={coverObjectUrl} alt={t('角色封面')} containerClassName="relative w-full overflow-hidden rounded-xl" className="block max-h-64 w-full object-contain" />
          : previewImage ? <SmartImage src={previewImage} alt={t('角色封面')} containerClassName="relative w-full overflow-hidden rounded-xl" className="block max-h-64 w-full object-contain" />
          : <p className="py-6 text-center text-sm text-gray-400">{t('暂无封面')}</p>}
        <input ref={coverInput} type="file" accept="image/*" aria-label={t('上传角色封面')} className="hidden" disabled={saving} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
          if (!file || savingRef.current) return;
          setCoverFile(file); uploadedCover.current = null;
        }} />
        <div className="flex flex-wrap gap-2">
          <ToolbarButton disabled={saving} onClick={() => coverInput.current?.click()}><Upload />{t('上传图片')}</ToolbarButton>
          <ToolbarButton disabled={saving} onClick={() => setHistoryOpen(true)}><ImagePlus />{t('从历史选图')}</ToolbarButton>
          <ToolbarButton disabled={saving || !coverFile && !previewImage} onClick={() => { setCoverFile(null); setPreviewImage(''); uploadedCover.current = null; }}>{t('清除封面')}</ToolbarButton>
        </div>
      </section>}
      <label className="block text-xs font-semibold text-gray-500">{t("名称")}<input ref={nameRef} value={catalogIdentity?.name || name} readOnly={Boolean(catalogIdentity)} disabled={saving} onChange={event => setName(event.target.value)} className={fieldClass} /></label>
      <label className="mt-4 block text-xs font-semibold text-gray-500">{t("描述")}<textarea value={description} disabled={saving} onChange={event => setDescription(event.target.value)} className={`${fieldClass} min-h-20 resize-y`} /></label>
      {catalogIdentity && <label className="mt-4 block text-xs font-semibold text-gray-500">{t("角色 Tag")}<input readOnly value={catalogIdentity.tag} className={fieldClass} /></label>}
      {character && <div className="mt-4 space-y-4">
        <PromptField label={catalogIdentity ? "补充提示词" : "正面提示词"} placeholder={catalogIdentity ? "补充角色外貌、服饰或其他提示词" : "角色正面提示词"} value={basePrompt} onChange={setBasePrompt} disabled={saving} tagAssistEnabled={tagAssistEnabled} />
        <PromptField label="负面提示词" placeholder="角色负面提示词" value={negativePrompt} onChange={setNegativePrompt} disabled={saving} tagAssistEnabled={tagAssistEnabled} />
      </div>}
      {sources.length > 0 && <section aria-label={t('分享来源')} className="mt-4 space-y-2 text-xs">
        <h3 className="font-semibold text-gray-500">{t('分享来源（分享者声明）')}</h3>
        {sources.map((source, index) => <div key={index} className="appearance-group space-y-1 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
          {source.author && <p className="break-words">{t('作者')}：{source.author}</p>}
          {source.sourceUrl && <p className="break-all">{t('来源链接')}：{/^https?:\/\//i.test(source.sourceUrl)
            ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline dark:text-indigo-300">{source.sourceUrl}</a>
            : <span>{source.sourceUrl}</span>}</p>}
          {source.note && <p className="whitespace-pre-wrap break-words">{source.note}</p>}
        </div>)}
      </section>}
      <div className="mt-4 text-xs font-semibold text-gray-500">{t("自定义标签")}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{tag}<button type="button" aria-label={t("移除标签 {0}", [tag])} disabled={saving} onClick={() => setTags(previous => previous.filter(value => value !== tag))}><X className="h-3 w-3" /></button></span>)}</div>
      <input aria-label={t("添加标签")} value={newTag} disabled={saving} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTag(); } }} placeholder={t("添加标签，回车确认")} className={fieldClass} />
      <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={saving} onClick={close}>{t("取消")}</ToolbarButton><ToolbarButton type="submit" disabled={saving || !name.trim()} className="!border-emerald-300 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-900 dark:!bg-emerald-950/40 dark:!text-emerald-300">{saving ? t("保存中…") : t("保存")}</ToolbarButton></div>
    </form>
    {character && <HistoryImagePicker open={historyOpen} zIndex={1600} allowImportParams={false} onClose={() => setHistoryOpen(false)} onSelect={item => {
      if (savingRef.current) return;
      setCoverFile(null); uploadedCover.current = null;
      setPreviewImage(item.imageUrl || `/api/local-history/${encodeURIComponent(item.id)}/image`);
      setHistoryOpen(false);
    }} />}
  </div>;
};
