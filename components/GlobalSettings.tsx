import React, { useEffect, useState } from 'react';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';

interface GlobalSettingsProps {
  open: boolean;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const readApiKey = () => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ open, onClose, notify }) => {
  const [apiKey, setApiKey] = useState(readApiKey);
  const [rememberApiKey, setRememberApiKey] = useState(() => localStorage.getItem('nai_api_key') !== null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey(readApiKey());
    setRememberApiKey(localStorage.getItem('nai_api_key') !== null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const broadcastApiKey = (value: string) => {
    window.dispatchEvent(new CustomEvent<string>('nai-api-key-changed', { detail: value }));
  };

  const updateApiKey = (value: string) => {
    setApiKey(value);
    if (value) sessionStorage.setItem('nai_api_key', value);
    else sessionStorage.removeItem('nai_api_key');
    if (rememberApiKey && value) localStorage.setItem('nai_api_key', value);
    else localStorage.removeItem('nai_api_key');
    broadcastApiKey(value);
  };

  const updateRememberApiKey = (remember: boolean) => {
    setRememberApiKey(remember);
    if (remember && apiKey) localStorage.setItem('nai_api_key', apiKey);
    else localStorage.removeItem('nai_api_key');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">全局设置</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">连接信息和本地数据维护</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="关闭全局设置">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <div className="mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white">NovelAI 连接</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">生图实验室和画师预览生成共用同一个 API Key。</p>
            </div>
            <div className="flex gap-2">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={event => updateApiKey(event.target.value.trim())}
                placeholder="输入 NovelAI API Key"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                aria-label="NovelAI API Key"
              />
              <button type="button" onClick={() => setShowApiKey(value => !value)} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={rememberApiKey} onChange={event => updateRememberApiKey(event.target.checked)} className="rounded border-gray-300 text-indigo-600" />
              在本机记住 API Key
            </label>
            <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">不勾选时仅保留到当前浏览器会话结束；浏览器前端无法对密钥提供真正的加密保护。</p>
          </section>

          <section className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Tag 补全词库</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">查看版本、数量并检查中英 Tag 数据更新。</p>
            </div>
            <TagDictionaryUpdater notify={notify} />
          </section>
        </div>
      </div>
    </div>
  );
};
