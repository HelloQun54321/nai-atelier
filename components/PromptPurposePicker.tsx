import React from 'react';
import { PromptPurposeGroup } from './PromptPurposeGroup';
import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES, type PromptPurposeId } from '../services/promptPurposes.mjs';
import { t, useLanguage } from '../services/i18n';

export function PromptPurposePicker({ value, onChange, disabled = false, label = '用途 Tag' }: {
  value: readonly PromptPurposeId[]; onChange: (value: PromptPurposeId[]) => void; disabled?: boolean; label?: string;
}) {
  useLanguage();
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-sm font-semibold">{t(label)}</legend>
    <div className="space-y-2">{PROMPT_PURPOSE_GROUPS.map(group => <PromptPurposeGroup key={group.id} id={group.id} label={group.label}
      summary={group.purposes.filter(id => value.includes(id)).map(id => t(PROMPT_PURPOSES.find(item => item.id === id)!.label)).join('、')}>
    <div className="flex flex-wrap gap-1.5">{group.purposes.map(id => PROMPT_PURPOSES.find(item => item.id === id)!).map(item => <button key={item.id} type="button" aria-pressed={value.includes(item.id)}
      title={t(item.description)} disabled={disabled} onClick={() => onChange(value.includes(item.id) ? value.filter(id => id !== item.id) : [...value, item.id])}
      className={`mobile-touch rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50 ${value.includes(item.id) ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200' : 'appearance-group border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}>{t(item.label)}</button>)}</div></PromptPurposeGroup>)}</div>
  </fieldset>;
}
