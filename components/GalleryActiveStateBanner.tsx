import React from 'react';
import { Dice5, LoaderCircle } from 'lucide-react';

interface GalleryActiveStateBannerProps {
  count: number;
  entityName: string;
  onDrawAgain: () => void;
  onExit: () => void;
  isLoading?: boolean;
}

export const GalleryActiveStateBanner: React.FC<GalleryActiveStateBannerProps> = ({
  count,
  entityName,
  onDrawAgain,
  onExit,
  isLoading = false,
}) => (
  <div className="flex h-9 flex-none items-center justify-between border-b border-indigo-100 bg-indigo-50/70 px-4 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/30">
    <span className="flex items-center gap-1.5 font-medium text-indigo-700 dark:text-indigo-300">
      {isLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Dice5 className="h-3.5 w-3.5" />}
      正在浏览随机抽取的 {count} 位{entityName}
    </span>
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onDrawAgain}
        disabled={isLoading}
        className="font-bold text-indigo-600 hover:underline dark:text-indigo-400 disabled:opacity-50"
      >
        再抽一批
      </button>
      <span className="text-gray-300 dark:text-gray-700">|</span>
      <button
        type="button"
        onClick={onExit}
        className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        返回完整目录
      </button>
    </div>
  </div>
);

