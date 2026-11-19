import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, LoaderCircle, X } from 'lucide-react';
import { getPastedImageFile, readClipboardImage } from '../../services/imageClipboard';
import { imageTaggerService } from '../../services/imageTaggerService';
import { BackButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y } from '../useModalA11y';
import { taggerProgressText, useImageTaggerStatus } from '../useImageTaggerStatus';

interface CharacterTaggerReferenceProps {
  buttonSlotRef?: React.RefObject<HTMLElement | null>;
  canEdit: boolean;
  onAppend: (tags: string) => void;
}

/** 参考图片只驻留当前角色编辑组件，不进入生成参数、参考编码或永久资料库。 */
export const CharacterTaggerReference: React.FC<CharacterTaggerReferenceProps> = ({ canEdit, onAppend, buttonSlotRef }) => {
  useLanguage();
  const [buttonTarget, setButtonTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setButtonTarget(buttonSlotRef?.current || null); }, [buttonSlotRef]);
  const [preview, setPreview] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operation = useRef(0);
  const running = useRef(false);
  const mounted = useRef(false);
  const latest = useRef({ canEdit, onAppend });
  useLayoutEffect(() => { latest.current = { canEdit, onAppend }; }, [canEdit, onAppend]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current += 1; };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const { status } = useImageTaggerStatus(busy);
  const selectedModel = status?.models?.find(model => model.id === status.model);
  const progress = busy && selectedModel && ['downloading', 'verifying'].includes(selectedModel.stage)
    ? taggerProgressText(selectedModel) : message;
  const previewOpen = Boolean(preview && expanded);
  const dialogRef = useModalA11y<HTMLDivElement>(previewOpen);
  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [previewOpen]);

  const recognize = async (getImage: () => File | Promise<File>) => {
    if (!latest.current.canEdit || running.current) return;
    const token = ++operation.current;
    const current = () => mounted.current && token === operation.current;
    running.current = true;
    setBusy(true); setError(''); setMessage('正在读取图片…');
    try {
      // 立即读取，不能在用户点击与剪贴板授权之间先等待模型状态。
      const file = await getImage();
      if (!current()) return;
      if (!latest.current.canEdit) { setMessage('未写入角色提示词'); return; }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请粘贴 PNG、JPEG 或 WebP 图片');
      if (file.size > 20 * 1024 * 1024) throw new Error('反推图片不能超过 20 MiB');
      setPreview(URL.createObjectURL(file));
      setExpanded(false); setMessage('正在识别…');
      // 不传固定阈值，沿用服务端已选择模型的默认值。
      const result = await imageTaggerService.tagFile(file);
      if (!current()) return;
      if (!latest.current.canEdit) { setMessage('未写入角色提示词'); return; }
      const tags = result.tags.map(tag => tag.name.replaceAll('_', ' ')).join(', ');
      if (tags) latest.current.onAppend(tags);
      setMessage(tags ? `已追加 ${result.tags.length} 个 Tag` : '未识别出可用 Tag');
    } catch (cause) {
      if (current()) { setError(cause instanceof Error ? cause.message : '图片反推失败'); setMessage(''); }
    } finally {
      if (current()) { running.current = false; setBusy(false); }
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLButtonElement>) => {
    const file = getPastedImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault(); event.stopPropagation();
    void recognize(() => file);
  };

  const trigger = <button type="button" aria-label={t(busy ? "反推中…" : "粘贴反推")} aria-busy={busy} disabled={!canEdit || busy} onPaste={handlePaste}
      onClick={() => void recognize(() => readClipboardImage({ pasteHint: '在「粘贴反推」按钮上按 Ctrl+V', imagePurpose: '反推参考' }))}
      title={t("识别剪贴板图片并追加到此角色，也可聚焦按钮后按 Ctrl+V")}
      className="mobile-touch inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 outline-none transition hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-25 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white">
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />}
    </button>;
  // 参考图、识别进度与入口都放在角色卡头部的工具行里：它们属于这次反推操作的状态，
  // 不再单独占提示词框上方一行，避免压住正文。
  const content = <>
    {trigger}
    {preview && <div className="appearance-media relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <button type="button" aria-label={t("放大反推参考图")} title={t("反推参考图，仅作提示词对照")} onClick={() => setExpanded(true)} className="flex h-full w-full items-center justify-center focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
        <img src={preview} alt={t("反推参考图")} className="h-full w-full object-cover" />
      </button>
      <button type="button" aria-label={t("移除反推参考图")} title={t("移除参考图，保留提示词")} onClick={() => { setPreview(''); setExpanded(false); }}
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="h-2.5 w-2.5" /></button>
    </div>}
    {(error || progress) && <p role={error ? 'alert' : 'status'} title={t(error) || progress} className={`max-w-[9rem] truncate text-micro ${error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{t(error) || progress}</p>}
    {previewOpen && <ImagePreviewPortal><div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("反推参考图")}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setExpanded(false); }}>
      <BackButton label={t("返回角色编辑")} onClick={() => setExpanded(false)} className="absolute left-4 top-4 z-10" />
      <img src={preview} alt={t("反推参考图大图")} data-safe-mode-ignore="true" className="max-h-[90dvh] max-w-full object-contain" />
    </div></ImagePreviewPortal>}
  </>;
  if (buttonTarget) return createPortal(content, buttonTarget);
  // 有槽位但还没挂载完成时先不渲染，避免按钮短暂出现在原位。
  if (buttonSlotRef) return null;
  return <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{content}</div>;
};
