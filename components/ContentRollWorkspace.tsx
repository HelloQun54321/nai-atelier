import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Copy, Dice5, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import type { PromptChain } from '../types';
import { KINDS, META } from '../services/contentRoll';
import type { RollRow } from '../services/contentRoll';
import { draw, evidenceOf, rerollOne } from '../services/contentRollDraw';
import type { ContentRollApplyPlan, ContentRollTarget } from '../services/contentRollApply';
import { filterPicksByScope, pickByParticipation, planContentRollApply } from '../services/contentRollApply';
import type { ContentRollScope } from '../services/contentRollApply';
import type { NAIParams } from '../types';
import { IconButton, ToolbarButton, ToolbarSelect, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';

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
  /** 作为「内容库」的子分区渲染：不再自带页面顶栏与外层画布。 */
  embedded?: boolean;
  toolbarSlot?: HTMLElement | null;
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

/**
 * 一键 Roll 工作区：六类内容各抽 1 条，可勾选参与、固定、单栏「换一个」，并保留会话内的抽取历史。
 * 全部随机与证据逻辑在 services/contentRoll（快照/约束）与 services/contentRollDraw（池子/随机流），
 * 本组件只负责界面与本地草稿，不写库、不触发生成。
 */
export const ContentRollWorkspace: React.FC<ContentRollWorkspaceProps> = ({ active, chains, notify, playgroundRoles = [], playgroundParams = null, onApplyRoll, onUndoApply, canUndo = false, onSaveRoll, seedRecord = null, onSeedConsumed, scopeRequest = null, onScopeRequestConsumed, embedded = false, toolbarSlot = null }) => {
  useLanguage();
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
    if (!current || !onApplyRoll || !plan || applying) return;
    setApplying(true);
    try {
      const ok = await onApplyRoll(plan);
      if (ok) {
        setConfirming(false);
        notify(t('已填入实验室：角色 {0} 类、补充栏 {1} 类（可撤销）', [String(plan.rows.filter(item => item.action === 'replace' && META[item.kind].scope === 'character').length), String(plan.rows.filter(item => item.action === 'replace' && META[item.kind].scope === 'global').length)]));
      }
    } catch (error) {
      notify(t('填入失败：{0}', [String((error as Error)?.message || error)]), 'error');
    } finally {
      setApplying(false);
    }
  };

  const doSave = async () => {
    if (!current || !onSaveRoll || saving) return;
    const name = saveName.trim();
    if (!name) { notify(t('先给这条记录起个名字'), 'error'); return; }
    setSaving(true);
    try {
      const id = await onSaveRoll(name, activePicks, current.seed, current.seeds);
      if (!id) throw new Error(t('保存失败，请稍后重试'));
      setSaveOpen(false);
      notify(t('已存为 Roll 内容「{0}」（六类内容与约束，不含画师风格与生图参数）', [name]));
    } catch (error) {
      notify(t('保存失败：{0}', [String((error as Error)?.message || error)]), 'error');
    } finally {
      setSaving(false);
    }
  };

  const rows = KINDS.map(kind => ({ kind, meta: META[kind], row: current?.picks[kind] || null }));
  const toolbar = <>
    <ToolbarSelect label="选择抽取范围" value={range} disabled={applying || saving} containerClassName="content-roll-scope min-w-0 flex-1" onChange={event => {
      const nextRange = event.target.value as ContentRollScope;
      setRange(nextRange); setConfirming(false);
      try { window.localStorage.setItem('nai-content-roll-range', nextRange); } catch { /* 存储不可用时仍可抽取。 */ }
    }}>
      <option value="character">{t('仅角色')}</option><option value="global">{t('仅场景与镜头')}</option><option value="all">{t('角色＋场景')}</option>
    </ToolbarSelect>
    <div className="flex shrink-0 items-center gap-1">
      <IconButton label="上一组" disabled={cursor <= 0 || applying} onClick={() => { setCursor(index => Math.max(0, index - 1)); setConfirming(false); }}><ChevronLeft /></IconButton>
      <span className="min-w-8 text-center text-xs tabular-nums text-gray-400">{history.length ? `${cursor + 1}/${history.length}` : '0/0'}</span>
      <IconButton label="下一组" disabled={cursor >= history.length - 1 || applying} onClick={() => { setCursor(index => Math.min(history.length - 1, index + 1)); setConfirming(false); }}><ChevronRight /></IconButton>
    </div>
    <ToolbarButton tone="primary" onClick={() => { setConfirming(false); (current ? rollAgain : rollOnce)(); }} disabled={busy || applying || saving}>
      <Dice5 /><span>{t(current ? '再抽未固定项' : '抽一次')}</span>
    </ToolbarButton>
  </>;

  return <div className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950'}>
    {embedded ? toolbarSlot && createPortal(toolbar, toolbarSlot) : <WorkspaceChrome><WorkspaceToolbar>{toolbar}</WorkspaceToolbar></WorkspaceChrome>}
    <div className="workspace-scroll-viewport min-h-0 flex-1 overflow-y-auto p-4 pb-28 md:p-6">
      <div className="content-library-roll-layout mx-auto w-full max-w-7xl items-start gap-4">
        <section className="content-library-roll-grid">
          {rows.map(({ kind, meta, row }) => {
            const on = effectiveChecks[kind] !== false;
            const isLocked = !!locked[kind];
            const poolSize = chains.filter(chain => chain.type === kind && chain.basePrompt?.trim()).length;
            return <article key={kind} data-content-roll-row={kind} data-content-roll-on={String(on)}
              className={`appearance-group rounded-2xl border bg-white p-4 dark:bg-gray-900 ${on ? 'border-gray-200 dark:border-gray-800' : 'border-dashed border-gray-200 text-gray-400 dark:border-gray-800'}`}>
              <div className="flex items-center justify-between gap-2">
                <label className="mobile-touch flex select-none items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={on} disabled={scopeChecks[kind] === false || applying} onChange={() => { toggleCheck(kind); setConfirming(false); }} aria-label={t('参与「{0}」的抽取', [t(meta.title)])} />
                  {t(meta.title)}
                </label>
                <span className="text-xs tabular-nums text-gray-400">{t('共 {0} 条', [poolSize])}</span>
              </div>
              <div className={`mt-3 min-h-20 ${on ? '' : 'opacity-50'}`}>
                {row?.filled ? <>
                  <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100" data-content-roll-name={kind}>{row.name}</p>
                  <p className="mt-1 line-clamp-3 break-words font-mono text-xs leading-5 text-gray-500 dark:text-gray-400" title={row.text}>{row.text}</p>
                  {row.constraints?.notes && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400" data-content-roll-constraint={kind}>{row.constraints.notes}</p>}
                </> : <p className="py-2 text-xs leading-5 text-gray-400" data-content-roll-note={kind}>
                  {t(!on ? '本次不参与：不抽取、也不会填入实验室' : !poolSize ? '该库当前 0 条，该栏留空' : '还没有结果')}
                </p>}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <ToolbarButton active={isLocked} aria-pressed={isLocked} disabled={!row?.filled || !on || applying} onClick={() => toggleLock(kind)} title={t(isLocked ? '解除固定' : '固定这一条')}>
                  {isLocked ? <Lock /> : <LockOpen />}{t(isLocked ? '已固定' : '固定')}
                </ToolbarButton>
                <ToolbarButton disabled={!current || !on || isLocked || applying} onClick={() => { rerollKind(kind); setConfirming(false); }}><RefreshCw />{t('换一个')}</ToolbarButton>
              </div>
            </article>;
          })}
        </section>
        <aside className="space-y-3">
          {current ? <section className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-content-roll-apply="true">
            <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">{t('当前组合')}</h3>
            {range !== 'global' && <ToolbarSelect label="选择写入的目标角色" value={targetId} containerClassName="w-full" disabled={applying}
              onChange={event => { targetTouched.current = true; setTargetId(event.target.value); setConfirming(false); }}>
              {playgroundRoles.length > 0 && <option value="all-enabled">{t('所有启用角色')}</option>}
              <option value="new">{t('新建角色')}</option>
              {playgroundRoles.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
            </ToolbarSelect>}
            <div className="mt-3 flex flex-wrap gap-2">
              <ToolbarButton tone="primary" className="flex-1" disabled={!onApplyRoll || applying || !Object.keys(activePicks).length} onClick={() => setConfirming(true)}>{t('填入实验室…')}</ToolbarButton>
              {onSaveRoll && <ToolbarButton disabled={saving || !Object.keys(activePicks).length} onClick={() => { setSaveName(saveName || t('组合 {0}', [new Date().toLocaleString()])); setSaveOpen(value => !value); }}>{t('保存组合')}</ToolbarButton>}
            </div>
            {saveOpen && <div className="mt-3 space-y-2" data-content-roll-save="true">
              <input autoFocus value={saveName} maxLength={80} disabled={saving} aria-label={t('给这条记录起名')}
                onChange={event => setSaveName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void doSave(); else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSaveOpen(false); } }}
                className="h-10 w-full rounded-xl border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-gray-100" />
              <div className="flex gap-2"><ToolbarButton tone="primary" disabled={saving} onClick={() => void doSave()}>{t(saving ? '保存中…' : '保存')}</ToolbarButton><ToolbarButton disabled={saving} onClick={() => setSaveOpen(false)}>{t('取消')}</ToolbarButton></div>
            </div>}
            {confirming && plan && <div className="mt-4 space-y-3" data-content-roll-apply-preview="true">
              {plan.rows.filter(item => item.action === 'replace').map(item => <div key={item.kind} data-content-roll-apply-row={item.kind} data-content-roll-apply-action={item.action} className="border-t border-gray-200 pt-2 dark:border-gray-800">
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t(item.title)}</span>
                <p className="mt-1 break-words font-mono text-xs leading-5 text-gray-500 dark:text-gray-400">{plan.target.mode === 'all-enabled' && META[item.kind].scope === 'character' ? t('所有启用角色') : item.current || t('空白')} → {item.next || t('空白')}</p>
                {item.note && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{item.note}</p>}
              </div>)}
              <p className="text-xs leading-5 text-gray-400">{t('未列出的内容保持不变。')}</p>
              <div className="flex gap-2"><ToolbarButton tone="primary" disabled={applying} onClick={() => void doApply()}>{t(applying ? '写入中…' : '确认填入')}</ToolbarButton><ToolbarButton disabled={applying} onClick={() => setConfirming(false)}>{t('取消')}</ToolbarButton></div>
            </div>}
            {canUndo && <button type="button" disabled={applying} onClick={() => void onUndoApply?.()} data-content-roll-undo="true" className="mobile-touch mt-3 text-xs font-semibold text-amber-600 dark:text-amber-400">{t('撤销上次填入')}</button>}
          </section> : <p className="px-2 py-3 text-sm leading-6 text-gray-400">{t('选择范围，抽取一组内容。喜欢的条目可以固定。')}</p>}
          {current && <details className="appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" open={showEvidence} onToggle={event => setShowEvidence(event.currentTarget.open)}>
            <summary className="cursor-pointer text-xs font-semibold text-gray-500 dark:text-gray-400">{t('抽取记录')}</summary>
            <p className="mt-3 break-all text-xs text-gray-400">{t('组合随机码 {0}', [current.seed])}</p>
            <p className="mt-1 text-xs text-gray-400">{t('组合随机码只用于复现这一组，不是生图 seed。')}</p>
            <ToolbarButton className="mt-3" onClick={() => void copyEvidence()}><Copy />{t('复制快照')}</ToolbarButton>
            {showEvidence && <pre data-content-roll-evidence="true" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-micro text-gray-500 dark:text-gray-400">{evidenceText}</pre>}
          </details>}
        </aside>
      </div>
    </div>
  </div>;
};
