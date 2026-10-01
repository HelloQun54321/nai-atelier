import React from 'react';
import { Heart } from 'lucide-react';

interface TagCoverActionsProps {
  favorite: boolean;
  onToggleFavorite: () => void;
}

/** 画师／角色 Tag 卡片只提供收藏操作，生成统一在实验室完成。 */
export const TagCoverActions: React.FC<TagCoverActionsProps> = ({
  favorite,
  onToggleFavorite,
}) => {
  return (
    <div className="absolute right-2 top-2 z-20 flex flex-col items-center gap-2" onClick={event => event.stopPropagation()}>
      <button type="button" onClick={onToggleFavorite} className={`mobile-size-locked flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow backdrop-blur hover:bg-black/85 ${favorite ? 'text-rose-400' : ''}`} title={favorite ? '取消收藏' : '收藏'} aria-label={favorite ? '取消收藏' : '收藏'}>
        <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
      </button>
    </div>
  );
};
