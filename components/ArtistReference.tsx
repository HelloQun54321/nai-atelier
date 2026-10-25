import React, { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { InfoPopover } from './InfoPopover';
import {
  collectArtistReferenceFacets, summarizeArtistReference,
  type ArtistReferenceEntry, type ArtistReferenceFilter, type ArtistReferenceUsability,
} from '../services/artistReference';

const USABILITY_TONE: Record<ArtistReferenceUsability, string> = { 稳定: 'bg-emerald-500', 可用: 'bg-sky-500', 慎用: 'bg-amber-500', 失效: 'bg-red-500', 待验证: 'bg-gray-400' };
const usabilityLabel = (value: ArtistReferenceUsability) => ({ 稳定: t('稳定'), 可用: t('可用'), 慎用: t('慎用'), 失效: t('失效'), 待验证: t('待验证') })[value];
const fidelityLabel = (value: ArtistReferenceEntry['fidelity']) => ({ 高: t('高'), 中: t('中'), 低: t('低'), 未知: t('未知') })[value];
/** 维度名称沿用来源站点「按风格探索」。 */
const dimensionLabel = (dimension: string) => ({
  线: t('线条与笔触'), 涂: t('上色与材质'), 色: t('色彩倾向'), 构: t('构图与视角'), 景: t('背景与环境'), 风: t('风格与表达'), 光: t('光影氛围'), 材: t('材质与表面'),
} as Record<string, string>)[dimension] || t('其他');
const Count: React.FC<{ value: number }> = ({ value }) => <span className="text-micro text-gray-400">{value}</span>;
const FilterGroup: React.FC<React.PropsWithChildren<{ title: string; hint?: React.ReactNode }>> = ({ title, hint, children }) => <div role="group" aria-label={title}>
  <div className="mb-1.5 flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{title}</p>{hint}</div>
  {children}
</div>;
const CHIP_CLASS = 'mobile-touch inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs';
const chipClass = (selected: boolean) => `${CHIP_CLASS} ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-gray-200 text-gray-600 hover:border-indigo-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-600'}`;
const UsabilityDot: React.FC<{ value: ArtistReferenceUsability }> = ({ value }) => <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${USABILITY_TONE[value]}`} />;

const Section: React.FC<{ title: string; items: string[] }> = ({ title, items }) => items.length ? <div>
  <p className="text-micro font-semibold text-gray-500 dark:text-gray-400">{title}</p>
  <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs leading-relaxed">{items.map(item => <li key={item}>{item}</li>)}</ul>
</div> : null;

/** 同一画师的多条来源记录逐条并列，不合并成单一结论。 */
const ArtistReferenceDetail: React.FC<{ records: ArtistReferenceEntry[]; sourceLabel: string; sourceUrl?: string; onCopy: (text: string) => void }> = ({ records, sourceLabel, sourceUrl, onCopy }) => <div className="space-y-3 whitespace-normal">
  {records.map(record => <section key={record.id} className="space-y-2 border-b border-gray-100 pb-3 last:border-b-0 last:pb-0 dark:border-gray-800">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1 font-semibold text-gray-800 dark:text-gray-100"><UsabilityDot value={record.usability} />{usabilityLabel(record.usability)}</span>
      <span className="text-gray-500 dark:text-gray-400">{t('还原度 {0}', [fidelityLabel(record.fidelity)])}</span>
      {record.tester && <span className="text-gray-500 dark:text-gray-400">{t('测试者 {0}', [record.tester])}</span>}
    </div>
    {(record.roles.length > 0 || record.tags.length > 0) && <div className="flex flex-wrap gap-1">
      {record.roles.map(role => <span key={`role:${role}`} className="rounded-full bg-indigo-50 px-2 py-0.5 text-micro font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200">{role}</span>)}
      {record.tags.map(tag => <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-micro text-gray-600 dark:bg-gray-800 dark:text-gray-300">{tag}</span>)}
    </div>}
    {record.look && <p className="text-xs leading-relaxed">{record.look}</p>}
    <Section title={t('预期作用')} items={record.effects} />
    <Section title={t('可能偏向')} items={record.biases} />
    {record.note && <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{record.note}</p>}
    {record.testedPrompt && <div className="flex items-center gap-1">
      <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-1.5 py-1 text-micro dark:bg-gray-800" title={record.testedPrompt}>{record.testedPrompt}</code>
      <button type="button" aria-label={t('复制测试提示词')} title={t('复制测试提示词')} onClick={() => onCopy(record.testedPrompt)} className="mobile-touch inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Copy className="h-3.5 w-3.5" /></button>
    </div>}
  </section>)}
  <p className="text-micro leading-relaxed text-gray-400">{t('来源')} {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300">{sourceLabel}</a> : sourceLabel} · {t('例图观察与组串假设由来源整理，未经工坊生图复测。')}</p>
</div>;

export const ArtistReferenceBadge: React.FC<{ records: ArtistReferenceEntry[]; sourceLabel: string; sourceUrl?: string; onCopy: (text: string) => void }> = ({ records, sourceLabel, sourceUrl, onCopy }) => {
  useLanguage();
  const summary = summarizeArtistReference(records);
  return <span data-card-action="true" className="inline-flex max-w-full" onPointerDown={event => event.stopPropagation()}>
    <InfoPopover label="组串参考" content={<ArtistReferenceDetail records={records} sourceLabel={sourceLabel} sourceUrl={sourceUrl} onCopy={onCopy} />}
      className="gallery-card-badge mobile-touch inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-gray-200 px-1.5 text-micro font-semibold text-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300 [@media(any-pointer:coarse)]:min-h-8">
      {summary.role && <span className="truncate">{summary.role}</span>}
      <UsabilityDot value={summary.usability} /><span className="flex-none">{usabilityLabel(summary.usability)}</span>
      {summary.count > 1 && <span className="flex-none text-gray-400">×{summary.count}</span>}
    </InfoPopover>
  </span>;
};

export const ArtistReferenceFilterSection: React.FC<{
  entries?: ArtistReferenceEntry[];
  filter: ArtistReferenceFilter;
  statusText: string;
  onChange: (filter: ArtistReferenceFilter) => void;
  onOpenSettings: () => void;
}> = ({ entries, filter, statusText, onChange, onOpenSettings }) => {
  useLanguage();
  const [query, setQuery] = useState('');
  const facets = useMemo(() => collectArtistReferenceFacets(entries), [entries]);
  const toggled = <T extends string>(list: T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  const keyword = query.trim().toLowerCase();
  // 选中维度后只列出该维度的标签，与来源站点的分类标签面板一致。
  const visible = filter.dimension ? facets.dimensions.filter(group => group.dimension === filter.dimension) : facets.dimensions;
  const groups = keyword ? visible.map(group => ({ ...group, tags: group.tags.filter(([tag]) => tag.toLowerCase().includes(keyword)) })).filter(group => group.tags.length) : visible;
  return <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-700">
    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('组串参考')}</p>
    {!entries?.length ? <div className="space-y-2">
      <p role="status" className="text-xs text-gray-500 dark:text-gray-400">{statusText}</p>
      <button type="button" onClick={onOpenSettings} className="mobile-touch rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold dark:border-gray-700 dark:text-gray-200">{t('下载组串参考')}</button>
    </div> : <>
      <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={filter.only} onChange={event => onChange({ ...filter, only: event.target.checked })} />{t('只看有组串参考')}</label>
      <FilterGroup title={t('按风格探索')}>
        <div className="grid grid-cols-2 gap-1.5">{facets.dimensions.filter(group => group.dimension).map(group => <button key={group.dimension} type="button" aria-pressed={filter.dimension === group.dimension}
          onClick={() => onChange({ ...filter, dimension: filter.dimension === group.dimension ? '' : group.dimension })}
          className={`${chipClass(filter.dimension === group.dimension)} justify-between rounded-lg`}><span className="truncate">{dimensionLabel(group.dimension)}</span><Count value={group.entries} /></button>)}</div>
      </FilterGroup>
      <FilterGroup title={t('风格标签')} hint={filter.tags.length > 1 && <span className="text-micro text-gray-400">{t('需同时包含')}</span>}>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('搜索风格标签')} placeholder={t('搜索风格标签')} className="mobile-touch h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
          {groups.map(group => <div key={group.dimension || 'other'}>
            <p className="mb-1 text-micro font-semibold text-gray-400">{dimensionLabel(group.dimension)}</p>
            <div className="flex flex-wrap gap-1.5">{group.tags.map(([tag, count]) => <button key={tag} type="button" aria-pressed={filter.tags.includes(tag)} onClick={() => onChange({ ...filter, tags: toggled(filter.tags, tag) })} className={chipClass(filter.tags.includes(tag))}>{tag.replace(/^[^-]+-/, '')}<Count value={count} /></button>)}</div>
          </div>)}
          {!groups.length && <p className="text-xs text-gray-400">{t('没有匹配的风格标签')}</p>}
        </div>
      </FilterGroup>
      <FilterGroup title={t('可用性')}>
        <div className="flex flex-wrap gap-1.5">{facets.usability.map(([value, count]) => <button key={value} type="button" aria-pressed={filter.usability.includes(value)} onClick={() => onChange({ ...filter, usability: toggled(filter.usability, value) })} className={chipClass(filter.usability.includes(value))}><UsabilityDot value={value} />{usabilityLabel(value)}<Count value={count} /></button>)}</div>
      </FilterGroup>
      <FilterGroup title={t('还原度')}>
        <div className="flex flex-wrap gap-1.5">{facets.fidelity.map(([value, count]) => <button key={value} type="button" aria-pressed={filter.fidelity.includes(value)} onClick={() => onChange({ ...filter, fidelity: toggled(filter.fidelity, value) })} className={chipClass(filter.fidelity.includes(value))}>{fidelityLabel(value)}<Count value={count} /></button>)}</div>
      </FilterGroup>
      <FilterGroup title={t('组串定位')}>
        <div className="flex flex-wrap gap-1.5">{facets.roles.map(([role, count]) => <button key={role} type="button" aria-pressed={filter.roles.includes(role)} onClick={() => onChange({ ...filter, roles: toggled(filter.roles, role) })} className={chipClass(filter.roles.includes(role))}>{role}<Count value={count} /></button>)}</div>
      </FilterGroup>
      <FilterGroup title={t('测试者')}>
        <div className="flex flex-wrap gap-1.5">{facets.testers.map(([tester, count]) => <button key={tester} type="button" aria-pressed={filter.testers.includes(tester)} onClick={() => onChange({ ...filter, testers: toggled(filter.testers, tester) })} className={chipClass(filter.testers.includes(tester))}>{tester}<Count value={count} /></button>)}</div>
      </FilterGroup>
    </>}
  </div>;
};
