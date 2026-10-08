import React from 'react';
import { Heart, Pencil } from 'lucide-react';

interface TagCoverActionsProps {
  favorite: boolean;
  onToggleFavorite: () => void;
  onEditInfo?: () => void;
}

/** 收藏和资料管理放在左上，右上留给统一图片操作；生成统一在实验室完成。 */
export const TagCoverActions: React.FC<TagCoverActionsProps> = ({
  favorite,
  onToggleFavorite,
  onEditInfo,
}) => {
  return (
    <div data-card-action="true" className="hover-reveal-touch absolute left-2 top-2 z-20 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-2" onClick={event => event.stopPropagation()}>
      {onEditInfo && <button type="button" aria-label="编辑自定义角色信息" title="编辑信息" onClick={onEditInfo} className="hover-reveal-md mobile-touch flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow backdrop-blur hover:bg-black/85"><Pencil className="h-4 w-4" /></button>}
      <button type="button" onClick={onToggleFavorite} className={`hover-reveal-touch mobile-touch flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow backdrop-blur hover:bg-black/85 ${favorite ? 'text-rose-400' : ''}`} title={favorite ? '取消收藏' : '收藏'} aria-label={favorite ? '取消收藏' : '收藏'}>
        <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
      </button>
    </div>
  );
};
