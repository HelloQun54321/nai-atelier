// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { promptAgentCoordinator, agentDraftFingerprint } from '../../services/promptAgentCoordinator';
import { promptAgentService } from '../../services/promptAgent';
import type { PromptAgentDraft } from '../../types';
import { getAgentPageClientId, readAgentPage } from '../../services/agentWorkspace';
import { registerAgentCommand } from '../../services/agentCommands';

it('统一任务持有，重复运行拒绝，结束归还任务', async () => {
  let release!: () => void;
  const mock = vi.spyOn(promptAgentService, 'run').mockImplementation(() => new Promise<undefined>(resolve => { release = () => resolve(undefined); }));
  const input = { sessionId: 's', message: 'test', draft: {} as PromptAgentDraft, context: {} };
  const task = promptAgentCoordinator.run(input, () => {});
  expect(promptAgentCoordinator.running('s')).toBe(true);
  await expect(promptAgentCoordinator.run(input, () => {})).rejects.toThrow('已有任务');
  release(); await task;
  expect(promptAgentCoordinator.running('s')).toBe(false);
  mock.mockRestore();
});

it.each([false, true])('页面辅助改词保存真实raw原稿；保存成功=%s决定是否执行，可信会话覆盖模型伪造', async success => {
  document.body.innerHTML = '<main data-agent-view="playground"><section id="raw-scope"></section></main>';
  let raw = { basePrompt: 'raw original', subjectPrompt: 'raw subject', negativePrompt: '', modules: [], params: { _promptSections: { scene: 'raw legacy source' } }, target: { chainId: 'work', mode: 'text-to-image', fingerprint: 'raw-target' } } as unknown as PromptAgentDraft;
  const mutate = vi.fn(async (args: Record<string, unknown>) => { raw = { ...raw, basePrompt: 'actual page change' }; return { session: args.agentSessionId }; });
  const releaseRead = registerAgentCommand({ name: 'get_prompt_version_state', label: 'raw', description: '', parameters: {}, readOnly: true, scope: () => document.getElementById('raw-scope'), execute: () => ({ draft: structuredClone(raw) }) });
  const releaseWrite = registerAgentCommand({ name: 'synthetic_prompt_edit', label: 'edit', description: '', parameters: {}, scope: () => document.getElementById('raw-scope'), execute: mutate });
  const save = vi.spyOn(promptAgentService, 'savePromptVersion');
  if (success) save.mockResolvedValue({ id: 'raw-version', versionId: 'raw-version', fingerprint: 'raw-hash' }); else save.mockRejectedValue(new Error('版本落盘失败'));
  const finish = vi.spyOn(promptAgentService, 'finishPromptVersion').mockResolvedValue(undefined);
  let done!: () => void;
  const control = vi.spyOn(promptAgentService, 'pageControl').mockImplementation(async (_session, action) => { if (action === 'ui_claim') return { execute: true, claimId: 'raw-claim' }; if (action === 'ui_result') done(); return { ok: true }; });
  const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, emit) => { await new Promise<void>(resolve => { done = resolve; emit({ type: 'ui_request', requestId: `raw-edit-${success}`, operation: { action: 'command', command: 'synthetic_prompt_edit', snapshotId: readAgentPage().snapshotId, agentSessionId: 'forged-operation-session', args: { sessionId: 'forged-session', agentSessionId: 'forged-args-session' } } }); }); });
  try {
    await promptAgentCoordinator.run({ sessionId: 'actual-session', message: 'edit', draft: { ...raw, basePrompt: 'normalized backend draft' }, context: {} }, () => {});
    expect(save).toHaveBeenCalledExactlyOnceWith('actual-session', expect.objectContaining({ source: 'page', reason: 'before_page_edit', draft: expect.objectContaining({ basePrompt: 'raw original', subjectPrompt: 'raw subject' }) }));
    if (success) {
      expect(mutate.mock.calls[0][0].agentSessionId).toBe('actual-session');
      expect(finish).toHaveBeenCalledExactlyOnceWith('actual-session', 'raw-version', expect.objectContaining({ basePrompt: 'actual page change' }));
    } else {
      expect(mutate).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
      expect(control).toHaveBeenCalledWith('actual-session', 'ui_result', expect.objectContaining({ error: '版本落盘失败' }));
    }
  } finally { releaseRead(); releaseWrite(); run.mockRestore(); control.mockRestore(); save.mockRestore(); finish.mockRestore(); document.body.innerHTML = ''; }
});
it('页面 RPC 由任务持有层执行，消息重复不重复操作，不依赖面板回调', async () => {
  document.body.innerHTML = '<main data-agent-view="history"><h1>最新作品</h1></main>';
  let release!: () => void;
  const callback = vi.fn();
  const control = vi.spyOn(promptAgentService, 'pageControl').mockImplementation(async (_session, action) => { if (action === 'ui_claim') return { execute: true, claimId: 'claim' }; if (action === 'ui_result') release(); return { ok: true }; });
  const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
    await new Promise<void>(resolve => {
      release = resolve;
      onEvent({ type: 'ui_request', requestId: 'request-page', operation: { action: 'read' } });
      onEvent({ type: 'ui_request', requestId: 'request-page', operation: { action: 'read' } });
    });
  });
  try {
    await promptAgentCoordinator.run({ sessionId: 'page-session', message: '在哪里', draft: {} as PromptAgentDraft, context: {} }, callback);
    expect(control.mock.calls.filter(([, action]) => action === 'ui_result')).toHaveLength(1);
    expect(control).toHaveBeenCalledWith('page-session', 'ui_result', expect.objectContaining({ claimId: 'claim', result: expect.objectContaining({ title: '生成历史' }) }));
    expect(callback).not.toHaveBeenCalled();
  } finally { run.mockRestore(); control.mockRestore(); document.body.innerHTML = ''; }
});
it('输入与图片按会话隔离，文字可以跨组件恢复', () => {
  promptAgentCoordinator.saveComposer('a', 'draft a', [{ data: 'image', mimeType: 'image/png', name: 'a.png' }]);
  promptAgentCoordinator.saveComposer('b', 'draft b', []);
  expect(promptAgentCoordinator.loadComposer('a').text).toBe('draft a');
  expect(promptAgentCoordinator.loadComposer('b').attachments).toEqual([]);
  expect(agentDraftFingerprint({ prompt: 'a' })).not.toBe(agentDraftFingerprint({ prompt: 'b' }));
});
it('浏览器禁用草稿存储仍能继续输入，不抛异常阻断界面', () => {
  const mock = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
  expect(() => promptAgentCoordinator.saveComposer('quota', 'pending text', [])).not.toThrow();
  expect(promptAgentCoordinator.loadComposer('quota').text).toBe('pending text');
  mock.mockRestore();
});
it('重连补送已完成回执，丢失回执的点击只报待核实，均不重复操作', async () => {
  document.body.innerHTML = '<main data-agent-view="history"><button>筛选</button></main>';
  const button = document.querySelector('button')!; let clicks = 0; button.onclick = () => clicks++;
  const page = readAgentPage(), result = structuredClone(page), clientId = getAgentPageClientId();
  const mock = vi.spyOn(promptAgentService, 'pageControl').mockImplementation(async (_s, action) => action === 'ui_claim' ? { execute: false, claimId: 'claimed' } : { ok: true });
  sessionStorage.setItem('nai-agent-page-receipt-recovered-result', JSON.stringify({ claimId: 'claimed', result }));
  const request = { operation: { action: 'click' as const, snapshotId: page.snapshotId, controlId: page.controls[0].id }, clientId, expiresAt: Date.now() + 1000 };
  try {
    promptAgentCoordinator.resumePageRequests('recover', { status: 'running', clientDraft: {} as PromptAgentDraft, pendingUI: [{ ...request, requestId: 'recovered-result' }, { ...request, requestId: 'recovered-unknown' }] }, () => ({} as PromptAgentDraft));
    await vi.waitFor(() => expect(mock.mock.calls.filter(([, action]) => action === 'ui_result')).toHaveLength(2));
    expect(mock).toHaveBeenCalledWith('recover', 'ui_result', expect.objectContaining({ requestId: 'recovered-result', result }));
    expect(mock).toHaveBeenCalledWith('recover', 'ui_result', expect.objectContaining({ requestId: 'recovered-unknown', error: expect.stringContaining('不重复执行') }));
    expect(clicks).toBe(0);
  } finally { promptAgentCoordinator.resumePageRequests('recover', { status: 'completed' }, () => ({} as PromptAgentDraft)); mock.mockRestore(); document.body.innerHTML = ''; }
});
it('轮询恢复未执行请求一次，其他标签页和过期请求不执行', async () => {
  document.body.innerHTML = '<main data-agent-view="history"><button aria-pressed="false">只看收藏</button></main>';
  const button = document.querySelector('button')!; let clicks = 0; button.onclick = () => { clicks++; button.setAttribute('aria-pressed', 'true'); };
  const page = readAgentPage(), clientId = getAgentPageClientId();
  const mock = vi.spyOn(promptAgentService, 'pageControl').mockImplementation(async (_s, action) => action === 'ui_claim' ? { execute: true, claimId: 'claim-new' } : { ok: true });
  const request = { requestId: 'recovered-new', operation: { action: 'check' as const, checked: true, snapshotId: page.snapshotId, controlId: page.controls[0].id }, clientId, expiresAt: Date.now() + 2000 };
  const task = { status: 'waiting_user_input', clientDraft: {} as PromptAgentDraft, pendingUI: [request, { ...request, requestId: 'wrong-client', clientId: 'someone-else' }, { ...request, requestId: 'expired', expiresAt: 1 }] };
  try {
    promptAgentCoordinator.resumePageRequests('recover-new', task, () => ({} as PromptAgentDraft)); promptAgentCoordinator.resumePageRequests('recover-new', task, () => ({} as PromptAgentDraft));
    await vi.waitFor(() => expect(mock.mock.calls.filter(([, action]) => action === 'ui_result')).toHaveLength(1));
    expect(clicks).toBe(1); expect(mock.mock.calls.filter(([, action]) => action === 'ui_claim')).toHaveLength(1);
  } finally { promptAgentCoordinator.resumePageRequests('recover-new', { status: 'completed' }, () => ({} as PromptAgentDraft)); mock.mockRestore(); document.body.innerHTML = ''; }
});
it('工作期间页面与已提交参数持续同步，不靠聊天标题替模型更新状态', async () => {
  document.body.innerHTML = '<main data-agent-view="playground"><input aria-label="步数" value="20"></main>';
  let draft = { params: { steps: 20 }, target: { chainId: 'playground', mode: 'text-to-image', fingerprint: 'before', name: '实验室' } } as PromptAgentDraft;
  let release!: () => void;
  const mock = vi.spyOn(promptAgentService, 'pageControl').mockResolvedValue({ ok: true });
  const run = vi.spyOn(promptAgentService, 'run').mockImplementation(() => new Promise(resolve => { release = () => resolve(undefined); }));
  const pending = promptAgentCoordinator.run({ sessionId: 'live-sync', message: '协作', draft, context: {} }, () => {}, () => draft);
  try {
    draft = { ...draft, params: { ...draft.params, steps: 23 }, target: { ...draft.target!, fingerprint: 'after' } };
    document.querySelector('main')!.setAttribute('data-agent-view', 'history');
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mock).toHaveBeenCalledWith('live-sync', 'ui_context', expect.objectContaining({ page: expect.objectContaining({ title: '生成历史' }), labSync: expect.objectContaining({ changes: [{ path: ['params', 'steps'], before: 20, after: 23 }] }) })));
    expect(run.mock.calls[0][0].context.clientSettings?.pageClientId).toBe(getAgentPageClientId());
  } finally { release(); await pending; mock.mockRestore(); run.mockRestore(); document.body.innerHTML = ''; }
});
it('跨模式接续传递完整新目标，收到回执后才更新基线', async () => {
  document.body.innerHTML = '<main data-agent-view="playground"><input aria-label="当前模式参数"/></main>';
  let draft: PromptAgentDraft = { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { steps: 20, width: 832, height: 1216, scale: 5, sampler: 'k_euler' }, target: { chainId: 'playground', mode: 'text-to-image', fingerprint: 'before' } };
  let release!: () => void;
  const control = vi.spyOn(promptAgentService, 'pageControl').mockResolvedValue({ ok: true });
  const run = vi.spyOn(promptAgentService, 'run').mockImplementation(() => new Promise(resolve => { release = () => resolve(undefined); }));
  const pending = promptAgentCoordinator.run({ sessionId: 'retarget', message: '接续', draft, context: {} }, () => {}, () => draft);
  try {
    draft = { ...draft, target: { ...draft.target!, mode: 'inpaint', fingerprint: 'next' } };
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(control).toHaveBeenCalledWith('retarget', 'ui_context', expect.objectContaining({ labRetarget: { targetBefore: expect.objectContaining({ mode: 'text-to-image' }), draft } })));
    draft = { ...draft, params: { ...draft.params, steps: 23 }, target: { ...draft.target!, fingerprint: 'edited' } };
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(control).toHaveBeenCalledWith('retarget', 'ui_context', expect.objectContaining({ labSync: expect.objectContaining({ targetBefore: expect.objectContaining({ mode: 'inpaint', fingerprint: 'next' }) }) })));
  } finally { release(); await pending; control.mockRestore(); run.mockRestore(); document.body.innerHTML = ''; }
});
