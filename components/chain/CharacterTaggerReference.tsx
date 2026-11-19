import { t, useLanguage } from '../../services/i18n';
import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus } from 'lucide-react';
import { ImageTaggerPanel } from '../ImageTaggerPanel';
import { ImagePreviewPortal } from '../ImagePreviewPortal';

interface CharacterTaggerReferenceProps {
  buttonSlotRef?: React.RefObject<HTMLElement | null>;
  canEdit: boolean;
  notify?: (message: string, type?: 'success' | 'error') => void;
  onAppend: (tags: string) => void;
}

/**
 * 角色就地反推：不再自己读剪贴板、也不再在角色卡上留参考图，
 * 而是打开与 Pixiv／Danbooru／实验室／提示词库共用的「识别图片 Tag」页面，
 * 选图、识别、勾选后把结果追加到当前角色。
 */
export const CharacterTaggerReference: React.FC<CharacterTaggerReferenceProps> = ({ canEdit, onAppend, buttonSlotRef, notify }) => {
  useLanguage();
  const [buttonTarget, setButtonTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setButtonTarget(buttonSlotRef?.current || null); }, [buttonSlotRef]);
  const [open, setOpen] = useState(false);
  const trigger = <button type="button" aria-label={t('粘贴反推')} disabled={!canEdit} onClick={() => setOpen(true)}
    title={t('识别图片 Tag 并追加到此角色')}
    className="mobile-touch inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 outline-none transition hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-25 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white">
    <ImagePlus className="h-4 w-4" aria-hidden="true" />
  </button>;
  return <>
    {buttonSlotRef ? (buttonTarget ? createPortal(trigger, buttonTarget) : null) : trigger}
    {open && <ImagePreviewPortal><ImageTaggerPanel contextual open onClose={() => setOpen(false)} onInsert={onAppend}
      notify={notify ?? (() => {})} actionLabel={t('追加 {count} 个 Tag 到此角色')} /></ImagePreviewPortal>}
  </>;
};
