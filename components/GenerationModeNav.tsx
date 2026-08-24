import React from 'react';
import { GenerationMode } from '../types';

const GENERATION_MODES: { mode: GenerationMode; label: string }[] = [
  { mode: 'text-to-image', label: '文生图' },
  { mode: 'image-to-image', label: '图生图' },
  { mode: 'inpaint', label: '局部重绘' },
  { mode: 'outpaint', label: '扩图' },
];

interface GenerationModeNavProps {
  activeMode: GenerationMode;
  onSelect: (mode: GenerationMode) => void | Promise<void>;
}

export const GenerationModeNav: React.FC<GenerationModeNavProps> = ({ activeMode, onSelect }) => (
  <nav className="generation-mode-nav mx-auto grid w-full max-w-3xl grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900" aria-label="生成模式">
    {GENERATION_MODES.map(({ mode, label }) => (
      <button
        key={mode}
        type="button"
        aria-current={activeMode === mode ? 'page' : undefined}
        onClick={() => void onSelect(mode)}
        className={`mobile-touch min-w-0 rounded-lg px-1.5 py-1.5 text-[11px] font-bold transition sm:px-3 sm:text-xs ${activeMode === mode ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
      >
        {label}
      </button>
    ))}
  </nav>
);
