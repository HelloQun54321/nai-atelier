import React from 'react';
import { Palette, UserRound } from 'lucide-react';
import { ChainCoverDecision } from '../../services/chainCover';

export interface ChainEditorForkModalProps {
    showForkModal: boolean;
    setShowForkModal: (value: boolean) => void;
    confirmFork: (targetType: 'style' | 'character') => void | Promise<void>;
    isUploading: boolean;
    currentPreviewCover: ChainCoverDecision;
}

export const ChainEditorForkModal: React.FC<ChainEditorForkModalProps> = ({
    showForkModal,
    setShowForkModal,
    confirmFork,
    isUploading,
    currentPreviewCover,
}) => showForkModal ? (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 text-center">选择保存类型</h3>
            {currentPreviewCover.source && <p className="mb-4 text-center text-xs text-gray-500 dark:text-gray-400">保存为风格串时，当前显示图片会自动成为封面。</p>}
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => void confirmFork('style')}
                    disabled={isUploading}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors gap-2"
                >
                    <Palette className="h-6 w-6 text-indigo-500" />
                    <span className="font-bold text-blue-700 dark:text-blue-300">{isUploading ? '保存中…' : '风格串'}</span>
                </button>
                <button
                    onClick={() => void confirmFork('character')}
                    disabled={isUploading}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-pink-50 dark:bg-pink-900/20 border-2 border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-900/40 transition-colors gap-2"
                >
                    <UserRound className="h-6 w-6 text-indigo-500" />
                    <span className="font-bold text-pink-700 dark:text-pink-300">角色串</span>
                </button>
            </div>
            <button
                onClick={() => setShowForkModal(false)}
                className="mt-6 w-full py-2 text-gray-500 hover:text-gray-800 dark:hover:text-white text-sm font-medium"
            >
                取消
            </button>
        </div>
    </div>
) : null;
