import { promptAgentService, type AgentPageRequest, type PromptAgentEvent, type PromptAgentTask } from './promptAgent';
import type { PromptAgentDraft } from '../types';
import { clearAgentPageHover, getAgentPageClientId, observeAgentPage, operateAgentPage, readAgentPage, type AgentPageSnapshot } from './agentWorkspace';
import { diffAgentClientDraft } from './agentLabSync.mjs';

type RunInput = Parameters<typeof promptAgentService.run>[0];
const active = new Map<string, Promise<void>>();
const composers = new Map<string, { text: string; attachments: Array<{ data: string; mimeType: string; name: string }> }>();
type PageClient = { clientId: string; baseline: PromptAgentDraft; getDraft: () => PromptAgentDraft; stop: () => void; queue: Promise<void> };
const clients = new Map<string, PageClient>();
const executing = new Map<string, AbortController>();
const handled = new Set<string>();
const pageSummary = (page: AgentPageSnapshot) => ({ view: page.view, title: page.title, snapshotId: page.snapshotId, capturedAt: page.capturedAt, foreground: page.foreground, busy: page.busy, notifications: page.notifications?.slice(-4).map(item => ({ ...item, text: item.text.slice(0, 400) })), commands: page.commands?.map(({ name, label, readOnly }) => ({ name, label, readOnly })), text: page.text.slice(0, 1200), controls: page.controls.slice(0, 4).map(({ id, label, context, role, checked, selected, expanded, pressed, disabled, value }) => ({ id, label, context, role, checked, selected, expanded, pressed, disabled, value: value?.slice(0, 240) })) });
const stopClient = (sessionId: string) => { clients.get(sessionId)?.stop(); clients.delete(sessionId); if (!clients.size) clearAgentPageHover(); };
const syncPage = async (sessionId: string) => {
  const client = clients.get(sessionId); if (!client) return;
  const current = client.getDraft(), changes = diffAgentClientDraft(client.baseline, current);
  const sameTarget = current.target && client.baseline.target && current.target.chainId === client.baseline.target.chainId && current.target.mode === client.baseline.target.mode;
  await promptAgentService.pageControl(sessionId, 'ui_context', { clientId: client.clientId, page: pageSummary(readAgentPage({ limit: 4 })), ...(!sameTarget && current.target && client.baseline.target ? { labRetarget: { targetBefore: client.baseline.target, draft: current } } : sameTarget && (changes.length || current.target?.fingerprint !== client.baseline.target?.fingerprint) ? { labSync: { targetBefore: client.baseline.target, targetAfter: current.target, changes } } : {}) });
  if (current.target) client.baseline = structuredClone(current);
};
const enqueue = (sessionId: string, work: () => Promise<void>) => {
  const client = clients.get(sessionId);
  if (!client) return work();
  const task = client.queue.catch(() => {}).then(work); client.queue = task; return task;
};
const attachClient = (sessionId: string, baseline: PromptAgentDraft, getDraft: () => PromptAgentDraft) => {
  if (clients.has(sessionId)) { clients.get(sessionId)!.getDraft = getDraft; return; }
  const client: PageClient = { clientId: getAgentPageClientId(), baseline: structuredClone(baseline), getDraft, queue: Promise.resolve(), stop: () => {} };
  clients.set(sessionId, client);
  client.stop = observeAgentPage(() => { void enqueue(sessionId, () => syncPage(sessionId)).catch(() => { /* 服务结束或暂时断线时由任务轮询重新附着。 */ }); });
};
type Receipt = { claimId: string; result?: AgentPageSnapshot; error?: string };
const ledgerKey = (requestId: string) => `nai-agent-page-receipt-${requestId}`;
const readReceipt = (requestId: string): Receipt | null => { try { return JSON.parse(sessionStorage.getItem(ledgerKey(requestId)) || 'null'); } catch { return null; } };
const saveReceipt = (requestId: string, receipt: Receipt) => { try { sessionStorage.setItem(ledgerKey(requestId), JSON.stringify(receipt)); const keys = Object.keys(sessionStorage).filter(key => key.startsWith('nai-agent-page-receipt-')); for (const key of keys.slice(0, Math.max(0, keys.length - 8))) sessionStorage.removeItem(key); } catch { /* 服务端认领仍保证不重复执行。 */ } };
const handlePageRequest = async (sessionId: string, request: AgentPageRequest) => {
  if (handled.has(request.requestId) || executing.has(request.requestId) || request.clientId && request.clientId !== getAgentPageClientId() || request.expiresAt && request.expiresAt <= Date.now()) return;
  const controller = new AbortController(); executing.set(request.requestId, controller);
  const timer = request.expiresAt ? setTimeout(() => controller.abort(), Math.max(0, request.expiresAt - Date.now())) : undefined;
  try {
    await enqueue(sessionId, async () => {
      controller.signal.throwIfAborted();
      const claimed = await promptAgentService.pageControl(sessionId, 'ui_claim', { requestId: request.requestId, clientId: getAgentPageClientId() });
      if (!claimed.claimId) throw new Error('页面请求未取得执行回执');
      let receipt = readReceipt(request.requestId);
      if (receipt?.claimId !== claimed.claimId) receipt = null;
      if (!claimed.execute && !receipt?.result && !receipt?.error && request.operation.action !== 'read') receipt = { claimId: claimed.claimId, error: '上次页面操作的结果未送达；请先重新读取核实，不重复执行点击或填写' };
      if (!receipt?.result && !receipt?.error) {
        receipt = { claimId: claimed.claimId }; saveReceipt(request.requestId, receipt);
        try {
          await syncPage(sessionId); controller.signal.throwIfAborted();
          receipt.result = await operateAgentPage(request.operation, controller.signal);
          await syncPage(sessionId);
        } catch (error) { receipt.error = error instanceof Error ? error.message : '页面操作失败'; }
        saveReceipt(request.requestId, receipt);
      }
      controller.signal.throwIfAborted();
      await promptAgentService.pageControl(sessionId, 'ui_result', { requestId: request.requestId, clientId: getAgentPageClientId(), ...receipt });
      handled.add(request.requestId); if (handled.size > 300) handled.delete(handled.values().next().value!);
      try { sessionStorage.removeItem(ledgerKey(request.requestId)); } catch { /* 过期收据也不会重新执行。 */ }
    });
  } finally { clearTimeout(timer); executing.delete(request.requestId); }
};

/** 标签页内统一持有任务，编辑器卸载不会关闭请求；电脑服务负责跨设备恢复。 */
export const promptAgentCoordinator = {
  running: (sessionId: string) => active.has(sessionId),
  run(input: RunInput, onEvent: (event: PromptAgentEvent) => void, getDraft: () => PromptAgentDraft = () => input.draft) {
    if (active.has(input.sessionId)) return Promise.reject(new Error('这个会话已有任务在执行'));
    attachClient(input.sessionId, input.draft, getDraft);
    const nextInput = { ...input, context: { ...input.context, clientSettings: { ...input.context.clientSettings, pageClientId: getAgentPageClientId(), currentPage: pageSummary(readAgentPage({ limit: 4 })) } } };
    const task = promptAgentService.run(nextInput, event => {
      if (event.type === 'ui_request') {
        void handlePageRequest(input.sessionId, event).catch(() => { /* 等待中的请求由重连轮询恢复，不重放已完成事件。 */ });
      } else if (event.type === 'ui_cancel') {
        executing.get(event.requestId)?.abort();
      } else onEvent(event);
    }).finally(() => { active.delete(input.sessionId); stopClient(input.sessionId); });
    active.set(input.sessionId, task);
    return task;
  },
  resumePageRequests(sessionId: string, task: PromptAgentTask, getDraft: () => PromptAgentDraft) {
    if (!['preparing', 'running', 'waiting_confirmation', 'executing'].includes(String(task.status))) { if (!active.has(sessionId)) stopClient(sessionId); return; }
    if (task.clientDraft) attachClient(sessionId, task.clientDraft, getDraft);
    for (const request of task.pendingUI || []) void handlePageRequest(sessionId, request).catch(() => { /* 下一次轮询恢复仅剩的实时请求。 */ });
  },
  saveComposer(sessionId: string, text: string, attachments: Array<{ data: string; mimeType: string; name: string }>) {
    if (!sessionId) return;
    composers.set(sessionId, { text, attachments: attachments.slice(0, 4) });
    // 图片只留有限的标签页内缓存；文字承担浏览器草稿职责。
    while (composers.size > 8) composers.delete(composers.keys().next().value!);
    try { sessionStorage.setItem(`nai-agent-composer-${sessionId}`, text.slice(0, 8000)); } catch { /* 浏览器禁用存储或空间不足时继续保留内存草稿。 */ }
  },
  loadComposer(sessionId: string) {
    const saved = composers.get(sessionId); if (saved) return saved;
    let text = ''; try { text = sessionStorage.getItem(`nai-agent-composer-${sessionId}`) || ''; } catch { /* 浏览器存储不可用。 */ }
    return { text, attachments: [] };
  },
};

export const agentDraftFingerprint = (value: unknown) => {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
};

export const agentDraftFields = ['basePrompt', 'subjectPrompt', 'negativePrompt', 'modules', 'params'] as const;
export const agentDraftChangedFields = (current: PromptAgentDraft, proposed: PromptAgentDraft) => agentDraftFields.filter(field => JSON.stringify(current[field]) !== JSON.stringify(proposed[field]));
export const mergeAgentDraftFields = (current: PromptAgentDraft, proposed: PromptAgentDraft, fields: ReadonlyArray<typeof agentDraftFields[number]>): PromptAgentDraft => ({ ...current, ...Object.fromEntries(fields.map(field => [field, proposed[field]])) });
