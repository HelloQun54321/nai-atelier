import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import type { PromptAgentDraft } from '../types';
import { agentDraftChangedFields, agentDraftFields, mergeAgentDraftFields } from '../services/promptAgentCoordinator';
import { createAgentPromptChange } from '../services/agentPromptChanges.mjs';
import { AgentPromptDiff } from './AgentPromptDiff';

const labels = { basePrompt: '全局提示词', subjectPrompt: '主体提示词', negativePrompt: '负面提示词', modules: '提示词模块', params: '参数与角色' };
export const AgentDraftReview: React.FC<{ current: PromptAgentDraft; proposed: PromptAgentDraft; onApply: (draft: PromptAgentDraft) => void; onClose: () => void }> = ({ current, proposed, onApply, onClose }) => {
  useLanguage();
  const changed = agentDraftChangedFields(current, proposed);
  const promptChanges = createAgentPromptChange(current, proposed).changes;
  const [selected, setSelected] = useState<ReadonlyArray<typeof agentDraftFields[number]>>(changed);
  const linked = promptChanges.some(change => change.path[1] === '_promptSections') ? changed.filter(field => ['params', 'basePrompt', 'subjectPrompt'].includes(field)) : [];
  const selectField = (field: typeof agentDraftFields[number], checked: boolean) => {
    const group = linked.includes(field) ? linked : [field];
    setSelected(previous => checked ? [...new Set([...previous, ...group])] : previous.filter(item => !group.includes(item)));
  };
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const requestClose = useMobileHistoryLayer(true, onClose, 'agent-draft-review');
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) { event.stopPropagation(); requestClose(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [dialogRef, requestClose]);
  return createPortal(<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("查看助手草稿差异")} className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm"><div className="agent-theme appearance-panel max-h-[85dvh] w-full max-w-3xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><h2 className="font-bold">{t("保留你的修改，选择需要应用的内容")}</h2><p className="mt-1 text-xs text-gray-500">{t("勾选字段会替换该字段；未勾选内容继续保留。")}</p>{changed.map(field => <details key={field} open className="mt-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"><summary className="flex items-center gap-2"><input type="checkbox" aria-label={t(labels[field])} checked={selected.includes(field)} onChange={event => selectField(field, event.target.checked)}/>{t(labels[field])}</summary><AgentPromptDiff changes={promptChanges.filter(change => change.path[0] === field)} />{(field === 'params' || field === 'modules') && (() => {
    const otherParams = (draft: PromptAgentDraft) => field === 'modules' ? draft.modules.map(module => Object.fromEntries(Object.entries(module).filter(([key]) => !['content', 'isActive'].includes(key)))) : ({ ...Object.fromEntries(Object.entries(draft.params).filter(([key]) => !['characters', '_promptSections', '_characterSectionsNegatives'].includes(key))), characters: draft.params.characters?.map(character => Object.fromEntries(Object.entries(character).filter(([key]) => !['prompt', 'negativePrompt', 'sections', 'sectionNegatives', 'sectionMeta'].includes(key)))) });
    if (JSON.stringify(otherParams(current)) === JSON.stringify(otherParams(proposed))) return null;
    return <details className="mt-2"><summary>{t(field === 'params' ? '参数差异' : '提示词模块')}</summary><div className="grid gap-2 md:grid-cols-2">{[current, proposed].map((draft, index) => <div key={index}><b>{t(index ? '助手建议' : '当前内容')}</b><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(otherParams(draft), null, 2)}</pre></div>)}</div></details>;
  })()}</details>)}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={requestClose} className="mobile-touch rounded-xl border border-gray-200 px-3 dark:border-gray-700">{t("暂不应用")}</button><button type="button" disabled={!selected.length} onClick={() => onApply(mergeAgentDraftFields(current, proposed, selected))} className="mobile-touch rounded-xl bg-indigo-600 px-3 text-white disabled:opacity-40">{t("应用选中修改")}</button></div></div></div>, document.body);
};
