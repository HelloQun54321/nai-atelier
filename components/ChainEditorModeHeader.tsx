import React from 'react';
import { ArrowLeft } from 'lucide-react';
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
}

export const ChainEditorModeHeader: React.FC<ChainEditorModeHeaderProps> = ({
  isLaboratory,
  entityLabel,
  activeMode,
  onSelectMode,
  isGenerating = false,
  onBack,
}) => {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <IconButton
        label={isLaboratory ? '退出实验室，返回上一页面' : `返回${entityLabel}列表`}
        onClick={() => void onBack()}
        className={isLaboratory ? 'flex-none md:hidden' : 'flex-none'}
      >
        <ArrowLeft className="h-4 w-4" />
      </IconButton>
      <div className="min-w-0 flex-1">
        <GenerationModeNav activeMode={activeMode} onSelect={onSelectMode} disabled={isGenerating} />
      </div>
    </div>
  );
};
