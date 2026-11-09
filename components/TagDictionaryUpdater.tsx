import { t, useLanguage, getLanguage } from '../services/i18n';
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

const formatDate = (value: string | null | undefined) => {
  if (!value) return t('未知');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('未知') : date.toLocaleString(getLanguage(), { hour12: false });
};

export const TagDictionaryUpdater: React.FC<TagDictionaryUpdaterProps> = ({ notify }) => {
  useLanguage();
  const [status, setStatus] = useState<TagUpdateStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const appliedResultRef = useRef<string | null | undefined>(undefined);

  const loadStatus = async () => {
    try {
      const next = await getTagUpdateStatus();
      setStatus(next);
      setConnectionError('');
      // 重新打开设置仍刷新词库缓存，但不重复通知旧更新。
      const isFirstRead = appliedResultRef.current === undefined;
      if ((next.phase === 'completed' || next.phase === 'unchanged') && next.finishedAt && appliedResultRef.current !== next.finishedAt) {
        appliedResultRef.current = next.finishedAt;
        if (next.phase === 'completed') {
          resetTagDictionaryCache();
          if (!isFirstRead) notify(`Tag 词库已更新，共 ${(next.manifest?.count ?? 0).toLocaleString(getLanguage())} 条`, 'success');
        } else if (!isFirstRead) {
          notify('Tag 词库已经是最新版本', 'success');
        }
      }
      if (isFirstRead) appliedResultRef.current = next.finishedAt;
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : '无法连接 Tag 更新服务');
    }
  };

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), status?.running ? 700 : 3000);
    return () => window.clearInterval(timer);
  }, [status?.running]);

  const handleUpdate = async () => {
    setIsStarting(true);
    try {
      appliedResultRef.current = null;
      setConnectionError('');
      setStatus(await startTagUpdate());
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法开始更新';
      setConnectionError(message);
      notify(message, 'error');
    } finally {
      setIsStarting(false);
    }
  };

  const isRunning = isStarting || Boolean(status?.running);
  const isError = !isStarting && (status?.phase === 'error' || Boolean(connectionError));
  const progress = PHASE_PROGRESS[isStarting ? 'checking' : status?.phase || 'idle'];
  const message = isStarting ? t('正在检查上游数据库…') : (connectionError || status?.message || '').split('\n').map(line => t(line)).join('\n');
  const showProgress = isRunning || status?.phase === 'completed' || status?.phase === 'unchanged' || isError;

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold text-gray-900 dark:text-white">{t('Tag 补全词库')}</h4>
        <div className="flex flex-none gap-2">
          <a href="https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table" target="_blank" rel="noreferrer" className="appearance-group mobile-touch flex items-center gap-1.5 rounded bg-gray-100 px-2 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700" title={t('打开词库 GitHub 原址')}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5v5m-1-4L10 14M19 14v4a1 1 0 01-1 1H6a1 1 0 011-1h4" /></svg>
            <span>{t('词库来源')}</span>
          </a>
          <button type="button" data-appearance="control" data-tone="neutral" disabled={isRunning} onClick={() => void handleUpdate()} className="mobile-touch flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2 py-1.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50" title={t('检查并更新 Tag 补全词库')}>
            <svg className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357 2m15.357 2H15" /></svg>
            <span>{isRunning ? t('更新中…') : t('更新词库')}</span>
          </button>
        </div>
      </div>
      {showProgress && (
        <div className="space-y-2">
          <p role={isError ? 'alert' : 'status'} className={`whitespace-pre-line text-xs leading-5 [overflow-wrap:anywhere] ${isError ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>{message}</p>
          <div role="progressbar" aria-label={t('词库更新进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={message} className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className={`h-full rounded-full transition-all duration-500 ${isError ? 'bg-red-500' : 'bg-indigo-700'} ${isRunning ? 'animate-pulse' : ''}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
        <span>{t('当前 Tag 数量')}：<span className="font-medium tabular-nums text-gray-600 dark:text-gray-300">{status ? (status.manifest?.count ?? 0).toLocaleString(getLanguage()) : '—'}</span></span>
        <span>{t('词库生成时间')}：{formatDate(status?.manifest?.generatedAt)}</span>
      </div>
    </div>
  );
};
