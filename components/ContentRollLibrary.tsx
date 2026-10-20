import React, { useMemo, useState } from 'react';
import { Copy, Download, ImagePlus, LoaderCircle, Search, Trash2 } from 'lucide-react';
import { t } from '../services/i18n';
import type { PromptChain } from '../types';
import { KINDS, META, contentRead, contentScopeOf, isContentRecord } from '../services/contentRoll';
import { promptLibraryHistoryImageUrl } from './PromptLibrary';
import { HistoryImagePicker } from './HistoryImagePicker';
import { SmartImage } from './SmartImage';
import type { LocalGenItem } from '../types';
import { WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';

interface ContentRollLibraryProps {
  active: boolean;
  chains: PromptChain[];
  notify: (message: string, kind?: 'success' | 'error') => void;
  /** 把这条记录载入「一键 Roll」当作当前一组（之后可直接「填入实验室」） */
  onLoad: (chain: PromptChain) => void;
  onRename: (chain: PromptChain, name: string) => Promise<void>;
  onDelete: (chain: PromptChain) => Promise<void>;
  /** 封面只写 previewImage（与图片提示词库同一套约定：历史图由 Worker 转成独立资产） */
  onSetCover: (chain: PromptChain, url: string) => Promise<void>;
  /** 作为「内容库」的子分区渲染：不再自带页面顶栏与外层画布。 */
  embedded?: boolean;
}

const shortText = (value: string, max = 64): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * Roll 内容库：只展示**纯内容记录**（`params._rollContentSnapshot`，format = nai-roll-content）。
 * 普通词库条目、完整搭配与旧记录都不在这里出现，也不会被这条筛选影响。
 * 只读预览里逐类列出内容与内容负面；「载入到一键 Roll」把这一组变成工作区的当前一组，
 * 之后仍然走同一条「填入实验室」确认流程（目标角色 + 逐栏预览 + 撤销）。
 */
export const ContentRollLibrary: React.FC<ContentRollLibraryProps> = ({ active, chains, notify, onLoad, onRename, onDelete, onSetCover, embedded = false }) => {
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [coverFor, setCoverFor] = useState<PromptChain | null>(null);

  const records = useMemo(() => chains.filter(chain => isContentRecord(chain)), [chains]);
  const shown = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return records
      .map(chain => {
        const read = contentRead((chain.params as { _rollContentSnapshot?: unknown } | undefined)?._rollContentSnapshot);
        return { chain, read, scope: contentScopeOf(read) };
      })
      .filter(item => !keyword || [item.chain.name, item.chain.description, ...(item.chain.tags || []), item.scope.label].join(' ').toLowerCase().includes(keyword))
      .sort((left, right) => Number(right.chain.updatedAt || 0) - Number(left.chain.updatedAt || 0));
  }, [records, query]);
  const preview = shown.find(item => item.chain.id === previewId) || null;

  const copySnapshot = async (item: { chain: PromptChain }) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify((item.chain.params as { _rollContentSnapshot?: unknown } | undefined)?._rollContentSnapshot, null, 2));
      notify(t('已复制这条记录的内容快照'));
    } catch {
      notify(t('复制失败：浏览器拒绝了剪贴板权限'), 'error');
    }
  };

  const commitRename = async () => {
    if (!renaming) return;
    const target = records.find(chain => chain.id === renaming.id);
    const name = renaming.value.trim();
    if (!target) { setRenaming(null); return; }
    if (!name || name === target.name) { setRenaming(null); return; }
    setBusy(renaming.id);
    try {
      await onRename(target, name);
      setRenaming(null);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950'} data-content-roll-library="true">
      {!embedded && <WorkspaceChrome><WorkspaceToolbar><h2 className="text-sm font-bold">{t('Roll 内容库')}</h2></WorkspaceToolbar></WorkspaceChrome>}
      <div className="workspace-scroll-viewport min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
        <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-meta text-gray-400">{t('共 {0} 条', [String(shown.length)])}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t('这里只保存六类内容与它们自己的约束，不含画师串、风格负面与生图参数；载入后仍走「填入实验室」的确认流程。')}
          </p>
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 px-2 dark:border-gray-700">
            <Search className="h-3.5 w-3.5 text-gray-400" />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)}
              aria-label={t('搜索名称、标签或备注')} placeholder={t('搜索名称、标签或备注…')}
              className="h-8 w-full bg-transparent text-xs text-gray-700 outline-none dark:text-gray-200" />
          </label>
        </section>

        <section className="space-y-2">
          {!active ? null : shown.length ? shown.map(item => {
            const isRenaming = renaming?.id === item.chain.id;
            return (
              <article key={item.chain.id} data-content-roll-record={item.chain.id}
                className="appearance-group rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start gap-3">
                <div className="appearance-media h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                  {item.chain.previewImage ? (
                    <SmartImage src={item.chain.previewImage} alt={item.chain.name || t('封面')} thumbnailVariant="thumb-320" className="h-full w-full object-cover" containerClassName="h-full w-full" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-micro text-gray-400">{t('无封面')}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  {isRenaming ? (
                    <input autoFocus value={renaming.value} disabled={busy === item.chain.id}
                      aria-label={t('重命名这条记录')} onChange={event => setRenaming({ id: item.chain.id, value: event.target.value })}
                      onKeyDown={event => { if (event.key === 'Enter') void commitRename(); else if (event.key === 'Escape') setRenaming(null); }}
                      onBlur={() => void commitRename()}
                      className="h-7 min-w-0 flex-1 rounded border border-gray-200 px-2 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                  ) : (
                    <button type="button" onClick={() => setPreviewId(previewId === item.chain.id ? '' : item.chain.id)}
                      className="min-w-0 truncate text-left text-sm font-bold text-gray-800 hover:text-indigo-600 dark:text-gray-100">
                      {item.chain.name || t('未命名')}
                    </button>
                  )}
                  <span className="text-micro text-gray-400">{new Date(Number(item.chain.updatedAt || 0)).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-meta leading-4 text-gray-600 dark:text-gray-300" data-content-roll-scope={item.chain.id}>
                  {item.read.ok ? (item.scope.label || t('（没有可载入的内容）')) : t('这条记录不能按纯内容载入：{0}', [item.read.warnings[0] || ''])}
                </p>
                {item.chain.description ? <p className="mt-1 text-meta leading-4 text-gray-500 dark:text-gray-400">{shortText(item.chain.description, 90)}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <button type="button" disabled={!item.read.ok} onClick={() => onLoad(item.chain)}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-meta font-semibold text-white disabled:opacity-40">
                    {t('载入到一键 Roll')}
                  </button>
                  <button type="button" onClick={() => setRenaming({ id: item.chain.id, value: item.chain.name || '' })}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-meta text-gray-600 dark:border-gray-700 dark:text-gray-300">{t('改名')}</button>
                  <button type="button" onClick={() => void copySnapshot(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-meta text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    <Copy className="h-3 w-3" />{t('复制快照')}
                  </button>
                  <button type="button" onClick={() => setCoverFor(item.chain)} data-content-roll-cover={item.chain.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-meta text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    <ImagePlus className="h-3 w-3" />{t(item.chain.previewImage ? '换封面' : '从历史选封面')}
                  </button>
                  <button type="button" onClick={() => void onDelete(item.chain)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-meta text-red-600 dark:border-gray-700 dark:text-red-400">
                    <Trash2 className="h-3 w-3" />{t('删除')}
                  </button>
                </div>
                </div>
                </div>
              </article>
            );
          }) : (
            <p className="appearance-group rounded-2xl border border-dashed border-gray-200 bg-white p-4 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
              {records.length ? t('没有符合搜索条件的记录') : t('还没有 Roll 内容记录：在「一键 Roll」里点「存为 Roll 内容」即可创建。')}
            </p>
          )}
        </section>

        {preview ? (
          <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-content-roll-preview={preview.chain.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('只读预览：{0}', [preview.chain.name || t('未命名')])}</h3>
              <button type="button" onClick={() => setPreviewId('')}
                className="rounded-lg border border-gray-200 px-2 py-1 text-meta text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('关闭预览')}</button>
            </div>
            <div className="mt-2 space-y-1">
              {KINDS.map(kind => {
                const role = preview.read.roles?.[0];
                const isRole = META[kind].scope === 'character';
                const provided = isRole ? !!role?.provided?.[kind] : !!preview.read.global?.[kind]?.provided;
                const text = isRole ? String(role?.sections?.[kind] || '') : String(preview.read.global?.[kind]?.text || '');
                const negative = isRole ? role?.negatives?.[kind] : preview.read.global?.[kind]?.negative;
                if (!provided) return null;
                return (
                  <div key={kind} className="rounded-lg border border-gray-200 p-2 text-meta dark:border-gray-700">
                    <span className="font-semibold text-indigo-600 dark:text-indigo-300">{t(META[kind].title)}</span>
                    <p className="mt-0.5 break-all font-mono text-gray-600 dark:text-gray-300">{text}</p>
                    {negative && (negative.text || negative.note) ? (
                      <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                        {negative.text ? t('内容负面：') + negative.text : ''}
                        {negative.text && negative.note ? '；' : ''}
                        {negative.note || ''}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 flex items-center gap-1 text-meta text-gray-400">
              <Download className="h-3 w-3" />{t('这只是只读预览，不会改动实验室，也不会消耗额度。')}
            </p>
          </section>
        ) : null}
        {busy ? <p className="flex items-center gap-1 text-meta text-gray-400"><LoaderCircle className="h-3 w-3 animate-spin" />{t('处理中…')}</p> : null}
        <HistoryImagePicker open={!!coverFor} onClose={() => setCoverFor(null)}
          onSelect={async (item: LocalGenItem) => {
            const target = coverFor;
            setCoverFor(null);
            if (!target || !item?.id) return;
            setBusy(target.id);
            try {
              await onSetCover(target, promptLibraryHistoryImageUrl(String(item.id)));
              notify(t('封面已更新：历史图会由 Worker 转成独立资产，不受历史清理影响'));
            } catch (error) {
              notify(t('设置封面失败：{0}', [String((error as Error)?.message || error)]), 'error');
            } finally {
              setBusy('');
            }
          }} />
      </div></div>
    </div>
  );
};
