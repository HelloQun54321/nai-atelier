import React, { useRef, useState } from 'react';
import { t } from '../services/i18n';
import type { AgentQuestionAnswer, AgentQuestionRequest, AgentUserQuestion } from '../services/promptAgent';
export type AgentQuestionDraft = { index: number; answers: Record<string, { selection: string; customText: string }> };

/** 回答只补充任务信息；不走费用或危险操作的批准入口。 */
export const AgentUserQuestionCard: React.FC<{ request: AgentQuestionRequest; onAnswer: (answers: AgentQuestionAnswer[]) => Promise<void>; initialDraft?: AgentQuestionDraft; onDraftChange?: (draft: AgentQuestionDraft) => void }> = ({ request, onAnswer, initialDraft, onDraftChange }) => {
  const [draft, setDraft] = useState<AgentQuestionDraft>(() => initialDraft || { index: 0, answers: {} });
  const { index, answers } = draft;
  const saveDraft = (next: AgentQuestionDraft) => { setDraft(next); onDraftChange?.(next); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const question = request.questions[index];
  if (!question) return null;
  const answer = answers[question.id];
  const answered = (item: AgentUserQuestion) => Boolean(answers[item.id]?.selection && (answers[item.id].selection !== 'custom' || answers[item.id].customText.trim()));
  const update = (patch: Partial<{ selection: string; customText: string }>) => saveDraft({ ...draft, answers: { ...answers, [question.id]: { ...(answer ?? { selection: '', customText: '' }), ...patch } } });
  const submit = async () => {
    if (submitting.current || !request.questions.every(answered)) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      await onAnswer(request.questions.map(item => answers[item.id].selection === 'custom'
        ? { questionId: item.id, customText: answers[item.id].customText.trim() }
        : { questionId: item.id, optionId: answers[item.id].selection.slice(7) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('回答未送达，请重试')); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <section aria-label={t('助手提问')} className="appearance-group rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
    <p className="mb-2 text-xs font-bold text-indigo-700 dark:text-indigo-300">{t('等待你回答')}{request.questions.length > 1 ? ` · ${index + 1} / ${request.questions.length}` : ''}</p>
    <fieldset disabled={busy} className="min-w-0 space-y-2">
      <legend className="mb-2 whitespace-pre-wrap text-sm font-medium text-gray-900 dark:text-gray-100">{question.prompt}</legend>
      {question.options.map(option => <label key={option.id} className="appearance-surface mobile-touch flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm dark:border-gray-700">
        <input type="radio" name={`${request.requestId}-${question.id}`} value={option.id} checked={answer?.selection === `option:${option.id}`} onChange={() => update({ selection: `option:${option.id}` })} className="mt-1 shrink-0 accent-indigo-600" />
        <span className="min-w-0 whitespace-pre-wrap break-words"><span>{option.label}</span>{option.description && <span className="block text-xs text-gray-500 dark:text-gray-400">{option.description}</span>}</span>
      </label>)}
      {question.options.length > 0 && <label className="mobile-touch flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="radio" name={`${request.requestId}-${question.id}`} checked={answer?.selection === 'custom'} onChange={() => update({ selection: 'custom' })} className="accent-indigo-600" />{t('自定义回答')}</label>}
      {(question.options.length === 0 || answer?.selection === 'custom') && <textarea rows={3} maxLength={2000} aria-label={t('自定义回答内容')} value={answer?.customText || ''} onChange={event => update({ customText: event.target.value, ...(question.options.length === 0 ? { selection: 'custom' } : {}) })} className="appearance-surface w-full resize-y rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />}
    </fieldset>
    {error && <p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-red-600 dark:text-red-300">{error}</p>}
    <div className="mt-3 flex items-center justify-end gap-2">
      {index > 0 && <button type="button" disabled={busy} onClick={() => saveDraft({ ...draft, index: index - 1 })} className="mobile-touch min-h-11 rounded-lg px-3 text-xs font-bold text-gray-600 disabled:opacity-40 dark:text-gray-300">{t('上一题')}</button>}
      {index < request.questions.length - 1 ? <button type="button" disabled={busy || !answered(question)} onClick={() => saveDraft({ ...draft, index: index + 1 })} className="mobile-touch min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-40">{t('下一题')}</button>
        : <button type="button" disabled={busy || !request.questions.every(answered)} onClick={() => void submit()} className="mobile-touch min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-40">{busy ? t('正在提交…') : t('提交回答并继续')}</button>}
    </div>
  </section>;
};

/** 历史问题和真实答案直接展示，不藏在可关闭的工具过程里。 */
export const AgentQuestionHistory: React.FC<{ args: unknown; result: unknown }> = ({ args, result }) => {
  let receipt: { answered?: boolean; answers?: AgentQuestionAnswer[]; questions?: AgentUserQuestion[]; error?: string } | undefined;
  const parts = Array.isArray(result) ? result : (result as { content?: unknown[] } | null)?.content;
  for (const part of parts || []) {
    try { const parsed = JSON.parse((part as { text?: string }).text || ''); if (Array.isArray(parsed.answers) || parsed.answered === false) { receipt = parsed; break; } } catch { /* 非问答工具回执不解释为回答。 */ }
  }
  if (!receipt) return null;
  const questions = receipt.questions || (args as { questions?: AgentUserQuestion[] } | null)?.questions;
  if (!Array.isArray(questions)) return null;
  return <section aria-label={t('问题与回答')} className="appearance-group my-3 space-y-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
    {questions.map(question => {
      const answer = receipt?.answers?.find(item => item.questionId === question.id);
      return <div key={question.id}><p className="whitespace-pre-wrap font-medium">{question.prompt}</p>
        {!!question.options?.length && <ul className="mt-1 space-y-1 text-xs text-gray-500 dark:text-gray-400">{question.options.map(option => <li key={option.id} className="whitespace-pre-wrap">{option.label}{option.description ? ` · ${option.description}` : ''}</li>)}</ul>}
        <p className="mt-1 whitespace-pre-wrap text-indigo-700 dark:text-indigo-300">{answer?.customText ?? answer?.label ?? question.options?.find(option => option.id === answer?.optionId)?.label ?? t('未回答')}</p>
      </div>;
    })}
    {receipt.error && <p className="whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400">{receipt.error}</p>}
  </section>;
};
