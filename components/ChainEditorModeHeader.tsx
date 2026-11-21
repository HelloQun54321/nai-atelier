import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { GenerationMode } from '../types';
import { GenerationModeNav } from './GenerationModeNav';
import { IconButton } from './DesignSystem';

interface ChainEditorModeHeaderProps {
  isLaboratory: boolean;
  entityLabel: '风格串' | '自定义角色';
  activeMode: GenerationMode;
  onSelectMode: (mode: GenerationMode) => void | Promise<void>;
  /** 生成进行中禁用模式切换（透传至 GenerationModeNav）。 */
  isGenerating?: boolean;
  onBack: () => void | Promise<void>;
  /** 手机端实验室顶栏直达「漫画」入口（参照风格串→Roll 串、历史→足迹成对设计）。 */
  onOpenComic?: () => void;
}

export const ChainEditorModeHeader: React.FC<ChainEditorModeHeaderProps> = ({
  isLaboratory,
  entityLabel,
  activeMode,
  onSelectMode,
  isGenerating = false,
  onBack,
  onOpenComic,
}) => {
  useLanguage();
  // 手机：返回 + 模式标题成一组左对齐；电脑：模式导航仍占满中间可用宽。
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
      <IconButton
        label={isLaboratory ? t("退出实验室，返回上一页面") : t("返回{0}列表", [t(entityLabel)])}
        onClick={() => void onBack()}
        className={isLaboratory ? 'flex-none md:hidden' : 'flex-none'}
      >
        <ArrowLeft className="h-4 w-4" />
      </IconButton>
      <div className="min-w-0 md:flex-1">
        <GenerationModeNav activeMode={activeMode} onSelect={onSelectMode} disabled={isGenerating} />
      </div>
      {isLaboratory && onOpenComic && (
        <button
          type="button"
          aria-label={t("漫画")}
          title={t("进入漫画创作模式")}
          onClick={onOpenComic}
          className="mobile-touch ml-auto inline-flex h-8 flex-none items-center gap-1 rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800/70 dark:bg-indigo-950/50 dark:text-indigo-300 md:hidden"
        >
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("漫画")}</span>
        </button>
      )}
    </div>
  );
};
