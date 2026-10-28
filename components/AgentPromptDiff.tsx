import React, { useMemo, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { diffPromptText, type AgentPromptChange, type AgentPromptFieldChange } from '../services/agentPromptChanges.mjs';
import { promptPurposeLabel } from '../services/promptPurposes.mjs';
import { splitPromptSegments } from '../services/promptSegments.mjs';

const labels: Record<string, string> = { basePrompt: '全局正面提示词', subjectPrompt: '主体提示词', negativePrompt: '负面提示词', prompt: '正面提示词', appearance: '外貌', wardrobe: '服饰', pose: '动作', expression: '表情', scene: '场景', camera: '镜头', extra: '补充', content: '提示词', isActive: '启用' };
const fieldLabel = (change: AgentPromptFieldChange) => {
  const { path } = change, key = path.at(-1)!;
  const character = path[1] === 'characters';
  const prefix = character ? t('角色') : path[0] === 'modules' ? t('提示词模块') : '';
  const owner = change.ownerName || change.ownerIndex || '';
  const name = key.startsWith('purpose:') ? t(promptPurposeLabel(key.slice(8))) : key.startsWith('directory:') ? change.directoryName || t('分类提示词') : t(labels[key] || '提示词');
  return [prefix && `${prefix} ${owner}`, path.includes('sectionNegatives') && t('负面提示词'), name].filter(Boolean).join(' › ');
};
const visibleFields = (changes: AgentPromptFieldChange[]) => changes.flatMap(change => {
  if (change.hidden || change.path.some(key => key === 'sectionMeta')) return [];
  if (typeof change.before === 'string' || typeof change.after === 'string' || typeof change.before === 'boolean' || typeof change.after === 'boolean') return [change];
  // 新增／删除整个角色时仍展示正文，不把坐标与内部配置当提示词输出。
  const before = change.before as Record<string, unknown> | undefined, after = change.after as Record<string, unknown> | undefined;
  const output: AgentPromptFieldChange[] = [];
  const visit = (a: unknown, b: unknown, path: string[]) => {
    if (a === b) return;
    if (typeof a === 'string' || typeof b === 'string') output.push({ ...change, path, before: a, after: b });
    else if (a && typeof a === 'object' || b && typeof b === 'object') for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) visit((a as Record<string, unknown>)?.[key], (b as Record<string, unknown>)?.[key], [...path, key]);
  };
  for (const key of ['prompt', 'negativePrompt', 'sections', 'sectionNegatives', 'content']) visit(before?.[key], after?.[key], [...change.path, key]);
  return output;
});

type DiffBlock = { kind: 'context'; text: string } | { kind: 'change'; parts: ReturnType<typeof diffPromptText> };
const promptSpans = (value: string) => {
  // 仅用于定位：换行按等长分隔符处理，正文和权重组仍保留原文。
  const text = value.replace(/[\r\n]/g, ',');
  let cursor = 0;
  return splitPromptSegments(text).map(segment => {
    const start = text.indexOf(segment, cursor);
    cursor = start + segment.length;
    return { start, end: cursor };
  });
};
const diffBlocks = (before: string, after: string) => {
  const parts = diffPromptText(before, after), beforeSpans = promptSpans(before), afterSpans = promptSpans(after);
  const tagList = beforeSpans.length > 1 || afterSpans.length > 1;
  const afterBounds = new Set(afterSpans.map(span => `${span.start}:${span.end}`));
  const blocks: DiffBlock[] = [];
  let oldPosition = 0, newPosition = 0;
  for (const part of parts) {
    // Tag 列表按完整未变片段分块；改动 Tag 内共用的词、逗号和权重继续原位显示。
    const context = part.kind === 'equal' && (tagList ? beforeSpans.some(span => span.start >= oldPosition && span.end <= oldPosition + part.text.length
      && afterBounds.has(`${newPosition + span.start - oldPosition}:${newPosition + span.end - oldPosition}`)) : !/^[\s\d\p{P}]+$/u.test(part.text));
    if (context) blocks.push({ kind: 'context', text: part.text });
    else {
      const previous = blocks.at(-1);
      if (previous?.kind === 'change') previous.parts.push(part);
      else blocks.push({ kind: 'change', parts: [part] });
    }
    if (part.kind !== 'insert') oldPosition += part.text.length;
    if (part.kind !== 'delete') newPosition += part.text.length;
  }
  return blocks;
};

export const AgentPromptDiff: React.FC<{ changes: AgentPromptFieldChange[] }> = ({ changes }) => {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const fields = useMemo(() => visibleFields(changes).map(change => ({ change, blocks: diffBlocks(String(change.before ?? ''), String(change.after ?? '')) })), [changes]);
  if (!changes.length || changes.every(change => change.hidden)) return null;
  return <div className="min-w-0 text-xs leading-5">
    {fields.map(({ change, blocks }, index) => <div key={index} className="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
      <div className="mb-1 break-words font-semibold text-gray-600 dark:text-gray-300">{fieldLabel(change)}</div>
      {blocks.map((block, blockIndex) => block.kind === 'context'
        ? <div key={blockIndex} className="whitespace-pre-wrap px-2 text-gray-500 [overflow-wrap:anywhere] dark:text-gray-400">{expanded ? block.text : '…'}</div>
        : <div key={blockIndex} className="overflow-hidden rounded-lg">{(['delete', 'insert'] as const).filter(kind => block.parts.some(part => part.kind === kind)).map(kind => <div key={kind} className={`flex gap-2 px-2 py-0.5 ${kind === 'delete' ? 'bg-red-50/70 text-red-900 dark:bg-red-950/30 dark:text-red-200' : 'bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>
          <span aria-label={t(kind === 'delete' ? '删除' : '新增')} className="select-none font-bold">{kind === 'delete' ? '−' : '+'}</span>
          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{block.parts.filter(part => part.kind === kind || part.kind === 'equal').map((part, partIndex) => part.kind === 'equal'
            ? <span key={partIndex} className="text-gray-600 dark:text-gray-400">{part.text}</span>
            : kind === 'delete' ? <del key={partIndex} className="no-underline">{part.text}</del> : <ins key={partIndex} className="no-underline">{part.text}</ins>)}</span>
        </div>)}</div>)}
    </div>)}
    {!fields.length && <p className="px-3 py-2 text-gray-500">{t('提示词来源已更新')}</p>}
    {fields.some(field => field.blocks.some(block => block.kind === 'context')) && <button type="button" aria-expanded={expanded} className="mobile-touch px-3 text-indigo-600 dark:text-indigo-300" onClick={() => setExpanded(value => !value)}>{t(expanded ? '只看改动' : '展开完整上下文')}</button>}
  </div>;
};

export const AgentPromptChangeCard: React.FC<{ change: AgentPromptChange; disabled: boolean; onAction: (direction: 'apply' | 'undo' | 'redo' | 'save') => Promise<void> }> = ({ change, disabled, onAction }) => {
  useLanguage();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const action = async (direction: 'apply' | 'undo' | 'redo' | 'save') => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onAction(direction); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const applied = change.status === 'applied', undone = change.status === 'undone';
  return <section aria-label={t('提示词修改')} className="appearance-group my-3 min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white/50 dark:border-gray-700 dark:bg-gray-950/30">
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
      <b>{t('提示词修改')}</b><span className="text-gray-500 dark:text-gray-400">{t(applied ? '已应用' : undone ? '已撤回' : '待应用')}{change.appliedChanges && change.appliedChanges.length !== change.changes.length ? ` · ${t('部分修改')}` : ''}</span>
      <div className="ml-auto flex items-center gap-1">
        {change.status === 'pending' ? <button type="button" disabled={disabled || busy} onClick={() => void action('apply')} className="mobile-touch px-2 font-semibold text-indigo-600 disabled:opacity-40 dark:text-indigo-300">{t('查看并应用')}</button> : <>
          <button type="button" disabled={disabled || busy || !applied} onClick={() => void action('undo')} title={t('撤回本次提示词修改')} aria-label={t('撤回本次提示词修改')} className="mobile-touch inline-flex items-center gap-1 px-2 disabled:opacity-35"><Undo2 className="h-3.5 w-3.5" />{t('撤回')}</button>
          <button type="button" disabled={disabled || busy || !undone} onClick={() => void action('redo')} title={t('重做本次提示词修改')} aria-label={t('重做本次提示词修改')} className="mobile-touch inline-flex items-center gap-1 px-2 disabled:opacity-35"><Redo2 className="h-3.5 w-3.5" />{t('重做')}</button>
        </>}
      </div>
    </header>
    <AgentPromptDiff changes={change.appliedChanges || change.changes} />
    {change.savePending && <button type="button" disabled={busy || disabled} className="mobile-touch px-3 text-xs text-indigo-600 dark:text-indigo-300" onClick={() => void action('save')}>{t('重试保存记录')}</button>}
    {error && <p role="alert" className="px-3 pb-2 text-xs text-red-600 dark:text-red-300">{t(error)}</p>}
  </section>;
};
