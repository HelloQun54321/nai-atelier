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
        <IconButton
          label={t("漫画")}
          onClick={onOpenComic}
          className="ml-auto flex-none md:hidden"
        >
          <LayoutGrid className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
};
