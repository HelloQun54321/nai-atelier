import React, { useEffect, useRef, useState } from 'react';
import { resetTagDictionaryCache } from '../services/tagDictionary';
import { getTagUpdateStatus, startTagUpdate, TagUpdatePhase, TagUpdateStatus } from '../services/tagDictionaryUpdater';

interface TagDictionaryUpdaterProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

const PHASE_PROGRESS: Record<TagUpdatePhase, number> = {
  idle: 0,
  checking: 15,
  downloading: 40,
  generating: 65,
  building: 88,
  completed: 100,
  unchanged: 100,
  error: 100
};

const formatDate = (value: string | null) => {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false });
};

export const TagDictionaryUpdater: React.FC<TagDictionaryUpdaterProps> = ({ notify }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<TagUpdateStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const appliedResultRef = useRef<string | null>(null);

  const loadStatus = async () => {
    try {
      const next = await getTagUpdateStatus();
      setStatus(next);
      setConnectionError('');

      if ((next.phase === 'completed' || next.phase === 'unchanged') && next.finishedAt && appliedResultRef.current !== next.finishedAt) {
        appliedResultRef.current = next.finishedAt;
        if (next.phase === 'completed') {
          resetTagDictionaryCache();
          notify(`Tag 词库已更新，共 ${next.manifest.count.toLocaleString('zh-CN')} 条`, 'success');
        } else {
          notify('Tag 词库已经是最新版本', 'success');
        }
      }
      return next;
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : '无法连接 Tag 更新服务');
      return null;
    }
  };

  useEffect(() => {
    if (!isOpen && !status?.running) return;
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), status?.running ? 700 : 3000);
    return () => window.clearInterval(timer);
  }, [isOpen, status?.running]);

  const handleUpdate = async () => {
    try {
      appliedResultRef.current = null;
      setConnectionError('');
      setStatus(await startTagUpdate());
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法开始更新';
      setConnectionError(message);
      notify(message, 'error');
    }
  };

  const isRunning = Boolean(status?.running);
  const isError = status?.phase === 'error' || Boolean(connectionError);
  const progress = PHASE_PROGRESS[status?.phase || 'idle'];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="px-2 md:px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 rounded text-sm font-medium transition-colors flex items-center gap-1.5"
        title="查看或更新 Tag 补全词库"
      >
        <svg className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>管理词库</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onMouseDown={() => !isRunning && setIsOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-5 py-4">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">Tag 补全词库</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">ffdkj 中英数据库 + NovelAI V4.5</p>
              </div>
              <button type="button" disabled={isRunning} onClick={() => setIsOpen(false)} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" aria-label="关闭">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400">当前 Tag 数量</div>
                  <div className="mt-1 font-semibold text-gray-900 dark:text-white">{status ? status.manifest.count.toLocaleString('zh-CN') : '—'}</div>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400">词库生成时间</div>
                  <div className="mt-1 text-xs font-medium text-gray-900 dark:text-white">{formatDate(status?.manifest.generatedAt || null)}</div>
                </div>
              </div>

              {(isRunning || status?.phase === 'completed' || status?.phase === 'unchanged' || isError) && (
                <div>
                  <div className={`mb-2 text-sm ${isError ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                    {connectionError || status?.message}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className={`h-full transition-all duration-500 ${isError ? 'bg-red-500' : 'bg-indigo-500'} ${isRunning ? 'animate-pulse' : ''}`} style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                检查时会先比较上游版本；没有变化便不会重复下载。网络中断时会自动重试并切换备用线路，现有词库不会受到影响。
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-800 px-5 py-4">
              <button type="button" disabled={isRunning} onClick={() => setIsOpen(false)} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-40">关闭</button>
              <button type="button" disabled={isRunning} onClick={handleUpdate} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isRunning ? '更新中…' : '检查并更新'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
