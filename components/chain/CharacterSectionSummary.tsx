import React, { useState } from 'react';
import { t } from '../../services/i18n';
import type { CharacterParams, CharacterSectionContent } from '../../types';
import { CHARACTER_SECTION_KEYS } from '../../services/characterPrompts';

const SECTION_LABELS: Record<keyof CharacterSectionContent, string> = {
  appearance: '外貌',
  wardrobe: '服饰',
  pose: '动作',
  expression: '表情',
};

interface CharacterSectionSummaryProps {
  character: CharacterParams;
}

/**
 * 角色分栏的摘要卡片 + 来源详情折叠。
 *
 * 摘要只回答三件事：填了哪几栏、正文与分栏合计多少字、有没有内容负面。
 * 来源详情默认收起：里面是本机记录的条目名 / 约束备注 / 内容负面（sectionMeta / sectionNegatives），
 * 这些字段只用于追溯，不进入请求，展开也不会改动任何数据。
 */
export const CharacterSectionSummary: React.FC<CharacterSectionSummaryProps> = ({ character }) => {
  const [open, setOpen] = useState(false);
  const filled = CHARACTER_SECTION_KEYS.filter(key => String(character.sections?.[key] || '').trim());
  const bodyLength = String(character.prompt || '').trim().length
    + CHARACTER_SECTION_KEYS.reduce((total, key) => total + String(character.sections?.[key] || '').trim().length, 0);
  if (!filled.length && !bodyLength) return null;

  const details = CHARACTER_SECTION_KEYS.map(key => ({
    key,
    meta: character.sectionMeta?.[key],
    negative: String(character.sectionNegatives?.[key] || '').trim(),
  })).filter(item => item.meta || item.negative);

  return (
    <div className="appearance-group mt-2 rounded border border-gray-200 bg-gray-50/60 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/40" data-character-summary="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-micro font-semibold text-gray-600 dark:text-gray-300">
          {t('分栏摘要')}：{filled.length}/4 · {t('正文 {0} 字', [String(bodyLength)])}
        </span>
        <button type="button" onClick={() => setOpen(value => !value)}
          aria-expanded={open} data-character-summary-toggle="true"
          className="text-micro font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
          {t(open ? '收起来源' : '展开来源')}
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {CHARACTER_SECTION_KEYS.map(key => (
          <span key={key}
            data-character-summary-chip={key}
            className={'rounded px-1.5 py-0.5 text-micro ' + (filled.includes(key)
              ? 'bg-indigo-100 font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500')}>
            {t(SECTION_LABELS[key])}
          </span>
        ))}
      </div>
      {open ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-gray-200 pt-1.5 text-micro text-gray-500 dark:border-gray-700 dark:text-gray-400" data-character-summary-detail="true">
          {details.length ? details.map(item => (
            <li key={item.key}>
              <span className="font-semibold text-gray-600 dark:text-gray-300">{t(SECTION_LABELS[item.key])}</span>
              <span className="ml-1">{t('来源：{0}', [item.meta?.entryName || t('手动填写')])}</span>
              {item.meta?.notes ? <span className="ml-1">· {item.meta.notes}</span> : null}
              {item.negative ? <span className="ml-1">· {t('内容负面')}：{item.negative}</span> : null}
            </li>
          )) : <li>{t('暂无来源记录（手动填写或尚未从一键 Roll 填入）')}</li>}
        </ul>
      ) : null}
    </div>
  );
};
