import React from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { GenerationMode } from '../types';
import { GenerationModeNav } from './GenerationModeNav';
import { IconButton } from './DesignSystem';

interface ChainEditorModeHeaderProps {
  isLaboratory: boolean;
  chainName: string;
  entityLabel: '风格串' | '自定义角色';
  isOwner: boolean;
  activeMode: GenerationMode;
  onSelectMode: (mode: GenerationMode) => void | Promise<void>;
  /** 生成进行中禁用模式切换（透传至 GenerationModeNav）。 */
  isGenerating?: boolean;
  onEditInfo: () => void;
  onBack: () => void | Promise<void>;
}

export const ChainEditorModeHeader: React.FC<ChainEditorModeHeaderProps> = ({
  isLaboratory,
  chainName,
  entityLabel,
  isOwner,
  activeMode,
  onSelectMode,
  isGenerating = false,
  onEditInfo,
  onBack,
}) => {
  if (isLaboratory) return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {/* 手机端实验室无侧边栏与底部导航，返回箭头是唯一出口；桌面/平板有侧边栏，不造重复入口 */}
      <IconButton label="退出实验室，返回上一页面" onClick={() => void onBack()} className="flex-none md:hidden">
        <ArrowLeft className="h-4 w-4" />
      </IconButton>
      <GenerationModeNav activeMode={activeMode} onSelect={onSelectMode} disabled={isGenerating} />
    </div>
  );

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <IconButton
        label={`返回${entityLabel}列表`}
        onClick={() => void onBack()}
      >
        <ArrowLeft className="h-4 w-4" />
      </IconButton>
      {isOwner && (
        <IconButton
          label={`编辑${entityLabel}信息`}
          onClick={onEditInfo}
        >
          <Pencil className="h-4 w-4" />
        </IconButton>
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-bold text-gray-900 dark:text-white md:text-lg" title={chainName}>{chainName}</h1>
    </div>
  );
};
