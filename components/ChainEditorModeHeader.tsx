import React from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { GenerationMode } from '../types';
import { GenerationModeNav } from './GenerationModeNav';
import { IconButton } from './DesignSystem';

interface ChainEditorModeHeaderProps {
  isLaboratory: boolean;
  chainName: string;
  entityLabel: '风格串' | '角色串';
  isOwner: boolean;
  activeMode: GenerationMode;
  onSelectMode: (mode: GenerationMode) => void | Promise<void>;
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
  onEditInfo,
  onBack,
}) => {
  if (isLaboratory) return <GenerationModeNav activeMode={activeMode} onSelect={onSelectMode} />;

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
