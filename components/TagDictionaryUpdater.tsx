import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Download, Import as ImportIcon } from 'lucide-react';
import { resetTagDictionaryCache } from '../services/tagDictionary';
import { getTagUpdateStatus, importTagDictionaryFile, startTagUpdate, TAG_IMPORT_MAX_BYTES, TagUpdatePhase, TagUpdateStatus } from '../services/tagDictionaryUpdater';

interface TagDictionaryUpdaterProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

const TAG_DICTIONARY_REPOSITORY_URL = 'https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table';
// 与 scripts/update-tag-dictionary.mjs 的 TRANSLATION_DATABASE_URL 同源：手动导入选的就是这个文件。
const TAG_DICTIONARY_DOWNLOAD_URL = 'https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/main/tag.sqlite';
const TAG_DICTIONARY_APPROX_SIZE_MB = 24;
// 三个操作共用同一尺寸、圆角与间距；只有主动作「更新词库」用强调色，其余保持中性。
const TAG_ACTION_CLASS = 'appearance-group mobile-touch flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors';
const TAG_ACTION_NEUTRAL_CLASS = `${TAG_ACTION_CLASS} bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700`;
const TAG_ACTION_PRIMARY_CLASS = `${TAG_ACTION_CLASS} bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50`;

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
  const [importing, setImporting] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const importInputRef = useRef<HTMLInputElement>(null);
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

  const handleImport = async (file: File) => {
    if (importing) return;
    if (!file.size) {
      notify(t('选择的词库文件是空的，请重新下载 tag.sqlite'), 'error');
      return;
    }
    if (file.size > TAG_IMPORT_MAX_BYTES) {
      notify(t('词库文件不能超过 {0} MB，请确认选择的是 tag.sqlite', [TAG_IMPORT_MAX_BYTES / 1024 / 1024]), 'error');
      return;
    }
    setImporting(true);
    setUploadPercent(0);
    setConnectionError('');
    try {
      const next = await importTagDictionaryFile(file, setUploadPercent);
      appliedResultRef.current = null;
      setStatus(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : '词库文件导入失败';
      setConnectionError(message);
      notify(message, 'error');
    } finally {
      setImporting(false);
      setUploadPercent(0);
    }
  };

  const isRunning = isStarting || importing || Boolean(status?.running);
  const isError = !isStarting && !importing && (status?.phase === 'error' || Boolean(connectionError));
  const progress = importing
    ? Math.min(40, Math.round(uploadPercent * 0.4))
    : PHASE_PROGRESS[isStarting ? 'checking' : status?.phase || 'idle'];
  const message = importing
    ? t('正在上传词库文件… {0}%', [uploadPercent])
    : isStarting ? t('正在检查上游数据库…') : (connectionError || status?.message || '').split('\n').map(line => t(line)).join('\n');
  const showProgress = isRunning || status?.phase === 'completed' || status?.phase === 'unchanged' || isError;

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold text-gray-900 dark:text-white">{t('Tag 补全词库')}</h4>
        <div className="flex flex-wrap flex-none gap-2">
          <a href={TAG_DICTIONARY_REPOSITORY_URL} target="_blank" rel="noreferrer" className={TAG_ACTION_NEUTRAL_CLASS} title={t('打开词库 GitHub 原址（仓库根目录的 tag.sqlite 可手动下载）')}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5v5m-1-4L10 14M19 14v4a1 1 0 01-1 1H6a1 1 0 011-1h4" /></svg>
            <span>{t('词库来源')}</span>
          </a>
          <input
            ref={importInputRef}
            type="file"
            accept=".sqlite,.db,.sqlite3,application/octet-stream,application/x-sqlite3,application/vnd.sqlite3"
            className="hidden"
            aria-label={t('选择 tag.sqlite 词库文件')}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void handleImport(file);
            }}
          />
          <button type="button" data-appearance="control" data-tone="neutral" disabled={isRunning} onClick={() => importInputRef.current?.click()} className={`${TAG_ACTION_NEUTRAL_CLASS} disabled:cursor-not-allowed disabled:opacity-50`} title={t('内置下载失败时，从词库来源手动下载 tag.sqlite 后在这里导入')}>
            <ImportIcon className="h-4 w-4" aria-hidden="true" />
            <span>{importing ? t('上传中…') : t('导入词库')}</span>
          </button>
          <button type="button" data-appearance="control" data-tone="neutral" disabled={isRunning} onClick={() => void handleUpdate()} className={`${TAG_ACTION_PRIMARY_CLASS} disabled:cursor-not-allowed disabled:opacity-50`} title={t('检查并更新 Tag 补全词库')}>
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
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro leading-5 text-gray-400 dark:text-gray-500">
        <span>{t('内置下载失败时，打开「词库来源」，在仓库根目录下载 tag.sqlite（约 {0} MB）后点「导入词库」。', [TAG_DICTIONARY_APPROX_SIZE_MB])}</span>
        <a href={TAG_DICTIONARY_DOWNLOAD_URL} target="_blank" rel="noreferrer" title={t('打开 tag.sqlite 下载直链')} className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 transition-colors hover:text-indigo-500 dark:text-indigo-300 dark:decoration-indigo-500/50 dark:hover:text-indigo-200">
          <Download className="h-3 w-3" aria-hidden="true" />
          {t('下载直链')}
        </a>
      </p>
    </div>
  );
};
