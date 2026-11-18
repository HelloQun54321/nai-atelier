import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { GenerationMode } from '../types';
import { GenerationModeNav } from './GenerationModeNav';
import { IconButton } from './DesignSystem';

interface ChainEditorModeHeaderProps {
  isLaboratory: boolean;
  entityLabel: '风格串' | '自定义角色';
  /** 当前编辑对象名称：电脑端在返回箭头旁显示，手机端省略以让出模式标题。 */
  entityName?: string;
  activeMode: GenerationMode;
  onSelectMode: (mode: GenerationMode) => void | Promise<void>;
  /** 生成进行中禁用模式切换（透传至 GenerationModeNav）。 */
  isGenerating?: boolean;
  onBack: () => void | Promise<void>;
}

export const ChainEditorModeHeader: React.FC<ChainEditorModeHeaderProps> = ({
  isLaboratory,
  entityLabel,
  entityName,
  activeMode,
  onSelectMode,
  isGenerating = false,
  onBack,
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
      {!isLaboratory && entityName && <span title={entityName} className="hidden min-w-0 max-w-48 truncate text-sm font-semibold text-gray-700 dark:text-gray-300 md:inline">{entityName}</span>}
      <div className="min-w-0 md:flex-1">
        <GenerationModeNav activeMode={activeMode} onSelect={onSelectMode} disabled={isGenerating} />
      </div>
    </div>
  );
};
