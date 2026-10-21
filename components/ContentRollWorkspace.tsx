import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Dice5, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { t } from '../services/i18n';
import type { PromptChain } from '../types';
import { KINDS, META } from '../services/contentRoll';
import type { RollRow } from '../services/contentRoll';
import { draw, evidenceOf, rerollOne } from '../services/contentRollDraw';
import type { ContentRollApplyPlan, ContentRollTarget } from '../services/contentRollApply';
import { filterPicksByScope, pickByParticipation, planContentRollApply } from '../services/contentRollApply';
import type { ContentRollScope } from '../services/contentRollApply';
import { planRollToChain } from '../services/contentRollToChain';
import type { RollToChainScope, RollToChainSourceRow } from '../services/contentRollToChain';
import type { NAIParams } from '../types';
import { WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';

interface ContentRollWorkspaceProps {
  active: boolean;
  chains: PromptChain[];
  notify: (message: string, kind?: 'success' | 'error') => void;
  /** 实验室当前已有角色（来自 playground 的 params.characters），用于「填入实验室」的目标选择 */
  playgroundRoles?: Array<{ id: string; label: string }>;
  /** 实验室当前参数（只读，用来显示「当前 → 将填入」） */
  playgroundParams?: NAIParams | null;
  /** 组好的应用计划交给 App 落盘（App 负责写 playground 参数）；返回是否成功 */
  onApplyRoll?: (plan: ContentRollApplyPlan) => Promise<boolean>;
  /** 撤销上一次填入（App 用改动前的快照恢复） */
  onUndoApply?: () => Promise<boolean>;
  /** 从实验室就地发起：范围与目标由调用方指定（消费一次） */
  scopeRequest?: { scope: ContentRollScope; targetId?: string; key: number } | null;
  onScopeRequestConsumed?: () => void;
  /** 是否有可撤销的填入 */
  canUndo?: boolean;
  /** 存为 Roll 内容（App 负责按白名单构造快照并落库），返回新记录 id */
  onSaveRoll?: (name: string, picks: Record<string, RollRow>, seed: string, seeds: Record<string, string>) => Promise<string>;
  /** 从内容库「载入到一键 Roll」带过来的一组（消费一次） */
  seedRecord?: { picks: Record<string, unknown>; seed: string; seeds: Record<string, string> } | null;
  onSeedConsumed?: () => void;
  /**
   * 把这一组写进风格串（新建或写进已有串）。
   * App 负责落库、刷新列表，并清掉目标串的编辑器草稿，避免旧草稿在自动保存时覆盖刚写入的分栏。
   */
  onWriteRollToChain?: (payload: {
    name: string;
    chain: PromptChain | null;
    params: NAIParams;
    variableValues: Record<string, string>;
  }) => Promise<string | undefined>;
}

/** 一次抽取的结果（会话内保留最近 20 组；只存派生数据，不存条目对象）。 */
interface RollRecord {
  seed: string;
  seeds: Record<string, string>;
  picks: Record<string, RollRow>;
  locked: Record<string, string>;
  checks: Record<string, boolean>;
  scope?: ContentRollScope;
  at: number;
}

const STORE_KEY = 'nai-content-roll';
const HISTORY_LIMIT = 20;

const newSeed = (): string => `r${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;

const readStore = (): { history: RollRecord[]; cursor: number } => {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { history: [], cursor: -1 };
    const parsed = JSON.parse(raw) as { history?: RollRecord[]; cursor?: number };
    const history = Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_LIMIT) : [];
    const cursor = Number.isFinite(Number(parsed.cursor)) ? Number(parsed.cursor) : history.length - 1;
    return { history, cursor: Math.min(Math.max(cursor, -1), history.length - 1) };
  } catch {
    return { history: [], cursor: -1 };
  }
};

const shortText = (value: string, max = 48): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * 一键 Roll 工作区：六类内容各抽 1 条，可勾选参与、固定、单栏「换一个」，并保留会话内的抽取历史。
 * 全部随机与证据逻辑在 services/contentRoll（快照/约束）与 services/contentRollDraw（池子/随机流），
 * 本组件只负责界面与本地草稿，不写库、不触发生成。
 */
export const ContentRollWorkspace: React.FC<ContentRollWorkspaceProps> = ({ active, chains, notify, playgroundRoles = [], playgroundParams = null, onApplyRoll, onUndoApply, canUndo = false, onSaveRoll, seedRecord = null, onSeedConsumed, scopeRequest = null, onScopeRequestConsumed, onWriteRollToChain }) => {
  const [initial] = useState(readStore);
  const [history, setHistory] = useState<RollRecord[]>(initial.history);
  const [cursor, setCursor] = useState(initial.cursor);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [targetId, setTargetId] = useState<string>('new');
  const [range, setRange] = useState<ContentRollScope>(() => {
    /* 本机默认「仅角色」；用户改过就记住，下次直接沿用 */
    try {
      const saved = window.localStorage.getItem('nai-content-roll-range');
      if (saved === 'all' || saved === 'character' || saved === 'global') return saved;
    } catch { /* 存储不可用时用默认值 */ }
    return 'character';
  });
  const targetTouched = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState('');

  const current = cursor >= 0 ? history[cursor] : null;

  /* 实验室就地发起：直接切到指定范围与目标 */
  useEffect(() => {
    if (!scopeRequest) return;
    setRange(scopeRequest.scope);
    if (scopeRequest.targetId) {
      targetTouched.current = true;
      setTargetId(scopeRequest.targetId);
    }
    onScopeRequestConsumed?.();
  }, [scopeRequest, onScopeRequestConsumed]);

  /* 默认目标＝当前启用角色；用户手动改过就不再覆盖 */
  useEffect(() => {
    if (targetTouched.current) return;
    const first = playgroundRoles[0];
    setTargetId(first ? first.id : 'new');
  }, [playgroundRoles]);

  /* 范围决定哪些分类参与抽取与应用（角色四类 / 场景镜头 / 全部） */
  const scopeChecks = useMemo(() => {
    if (range === 'all') return {} as Record<string, boolean>;
    const out: Record<string, boolean> = {};
    for (const kind of KINDS) out[kind] = range === 'global' ? META[kind].scope === 'global' : META[kind].scope !== 'global';
    return out;
  }, [range]);
  const effectiveChecks = useMemo(() => Object.fromEntries(KINDS.map(kind => [kind,
    scopeChecks[kind] !== false && checks[kind] !== false,
  ])), [scopeChecks, checks]);

  /* 会话草稿只留在本机：刷新后仍能看到上次这一组，但不会写库 */
  useEffect(() => {
    if (!active) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ history: history.slice(-HISTORY_LIMIT), cursor }));
    } catch {
      /* localStorage 不可用时不影响使用 */
    }
  }, [active, history, cursor]);

  /* 从内容库载入的一组：转成一条历史记录（草稿只在本机） */
  useEffect(() => {
    if (!seedRecord) return;
    const picks = seedRecord.picks as Record<string, RollRow>;
    const hasRoles = Object.keys(picks).some(kind => META[kind]?.scope === 'character');
    const hasGlobal = Object.keys(picks).some(kind => META[kind]?.scope === 'global');
    const scope = hasRoles && hasGlobal ? 'all' : hasGlobal ? 'global' : 'character';
    setRange(scope);
    setHistory(previous => {
      const next = [...previous, { seed: seedRecord.seed, seeds: seedRecord.seeds || {}, picks, locked: {}, checks: {}, scope: scope as ContentRollScope, at: Date.now() }].slice(-HISTORY_LIMIT);
      setCursor(next.length - 1);
      return next;
    });
    setSaveName(seedRecord.seed);
    setChecks({});
    setLocked({});
    notify(t('已把内容库的这一组载入为当前一组；点「填入实验室」继续确认'));
    onSeedConsumed?.();
  }, [seedRecord, notify, onSeedConsumed]);

  /* 上一组 / 下一组：连参与与固定范围一起恢复，避免用新范围读旧结果 */
  const historyRef = useRef(history);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => {
    const record = historyRef.current[cursor];
    if (!record) return;
    setChecks(record.checks || {});
    setLocked(record.locked || {});
    if (record.scope) setRange(record.scope);
  }, [cursor]);

  const commit = useCallback((record: RollRecord) => {
    setHistory(previous => {
      const kept = previous.slice(0, cursor + 1);
      const next = [...kept, { ...record, scope: range }].slice(-HISTORY_LIMIT);
      setCursor(next.length - 1);
      return next;
    });
  }, [cursor, range]);

  const rollOnce = useCallback(() => {
    setBusy(true);
    try {
      const result = draw({ chains, seed: newSeed(), checks: effectiveChecks, locked });
      commit({ seed: result.seed, seeds: result.seeds, picks: result.picks, locked: result.locked, checks: { ...checks }, at: Date.now() });
      const missing = result.notes.filter(note => note.code !== 'pool_empty').length;
      notify(missing ? t('已抽取；有 {0} 条说明需要看一眼', [String(missing)]) : t('已抽取一组六类内容'));
    } finally {
      setBusy(false);
    }
  }, [chains, checks, effectiveChecks, locked, commit, notify]);

  /* 「再抽未固定项」：只换没固定的栏，并排除当前条目（候选不足时核会如实保留并说明） */
  const rollAgain = useCallback(() => {
    if (!current) return;
    setBusy(true);
    try {
      const avoid: Record<string, string | undefined> = {};
      for (const kind of KINDS) {
        if (locked[kind]) continue;
        avoid[kind] = current.picks[kind]?.id || undefined;
      }
      const result = draw({ chains, seed: newSeed(), checks: effectiveChecks, locked, avoid });
      commit({ seed: result.seed, seeds: result.seeds, picks: result.picks, locked: result.locked, checks: { ...checks }, at: Date.now() });
      const kept = result.notes.filter(note => note.code === 'avoid_short').length;
      notify(kept ? t('已重抽；{0} 栏只有一条候选，已保留并说明', [String(kept)]) : t('已重新抽取未固定的栏'));
    } finally {
      setBusy(false);
    }
  }, [chains, current, checks, effectiveChecks, locked, commit, notify]);

  const rerollKind = useCallback((kind: string) => {
    if (!current) return;
    const result = rerollOne({ chains, checks: effectiveChecks, picks: current.picks, locked }, kind, newSeed());
    if (!result.ok) {
      notify(result.message, 'error');
      return;
    }
    const swapped = history.map((record, index) => (index === cursor
      ? { ...record, picks: { ...record.picks, [kind]: result.row as unknown as RollRow }, seeds: { ...record.seeds, [kind]: String(result.seed) } }
      : record));
    setHistory(swapped);
    const note = result.note === 'avoid_short' ? t('（只有这一条可换，已保留）') : '';
    notify(t('已为「{0}」换了一条', [t(META[kind].title)]) + note);
  }, [chains, effectiveChecks, locked, current, history, cursor, notify]);

  const toggleCheck = (kind: string) => setChecks(previous => ({ ...previous, [kind]: effectiveChecks[kind] === false }));
  const toggleLock = (kind: string) => {
    const id = current?.picks[kind]?.id || '';
    if (!id) {
      notify(t('这一栏还没有内容，先抽一次再固定'), 'error');
      return;
    }
    setLocked(previous => {
      const next = { ...previous };
      if (next[kind]) delete next[kind];
      else next[kind] = id;
      return next;
    });
  };

  const evidenceText = useMemo(() => {
    if (!current) return '';
    const evidence = evidenceOf({ ...current, chains });
    return JSON.stringify(evidence, null, 2);
  }, [current, chains]);

  const copyEvidence = async () => {
    try {
      await navigator.clipboard.writeText(evidenceText);
      notify(t('已复制这一组的证据（算法版本 / 随机码 / 每栏随机流 / 池指纹）'));
    } catch {
      notify(t('复制失败：浏览器拒绝了剪贴板权限'), 'error');
    }
  };

  const applyTarget: ContentRollTarget = targetId === 'all-enabled'
    ? { mode: 'all-enabled' }
    : targetId && targetId !== 'new' ? { mode: 'existing', id: targetId } : { mode: 'new' };
  /* 参与范围：取消勾选的栏位即使还留着上次抽到的内容，也不进计划、不入库 */
  const activePicks = useMemo(
    () => (current ? pickByParticipation(filterPicksByScope(current.picks, range), effectiveChecks) : {}),
    [current, range, effectiveChecks],
  );
  const plan = current ? planContentRollApply(activePicks, playgroundParams, applyTarget) : null;

  const doApply = async () => {
    if (!current || !onApplyRoll || !plan) return;
    setApplying(true);
    try {
      const ok = await onApplyRoll(plan);
      if (ok) {
        setConfirming(false);
        notify(t('已填入实验室：角色 {0} 类、补充栏 {1} 类（可撤销）', [String(plan.rows.filter(item => item.action === 'replace' && META[item.kind].scope === 'character').length), String(plan.rows.filter(item => item.action === 'replace' && META[item.kind].scope === 'global').length)]));
      }
    } finally {
      setApplying(false);
    }
  };

  const doSave = async () => {
    if (!current || !onSaveRoll) return;
    const name = saveName.trim();
    if (!name) { notify(t('先给这条记录起个名字'), 'error'); return; }
    setSaving(true);
    try {
      const id = await onSaveRoll(name, activePicks, current.seed, current.seeds);
      setSavedId(String(id || ''));
      setSaveOpen(false);
      notify(t('已存为 Roll 内容「{0}」（六类内容与约束，不含画师风格与生图参数）', [name]));
    } catch (error) {
      notify(t('保存失败：{0}', [String((error as Error)?.message || error)]), 'error');
    } finally {
      setSaving(false);
    }
  };

  const rows = KINDS.map(kind => ({ kind, meta: META[kind], row: current?.picks[kind] || null }));

  /* ---------------- 写入风格串 ---------------- */

  const [chainTargetId, setChainTargetId] = useState('new');
  const [chainScope, setChainScope] = useState<RollToChainScope>('split');
  const [chainPicked, setChainPicked] = useState<Set<string>>(new Set());
  const [chainConfirming, setChainConfirming] = useState(false);
  const [chainName, setChainName] = useState('');
  const [chainBusy, setChainBusy] = useState(false);

  const styleChains = useMemo(() => (Array.isArray(chains) ? chains : []).filter(item => item && item.type === 'style'), [chains]);
  const rollRows = useMemo<RollToChainSourceRow[]>(() => KINDS
    .map(kind => ({ kind, row: activePicks[kind] as RollRow | undefined }))
    .filter(({ row }) => row && row.filled && String(row.text || '').trim())
    .map(({ kind, row }) => ({ kind, name: String(row!.name || ''), text: String(row!.text || '') })), [activePicks]);
  const selectedChain = useMemo(() => styleChains.find(item => item.id === chainTargetId) || null, [chainTargetId, styleChains]);
  const chainPlan = useMemo(
    () => planRollToChain(selectedChain, rollRows.filter(row => chainPicked.has(row.kind)), { scope: chainScope }),
    [chainPicked, chainScope, rollRows, selectedChain],
  );
  const chainWriteOf = (kind: string) => chainPlan.writes.find(write => write.kind === kind) || null;
  const chainTargetLabel = (kind: string) => (chainScope === 'extra'
    ? t('补充栏')
    : META[kind].scope === 'character' ? t('角色 1') : t(META[kind].title));

  const openChainConfirm = () => {
    setChainPicked(new Set(rollRows.map(row => row.kind)));
    setChainName(selectedChain ? '' : t('Roll 内容 {0}', [new Date().toLocaleString()]));
    setChainConfirming(true);
  };

  const doWriteChain = async () => {
    if (!onWriteRollToChain || !chainPicked.size) return;
    setChainBusy(true);
    try {
      const name = chainName.trim() || t('Roll 内容 {0}', [new Date().toLocaleString()]);
      await onWriteRollToChain({
        name,
        chain: selectedChain,
        params: chainPlan.params,
        variableValues: chainPlan.variableValues as Record<string, string>,
      });
      setChainConfirming(false);
      const roleWrites = chainPlan.writes.filter(write => write.target === 'character').length;
      const globalWrites = chainPlan.writes.filter(write => write.target !== 'character').length;
      notify(chainScope === 'extra'
        ? t('已写入风格串：六类合并进补充栏')
        : t('已写入风格串：角色 {0} 栏、全局 {1} 栏', [String(roleWrites), String(globalWrites)]));
    } catch (error) {
      notify(t('写入失败：{0}', [String((error as Error)?.message || error)]), 'error');
    } finally {
      setChainBusy(false);
    }
  };

  return (
    <div className="workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <WorkspaceChrome><WorkspaceToolbar><h2 className="text-sm font-bold">{t('一键 Roll')}</h2></WorkspaceToolbar></WorkspaceChrome>
      <div className="workspace-scroll-viewport min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
        <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-meta text-gray-400">
              {current ? t('组合随机码 {0}', [current.seed]) : t('还没有抽取')}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t('六个库各抽 1 条。每栏使用独立随机流，固定或跳过某一栏不会改变其它栏；抽中的条目只被读取，不会改写词库。')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={rollOnce} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              <Dice5 className="h-4 w-4" />{t('抽一次')}
            </button>
            <button type="button" onClick={rollAgain} disabled={busy || !current}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">
              <RefreshCw className="h-4 w-4" />{t('再抽未固定项')}
            </button>
            <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
            <button type="button" onClick={() => setCursor(index => Math.max(0, index - 1))} disabled={cursor <= 0}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-gray-700">
              <ChevronLeft className="h-4 w-4" />{t('上一组')}
            </button>
            <button type="button" onClick={() => setCursor(index => Math.min(history.length - 1, index + 1))} disabled={cursor >= history.length - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-gray-700">
              {t('下一组')}<ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-meta text-gray-400">
              {history.length ? t('第 {0} / {1} 组', [String(cursor + 1), String(history.length)]) : ''}
            </span>
          </div>
        </section>

        <section className="space-y-2">
          {rows.map(({ kind, meta, row }) => {
            const on = effectiveChecks[kind] !== false;
            const isLocked = !!locked[kind];
            return (
              <div key={kind} data-content-roll-row={kind} data-content-roll-on={String(on)}
                className={`appearance-group rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 ${on ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <label className="flex select-none items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <input type="checkbox" checked={on} disabled={scopeChecks[kind] === false} onChange={() => toggleCheck(kind)} aria-label={t('参与「{0}」的抽取', [t(meta.title)])} />
                    {t('参与')}
                  </label>
                  <span className="w-16 shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t(meta.title)}</span>
                  <div className="min-w-0 flex-1">
                    {row && row.filled ? (
                      <>
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100" data-content-roll-name={kind}>{row.name}</p>
                        <p className="mt-0.5 line-clamp-2 break-words font-mono text-meta text-gray-500 dark:text-gray-400">{row.text}</p>
                        {row.constraints?.notes ? (
                          <p className="mt-1 text-meta leading-4 text-amber-600 dark:text-amber-400" data-content-roll-constraint={kind}>{row.constraints.notes}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400" data-content-roll-note={kind}>
                        {!on ? t('本次不参与：不抽取、也不会填入实验室') : row?.reason === 'empty' ? t('该库当前 0 条，该栏留空') : t('还没有结果')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => toggleLock(kind)}
                      aria-pressed={isLocked} title={t(isLocked ? '解除固定' : '固定这一条')}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-meta ${isLocked ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}`}>
                      {isLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                      {t(isLocked ? '已固定' : '固定')}
                    </button>
                    <button type="button" onClick={() => rerollKind(kind)} disabled={!current || !on}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-meta text-gray-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400">
                      {t('换一个')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {current && onSaveRoll ? (
          <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-content-roll-save="true">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('存为 Roll 内容')}</span>
              <span className="text-meta text-gray-400">{savedId ? t('上次保存：{0}', [savedId.slice(0, 12)]) : ''}</span>
            </div>
            {saveOpen ? (
              <div className="mt-2">
                <input autoFocus value={saveName} maxLength={80} disabled={saving}
                  aria-label={t('给这条记录起名')} onChange={event => setSaveName(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') void doSave(); else if (event.key === 'Escape') setSaveOpen(false); }}
                  className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                <p className="mt-1 text-meta leading-4 text-gray-400">
                  {t('只保存六类内容与它们自己的约束，不含画师串、风格负面与生图参数。')}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => void doSave()} disabled={saving}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {saving ? t('保存中…') : t('保存')}
                  </button>
                  <button type="button" onClick={() => setSaveOpen(false)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">{t('取消')}</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setSaveName(saveName || t('Roll 内容 {0}', [new Date().toLocaleString()])); setSaveOpen(true); }}
                className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                {t('存为 Roll 内容…')}
              </button>
            )}
          </section>
        ) : null}

        {current ? (
          <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-content-roll-apply="true">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('填入实验室')}</span>
              <label className="flex items-center gap-1 text-meta text-gray-500 dark:text-gray-400">
                {t('范围')}
                <select value={range} onChange={event => {
                  const nextRange = event.target.value as ContentRollScope;
                  setRange(nextRange);
                  try { window.localStorage.setItem('nai-content-roll-range', nextRange); } catch { /* 忽略存储失败 */ }
                }}
                  aria-label={t('选择抽取范围')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  <option value="all">{t('角色＋场景')}</option>
                  <option value="character">{t('仅角色')}</option>
                  <option value="global">{t('仅场景与镜头')}</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-meta text-gray-500 dark:text-gray-400">
                {t('目标角色')}
                <select value={targetId} onChange={event => { targetTouched.current = true; setTargetId(event.target.value); setConfirming(false); }}
                  aria-label={t('选择写入的目标角色')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  {playgroundRoles.length ? <option value="all-enabled">{t('所有启用角色')}</option> : null}
                  <option value="new">{t('新建角色')}</option>
                  {playgroundRoles.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-1 text-meta leading-4 text-gray-400">
              {t('角色四类写进目标角色的提示词；场景与镜头各写自己的一栏。画师串、风格负面与生图参数不会改动。')}
            </p>
            {confirming && plan ? (
              <div className="mt-2 space-y-1" data-content-roll-apply-preview="true">
                {plan.rows.map(item => (
                  <div key={item.kind} className="rounded-lg border border-gray-200 px-2 py-1 text-meta dark:border-gray-700" data-content-roll-apply-row={item.kind} data-content-roll-apply-action={item.action}>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-300">{t(item.title)}</span>
                    <span className="ml-1 text-gray-400">{item.action === 'replace' ? t('改为填入') : t('保持原值')}</span>
                    <span className="ml-1 break-all font-mono text-gray-500 dark:text-gray-400">
                      {item.action === 'replace' ? shortText(item.next, 60) : t('本次未提供')}
                    </span>
                    {item.note ? <span className="ml-1 text-amber-600 dark:text-amber-400">{item.note}</span> : null}
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={() => void doApply()} disabled={applying}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {applying ? t('写入中…') : t('确认填入')}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">{t('取消')}</button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setConfirming(true)} disabled={!onApplyRoll}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{t('填入实验室…')}</button>
                {canUndo ? (
                  <button type="button" onClick={() => void onUndoApply?.()} data-content-roll-undo="true"
                    className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300">{t('撤销上次填入')}</button>
                ) : null}
                {!onApplyRoll ? <span className="text-meta text-gray-400">{t('当前视图不支持写入，请进入实验室后再试')}</span> : null}
              </div>
            )}
          </section>
        ) : null}

        {current && onWriteRollToChain ? (
          <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-content-roll-chain="true">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('写入风格串')}</span>
              <label className="flex items-center gap-1 text-meta text-gray-500 dark:text-gray-400">
                {t('目标')}
                <select value={chainTargetId} onChange={event => { setChainTargetId(event.target.value); setChainConfirming(false); }}
                  aria-label={t('选择写入的风格串')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  <option value="new">{t('新建风格串')}</option>
                  {styleChains.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-meta text-gray-500 dark:text-gray-400">
                {t('写入范围')}
                <select value={chainScope} onChange={event => setChainScope(event.target.value as RollToChainScope)}
                  aria-label={t('选择写入范围')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  <option value="split">{t('按栏写入')}</option>
                  <option value="extra">{t('合并成一段写进补充')}</option>
                </select>
              </label>
            </div>
            <p className="mt-1 text-meta leading-4 text-gray-400">
              {t('人物形象／服饰穿搭／动作互动／表情状态写进角色 1，场景与镜头写各自的全局栏；画师串、风格负面与生图参数不会改动。')}
            </p>
            {chainConfirming ? (
              <div className="mt-2 space-y-1" data-content-roll-chain-preview="true">
                {!selectedChain ? (
                  <input value={chainName} onChange={event => setChainName(event.target.value)} maxLength={120}
                    aria-label={t('风格串名称')} placeholder={t('风格串名称（留空则自动命名）')}
                    className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                ) : null}
                {rollRows.map(row => {
                  const write = chainWriteOf(row.kind);
                  return (
                    <label key={row.kind} className="flex items-start gap-2 rounded-lg border border-gray-200 px-2 py-1 text-meta dark:border-gray-700" data-content-roll-chain-row={row.kind}>
                      <input type="checkbox" checked={chainPicked.has(row.kind)} disabled={chainBusy}
                        onChange={() => setChainPicked(previous => {
                          const next = new Set(previous);
                          if (next.has(row.kind)) next.delete(row.kind); else next.add(row.kind);
                          return next;
                        })}
                        className="mt-0.5" aria-label={t('写入「{0}」', [t(META[row.kind].title)])} />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-300">{t(META[row.kind].title)} → {chainTargetLabel(row.kind)}</span>
                        {write && write.previous ? <span className="ml-1 break-all font-mono text-gray-400 line-through">{shortText(write.previous, 40)}</span> : null}
                        <span className="ml-1 break-all font-mono text-gray-500 dark:text-gray-400">{shortText(row.text, 60)}</span>
                      </span>
                    </label>
                  );
                })}
                {chainPlan.skipped.length ? (
                  <p className="text-meta text-amber-600 dark:text-amber-400">{t('这些分类没有对应的栏位，已跳过：{0}', [chainPlan.skipped.join('、')])}</p>
                ) : null}
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={() => void doWriteChain()} disabled={chainBusy || !chainPicked.size}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {chainBusy ? t('写入中…') : selectedChain ? t('写入这条风格串') : t('新建并写入')}
                  </button>
                  <button type="button" onClick={() => setChainConfirming(false)} disabled={chainBusy}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">{t('取消')}</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={openChainConfirm} disabled={!rollRows.length}
                className="mt-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-40 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
                {t('写入风格串…')}
              </button>
            )}
          </section>
        ) : null}

        {current ? (
          <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('这一组的证据')}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowEvidence(value => !value)}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-meta text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t(showEvidence ? '收起' : '展开')}
                </button>
                <button type="button" onClick={() => void copyEvidence()}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-meta text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <Copy className="h-3.5 w-3.5" />{t('复制证据')}
                </button>
              </div>
            </div>
            <p className="mt-1 text-meta leading-4 text-gray-400">
              {t('组合随机码只用于复现这一组，不是生图 seed。')}
            </p>
            {showEvidence ? (
              <pre data-content-roll-evidence="true" className="appearance-group mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-2 font-mono text-micro leading-4 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                {evidenceText}
              </pre>
            ) : null}
          </section>
        ) : null}
      </div></div>
    </div>
  );
};
