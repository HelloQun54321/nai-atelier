import React from 'react';
import { Pencil } from 'lucide-react';
import { GenerationMode } from '../types';
import { GenerationModeNav } from './GenerationModeNav';

interface ChainEditorModeHeaderProps {
  isLaboratory: boolean;
  chainName: string;
  entityLabel: '风格串' | '角色串';
  isOwner: boolean;
  activeMode: GenerationMode;
  onSelectMode: (mode: GenerationMode) => void | Promise<void>;
  onEditInfo: () => void;
}

export const ChainEditorModeHeader: React.FC<ChainEditorModeHeaderProps> = ({
  isLaboratory,
  chainName,
  entityLabel,
  isOwner,
  activeMode,
  onSelectMode,
  onEditInfo,
}) => {
  if (isLaboratory) return <GenerationModeNav activeMode={activeMode} onSelect={onSelectMode} />;

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {isOwner && (
        <button
          type="button"
          onClick={onEditInfo}
          className="mobile-touch flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
          aria-label={`编辑${entityLabel}信息`}
          title={`编辑${entityLabel}名称与信息`}
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-bold text-gray-900 dark:text-white md:text-lg" title={chainName}>{chainName}</h1>
    </div>
  );
};
