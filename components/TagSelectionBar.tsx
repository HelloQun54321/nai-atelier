import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';

interface TagSelectionBarProps {
  count: number;
  unit: string;
  onClear: () => void;
  onCopy: () => void | Promise<void>;
  onImport?: () => void;
  onSendToRoll?: () => void;
}

/**
 * 目录只负责选择与取用；权重、角色站位等创作调整在实验室完成。
 * 手机底部导航高于工作区隔离层，浮动条需脱离工作区并抬到导航之上，否则主操作会被遮住。
 */
export const TagSelectionBar: React.FC<TagSelectionBarProps> = ({ count, unit, onClear, onCopy, onImport, onSendToRoll }) => {
  useLanguage();
  if (!count) return null;
  return <ImagePreviewPortal><div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom)+0.75rem)] z-[60] flex justify-center px-4 md:bottom-6">
    <div className="appearance-panel pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
      <span aria-live="polite" className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("已选 {0} {1}", [count, unit])}</span>
      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
      <button type="button" onClick={onClear} className="mobile-touch rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">{t("清空")}</button>
      <ToolbarButton onClick={() => void onCopy()} className="mobile-touch !h-8 !px-3 !text-xs">{t("复制全部")}</ToolbarButton>
      {onSendToRoll && <ToolbarButton onClick={onSendToRoll} className="mobile-touch !h-8 !px-3 !text-xs">{t("在 Roll 中固定")}</ToolbarButton>}
      {onImport && <ToolbarButton tone="primary" onClick={onImport} className="mobile-touch !h-8 !px-3 !text-xs">{t("导入实验室")}</ToolbarButton>}
    </div>
  </div></ImagePreviewPortal>;
};
