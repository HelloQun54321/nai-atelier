
import React from 'react';

interface CartItem {
    name: string;
    weight: number; 
}

interface ArtistLibraryCartProps {
    cart: CartItem[];
    updateWeight: (index: number, delta: number) => void;
    toggleCart: (name: string) => void;
    setCart: (cart: CartItem[]) => void;
    copyCart: () => void;
    formatTag: (item: CartItem) => string;
}

export const ArtistLibraryCart: React.FC<ArtistLibraryCartProps> = ({
    cart, updateWeight, toggleCart, setCart, copyCart, formatTag
}) => {
    return (
        <div className={`absolute bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 transition-transform duration-300 transform shadow-[0_-5px_20px_rgba(0,0,0,0.1)] z-30 ${cart.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="p-4 max-w-6xl mx-auto flex flex-col md:flex-row gap-4 items-center">
                <div className="flex-1 overflow-x-auto flex gap-2 pb-2 md:pb-0 w-full no-scrollbar">
                    {cart.map((item, idx) => (
                        <div key={item.name} className="flex items-center bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 flex-shrink-0 text-sm shadow-sm select-none">
                            <button onClick={() => updateWeight(idx, -1)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white px-1 font-mono font-bold">-</button>
                            <span className="mx-1 font-mono text-indigo-600 dark:text-indigo-300 font-medium">{formatTag(item)}</span>
                            <button onClick={() => updateWeight(idx, 1)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white px-1 font-mono font-bold">+</button>
                            <button onClick={() => toggleCart(item.name)} className="ml-2 text-red-500 hover:text-red-700 border-l border-gray-300 dark:border-gray-600 pl-2">×</button>
                        </div>
                    ))}
                </div>
                <div className="flex gap-2 flex-shrink-0 items-center w-full md:w-auto justify-between md:justify-end">
                    <div className="text-sm text-gray-500 dark:text-gray-400 mr-2">已选 <span className="font-bold text-gray-900 dark:text-white">{cart.length}</span></div>
                    <div className="flex gap-2">
                    <button onClick={() => setCart([])} className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm font-bold transition-colors">清空</button>
                    <button onClick={copyCart} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold shadow-lg shadow-indigo-500/20 transition-colors">复制</button>
                    </div>
                </div>
            </div>
        </div>
    );
};
