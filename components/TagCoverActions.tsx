import React from 'react';
import { FavoriteButton } from './DesignSystem';

interface TagCoverActionsProps {
  favorite: boolean;
  onToggleFavorite: () => void;
}

/** 词库条目只在封面左上收藏，自定义资料沿用风格串卡片布局。 */
export const TagCoverActions: React.FC<TagCoverActionsProps> = ({
  favorite,
  onToggleFavorite,
}) => {
  return (
    <div data-card-action="true" className="hover-reveal-touch absolute left-2 top-2 z-20" onClick={event => event.stopPropagation()}>
      <FavoriteButton overlay active={favorite} onClick={onToggleFavorite} className="hover-reveal-touch !h-11 !w-11 md:!h-8 md:!w-8" />
    </div>
  );
};
