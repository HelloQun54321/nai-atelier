import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPaste, LoaderCircle, X } from 'lucide-react';
import { getPastedImageFile, readClipboardImage } from '../../services/imageClipboard';
import { imageTaggerService } from '../../services/imageTaggerService';
import { BackButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y } from '../useModalA11y';
import { taggerProgressText, useImageTaggerStatus } from '../useImageTaggerStatus';

interface CharacterTaggerReferenceProps {
  canEdit: boolean;
  onAppend: (tags: string) => void;
}

/** 参考图片只驻留当前角色编辑组件，不进入生成参数、参考编码或永久资料库。 */
export const CharacterTaggerReference: React.FC<CharacterTaggerReferenceProps> = ({ canEdit, onAppend }) => {
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

  return <div className="w-full min-w-0 space-y-2">
    <button type="button" disabled={!canEdit || busy} onPaste={handlePaste}
      onClick={() => void recognize(() => readClipboardImage({ pasteHint: '在「粘贴反推」按钮上按 Ctrl+V', imagePurpose: '反推参考' }))}
      title="识别剪贴板图片并追加到此角色，也可聚焦按钮后按 Ctrl+V"
      className="flex h-9 w-full items-center justify-center gap-1 rounded border border-gray-200 bg-white px-1 text-xs font-medium text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
      {busy ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5 shrink-0" />}
      {busy ? '反推中…' : '粘贴反推'}
    </button>
    {preview && <div className="relative overflow-hidden rounded border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <button type="button" aria-label="放大反推参考图" title="反推参考图，仅作提示词对照" onClick={() => setExpanded(true)} className="flex min-h-16 w-full items-center justify-center focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
        <img src={preview} alt="反推参考图" className="max-h-40 w-full object-contain" />
      </button>
      <button type="button" aria-label="移除反推参考图" title="移除参考图，保留提示词" onClick={() => { setPreview(''); setExpanded(false); }}
        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="h-3.5 w-3.5" /></button>
    </div>}
    {(error || progress) && <p role={error ? 'alert' : 'status'} title={error || progress} className={`truncate text-micro ${error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{error || progress}</p>}
    {previewOpen && <ImagePreviewPortal><div ref={dialogRef} role="dialog" aria-modal="true" aria-label="反推参考图"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setExpanded(false); }}>
      <BackButton label="返回角色编辑" onClick={() => setExpanded(false)} className="absolute left-4 top-4 z-10" />
      <img src={preview} alt="反推参考图大图" data-safe-mode-ignore="true" className="max-h-[90dvh] max-w-full object-contain" />
    </div></ImagePreviewPortal>}
  </div>;
};
