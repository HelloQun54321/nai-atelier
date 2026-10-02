import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Copy, FlaskConical, ImagePlus } from 'lucide-react';
import type { Inspiration } from '../types';
import { db } from '../services/dbService';
import { copyTagText, externalImageDrafts, readExternalImageTags, type ExternalImageTags } from '../services/externalImageTags';
import { ImageTaggerPanel } from './ImageTaggerPanel';
import { ToolbarButton } from './DesignSystem';

interface ExternalImageToolsProps {
  source: 'danbooru' | 'pixiv';
  sourceId: string;
  page?: number;
  imageUrl: string;
  sourcePrompt: string;
  sourceCopy?: string;
  onImport: (prompt: string) => void;
  onSave: (reverse: ExternalImageTags | undefined, existing: Inspiration | undefined) => Promise<Inspiration>;
  notify: (message: string, type?: 'success' | 'error') => void;
  /** 当前图片的站内状态操作；来源导航由详情标题栏承载。 */
  trailingAction?: React.ReactNode;
  sourceTags: React.ReactNode;
}

/** 图片处理与保存保持紧凑单行，两种 Tag 不相互覆盖。 */
export const ExternalImageTools: React.FC<ExternalImageToolsProps> = ({ source, sourceId, page = 0, imageUrl, sourcePrompt, sourceCopy = sourcePrompt, onImport, onSave, notify, trailingAction, sourceTags }) => {
  const key = `${source}:${sourceId}:${page}`;
  const [reverse, setReverse] = useState<ExternalImageTags | undefined>(() => externalImageDrafts.get(key));
  const [existing, setExisting] = useState<Inspiration>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadToken, setLoadToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [taggerOpen, setTaggerOpen] = useState(false);
  // 传给面板的初始快照在打开时固定，选择回调不能改变它、覆盖用户本次勾选。
  const initial = useRef(reverse);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    void db.getInspirationsBySource(source, sourceId).then(items => {
      if (!active) return;
      // 旧 Pixiv 条目没有页码时无法判定是哪张图，保留原件，不把它误当当前页更新。
      const saved = items.find(item => source === 'danbooru' || item.analysis?.externalSourcePage === page);
      setExisting(saved);
      setReverse(current => current || readExternalImageTags(saved));
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source, sourceId, page, loadToken]);
  const retain = (draft: ExternalImageTags) => { setReverse(draft); externalImageDrafts.set(key, draft); };
  const copy = async (prompt: string, label: string) => {
    try { await copyTagText(prompt); notify(`已复制${label}`); }
    catch { notify('复制失败，请重试', 'error'); }
  };
  const save = async () => {
    if (savingRef.current || loading || loadError) return;
    savingRef.current = true; setSaving(true);
    try { const saved = await onSave(reverse, existing); setExisting(saved); }
    catch (error) { notify(error instanceof Error ? error.message : '保存图片与 Tag 失败', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const savedReverse = readExternalImageTags(existing);
  const saved = Boolean(reverse && savedReverse && reverse.prompt === savedReverse.prompt && reverse.createdAt === savedReverse.createdAt);
  const saveLabel = saving ? '保存中…' : existing ? '更新灵感库' : '加入灵感库';
  return <>
    <div className="@container space-y-2">
      <div role="group" aria-label="图片操作" className="flex items-center gap-2">
        <ToolbarButton tone="primary" className="whitespace-nowrap" disabled={loading} onClick={() => { initial.current = reverse; setTaggerOpen(true); }}><ImagePlus />图片反推</ToolbarButton>
        <ToolbarButton aria-label={saveLabel} title={saveLabel} className="whitespace-nowrap" disabled={loading || loadError || saving} onClick={() => void save()}><Bookmark /><span className="hidden @[20rem]:inline">{saveLabel}</span></ToolbarButton>
        {trailingAction && <div className="ml-auto flex flex-none items-center">{trailingAction}</div>}
      </div>
      {loadError && <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-300"><span>无法读取已保存的 Tag</span><ToolbarButton onClick={() => setLoadToken(value => value + 1)}>重试读取</ToolbarButton></div>}
    </div>
    {reverse && <section className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-black">反推 Tag</h3><span className="text-micro text-gray-500">{saved ? '已保存到灵感库' : '尚未保存'} · 模型预测</span></div>
      <textarea aria-label="反推 Tag" value={reverse.prompt} onChange={event => retain({ ...reverse, prompt: event.target.value })} className="min-h-24 w-full rounded-lg border border-gray-200 bg-white p-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-950" />
      <div className="flex flex-wrap gap-2">
        <ToolbarButton disabled={!reverse.prompt.trim()} onClick={() => void copy(reverse.prompt, '反推 Tag')}><Copy />复制反推 Tag</ToolbarButton>
        <ToolbarButton disabled={!reverse.prompt.trim()} onClick={() => onImport(reverse.prompt)}><FlaskConical />反推 Tag 送往实验室</ToolbarButton>
      </div>
    </section>}
    <section className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800">
      <h3 className="text-xs font-black">{source === 'danbooru' ? 'Danbooru 原站 Tag' : 'Pixiv 原站标签'}</h3>
      <div className="flex flex-wrap gap-2">
        <ToolbarButton disabled={!sourceCopy.trim()} onClick={() => void copy(sourceCopy, source === 'danbooru' ? 'Danbooru Tag' : 'Pixiv 标签')} title={source === 'danbooru' ? '复制完整原站标注，保留全部分类与 Tag 原名' : '原站标签用于检索，不等于生图提示词'}><Copy />{source === 'danbooru' ? '复制 Danbooru Tag' : '复制 Pixiv 标签'}</ToolbarButton>
        {source === 'danbooru' && <ToolbarButton disabled={!sourcePrompt.trim()} onClick={() => onImport(sourcePrompt)} title="追加角色与普通 Tag，不追加画师、作品和元数据"><FlaskConical />原站 Tag 送往实验室</ToolbarButton>}
      </div>
      {sourceTags}
    </section>
    {taggerOpen && <ImageTaggerPanel contextual lockImage open imageUrl={imageUrl} initialResult={initial.current?.result} initialTags={initial.current?.prompt} notify={notify}
      onClose={() => setTaggerOpen(false)} actionLabel="完成选择" onInsert={() => {}}
      onSendToLab={onImport} onResult={(result, prompt) => retain({ result, prompt, createdAt: initial.current && result === initial.current.result ? initial.current.createdAt : Date.now() })} />}
  </>;
};
