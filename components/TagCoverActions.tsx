import React, { useState } from 'react';
import { Heart, Pin } from 'lucide-react';
import type { DanbooruCoverCandidate } from '../services/danbooruService';

interface TagCoverActionsProps {
  favorite: boolean;
  onToggleFavorite: () => void;
  candidate?: DanbooruCoverCandidate | null;
  onSetCover?: (candidate: DanbooruCoverCandidate) => Promise<void> | void;
  /** Pin（设为固定封面）按钮位置：右上动作组（默认，角色卡）或图片右下角（画师卡）。 */
  pinPlacement?: 'top-right' | 'bottom-right';
  children?: React.ReactNode;
}

/** Shared image-overlay actions for the character and artist Tag cards. */
export const TagCoverActions: React.FC<TagCoverActionsProps> = ({
  favorite,
  onToggleFavorite,
  candidate = null,
  onSetCover,
  pinPlacement = 'top-right',
  children,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const setCover = async () => {
    if (!candidate || !onSetCover || isSaving) return;
    setIsSaving(true);
    try {
      await onSetCover(candidate);
    } finally {
      setIsSaving(false);
    }
  };

  const pinButton = candidate && onSetCover ? (
    <button type="button" disabled={isSaving} onClick={() => void setCover()} className="mobile-size-locked flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600/90 text-white shadow backdrop-blur hover:bg-indigo-500 disabled:opacity-60" title="设为固定封面" aria-label="设为固定封面">
      <Pin className="h-3.5 w-3.5" />
    </button>
  ) : null;

  return <>
    <div className="absolute right-2 top-2 z-20 flex flex-col items-center gap-2" onClick={event => event.stopPropagation()}>
      <button type="button" onClick={onToggleFavorite} className={`mobile-size-locked flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow backdrop-blur hover:bg-black/85 ${favorite ? 'text-rose-400' : ''}`} title={favorite ? '取消收藏' : '收藏'} aria-label={favorite ? '取消收藏' : '收藏'}>
        <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
      </button>
      {pinPlacement === 'top-right' && pinButton}
      {children}
    </div>
    {pinPlacement === 'bottom-right' && pinButton && (
      <div className="absolute bottom-2 right-2 z-20" onClick={event => event.stopPropagation()}>
        {pinButton}
      </div>
    )}
  </>;
};
