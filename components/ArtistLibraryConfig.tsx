
import React, { useState, useEffect } from 'react';

// Re-define locally to ensure portability
interface BenchmarkSlot {
    label: string;
    prompt: string;
}

interface BenchmarkConfig {
    slots: BenchmarkSlot[];
    negative: string;
    seed: number;
    steps: number;
    scale: number;
    interval?: number; // Added interval
}

interface ArtistLibraryConfigProps {
    show: boolean;
    onClose: () => void;
    onSave: (config: BenchmarkConfig) => void;
    initialConfig: BenchmarkConfig;
    apiKey: string;
    onApiKeyChange: (key: string) => void;
    rememberApiKey: boolean;
    onRememberApiKeyChange: (remember: boolean) => void;
    notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ArtistLibraryConfig: React.FC<ArtistLibraryConfigProps> = ({
    show, onClose, onSave, initialConfig, apiKey, onApiKeyChange, rememberApiKey, onRememberApiKeyChange, notify
}) => {
    const [draftConfig, setDraftConfig] = useState<BenchmarkConfig>(initialConfig);
    const [slotToDelete, setSlotToDelete] = useState<number | null>(null);

    // Reset draft when opening
    useEffect(() => {
        if (show) {
            setDraftConfig(JSON.parse(JSON.stringify(initialConfig)));
        }
    }, [show, initialConfig]);

    const updateSlot = (index: number, field: keyof BenchmarkSlot, value: string) => {
        const newSlots = [...draftConfig.slots];
        newSlots[index] = { ...newSlots[index], [field]: value };
        setDraftConfig({ ...draftConfig, slots: newSlots });
    };
  
    const addSlot = () => {
        setDraftConfig({
            ...draftConfig,
            slots: [...draftConfig.slots, { label: `分组 ${draftConfig.slots.length + 1}`, prompt: "" }]
        });
    };
  
    const handleDeleteClick = (index: number) => {
        setSlotToDelete(index);
    };
  
    const confirmDeleteSlot = () => {
        if (slotToDelete === null) return;
        const newSlots = draftConfig.slots.filter((_, i) => i !== slotToDelete);
        setDraftConfig({ ...draftConfig, slots: newSlots });
        setSlotToDelete(null);
    };

    const handleSave = () => {
        onSave(draftConfig);
    };

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh] relative">
                
                {/* Delete Confirmation Overlay */}
                {slotToDelete !== null && (
                    <div className="absolute inset-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur flex items-center justify-center rounded-xl p-4">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 max-w-sm text-center">
                            <h4 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">确认删除此分组？</h4>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                                删除第 {slotToDelete + 1} 组 ({draftConfig.slots[slotToDelete]?.label}) 会导致后续分组序号前移，可能会使已生成的实装图错位。
                            </p>
                            <div className="flex gap-3 justify-center">
                                <button onClick={() => setSlotToDelete(null)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">取消</button>
                                <button onClick={confirmDeleteSlot} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-bold shadow-lg transition-colors">确认删除</button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">⚙️ 实装测试配置</h3>
                    <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded">编辑模式</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">配置生成实装图时的参数。系统会自动添加 <code>artist:NAME</code>。</p>
                </div>
                
                <div className="p-6 overflow-y-auto space-y-6">
                    {/* API Key Input */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">NovelAI API Key (Bearer Token)</label>
                        <input
                            type="password"
                            className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white font-mono"
                            placeholder="pst-..."
                            value={apiKey}
                            onChange={e => onApiKeyChange(e.target.value)}
                        />
                        <div className="flex items-center justify-between mt-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rememberApiKey}
                                    onChange={e => onRememberApiKeyChange(e.target.checked)}
                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-xs text-gray-500 dark:text-gray-400">记住 Key（关闭浏览器后仍保留）</span>
                            </label>
                            <span className="text-[10px] text-yellow-600 dark:text-yellow-400">
                                {rememberApiKey ? '⚠️ 持久化存储' : '🔒 会话级存储'}
                            </span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">
                            {rememberApiKey
                                ? 'Key 将混淆存储在本地，关闭浏览器后仍保留。请确保设备安全。'
                                : 'Key 仅在当前会话有效，关闭标签页后自动清除。更安全。'}
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase">测试分组 (Slots)</label>
                            <button onClick={addSlot} className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800">
                                + 添加分组
                            </button>
                        </div>
                        
                        {draftConfig.slots.map((slot, i) => (
                            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/50 relative group/slot">
                                <div className="flex justify-between mb-2 gap-2">
                                    <div className="flex items-center gap-2 flex-1">
                                        <span className="text-xs font-mono text-gray-400 w-4">{i + 1}.</span>
                                        <input 
                                            type="text"
                                            className="text-xs font-bold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none dark:text-white transition-colors w-full"
                                            value={slot.label}
                                            onChange={e => updateSlot(i, 'label', e.target.value)}
                                            placeholder="分组名称"
                                        />
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteClick(i)} // Trigger confirm modal
                                        className="text-gray-400 hover:text-red-500 text-xs px-2"
                                        title="删除此分组"
                                    >
                                        删除
                                    </button>
                                </div>
                                <textarea 
                                    className="w-full h-16 p-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-600 rounded text-xs dark:text-white font-mono resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                    value={slot.prompt}
                                    onChange={e => updateSlot(i, 'prompt', e.target.value)}
                                    placeholder="输入测试 Prompt..."
                                />
                            </div>
                        ))}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-red-500 dark:text-red-400 mb-1 uppercase">通用负面 (Negative Prompt)</label>
                        <textarea 
                            className="w-full h-16 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs dark:text-white font-mono resize-none focus:ring-1 focus:ring-red-500 outline-none"
                            value={draftConfig.negative}
                            onChange={e => setDraftConfig({...draftConfig, negative: e.target.value})}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Seed (-1 = Random)</label>
                            <div className="flex gap-2">
                            <input 
                                type="number" 
                                className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                value={draftConfig.seed}
                                onChange={e => setDraftConfig({...draftConfig, seed: parseInt(e.target.value)})}
                            />
                            <button
                                onClick={() => setDraftConfig({...draftConfig, seed: -1})}
                                className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs whitespace-nowrap"
                                title="设置为 -1 (随机)"
                            >
                                随机
                            </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Steps / Scale</label>
                            <div className="flex gap-2">
                                <input 
                                    type="number" placeholder="Steps"
                                    className="w-1/2 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                    value={draftConfig.steps}
                                    onChange={e => setDraftConfig({...draftConfig, steps: parseInt(e.target.value)})}
                                />
                                <input 
                                    type="number" placeholder="Scale"
                                    className="w-1/2 p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                    value={draftConfig.scale}
                                    onChange={e => setDraftConfig({...draftConfig, scale: parseFloat(e.target.value)})}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">队列间隔 (ms)</label>
                            <input 
                                type="number" 
                                className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm dark:text-white"
                                value={draftConfig.interval ?? 3000}
                                min={500}
                                onChange={e => setDraftConfig({...draftConfig, interval: parseInt(e.target.value)})}
                            />
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-900 rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white">取消</button>
                    <button onClick={handleSave} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold shadow-lg">保存配置</button>
                </div>
            </div>
        </div>
    );
};
