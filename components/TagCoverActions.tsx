import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { Heart, Pencil, Trash2 } from 'lucide-react';

interface TagCoverActionsProps {
  favorite: boolean;
  onToggleFavorite: () => void;
  onEditInfo?: () => void;
  onDelete?: () => void;
}

/** 收藏和资料管理放在左上，右上留给统一图片操作；生成统一在实验室完成。 */
export const TagCoverActions: React.FC<TagCoverActionsProps> = ({
  favorite,
  onToggleFavorite,
  onEditInfo,
  onDelete,
}) => {
  useLanguage();
  return (
    <div data-card-action="true" className="hover-reveal-touch absolute left-2 top-2 z-20 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-2" onClick={event => event.stopPropagation()}>
      {onDelete && <button type="button" aria-label={t('删除这个自定义角色')} title={t('删除')} onClick={onDelete} className="mobile-size-locked flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 md:w-8"><Trash2 className="h-4 w-4" /></button>}
      {onEditInfo && <button type="button" aria-label={t("编辑自定义角色信息")} title={t("编辑信息")} onClick={onEditInfo} className="hover-reveal-md mobile-touch flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow backdrop-blur hover:bg-black/85"><Pencil className="h-4 w-4" /></button>}
      <button type="button" onClick={onToggleFavorite} className={`hover-reveal-touch mobile-touch flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow backdrop-blur hover:bg-black/85 ${favorite ? 'text-rose-400' : ''}`} title={favorite ? t("取消收藏") : t("收藏")} aria-label={favorite ? t("取消收藏") : t("收藏")}>
        <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
      </button>
    </div>
  );
};
