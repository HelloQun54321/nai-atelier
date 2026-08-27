import React, { useState } from 'react';
import { ToolbarButton } from './DesignSystem';
import { ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react';

export interface CartItem {
    name: string;
    weight: number; 
}

interface ArtistLibraryCartProps {
    cart: CartItem[];
    updateWeight: (index: number, delta: number) => void;
    toggleCart: (name: string) => void;
    setCart: (cart: CartItem[]) => void;
    copyCart: () => void;
    importCart?: () => void;
    formatTag: (item: CartItem) => string;
}

export const ArtistLibraryCart: React.FC<ArtistLibraryCartProps> = ({
    cart, updateWeight, toggleCart, setCart, copyCart, importCart, formatTag
}) => {
    const [showDetail, setShowDetail] = useState(false);

    return (
        <div className={`pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 transition-all duration-300 ${cart.length > 0 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
            <div className="pointer-events-auto relative flex flex-col items-center">
                {showDetail && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowDetail(false)} />
                        <div role="dialog" aria-label="画师权重与微调" className="absolute bottom-[calc(100%+0.5rem)] z-50 max-h-60 w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
                            <div className="mb-2 flex items-center justify-between px-1 text-xs font-bold text-gray-800 dark:text-white">
                                <span>微调画师权重</span>
                                <span className="text-[11px] font-normal text-gray-500">点击 - / + 增减权重括号</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {cart.map((item, idx) => (
                                    <div key={item.name} className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-2 py-1 text-xs shadow-sm dark:border-gray-700 dark:bg-gray-800">
                                        <button type="button" onClick={() => updateWeight(idx, -1)} className="px-1 font-mono font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white">-</button>
                                        <span className="mx-1 font-mono font-medium text-indigo-600 dark:text-indigo-300">{formatTag(item)}</span>
                                        <button type="button" onClick={() => updateWeight(idx, 1)} className="px-1 font-mono font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white">+</button>
                                        <button type="button" onClick={() => toggleCart(item.name)} className="ml-1.5 border-l border-gray-300 pl-1.5 text-red-500 hover:text-red-700 dark:border-gray-600">×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}

                <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-2.5 shadow-2xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
                    <button
                        type="button"
                        onClick={() => setShowDetail(value => !value)}
                        className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-400"
                        title="点击展开/收起画师权重微调"
                    >
                        <span>已选 <span className="font-bold text-indigo-600 dark:text-indigo-400">{cart.length}</span> 位画师</span>
                        <SlidersHorizontal className="h-3.5 w-3.5 opacity-70" />
                    </button>
                    <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
                    <button
                        type="button"
                        onClick={() => setCart([])}
                        className="rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                        清空
                    </button>
                    <div className="flex items-center gap-1.5">
                        <ToolbarButton
                            tone="neutral"
                            disabled={cart.length === 0}
                            onClick={copyCart}
                            className="!h-8 !px-3 !text-xs"
                        >
                            复制全部
                        </ToolbarButton>
                        {importCart && (
                            <ToolbarButton
                                tone="primary"
                                disabled={cart.length === 0}
                                onClick={importCart}
                                className="!h-8 !px-3 !text-xs"
                            >
                                导入实验室
                            </ToolbarButton>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
