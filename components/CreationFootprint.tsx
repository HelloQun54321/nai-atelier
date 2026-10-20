import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity, ArrowRight, BarChart3, Brush, CalendarDays, Download,
  Flame, Footprints, Heart, Image as ImageIcon, LoaderCircle, Palette, RefreshCw, Sparkles,
} from 'lucide-react';
import { EmptyState, ToolbarButton, WorkspaceToolbar } from './DesignSystem';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { collectionRevision, collectionSnapshot, ensureCollection, subscribeCollection } from '../services/collectionFavorites';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { getLanguage, t, useLanguage } from '../services/i18n';
import { getUsageAssets, getUsageStats, type UsageAssets, type UsageChainRow, type UsageRange, type UsageStats } from '../services/usageStats';
import { getUsageEventStats, type UsageEventStats } from '../services/usageEvents';
import { KeyUsageSection } from './KeyUsageSection';
import { promptAgentService, type PromptAgentSession } from '../services/promptAgent';
import { sourceLabel } from '../services/inspirationUtils';
import type { PromptChain } from '../types';
import type { HistoryBrowseQuery } from '../services/historyBrowse';
import type { InspirationSourceType } from '../types';

interface CreationFootprintProps {
  active?: boolean;
  chains: PromptChain[];
  onOpenHistory: (query?: HistoryBrowseQuery) => void;
  onOpenCollection: () => void;
  onOpenLab: () => void;
  onOpenRoll: () => void;
}

type Granularity = 'week' | 'month' | 'year';
const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
];

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const formatDay = (timestamp: number) => {
  if (!timestamp) return t('暂无');
  return new Intl.DateTimeFormat(getLanguage(), { month: 'short', day: 'numeric' }).format(new Date(timestamp));
};
const formatNumber = (value: number) => value.toLocaleString(getLanguage());
const formatMonth = (date: Date) => new Intl.DateTimeFormat(getLanguage(), { month: 'short' }).format(date);
const formatYearMonth = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(getLanguage(), { year: 'numeric', month: 'long' }).format(new Date(year, month - 1, 1));
};
const currentMonthKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const startOfWeek = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
};
const endOfWeek = (time: number) => startOfDay(new Date(startOfWeek(time) + 6 * 86400000)) + 86400000 - 1;
const dayKeyToTime = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
};

const heatClass = (count: number) => count <= 0
  ? 'bg-gray-200/80 dark:bg-gray-800'
  : count === 1
    ? 'bg-indigo-200 dark:bg-indigo-900/70'
    : count <= 3
      ? 'bg-indigo-300 dark:bg-indigo-800'
      : count <= 6
        ? 'bg-indigo-400 dark:bg-indigo-700'
        : count <= 12
          ? 'bg-indigo-500 dark:bg-indigo-600'
          : 'bg-indigo-600 dark:bg-indigo-500';

const OPERATION_LABELS: Record<string, string> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  img2img: '图生图',
  inpaint: '局部重绘',
  outpaint: '扩图',
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; detail?: React.ReactNode; icon?: React.ReactNode; title?: string }> = ({ label, value, detail, icon, title }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
      <span className="truncate">{label}</span>
      {icon && <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-300 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
    </div>
    <div title={title} className="mt-2 truncate text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</div>
    {detail && <div className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">{detail}</div>}
  </div>
);

const RankingRow: React.FC<{ name: string; images: number; lastAt: number; onClick: () => void; accent?: 'indigo' | 'rose' }> = ({ name, images, lastAt, onClick, accent = 'indigo' }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-gray-800/70">
    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg text-xs font-bold ${accent === 'rose' ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-indigo-50 text-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300'}`}>
      {String(images)}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100" title={name}>{name}</span>
      <span className="mt-0.5 block text-micro text-gray-400 dark:text-gray-500">{t('{0} 张 · 最近 {1}', [formatNumber(images), formatDay(lastAt)])}</span>
    </span>
    <ArrowRight className="h-3.5 w-3.5 flex-none text-gray-300 dark:text-gray-600" />
  </button>
);

const SectionCard: React.FC<{ title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, hint, action, children, className = '' }) => (
  <section className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 ${className}`}>
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const SmallMetric: React.FC<{ label: string; value: React.ReactNode; detail?: React.ReactNode }> = ({ label, value, detail }) => (
  <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
    <span className="block text-micro text-gray-400 dark:text-gray-500">{label}</span>
    <span className="mt-1 block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{value}</span>
    {detail && <span className="mt-0.5 block truncate text-micro text-gray-400">{detail}</span>}
  </div>
);

export const CreationFootprint: React.FC<CreationFootprintProps> = ({ active = true, chains, onOpenHistory, onOpenCollection, onOpenLab, onOpenRoll }) => {
  const language = useLanguage();
  const [granularity, setGranularity] = useState<Granularity>(() => {
    const saved = localStorage.getItem('nai_footprint_granularity_v2');
    return saved === 'week' || saved === 'month' || saved === 'year' ? saved : 'year';
  });
  const [weekStart, setWeekStart] = useState(() => startOfWeek(Date.now()));
  const range: UsageRange = granularity === 'week' ? '7' : granularity === 'month' ? 'month' : 'all';
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [assets, setAssets] = useState<UsageAssets & { agent?: PromptAgentSession[] }>({});
  const [agentLoading, setAgentLoading] = useState(true);
  const [eventStats, setEventStats] = useState<UsageEventStats | null>(null);
  const [keyUsageFirstAt, setKeyUsageFirstAt] = useState<number | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');
  const [selectedYear, setSelectedYear] = useState(() => {
    const saved = localStorage.getItem('nai_footprint_year');
    const current = String(new Date().getFullYear());
    if (saved === null) return current;
    if (saved === '') return '';
    return /^\d{4}$/.test(saved) && Number(saved) <= Number(current) ? saved : current;
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const saved = localStorage.getItem('nai_footprint_month');
    return saved && /^\d{4}-\d{2}$/.test(saved) && saved <= currentMonthKey() ? saved : currentMonthKey();
  });
  const requestRef = useRef(0);
  const eventsRequestRef = useRef<Promise<void>>(Promise.resolve());
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScrollRestore = useKeepAliveScrollRestore(scrollRef, 'footprint');
  const collectionRevisionValue = useSyncExternalStore(subscribeCollection, collectionRevision, collectionRevision);

  useEffect(() => { localStorage.setItem('nai_footprint_granularity_v2', granularity); }, [granularity]);
  useEffect(() => { localStorage.setItem('nai_footprint_month', selectedMonth); }, [selectedMonth]);
  useEffect(() => { localStorage.setItem('nai_footprint_year', selectedYear); }, [selectedYear]);

  // 先交付轻量 Key 用量，避免历史聚合与资产查询占满本地后端后才返回。
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setEventsLoading(true); setEventsError(''); setEventStats(null);
    eventsRequestRef.current = getUsageEventStats(range, controller.signal, selectedMonth, range === 'all' ? selectedYear || undefined : undefined, range === '7' ? { start: weekStart, end: endOfWeek(weekStart) } : undefined)
      .then(data => { if (!controller.signal.aborted) { setEventStats(data); setKeyUsageFirstAt(data.keyUsageFirstAt ?? null); } })
      .catch(() => { if (!controller.signal.aborted) setEventsError(t('用量读取失败，请重试')); })
      .finally(() => { if (!controller.signal.aborted) setEventsLoading(false); });
    return () => controller.abort();
  }, [active, range, selectedMonth, selectedYear, weekStart, reload]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const request = ++requestRef.current;
    setLoading(true); setError('');
    void eventsRequestRef.current.then(() => {
      if (controller.signal.aborted) return;
      return getUsageStats(range, controller.signal, selectedMonth, range === 'all' ? selectedYear || undefined : undefined, range === '7' ? { start: weekStart, end: endOfWeek(weekStart) } : undefined);
    })
      .then(data => { if (data && !controller.signal.aborted && request === requestRef.current) setStats(data); })
      .catch(cause => {
        if (request !== requestRef.current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : t('统计加载失败，请稍后重试'));
      })
      .finally(() => { if (!controller.signal.aborted && request === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [active, range, selectedMonth, selectedYear, weekStart, reload]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const controller = new AbortController();
    setAgentLoading(true);
    void eventsRequestRef.current.then(() => {
      if (cancelled) return;
      return Promise.allSettled([
        getUsageAssets(controller.signal).catch(() => ({})).then(summary => {
          if (!cancelled) setAssets(previous => ({ ...summary, agent: previous.agent }));
        }),
        promptAgentService.listSessions().catch(() => undefined).then(agent => {
          if (!cancelled) setAssets(previous => ({ ...previous, agent }));
        }).finally(() => { if (!cancelled) setAgentLoading(false); }),
        ensureCollection(),
      ]);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [active, reload]);

  const monthBounds = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return {
      start: new Date(year, month - 1, 1).getTime(),
      end: new Date(year, month, 1).getTime() - 1,
      days: new Date(year, month, 0).getDate(),
    };
  }, [selectedMonth]);
  const yearBounds = useMemo(() => {
    const year = Number(selectedYear) || new Date().getFullYear();
    return {
      start: new Date(year, 0, 1).getTime(),
      end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
    };
  }, [selectedYear]);
  const rangeStart = range === '7'
    ? weekStart
    : range === 'month' ? monthBounds.start : selectedYear ? yearBounds.start : 0;
  const rangeEnd = range === '7'
    ? endOfWeek(weekStart)
    : range === 'month' ? monthBounds.end : selectedYear ? yearBounds.end : Date.now();
  const inRange = React.useCallback((time?: number) => range === 'all' && !selectedYear ? true : time === undefined || (time >= rangeStart && time <= rangeEnd), [range, selectedYear, rangeStart, rangeEnd]);

  const collectionStats = useMemo(() => {
    const items = collectionSnapshot().filter(item => !item.archived);
    const bySource = new Map<string, number>();
    const boards = new Set<string>();
    for (const item of items) {
      const source = item.sourceType || 'other';
      bySource.set(source, (bySource.get(source) || 0) + 1);
      if (item.boardId) boards.add(item.boardId);
    }
    return {
      total: items.length,
      chains: items.filter(item => item.sourceType === 'chain').length,
      artists: items.filter(item => item.sourceType === 'artist').length,
      boards: boards.size,
      bySource: [...bySource].sort((left, right) => right[1] - left[1]),
    };
  }, [collectionRevisionValue]);

  const chainStats = useMemo(() => ({
    style: chains.filter(chain => chain.type === 'style').length,
    character: chains.filter(chain => chain.type === 'character').length,
  }), [chains]);

  const rollStats = useMemo(() => {
    const experiments = (assets.roll || []).filter(experiment => !experiment.archived && inRange(experiment.updatedAt));
    const candidates = experiments.flatMap(experiment => experiment.candidates).filter(candidate => inRange(candidate.createdAt));
    const rounds = experiments.flatMap(experiment => experiment.rounds).filter(round => inRange(round.createdAt));
    const top = experiments.map(experiment => {
      const scoped = experiment.candidates.filter(candidate => inRange(candidate.createdAt));
      return { id: experiment.id, name: experiment.name, candidates: scoped.length, saved: scoped.filter(candidate => candidate.savedChainId).length };
    }).sort((left, right) => right.candidates - left.candidates).slice(0, 5);
    return {
      experiments: experiments.length,
      candidates: candidates.length,
      saved: candidates.filter(candidate => candidate.savedChainId).length,
      archived: candidates.filter(candidate => candidate.archived).length,
      rounds: rounds.length,
      top,
    };
  }, [assets.roll, inRange]);

  const vibeStats = useMemo(() => {
    const vibeAssets = (assets.vibes || []).filter(asset => inRange(asset.createdAt));
    const encodings = vibeAssets.flatMap(asset => asset.encodings).filter(encoding => inRange(encoding.createdAt));
    const models = new Map<string, number>();
    for (const encoding of encodings) models.set(encoding.model, (models.get(encoding.model) || 0) + 1);
    return {
      assets: vibeAssets.length,
      encodings: encodings.length,
      groups: (assets.vibeGroups || []).filter(group => inRange(group.createdAt)).length,
      models: [...models].sort((left, right) => right[1] - left[1]).slice(0, 5),
    };
  }, [assets.vibes, assets.vibeGroups, inRange]);

  const agentStats = useMemo(() => {
    const sessions = (assets.agent || []).filter(session => inRange(session.updatedAt));
    const models = new Map<string, number>();
    for (const session of sessions) if (session.model) models.set(session.model, (models.get(session.model) || 0) + 1);
    return {
      sessions: sessions.length,
      messages: sessions.reduce((sum, session) => sum + (session.messageCount || 0), 0),
      models: [...models].sort((left, right) => right[1] - left[1]).slice(0, 5),
    };
  }, [assets.agent, inRange]);

  const generationOutcomes = useMemo(() => {
    const value = (action: string) => eventStats?.totals.find(row => row.category === 'generation' && row.action === action)?.count || 0;
    return { failed: value('failed'), cancelled: value('cancelled'), blocked: value('blocked') };
  }, [eventStats]);

  const groupedChains = useMemo(() => {
    const map = new Map<string, UsageChainRow>();
    for (const chain of stats?.chains || []) {
      const key = chain.name || chain.id;
      const current = map.get(key);
      if (current) {
        current.images += chain.images;
        current.lastAt = Math.max(current.lastAt, chain.lastAt);
      } else map.set(key, { ...chain });
    }
    return [...map.values()].sort((left, right) => right.images - left.images || right.lastAt - left.lastAt);
  }, [stats?.chains]);

  const availableYears = useMemo(() => [...new Set((stats?.daily || []).map(point => point.date.slice(0, 4)))].filter(year => Number(year) <= new Date().getFullYear()).sort().reverse(), [stats?.daily]);
  const activeYear = selectedYear || availableYears[0] || String(new Date().getFullYear());

  const compactDays = useMemo(() => {
    const counts = new Map((stats?.daily || []).map(point => [point.date, point.images]));
    const today = new Date();
    const todayKey = dayKey(today);
    if (range === '7') {
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + index);
        const key = dayKey(date);
        return { key, count: counts.get(key) || 0, today: key === todayKey, future: date > today };
      });
    }
    if (range === 'month') {
      const [year, month] = selectedMonth.split('-').map(Number);
      return Array.from({ length: monthBounds.days }, (_, index) => {
        const date = new Date(year, month - 1, index + 1);
        const key = dayKey(date);
        return { key, count: counts.get(key) || 0, today: key === todayKey, future: date > today };
      });
    }
    return [];
  }, [range, weekStart, selectedMonth, monthBounds.days, stats?.daily]);

  const heatmap = useMemo(() => {
    if (range !== 'all') return { weeks: [], labels: [], startKey: '', endKey: '' };
    const counts = new Map((stats?.daily || []).map(point => [point.date, point.images]));
    const today = new Date();
    const end = new Date(Number(activeYear), 11, 31);
    const start = new Date(Number(activeYear), 0, 1);
    const gridStart = new Date(start);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const todayKey = dayKey(today);
    const weeks: { key: string; count: number; today: boolean; future: boolean }[][] = [];
    let week: { key: string; count: number; today: boolean; future: boolean }[] = [];
    for (let cursor = new Date(gridStart); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const date = new Date(cursor);
      const key = dayKey(date);
      const hidden = date < start || date > today;
      week.push({ key, count: hidden ? 0 : counts.get(key) || 0, today: key === todayKey, future: hidden });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) {
      while (week.length < 7) week.push({ key: '', count: 0, today: false, future: true });
      weeks.push(week);
    }
    const labels: { label: string; monthKey: string; weekIndex: number }[] = [];
    weeks.forEach((days, weekIndex) => {
      const first = days.find(day => day.key && day.key >= dayKey(start));
      if (!first) return;
      const [year, month] = first.key.split('-').map(Number);
      const monthKey = `${year}-${month}`;
      if (labels.at(-1)?.monthKey === monthKey) return;
      labels.push({ label: formatMonth(new Date(year, month - 1, 1)), monthKey, weekIndex });
    });
    return { weeks, labels, startKey: dayKey(start), endKey: dayKey(end) };
  }, [range, activeYear, stats?.daily, language]);

  const trend = useMemo(() => {
    const counts = new Map((stats?.daily || []).map(point => [point.date, point.images]));
    if (range === '7') {
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + index);
        const key = dayKey(date);
        return { key, count: counts.get(key) || 0 };
      });
    }
    if (range === 'month') {
      const [year, month] = selectedMonth.split('-').map(Number);
      return Array.from({ length: monthBounds.days }, (_, index) => {
        const date = new Date(year, month - 1, index + 1);
        const key = dayKey(date);
        return { key, count: counts.get(key) || 0 };
      });
    }
    const year = Number(activeYear);
    const monthly = Array.from({ length: 12 }, () => 0);
    for (const point of stats?.daily || []) {
      if (point.date.startsWith(`${year}-`)) monthly[Number(point.date.slice(5, 7)) - 1] += point.images;
    }
    return monthly.map((count, index) => ({ key: `${year}-${String(index + 1).padStart(2, '0')}`, count }));
  }, [range, weekStart, selectedMonth, monthBounds.days, activeYear, stats?.daily]);

  const openDay = (key: string) => {
    if (!key) return;
    const [year, month, day] = key.split('-').map(Number);
    const from = new Date(year, month - 1, day).getTime();
    onOpenHistory({ from, to: startOfDay(new Date(year, month - 1, day + 1)) - 1, sort: 'newest' });
  };
  const openTrend = (key: string) => {
    if (key.length === 7) {
      const [year, month] = key.split('-').map(Number);
      onOpenHistory({ from: new Date(year, month - 1, 1).getTime(), to: new Date(year, month, 1).getTime() - 1, sort: 'newest' });
      return;
    }
    openDay(key);
  };
  const openChain = (chain: UsageChainRow) => onOpenHistory({ ...(chain.name ? { search: chain.name } : { source: chain.id }), sort: 'newest' });
  const openArtist = (name: string) => onOpenHistory({ search: `artist:${name}`, sort: 'newest' });
  const openModel = (model: string) => onOpenHistory({ model, sort: 'newest' });
  const openOperation = (operation: string) => onOpenHistory({ operation, sort: 'newest' });
  const chainLabel = (chain: UsageChainRow) => chain.name || (chain.id === 'playground' ? t('生图实验室') : t('已移除的预设'));

  const totals = stats?.totals;
  const topChain = groupedChains[0];
  const topArtist = stats?.artists[0];
  const topModel = stats?.models[0];
  const topSize = stats?.sizes[0];
  const topSteps = stats?.steps[0];
  const averagePerActiveDay = totals && totals.activeDays > 0 ? (totals.images / totals.activeDays).toFixed(1) : '0';
  const maxTrend = Math.max(1, ...trend.map(point => point.count));
  const hasData = Boolean(totals && totals.images > 0);

  const exportCsv = () => {
    if (!stats) return;
    const rows: string[][] = [['category', 'name', 'count', 'recent']];
    const push = (category: string, name: string, count: number, recent?: number) => rows.push([category, name, String(count), recent ? new Date(recent).toISOString() : '']);
    push('summary', 'works', stats.totals.images, stats.totals.lastAt || undefined);
    push('summary', 'active_days', stats.totals.activeDays);
    push('summary', 'streak', stats.totals.currentStreak);
    push('summary', 'history_favorites', stats.totals.favoriteImages);
    stats.chains.forEach(row => push('style_chain', chainLabel(row), row.images, row.lastAt));
    stats.artists.forEach(row => push('artist', row.name, row.images, row.lastAt));
    stats.characters.forEach(row => push('character', row.name, row.images, row.lastAt));
    stats.tags.forEach(row => push('tag', row.name, row.images));
    stats.models.forEach(row => push('model', getNaiModelDisplayLabel(row.model), row.images));
    stats.sizes.forEach(row => push('size', `${row.width}x${row.height}`, row.images));
    stats.steps.forEach(row => push('steps', String(row.steps), row.images));
    stats.operations.forEach(row => push('operation', t(OPERATION_LABELS[row.operation] || row.operation), row.images));
    collectionStats.bySource.forEach(([source, count]) => push('collection_source', sourceLabel(source as InspirationSourceType), count));
    rollStats.top.forEach(row => push('roll', row.name, row.candidates));
    vibeStats.models.forEach(([model, count]) => push('vibe_model', getNaiModelDisplayLabel(model), count));
    agentStats.models.forEach(([model, count]) => push('agent_model', model, count));
    eventStats?.keys?.forEach((row, index) => {
      const name = row.name || t('历史用量 {0}', [index + 1]);
      if (row.models.length) push('key_images', name, row.images);
      if (row.models.length || row.encodingAnlas > 0) {
        push('key_generation_anlas_estimate', name, row.generationAnlas);
        push('key_encoding_anlas_estimate', name, row.encodingAnlas);
        push('key_opus_images', name, row.opusImages);
        push('key_unknown_billing_images', name, row.unknownBillingImages);
      }
      if (row.lifetime) {
        push('key_cumulative_anlas_estimate', name, row.lifetime.anlasSpent);
        push('key_cumulative_opus_images', name, row.lifetime.opusImages);
      }
      row.models.forEach(model => push('key_model', `${name} · ${model.model}`, model.images));
    });
    rows[0].push('period');
    rows.slice(1).forEach(row => row.push(row[0].startsWith('key_cumulative_') ? t('累计（含旧版）') : row[0].startsWith('key_') ? usagePeriod : ''));
    const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `creation-footprint-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const weekLabel = `${formatDay(weekStart)}–${formatDay(endOfWeek(weekStart))}`;
  const usagePeriod = granularity === 'week' ? weekLabel : granularity === 'month' ? formatYearMonth(selectedMonth) : selectedYear || t('全部年份');
  const weekOptions = useMemo(() => {
    const current = startOfWeek(Date.now());
    const earliest = stats?.daily?.[0]?.date ? dayKeyToTime(stats.daily[0].date) : current;
    const first = Math.min(startOfWeek(earliest), startOfWeek(keyUsageFirstAt || current), current - 11 * 7 * 86400000);
    const values: number[] = [];
    for (let time = current; time >= first; time -= 7 * 86400000) values.push(time);
    if (weekStart <= current && !values.includes(weekStart)) values.push(weekStart);
    return [...new Set(values)].sort((left, right) => right - left);
  }, [stats?.daily, weekStart, keyUsageFirstAt]);
  const monthOptions = useMemo(() => {
    const now = new Date();
    const current = new Date(now.getFullYear(), now.getMonth(), 1);
    const historyFirst = stats?.daily?.[0]?.date ? dayKeyToTime(stats.daily[0].date) : current.getTime();
    const earliest = new Date(Math.min(historyFirst, keyUsageFirstAt || current.getTime()));
    const fallback = new Date(current.getFullYear(), current.getMonth() - 11, 1);
    const first = new Date(Math.min(new Date(earliest.getFullYear(), earliest.getMonth(), 1).getTime(), fallback.getTime()));
    const values: string[] = [];
    for (const cursor = new Date(current); cursor >= first; cursor.setMonth(cursor.getMonth() - 1)) {
      values.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    }
    if (selectedMonth <= currentMonthKey() && !values.includes(selectedMonth)) values.push(selectedMonth);
    return [...new Set(values)].sort().reverse();
  }, [stats?.daily, selectedMonth, keyUsageFirstAt]);
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const years = new Set(availableYears.map(Number));
    years.add(current);
    if (selectedYear) years.add(Number(selectedYear));
    if (keyUsageFirstAt) {
      for (let year = new Date(keyUsageFirstAt).getFullYear(); year <= current; year++) years.add(year);
    }
    return [...years].filter(year => year <= current).sort((left, right) => right - left);
  }, [availableYears, selectedYear, keyUsageFirstAt]);
  const pickerClassName = 'mobile-touch h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-600 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';
  const periodPicker = granularity === 'week'
    ? <select aria-label={t('选择周')} value={String(weekStart)} onChange={event => setWeekStart(Number(event.target.value))} className={pickerClassName}>
      {weekOptions.map(time => <option key={time} value={time}>{formatDay(time)}–{formatDay(endOfWeek(time))}</option>)}
    </select>
    : granularity === 'month'
      ? <select aria-label={t('选择月份')} value={selectedMonth} onChange={event => { if (event.target.value) setSelectedMonth(event.target.value); }} className={pickerClassName}>
        {monthOptions.map(month => <option key={month} value={month}>{formatYearMonth(month)}</option>)}
      </select>
      : <select aria-label={t('选择年份')} value={selectedYear} onChange={event => setSelectedYear(event.target.value)} className={pickerClassName}>
        <option value="">{t('全部年份')}</option>
        {yearOptions.map(year => <option key={year} value={year}>{year}</option>)}
      </select>;
  const keyUsage = <KeyUsageSection rows={eventStats?.keys || []} period={usagePeriod} includeLifetime={range === 'all' && !selectedYear} periodPicker={!hasData ? periodPicker : undefined} loading={eventsLoading} error={eventsError} onRetry={() => setReload(value => value + 1)} />;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-300"><Footprints className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{t('创作足迹')}</h1>
            <p className="hidden truncate text-micro text-gray-400 dark:text-gray-500 sm:block">{t('回看创作节奏、常用资产与收藏')}</p>
          </div>
        </div>
        <div className="flex max-w-[52vw] flex-none items-center gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-950 md:max-w-none">
          {GRANULARITIES.map(item => <button key={item.id} type="button" aria-pressed={granularity === item.id} onClick={() => setGranularity(item.id)} className={`mobile-touch whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition ${granularity === item.id ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>{t(item.label)}</button>)}
        </div>
        <ToolbarButton aria-label={t('刷新统计')} title={t('刷新统计')} onClick={() => setReload(value => value + 1)} disabled={loading} className="!px-2.5">
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}<span className="hidden lg:inline">{t('刷新')}</span>
        </ToolbarButton>
        <ToolbarButton aria-label={t('导出 CSV')} title={t('导出 CSV')} onClick={exportCsv} disabled={!stats || eventsLoading || Boolean(eventsError)} className="!px-2.5">
          <Download /><span className="hidden xl:inline">CSV</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => onOpenHistory({ sort: 'newest' })} className="!px-2.5">
          <CalendarDays /><span className="hidden sm:inline">{t('打开历史')}</span>
        </ToolbarButton>
      </WorkspaceToolbar>

      <div ref={scrollRef} onScroll={onScrollRestore} className="min-h-0 flex-1 overflow-y-scroll overscroll-contain p-4 pb-28 md:p-6 md:pb-10">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          {loading && !stats && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />)}</div>}

          {error && !loading && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            <div className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setReload(value => value + 1)} className="mobile-touch rounded-lg border border-current px-3 py-1 text-xs font-semibold">{t('重试')}</button><button type="button" onClick={() => onOpenHistory({ sort: 'newest' })} className="mobile-touch text-xs font-semibold underline">{t('打开历史')}</button></div>
          </div>}

          {!error && !loading && !hasData && <div className="rounded-2xl border border-gray-200 bg-white py-14 dark:border-gray-800 dark:bg-gray-900">
            <EmptyState icon={<Footprints className="h-8 w-8" />} title={t('还没有创作记录')} hint={t('生成并保存作品后，这里会记录你的创作节奏、常用画师与风格串。')} action={<div className="flex flex-wrap items-center justify-center gap-2"><ToolbarButton tone="primary" onClick={onOpenLab}>{t('去实验室创作')}</ToolbarButton><ToolbarButton onClick={() => onOpenHistory({ sort: 'newest' })}>{t('打开历史')}</ToolbarButton></div>} />
          </div>}
          {!hasData && keyUsage}

          {!error && hasData && totals && stats && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <StatCard label={t('作品总数')} value={formatNumber(totals.images)} detail={t('最近 {0}', [formatDay(totals.lastAt || 0)])} icon={<ImageIcon />} />
              <StatCard label={t('活跃天数')} value={formatNumber(totals.activeDays)} detail={t('平均每个活跃日 {0} 张', [averagePerActiveDay])} icon={<CalendarDays />} />
              <StatCard label={t('连续创作')} value={`${formatNumber(totals.currentStreak)} ${t('天')}`} icon={<Flame />} />
              <StatCard label={t('历史收藏')} value={formatNumber(totals.favoriteImages)} detail={t('已收藏的历史作品')} icon={<Heart />} />
              <StatCard label={t('最常用风格串')} value={topChain ? chainLabel(topChain) : t('暂无')} detail={topChain ? t('{0} 张', [formatNumber(topChain.images)]) : undefined} icon={<Palette />} title={topChain ? chainLabel(topChain) : undefined} />
              <StatCard label={t('最常用画师')} value={topArtist ? topArtist.name : t('暂无')} detail={topArtist ? t('{0} 张', [formatNumber(topArtist.images)]) : undefined} icon={<Brush />} title={topArtist?.name} />
            </div>

            <SectionCard
              title={granularity === 'week' ? t('创作活动 · {0}', [weekLabel]) : granularity === 'month' ? t('创作活动 · {0}', [formatYearMonth(selectedMonth)]) : t('创作活动 · {0}', [selectedYear || t('全部年份')])}
              hint={granularity === 'week'
                ? t('所选周每天生成的作品数；点击某天查看当天作品')
                : granularity === 'month'
                  ? t('所选月份每天生成的作品数；点击某天查看当天作品')
                  : (selectedYear ? t('所选年份每天生成的作品数；点击某天查看当天作品') : t('全部年份统计；热力图显示最近一年'))}
              action={<div className="flex flex-wrap items-center gap-2">
                {periodPicker}
                <span className="hidden items-center gap-1.5 text-micro text-gray-400 sm:flex">{t('少')}<span className="h-2.5 w-2.5 rounded-[2px] bg-gray-200 dark:bg-gray-800" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-300 dark:bg-indigo-800" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-400 dark:bg-indigo-700" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-500 dark:bg-indigo-600" /><span className="h-2.5 w-2.5 rounded-[2px] bg-indigo-600 dark:bg-indigo-500" />{t('多')}</span>
              </div>}
            >
              {compactDays.length > 0 ? <>
                <div className="grid w-max grid-cols-7 gap-1.5" role="grid" aria-label={t('创作活动热力图')}>
                  {compactDays.map(day => <button key={day.key} type="button" role="gridcell" disabled={day.future} onClick={() => openDay(day.key)} title={day.future ? '' : t('{0} · {1} 张', [day.key, formatNumber(day.count)])} aria-label={day.future ? t('未来') : t('{0} · {1} 张', [day.key, formatNumber(day.count)])} className={`mobile-touch h-8 w-8 rounded-[3px] transition hover:ring-2 hover:ring-indigo-300 disabled:cursor-default disabled:opacity-0 dark:hover:ring-indigo-600 ${heatClass(day.count)} ${day.today ? 'ring-1 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900' : ''}`} />)}
                </div>
                <div className="mt-2 flex justify-between text-micro text-gray-400 dark:text-gray-500"><span>{formatDay(dayKeyToTime(compactDays[0].key))}</span><span>{granularity === 'week' ? formatDay(endOfWeek(weekStart)) : formatDay(monthBounds.end)}</span></div>
              </> : <>
                <div className="overflow-x-auto pb-1">
                  <div className="w-full min-w-[760px]">
                    <div aria-hidden="true" className="mb-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, minmax(0, 1fr))` }}>
                      {heatmap.labels.map(label => <span key={label.monthKey} style={{ gridColumnStart: label.weekIndex + 1, gridColumnEnd: `span ${Math.min(4, heatmap.weeks.length - label.weekIndex)}`, gridRowStart: 1 }} className="truncate text-micro text-gray-400 dark:text-gray-500">{label.label}</span>)}
                    </div>
                    <div className="flex w-full gap-1" role="grid" aria-label={t('创作活动热力图')}>
                      {heatmap.weeks.map((week, weekIndex) => <div key={weekIndex} role="row" className="flex min-w-0 flex-1 flex-col gap-1">
                        {week.map((day, dayIndex) => <button key={dayIndex} type="button" role="gridcell" disabled={day.future} onClick={() => openDay(day.key)} title={day.future ? '' : t('{0} · {1} 张', [day.key, formatNumber(day.count)])} aria-label={day.future ? t('未来') : t('{0} · {1} 张', [day.key, formatNumber(day.count)])} className={`aspect-square w-full rounded-[2px] transition hover:ring-2 hover:ring-indigo-300 disabled:cursor-default disabled:opacity-0 dark:hover:ring-indigo-600 ${heatClass(day.count)} ${day.today ? 'ring-1 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900' : ''}`} />)}
                      </div>)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-micro text-gray-400 dark:text-gray-500"><span>{heatmap.startKey ? formatDay(dayKeyToTime(heatmap.startKey)) : ''}</span><span>{range === 'all' ? formatDay(dayKeyToTime(heatmap.endKey)) : t('今天')}</span></div>
              </>}
            </SectionCard>

            {keyUsage}
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title={t('风格串使用排行')} hint={t('按由该风格串生成的作品数排序')} action={<button type="button" onClick={() => onOpenHistory({ sort: 'newest' })} className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('打开历史')}</button>}>
                {groupedChains.length ? <div className="space-y-0.5">{groupedChains.slice(0, 8).map(chain => <RankingRow key={chain.name || chain.id} name={chainLabel(chain)} images={chain.images} lastAt={chain.lastAt} onClick={() => openChain(chain)} />)}</div> : <p className="py-8 text-center text-sm text-gray-400">{t('暂无')}</p>}
              </SectionCard>
              <SectionCard title={t('画师使用排行')} hint={t('按历史 Prompt 中的 artist: 标签统计')}>
                {stats.artists.length ? <div className="space-y-0.5">{stats.artists.slice(0, 8).map(artist => <RankingRow key={artist.name} name={artist.name} images={artist.images} lastAt={artist.lastAt} onClick={() => openArtist(artist.name)} accent="rose" />)}</div> : <p className="py-8 text-center text-sm text-gray-400">{t('暂无')}</p>}
                {stats.artistScan.truncated && <p className="mt-2 text-micro text-gray-400">{t('基于最近 {0} 张作品统计', [formatNumber(stats.artistScan.scanned)])}</p>}
              </SectionCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <SectionCard title={granularity === 'week' ? t('所选周趋势') : granularity === 'month' ? t('所选月份趋势') : (selectedYear ? t('年度月度趋势') : t('最近一年月度趋势'))} hint={granularity === 'year' ? t('每月生成的作品数') : t('每天生成的作品数')}>
                <div className="flex h-28 items-end gap-1" role="img" aria-label={granularity === 'year' ? t('每月生成的作品数') : t('每天生成的作品数')}>
                  {trend.map(day => <button key={day.key} type="button" onClick={() => openTrend(day.key)} title={t('{0} · {1} 张', [day.key, formatNumber(day.count)])} className="mobile-touch flex h-full flex-1 items-end rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><span className={`w-full rounded-t transition-colors ${day.count ? 'bg-indigo-500/85 hover:bg-indigo-500 dark:bg-indigo-400/80' : 'bg-gray-100 dark:bg-gray-800'}`} style={{ height: `${Math.max(3, day.count / maxTrend * 100)}%` }} /></button>)}
                </div>
                <div className="mt-2 flex justify-between text-micro text-gray-400"><span>{granularity === 'year' ? formatMonth(new Date(Number(activeYear), 0, 1)) : trend[0] ? formatDay(dayKeyToTime(trend[0].key)) : ''}</span><span>{granularity === 'year' ? formatMonth(new Date(Number(activeYear), 11, 1)) : granularity === 'week' ? formatDay(endOfWeek(weekStart)) : formatDay(monthBounds.end)}</span></div>
              </SectionCard>

              <SectionCard title={t('收藏概览')} hint={t('全部收藏，不随上方范围变化')} action={<button type="button" onClick={onOpenCollection} className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('打开收藏库')}</button>}>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={onOpenCollection} className="mobile-touch rounded-xl bg-gray-50 p-3 text-left dark:bg-gray-800/60"><span className="block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(collectionStats.chains)}</span><span className="mt-0.5 block text-micro text-gray-400">{t('收藏的风格串')}</span></button>
                  <button type="button" onClick={onOpenCollection} className="mobile-touch rounded-xl bg-gray-50 p-3 text-left dark:bg-gray-800/60"><span className="block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(collectionStats.artists)}</span><span className="mt-0.5 block text-micro text-gray-400">{t('收藏的画师')}</span></button>
                  <button type="button" onClick={onOpenCollection} className="mobile-touch rounded-xl bg-gray-50 p-3 text-left dark:bg-gray-800/60"><span className="block text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(collectionStats.total)}</span><span className="mt-0.5 block text-micro text-gray-400">{t('收藏的图片')}</span></button>
                </div>
                <p className="mt-3 text-micro leading-5 text-gray-400">{t('收藏是作品级记录；这里只汇总数量，不改变收藏内容。')}</p>
              </SectionCard>
            </div>

            <SectionCard title={t('创作洞察')} hint={t('从已保存作品归纳，不代表官方额度结算')}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <button type="button" onClick={() => topModel && openModel(topModel.model)} disabled={!topModel} className="mobile-touch rounded-xl border border-gray-100 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40 disabled:cursor-default dark:border-gray-800 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20"><span className="flex items-center gap-1.5 text-micro text-gray-400"><Sparkles className="h-3 w-3" />{t('最常用模型')}</span><span className="mt-1 block truncate text-sm font-bold text-gray-800 dark:text-gray-100">{topModel ? getNaiModelDisplayLabel(topModel.model) : t('暂无')}</span></button>
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><span className="flex items-center gap-1.5 text-micro text-gray-400"><BarChart3 className="h-3 w-3" />{t('最常用尺寸')}</span><span className="mt-1 block text-sm font-bold text-gray-800 dark:text-gray-100">{topSize ? `${topSize.width} × ${topSize.height}` : t('暂无')}</span></div>
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><span className="flex items-center gap-1.5 text-micro text-gray-400"><Activity className="h-3 w-3" />{t('最常用步数')}</span><span className="mt-1 block text-sm font-bold text-gray-800 dark:text-gray-100">{topSteps ? t('{0} 步', [topSteps.steps]) : t('暂无')}</span></div>
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><span className="flex items-center gap-1.5 text-micro text-gray-400"><Palette className="h-3 w-3" />{t('探索画师')}</span><span className="mt-1 block text-sm font-bold text-gray-800 dark:text-gray-100">{formatNumber(stats.uniqueArtists)}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {stats.operations.map(operation => <button key={operation.operation} type="button" onClick={() => openOperation(operation.operation)} className="mobile-touch rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">{t(OPERATION_LABELS[operation.operation] || operation.operation)} · {formatNumber(operation.images)}</button>)}
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">{t('使用风格串')} · {formatNumber(stats.uniqueChains)}</span>
              </div>
            </SectionCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title={t('角色使用排行')} hint={t('按历史中的角色提示词统计')}>
                {stats.characters.length ? <div className="space-y-0.5">{stats.characters.slice(0, 8).map(character => <RankingRow key={character.id} name={character.name || t('未命名角色')} images={character.images} lastAt={character.lastAt} onClick={() => onOpenHistory({ search: character.name, sort: 'newest' })} accent="rose" />)}</div> : <p className="py-8 text-center text-sm text-gray-400">{t('暂无')}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-gray-50 px-2.5 py-1 text-micro text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">{t('带角色 {0} 张 · {1} 个槽', [formatNumber(stats.characterUsage.images), formatNumber(stats.characterUsage.slots)])}</span>
                  <span className="rounded-full bg-gray-50 px-2.5 py-1 text-micro text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">{t('Vibe {0} 张 · {1} 个槽', [formatNumber(stats.vibeUsage.images), formatNumber(stats.vibeUsage.slots)])}</span>
                  <span className="rounded-full bg-gray-50 px-2.5 py-1 text-micro text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">{t('角色参考 {0} 张 · {1} 个槽', [formatNumber(stats.referenceUsage.images), formatNumber(stats.referenceUsage.slots)])}</span>
                  <span className="rounded-full bg-gray-50 px-2.5 py-1 text-micro text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">{t('角色库')} · {formatNumber(chainStats.character)}</span>
                </div>
              </SectionCard>
              <SectionCard title={t('常用标签')} hint={t('从 Prompt 与角色内容归纳')}>
                {stats.tags.length ? <div className="flex flex-wrap gap-1.5">{stats.tags.slice(0, 12).map(tag => <button key={tag.name} type="button" onClick={() => onOpenHistory({ search: tag.name, sort: 'newest' })} className="mobile-touch rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">{tag.name} · {formatNumber(tag.images)}</button>)}</div> : <p className="py-8 text-center text-sm text-gray-400">{t('暂无')}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-micro text-gray-400 dark:text-gray-500">
                  <span>{t('探索画师')} {formatNumber(stats.uniqueArtists)}</span>
                  <span>·</span>
                  <span>{t('使用角色')} {formatNumber(stats.uniqueCharacters)}</span>
                </div>
              </SectionCard>
            </div>

            <SectionCard title={t('创作资产')} hint={t('本地保存的配方、参考与实验')} action={<button type="button" onClick={onOpenRoll} className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t('打开 Roll 串')}</button>}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                <SmallMetric label={t('风格串')} value={formatNumber(chainStats.style)} />
                <SmallMetric label={t('角色库')} value={formatNumber(chainStats.character)} />
                <SmallMetric label={t('Vibe 资产')} value={assets.vibes ? formatNumber(vibeStats.assets) : '—'} detail={assets.vibes ? t('编码 {0}', [formatNumber(vibeStats.encodings)]) : undefined} />
                <SmallMetric label={t('Vibe 分组')} value={assets.vibeGroups ? formatNumber(vibeStats.groups) : '—'} />
                <SmallMetric label={t('Roll 实验')} value={assets.roll ? formatNumber(rollStats.experiments) : '—'} />
                <SmallMetric label={t('Roll 候选')} value={assets.roll ? formatNumber(rollStats.candidates) : '—'} />
                <SmallMetric label={t('已保存组合')} value={assets.roll ? formatNumber(rollStats.saved) : '—'} />
                <SmallMetric label={t('收藏夹')} value={formatNumber(collectionStats.boards)} detail={t('收藏 {0}', [formatNumber(collectionStats.total)])} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{t('Roll 实验排行')}</p>
                  {rollStats.top.length ? <div className="space-y-0.5">{rollStats.top.map(row => <button key={row.id} type="button" onClick={onOpenRoll} className="mobile-touch flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/70"><span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{row.name}</span><span className="flex-none text-micro text-gray-400">{t('{0} 候选 · {1} 保存', [formatNumber(row.candidates), formatNumber(row.saved)])}</span></button>)}</div> : <p className="py-4 text-center text-sm text-gray-400">{t('暂无')}</p>}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{t('素材与收藏来源')}</p>
                  {collectionStats.bySource.length ? <div className="space-y-1">{collectionStats.bySource.slice(0, 6).map(([source, count]) => <div key={source} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"><span className="min-w-0 truncate text-gray-600 dark:text-gray-300">{sourceLabel(source as InspirationSourceType)}</span><span className="flex-none text-micro tabular-nums text-gray-400">{formatNumber(count)}</span></div>)}</div> : <p className="py-4 text-center text-sm text-gray-400">{t('暂无')}</p>}
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title={t('创作助手')} hint={t('会话与消息元数据，不读取聊天内容')}>
                {agentLoading && !assets.agent ? <p className="py-6 text-center text-sm text-gray-400">{t('正在读取…')}</p> : !assets.agent ? <p className="py-6 text-center text-sm text-gray-400">{t('助手服务未连接')}</p> : <div className="grid grid-cols-2 gap-2">
                  <SmallMetric label={t('会话')} value={formatNumber(agentStats.sessions)} />
                  <SmallMetric label={t('消息')} value={formatNumber(agentStats.messages)} />
                </div>}
                {agentStats.models.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{agentStats.models.map(([model, count]) => <span key={model} className="rounded-full bg-gray-50 px-2.5 py-1 text-micro text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">{model} · {formatNumber(count)}</span>)}</div>}
              </SectionCard>
              <SectionCard title={t('生成结果')} hint={t('所选周期内的全工坊事件')}>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <SmallMetric label={t('失败')} value={eventsLoading || eventsError ? '—' : formatNumber(generationOutcomes.failed)} />
                  <SmallMetric label={t('取消')} value={eventsLoading || eventsError ? '—' : formatNumber(generationOutcomes.cancelled)} />
                  <SmallMetric label={t('受阻')} value={eventsLoading || eventsError ? '—' : formatNumber(generationOutcomes.blocked)} />
                </div>
                <p className="mt-1 text-micro leading-5 text-gray-400 dark:text-gray-500">{t('失败、取消与受阻自本版本起记录；历史只保留成功保存的作品。')}</p>
              </SectionCard>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
};
