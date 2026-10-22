/**
 * AI 一键六库：用一段话一次生成人物形象 / 服饰 / 姿势 / 表情状态 / 场景 / 镜头六类提示词，
 * 逐条勾选、改名、改提示词后一次性保存到对应提示词库。
 *
 * 费用与授权：由用户主动点击生成，使用当前创作助手模型做文本补全，不消耗 NovelAI 生图额度；
 * 界面必须说明模型服务可能收费（见 docs/PRODUCT_DECISIONS.md 第 2 节）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles, Wand2, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { LAB_DEFAULT_PARAMS } from '../services/labWorkspace';
import { planRollToChain } from '../services/contentRollToChain';
import {
  PROMPT_LIBRARY_KIND_LABELS,
  promptAgentService,
  type PromptLibraryBundleItem,
} from '../services/promptAgent';
import type { ChainType, NAIParams, PromptChain } from '../types';
import { ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from './useModalA11y';

const DETAIL_FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const DETAIL_LABEL_CLASS = 'text-sm font-semibold text-gray-700 dark:text-gray-200';

/** 与 PromptLibrary 的 onCreate 同签名：由 App 创建完整条目并同步列表。 */
export type PromptLibraryBundleCreate = (
  name: string,
  description: string,
  type: ChainType,
  data?: Partial<PromptChain>,
) => Promise<string | undefined>;

/** 六库结果写进风格串：父级负责落库、刷新列表，并清掉目标串的编辑器草稿。 */
export type PromptLibraryBundleChainWrite = (payload: {
  chain: PromptChain | null;
  name: string;
  params: NAIParams;
  variableValues: Record<string, string>;
}) => Promise<string | undefined>;

export interface PromptLibraryBundleDialogProps {
  open: boolean;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  onCreate: PromptLibraryBundleCreate;
  /** 成功写入若干条目后通知父级刷新列表与图墙计数。 */
  onSaved?: () => void;
  /** 可写入的风格串（父级只传 type=style），用于「写入风格串」的目标选择。 */
  styleChains?: PromptChain[];
  /** 把勾选的六条按栏写进新建或已有风格串；未提供时不显示该入口。 */
  onWriteToChain?: PromptLibraryBundleChainWrite;
}

/** NAIParams 上的提示词库扩展键（与 PromptLibrary 的存储约定一致）。 */
type BundleParams = NAIParams & { _promptLibrary?: { bilingual?: string; references?: Array<{ id: string; url: string; prompt: string }> } };

/** 生成结果的本地草稿：多了勾选态与稳定 id，便于保存后只移除成功项。 */
interface BundleDraft extends PromptLibraryBundleItem {
  id: number;
  picked: boolean;
}

const draftFromItem = (item: PromptLibraryBundleItem, id: number): BundleDraft => ({
  id,
  picked: true,
  kind: item.kind,
  label: String(item.label || PROMPT_LIBRARY_KIND_LABELS[item.kind] || ''),
  name: String(item.name || ''),
  prompt: String(item.prompt || ''),
  bilingual: String(item.bilingual || ''),
  negativePrompt: String(item.negativePrompt || ''),
  tags: Array.isArray(item.tags) ? item.tags.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12) : [],
  note: String(item.note || ''),
});

export const PromptLibraryBundleDialog: React.FC<PromptLibraryBundleDialogProps> = ({ open, onClose, notify, onCreate, onSaved, styleChains = [], onWriteToChain }) => {
  useLanguage();
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const [brief, setBrief] = useState('');
  const [drafts, setDrafts] = useState<BundleDraft[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [generatedBy, setGeneratedBy] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const [chainTarget, setChainTarget] = useState('new');
  const [chainName, setChainName] = useState('');
  const [chainWriting, setChainWriting] = useState(false);
  // 卸载后不再回写状态（StrictMode 下 effect 会模拟卸载重挂）。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // 每次打开都是新的一轮：不把上一次的候选与勾选带到下次。
  useEffect(() => {
    if (!open) return;
    setBrief('');
    setDrafts([]);
    setMissing([]);
    setGeneratedBy('');
    setGenerating(false);
    setSaving(false);
    setChainOpen(false);
    setChainTarget('new');
    setChainName('');
    setChainWriting(false);
  }, [open]);

  const closeDialog = useCallback(() => {
    if (generating || saving) return;
    onClose();
  }, [generating, onClose, saving]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopmostModal(dialogRef.current)) return;
      event.preventDefault();
      closeDialog();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDialog, dialogRef, open]);

  const generate = async () => {
    const text = brief.trim();
    if (!text || generating || saving) return;
    setGenerating(true);
    try {
      const result = await promptAgentService.generateLibraryBundle({ brief: text });
      if (!aliveRef.current) return;
      const list = (Array.isArray(result?.items) ? result.items : []).filter(item => item && String(item.prompt || '').trim());
      if (!list.length) throw new Error(t('没有生成可用的方案，请换个描述再试'));
      setDrafts(list.map((item, index) => draftFromItem(item, index)));
      setMissing(Array.isArray(result?.missing) ? result.missing.map(value => String(value || '')).filter(Boolean) : []);
      setGeneratedBy([result?.provider, result?.model].filter(Boolean).join(' · '));
    } catch (error) {
      console.warn('Prompt library bundle generate failed:', error);
      notify(t('生成失败：{0}', [error instanceof Error && error.message ? error.message : t('生成失败，请稍后重试')]), 'error');
    } finally {
      if (aliveRef.current) setGenerating(false);
    }
  };

  const patchDraft = (id: number, patch: Partial<BundleDraft>) => {
    setDrafts(previous => previous.map(draft => (draft.id === id ? { ...draft, ...patch } : draft)));
  };

  const togglePick = (id: number) => {
    setDrafts(previous => previous.map(draft => (draft.id === id ? { ...draft, picked: !draft.picked } : draft)));
  };

  const pickedCount = drafts.filter(draft => draft.picked && String(draft.prompt || '').trim()).length;

  /** 逐条创建完整条目：失败与未勾选项保留在面板里，成功后只移除已写入的那些。 */
  const saveAll = async () => {
    if (saving || generating) return;
    const chosen = drafts.filter(draft => draft.picked && String(draft.prompt || '').trim());
    if (!chosen.length) { notify(t('勾选后一起保存'), 'error'); return; }
    setSaving(true);
    const savedIds = new Set<number>();
    try {
      for (const draft of chosen) {
        try {
          const params: BundleParams = {
            ...LAB_DEFAULT_PARAMS,
            _promptLibrary: { bilingual: String(draft.bilingual || ''), references: [] },
          };
          const newId = await onCreate(
            String(draft.name || '').trim() || t('未命名'),
            String(draft.note || ''),
            draft.kind as ChainType,
            {
              tags: draft.tags,
              basePrompt: String(draft.prompt || ''),
              negativePrompt: String(draft.negativePrompt || ''),
              params,
              variableValues: { subject: '' },
              modules: [],
            },
          );
          if (!newId) throw new Error('创建提示词条目失败');
          savedIds.add(draft.id);
        } catch (error) {
          console.warn('Prompt library bundle save failed:', error);
        }
      }
    } finally {
      if (aliveRef.current) setSaving(false);
    }
    if (!aliveRef.current) return;
    const saved = savedIds.size;
    const failed = chosen.length - saved;
    if (saved > 0) {
      const remaining = drafts.filter(draft => !savedIds.has(draft.id));
      setDrafts(remaining);
      notify(t('已保存 {0} 条', [saved]));
      onSaved?.();
      if (!remaining.length) onClose();
    }
    if (failed > 0) notify(t('保存失败：{0}', [failed]), 'error');
  };

  const pickedDrafts = drafts.filter(draft => draft.picked && String(draft.prompt || '').trim());
  const selectedChain = styleChains.find(item => item.id === chainTarget) || null;

  /**
   * 把勾选的六条写进风格串：人物/服饰/姿势/表情进角色 1，场景/镜头进各自全局栏。
   * 映射复用 `planRollToChain`，与「一键 Roll → 风格串」保持同一套规则。
   */
  const writeToChain = async () => {
    if (!onWriteToChain || chainWriting) return;
    if (!pickedDrafts.length) { notify(t('勾选后一起保存'), 'error'); return; }
    setChainWriting(true);
    try {
      const plan = planRollToChain(
        selectedChain,
        pickedDrafts.map(draft => ({ kind: draft.kind, name: draft.name, text: draft.prompt, negative: draft.negativePrompt })),
        { scope: 'split' },
      );
      await onWriteToChain({
        chain: selectedChain,
        name: String(chainName || '').trim() || t('Roll 内容 {0}', [new Date().toLocaleString()]),
        params: plan.params,
        variableValues: plan.variableValues as Record<string, string>,
      });
      const roleWrites = plan.writes.filter(write => write.target === 'character').length;
      const globalWrites = plan.writes.filter(write => write.target !== 'character').length;
      notify(t('已写入风格串：角色 {0} 栏、全局 {1} 栏', [String(roleWrites), String(globalWrites)]));
      setChainOpen(false);
      onSaved?.();
    } catch (error) {
      notify(t('写入失败：{0}', [String((error as Error)?.message || error)]), 'error');
    } finally {
      if (aliveRef.current) setChainWriting(false);
    }
  };

  if (!open) return null;

  return (
    <ImagePreviewPortal>
      <div
        className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('AI 一键六库')}
          className="appearance-panel ui-modal-enter flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 sm:rounded-2xl"
        >
          <header className="flex flex-none items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
            <Wand2 className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <h2 className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{t('AI 一键六库')}</h2>
            <button
              type="button"
              onClick={closeDialog}
              disabled={generating || saving}
              aria-label={t('关闭')}
              title={t('关闭')}
              className="mobile-touch flex h-10 w-10 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-300">{t('用一段话一次生成六类提示词')}</p>
              <label className="mt-2 block">
                <span className={DETAIL_LABEL_CLASS}>{t('描述你想要的画面')}</span>
                <textarea
                  autoFocus
                  value={brief}
                  onChange={event => setBrief(event.target.value)}
                  placeholder={t('例如：雨夜天台，少女，湿发，霓虹倒影')}
                  aria-label={t('描述你想要的画面')}
                  className={`${DETAIL_FIELD_CLASS} h-24 resize-y`}
                />
              </label>
              <p className="mt-2 text-micro text-gray-400 dark:text-gray-500">{t('使用当前创作助手模型生成提示词，模型服务可能收费；不消耗生图额度。')}</p>
            </div>

            {drafts.length > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('已生成 {0} 条', [drafts.length])}</span>
                  {generatedBy && <span className="truncate text-micro text-gray-400" title={generatedBy}>{t('由 {0} 生成', [generatedBy])}</span>}
                </div>
                {missing.length > 0 && (
                  <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('{0} 类缺失，可重试', [missing.length])}
                  </p>
                )}
                <p className="text-micro text-gray-400 dark:text-gray-500">{t('勾选后一起保存')}</p>
                {drafts.map(draft => {
                  const label = draft.label || t(PROMPT_LIBRARY_KIND_LABELS[draft.kind] || '提示词');
                  return (
                    <div
                      key={draft.id}
                      data-bundle-kind={draft.kind}
                      className={`rounded-2xl border p-3 ${draft.picked ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-700 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-800'}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={draft.picked}
                          onChange={() => togglePick(draft.id)}
                          aria-label={t('选择{0}', [label])}
                          className="h-4 w-4 flex-none accent-indigo-500"
                        />
                        <span className="flex-none rounded bg-gray-100 px-1.5 py-0.5 text-micro font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{label}</span>
                        <input
                          value={draft.name}
                          onChange={event => patchDraft(draft.id, { name: event.target.value })}
                          aria-label={t('{0}名称', [label])}
                          placeholder={t('条目名称')}
                          className={`${DETAIL_FIELD_CLASS} mt-0 min-w-0 flex-1`}
                        />
                      </div>
                      <label className="mt-2 block">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('提示词')}</span>
                        <textarea
                          value={draft.prompt}
                          onChange={event => patchDraft(draft.id, { prompt: event.target.value })}
                          aria-label={t('{0}提示词', [label])}
                          className={`${DETAIL_FIELD_CLASS} h-20 resize-y font-mono`}
                        />
                      </label>
                      {draft.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {draft.tags.map(value => (
                            <span key={value} className="rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400">{value}</span>
                          ))}
                        </div>
                      )}
                      {draft.note && <p className="mt-1 break-words text-micro text-gray-400">{draft.note}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {chainOpen && onWriteToChain ? (
            <div data-bundle-chain-target="true" className="mx-4 mb-3 flex-none rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('写入风格串')}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-meta text-gray-600 dark:text-gray-300">
                <label className="flex items-center gap-1">
                  <input type="radio" name="bundle-chain-target" checked={chainTarget === 'new'} onChange={() => setChainTarget('new')} aria-label={t('新建风格串')} />
                  {t('新建风格串')}
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="bundle-chain-target"
                    checked={chainTarget !== 'new'}
                    disabled={!styleChains.length}
                    onChange={() => setChainTarget(styleChains[0]?.id || 'new')}
                    aria-label={t('写入已有风格串')}
                  />
                  {t('写入已有风格串')}
                </label>
                {chainTarget !== 'new' && styleChains.length ? (
                  <select
                    value={chainTarget}
                    onChange={event => setChainTarget(event.target.value)}
                    aria-label={t('选择写入的风格串')}
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  >
                    {styleChains.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                ) : (
                  <input
                    value={chainName}
                    onChange={event => setChainName(event.target.value)}
                    aria-label={t('风格串名称')}
                    placeholder={t('风格串名称（留空则自动命名）')}
                    className="h-8 min-w-[12rem] flex-1 rounded-lg border border-gray-200 px-2 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                )}
              </div>
              <p className="mt-1 text-micro text-gray-400">{t('人物形象／服饰穿搭／动作互动／表情状态写进角色 1，场景与镜头写各自的全局栏；画师串、风格负面与生图参数不会改动。')}</p>
              <div className="mt-2 flex items-center gap-2">
                <ToolbarButton onClick={() => void writeToChain()} disabled={chainWriting || !pickedCount} tone="primary" className="mobile-touch">
                  {chainWriting ? <LoaderCircle className="animate-spin" /> : null}
                  <span>{chainWriting ? t('写入中…') : selectedChain ? t('写入这条风格串') : t('新建并写入')}</span>
                </ToolbarButton>
                <ToolbarButton onClick={() => setChainOpen(false)} disabled={chainWriting} className="mobile-touch"><span>{t('取消')}</span></ToolbarButton>
              </div>
            </div>
          ) : null}

          <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <ToolbarButton onClick={() => void generate()} disabled={generating || saving || !brief.trim()} tone="primary" className="mobile-touch">
              {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              <span>{generating ? t('正在生成…') : drafts.length ? t('重新生成') : t('生成六条')}</span>
            </ToolbarButton>
            <ToolbarButton onClick={() => void saveAll()} disabled={generating || saving || pickedCount === 0} className="mobile-touch">
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              <span>{saving ? t('保存中…') : t('全部保存到提示词库')}</span>
            </ToolbarButton>
            {onWriteToChain ? (
              <ToolbarButton onClick={() => setChainOpen(value => !value)} disabled={generating || saving || chainWriting || pickedCount === 0} className="mobile-touch">
                <span>{t('写入风格串…')}</span>
              </ToolbarButton>
            ) : null}
            <ToolbarButton onClick={closeDialog} disabled={generating || saving} className="mobile-touch"><span>{t('取消')}</span></ToolbarButton>
          </footer>
        </div>
      </div>
    </ImagePreviewPortal>
  );
};
