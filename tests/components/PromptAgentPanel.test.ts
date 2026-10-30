// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PromptAgentPanel } from '../../components/PromptAgentPanel';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { NAIParams } from '../../types';
import { promptAgentService, type PromptAgentEvent, type PromptAgentCompactionResult, type PromptAgentSession } from '../../services/promptAgent';
import { promptAgentCoordinator } from '../../services/promptAgentCoordinator';
import { createAgentPromptChange, type AgentPromptChange } from '../../services/agentPromptChanges.mjs';
import type { PromptAgentDraft } from '../../types';
import { normalizeAgentLabDraft, restoreUnchangedAgentLabFields } from '../../services/agentLabSync.mjs';
import type { AgentPromptApplied, AgentPromptBeforeApply } from '../../services/promptAgent';

vi.mock('../../components/MobileUI', () => ({
  useMobileHistoryLayer: (_open: boolean, onClose: () => void) => onClose,
}));

vi.mock('../../services/tagDictionary', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/tagDictionary')>();
  return { ...actual, searchCharacterDictionary: vi.fn(async () => []), getCharacterDictionaryEntries: vi.fn(async () => []), preloadTagDictionary: vi.fn() };
});
import { getCharacterDictionaryEntries, searchCharacterDictionary } from '../../services/tagDictionary';

const characterChain = (overrides: Record<string, unknown> = {}) => ({
  id: 'character-furina',
  userId: 'user',
  type: 'character' as const,
  name: '芙宁娜',
  description: '水神',
  tags: [] as string[],
  basePrompt: 'furina (genshin impact), blue eyes',
  negativePrompt: 'bad hands',
  modules: [],
  params: { model: 'nai-diffusion-4-full' } as unknown as NAIParams,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const responseFor = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => '',
}) as Response;

const mockSession = {
  id: 'session-1',
  title: '新对话',
  model: 'deepseek-chat',
  provider: 'deepseek',
  thinkingLevel: 'off' as const,
  imageInput: false,
  messages: [],
  messageCount: 0,
  running: false,
  createdAt: 1000,
  updatedAt: 1000,
};

const stubServices = (
  sessionOverrides: { imageInput?: boolean; [key: string]: unknown } = {},
  sessionSetup: { sessions?: typeof mockSession[]; createdSession?: typeof mockSession; createFailures?: number } = {},
) => {
  const currentSession = { ...mockSession, ...sessionOverrides };
  let createCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/prompt-agent/sessions') && !url.includes('audit-log')) {
      if (init?.method === 'POST') {
        createCount++;
        if (createCount <= (sessionSetup.createFailures || 0)) return responseFor({ error: 'synthetic create failure' }, 500);
        return responseFor(sessionSetup.createdSession || currentSession);
      }
      return responseFor({ items: sessionSetup.sessions || [currentSession] });
    }
    if (url.includes('/api/prompt-agent/config')) {
      return responseFor({
        provider: 'deepseek',
        model: 'deepseek-chat',
        imageInput: false,
        configured: true,
        configuredProviders: ['deepseek'],
        policyVersion: '1.0',
        policyFingerprint: 'fp123',
        runtimeStartedAt: 1000,
        permissionMode: 'standard',
        backendVersion: 'synthetic',
        sourceVersion: 'synthetic',
      });
    }
    if (url.includes('/api/prompt-agent/available-models')) {
      return responseFor({
        items: [
          { id: 'deepseek-chat', name: 'DeepSeek-V3', provider: 'deepseek', providerName: 'DeepSeek', reasoning: false, imageInput: sessionOverrides.imageInput === true, contextWindow: 64000, thinkingLevels: ['off'] },
        ],
      });
    }
    return responseFor({});
  }));
  return { createCount: () => createCount };
};

const panelElement = (_canUndo = false, overrides = {}) => {
  return (
    React.createElement(
      ConfirmDialogProvider,
      null,
      React.createElement(PromptAgentPanel, {
        open: true,
        onClose: () => {},
        draft: {
          basePrompt: '',
          subjectPrompt: '',
          negativePrompt: '',
          modules: [],
          params: {
            prompt: '',
            negativePrompt: '',
            steps: 28,
            scale: 5,
            width: 832,
            height: 1216,
            sampler: 'k_euler',
            seed: 0,
            model: 'nai-diffusion-4-full',
          } as unknown as NAIParams,
        },
        apiKey: '',
        onRunStart: () => {},
        onFinalDraft: () => {},
        onRequestGeneration: () => {},
        onPromptChange: () => {},
        tagAssistEnabled: true,
        ...overrides,
      })
    )
  );
};
const renderPanel = (canUndo = false, overrides = {}) => render(panelElement(canUndo, overrides));

describe('PromptAgentPanel 顶栏前端布局规范', () => {

  it('重连恢复待回答问题、原任务保持忙碌，提交失败保留选择，成功不另开任务', async () => {
    stubServices();
    const request = { requestId: 'question-one', runId: 'question-run', questions: [{ id: 'q', prompt: '想用哪一种构图？', options: [{ id: 'wide', label: '远景' }, { id: 'close', label: '特写' }] }] };
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    const task = vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ runId: request.runId, status: 'waiting_user_input', pendingQuestions: [request] });
    const control = vi.spyOn(promptAgentService, 'control').mockRejectedValueOnce(new Error('回答连接中断')).mockResolvedValue(undefined);
    const run = vi.spyOn(promptAgentService, 'run');
    const view = renderPanel();
    await screen.findByText('想用哪一种构图？');
    expect(screen.getByRole('button', { name: '助手权限' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull();
    expect(screen.getAllByRole('radio').every(item => !(item as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByLabelText('远景'));
    fireEvent.click(screen.getByRole('button', { name: '提交回答并继续' }));
    expect(await screen.findByText('回答连接中断')).toBeTruthy();
    expect(screen.getByLabelText('远景')).toHaveProperty('checked', true);
    view.rerender(panelElement(false, { open: false }));
    view.rerender(panelElement(false, { open: true }));
    await screen.findByText('想用哪一种构图？');
    expect(screen.getByLabelText('远景')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: '提交回答并继续' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '助手提问' })).toBeNull());
    expect(control).toHaveBeenLastCalledWith('session-1', 'answer', undefined, { runId: request.runId, requestId: request.requestId, answers: [{ questionId: 'q', optionId: 'wide' }] });
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    const reads = task.mock.calls.length;
    await waitFor(() => expect(task.mock.calls.length).toBeGreaterThan(reads), { timeout: 3000 });
    expect(screen.queryByRole('region', { name: '助手提问' })).toBeNull();
  });

  it('历史问题和完整答案直接可见，不受工具过程折叠影响', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ status: 'completed' });
    const longAnswer = '完整自定义回答'.repeat(650);
    const questions = [{ id: 'normalized', prompt: '规范化后实际问题', options: [] }];
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'answer', role: 'agent', text: '已继续完成任务', tools: [{ id: 'input', name: 'request_user_input', state: 'done', args: { questions: [{ prompt: '原始输入问题' }] }, result: [{ type: 'text', text: JSON.stringify({ answered: true, questions, answers: [{ questionId: 'normalized', customText: longAnswer }] }) }] }] }]);
    renderPanel();
    await screen.findByText('规范化后实际问题');
    const card = screen.getByRole('region', { name: '问题与回答' });
    expect(card.closest('details')).toBeNull();
    expect(card.textContent).toContain(longAnswer);
    expect(card.textContent).not.toContain('原始输入问题');
  });

  it('流式提问重复事件保留同一卡片填写；取消后隐藏且不会作为批准', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    const request = { requestId: 'stream-question', runId: 'stream-run', questions: [{ id: 'q', prompt: '作品的主题？', options: [] }] };
    let emit!: (event: PromptAgentEvent) => void, finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { emit = onEvent; await new Promise<void>(resolve => { finish = resolve; }); });
    const control = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    renderPanel();
    const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: '制作一张作品' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    act(() => emit({ type: 'request_question', request }));
    fireEvent.change(screen.getByRole('textbox', { name: '自定义回答内容' }), { target: { value: '未提交的主题' } });
    act(() => emit({ type: 'request_question', request }));
    expect(screen.getAllByRole('region', { name: '助手提问' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '自定义回答内容' })).toHaveProperty('value', '未提交的主题');
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(control).toHaveBeenCalledWith('session-1', 'abort');
    await act(async () => { emit({ type: 'question_answered', requestId: request.requestId, answered: false, outcome: 'cancelled' }); emit({ type: 'done', status: 'aborted', message: '', provider: '', model: '', draft: {} as PromptAgentDraft }); finish(); });
    expect(screen.queryByRole('region', { name: '助手提问' })).toBeNull();
    expect(control.mock.calls.some(([, action]) => action === 'confirm' || action === 'answer')).toBe(false);
  });

  it('轮询先恢复并回答后迟到SSE不复活问题，停止后的新问题帧也不能恢复任务', async () => {
    stubServices(); const task = vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    const request = { requestId: 'poll-first-question', runId: 'poll-first-run', questions: [{ id: 'q', prompt: '先由轮询读到的问题', options: [] }] };
    let emit!: (event: PromptAgentEvent) => void, finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { emit = onEvent; await new Promise<void>(resolve => { finish = resolve; }); });
    const control = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    const view = renderPanel();
    const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: '继续这个任务' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    task.mockResolvedValue({ runId: request.runId, status: 'waiting_user_input', pendingQuestions: [request] });
    view.rerender(panelElement(false, { open: false })); view.rerender(panelElement(false, { open: true }));
    await screen.findByText('先由轮询读到的问题');
    fireEvent.change(screen.getByRole('textbox', { name: '自定义回答内容' }), { target: { value: '真实回答' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回答并继续' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '助手提问' })).toBeNull());
    act(() => emit({ type: 'request_question', runId: request.runId, request }));
    expect(screen.queryByRole('region', { name: '助手提问' })).toBeNull();
    expect(control).toHaveBeenCalledExactlyOnceWith('session-1', 'answer', undefined, { runId: request.runId, requestId: request.requestId, answers: [{ questionId: 'q', customText: '真实回答' }] });
    task.mockResolvedValue({ runId: request.runId, status: 'aborted', pendingQuestions: [] });
    await act(async () => { emit({ type: 'done', runId: request.runId, status: 'aborted', message: '', provider: '', model: '', draft: {} as PromptAgentDraft }); finish(); });
    act(() => emit({ type: 'request_question', runId: request.runId, request: { ...request, requestId: 'late-after-abort' } }));
    expect(screen.queryByRole('region', { name: '助手提问' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    expect(screen.getByRole('button', { name: '执行' })).toBeTruthy();
  });

  it.each([{ width: 320, dark: false }, { width: 1280, dark: true }])('斜杠建议贴近输入框且不占历史空间，$width宽度明暗主题可点击执行并保留后来输入', async ({ width, dark }) => {
    vi.stubGlobal('innerWidth', width); stubServices();
    const history = [{ id: 'u', role: 'user' as const, text: '原来的目标' }, { id: 'a', role: 'agent' as const, text: '保留的回答' }];
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue(history); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const run = vi.spyOn(promptAgentService, 'run');
    let finish!: (value: PromptAgentCompactionResult) => void;
    const compact = vi.spyOn(promptAgentService, 'compactSession').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wasDark = document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark', dark);
    try {
      renderPanel(); await screen.findByText('保留的回答');
      const input = screen.getByRole('textbox', { name: '任务要求' });
      expect(input.getAttribute('placeholder')).toBe('输入要求，或用 / 查看命令，@ 引用角色库…');
      fireEvent.change(input, { target: { value: '/' } });
      const list = screen.getByRole('listbox', { name: '助手命令' });
      const option = within(list).getByRole('option', { name: '/compact 压缩上下文' });
      expect(input.getAttribute('aria-controls')).toBe(list.id); expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
      expect(input.getAttribute('aria-haspopup')).toBe('listbox'); expect(input.hasAttribute('aria-expanded')).toBe(false);
      for (const name of ['absolute', 'bottom-full', 'inset-x-0', 'max-w-full', 'appearance-overlay', 'bg-white', 'dark:bg-gray-900']) expect(list.classList.contains(name)).toBe(true);
      expect(list.parentElement?.classList.contains('relative')).toBe(true); expect(option.classList.contains('min-h-11')).toBe(true);
      expect(screen.getAllByRole('option')).toHaveLength(1);
      fireEvent.pointerDown(option, { pointerType: width < 768 ? 'touch' : 'mouse' }); fireEvent.click(option);
      expect(compact).toHaveBeenCalledExactlyOnceWith('session-1'); expect(input).toHaveProperty('value', '');
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.change(input, { target: { value: '/compact' } });
      expect(screen.getByRole('option', { name: '/compact 压缩上下文' })).toHaveProperty('disabled', true);
      fireEvent.keyDown(input, { key: 'Enter' }); expect(compact).toHaveBeenCalledOnce(); expect(input).toHaveProperty('value', '/compact');
      fireEvent.change(input, { target: { value: '压缩期间后来写的草稿' } });
      await act(async () => finish({ compacted: true }));
      expect(await screen.findByText('上下文已压缩')).toBeTruthy(); expect(input).toHaveProperty('value', '压缩期间后来写的草稿');
      expect(screen.getByText('保留的回答')).toBeTruthy(); expect(run).not.toHaveBeenCalled();
    } finally { document.documentElement.classList.toggle('dark', wasDark); }
  });

  it('斜杠支持英文前缀、中文过滤、Tab补全及Esc收起，Shift+Enter和IME确认不误执行', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'u', role: 'user', text: '既有目标' }]); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const compact = vi.spyOn(promptAgentService, 'compactSession').mockResolvedValue({ compacted: false }); const close = vi.fn();
    renderPanel(false, { onClose: close }); await screen.findByText('既有目标'); const input = screen.getByRole('textbox', { name: '任务要求' });
    for (const value of ['/comp', '/压缩']) { fireEvent.change(input, { target: { value } }); expect(screen.getByRole('option', { name: '/compact 压缩上下文' })).toBeTruthy(); }
    fireEvent.keyDown(input, { key: 'Tab' }); expect(input).toHaveProperty('value', '/compact'); expect(compact).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); expect(compact).not.toHaveBeenCalled();
    fireEvent.compositionStart(input); expect(screen.queryByRole('listbox')).toBeNull(); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(compact).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 }); expect(compact).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' }); expect(screen.queryByRole('listbox')).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(input).toHaveProperty('value', '/compact');
    fireEvent.change(input, { target: { value: '/comp' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('当前上下文无需压缩')).toBeTruthy(); expect(compact).toHaveBeenCalledOnce();
  });

  it.each(['/compact', ' /COMPACT '])('完整命令“%s”点击发送走压缩而非模型，失败仍保留附件与后来输入', async command => {
    stubServices({ imageInput: true }); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'u', role: 'user', text: '原始目标' }]); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.spyOn(promptAgentCoordinator, 'loadComposer').mockReturnValue({ text: '', attachments: [{ name: 'slash-synthetic.png', data: 'c3ludGhldGlj', mimeType: 'image/png' }] });
    const run = vi.spyOn(promptAgentService, 'run'); let reject!: (error: Error) => void;
    const compact = vi.spyOn(promptAgentService, 'compactSession').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    try {
      renderPanel(); await screen.findByText('原始目标'); const input = screen.getByRole('textbox', { name: '任务要求' });
      fireEvent.change(input, { target: { value: command } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
      expect(compact).toHaveBeenCalledOnce(); expect(input).toHaveProperty('value', '');
      fireEvent.change(input, { target: { value: '失败也不丢的新输入' } }); await act(async () => reject(new Error('合成摘要失败')));
      expect(await screen.findByText('合成摘要失败')).toBeTruthy(); expect(input).toHaveProperty('value', '失败也不丢的新输入');
      expect(screen.getByRole('button', { name: '移除附件 slash-synthetic.png' })).toBeTruthy(); expect(run).not.toHaveBeenCalled();
    } finally { promptAgentCoordinator.saveComposer('session-1', '', []); }
  });

  it.each([false, true])('无历史或任务忙=%s时命令不能启动且不作为普通消息发送', async busy => {
    stubServices(); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue(busy ? [{ id: 'u', role: 'user', text: '执行中的目标' }] : []); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue(busy ? { status: 'running' } : {});
    const compact = vi.spyOn(promptAgentService, 'compactSession'), run = vi.spyOn(promptAgentService, 'run');
    renderPanel(); const input = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect(input).toHaveProperty('disabled', false));
    if (busy) await screen.findByRole('button', { name: '停止' });
    fireEvent.change(input, { target: { value: '/compact' } }); const option = screen.getByRole('option', { name: '/compact 压缩上下文' });
    expect(option).toHaveProperty('disabled', true); fireEvent.click(option); fireEvent.keyDown(input, { key: 'Enter' });
    if (!busy) fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(compact).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(input).toHaveProperty('value', '/compact');
  });

  it.each(['https://example.com/a/b', '普通正文 /compact', '/unknown', '/compact extra', '/compact\n继续正文'])('正文“%s”原样发送，不拦截未注册或混入正文的斜杠', async text => {
    stubServices(); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const compact = vi.spyOn(promptAgentService, 'compactSession'); const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async () => {});
    renderPanel(); const input = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: text } }); expect(screen.queryByRole('listbox')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce()); expect(run.mock.calls[0][0].message).toBe(text); expect(compact).not.toHaveBeenCalled();
  });

  it('编辑旧消息时完整斜杠仍走原编辑重发，不抢走编辑语义', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'u', role: 'user', text: '旧消息' }]); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const compact = vi.spyOn(promptAgentService, 'compactSession'); const revise = vi.spyOn(promptAgentService, 'reviseMessage').mockResolvedValue([{ id: 'u', role: 'user', text: '/compact' }]);
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async () => {});
    renderPanel(); await screen.findByText('旧消息'); fireEvent.click(screen.getByRole('button', { name: '编辑重发' }));
    const input = screen.getByRole('textbox', { name: '任务要求' }); fireEvent.change(input, { target: { value: '/compact' } }); expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新发送' })); await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(revise).toHaveBeenCalledExactlyOnceWith('session-1', 'u', '/compact', []); expect(compact).not.toHaveBeenCalled();
  });

  it('没有真实对话或任务仍在执行时，聊天菜单不能压缩上下文', async () => {
    stubServices();
    const compact = vi.spyOn(promptAgentService, 'compactSession');
    const history = vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    const task = vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const view = renderPanel(); await screen.findByRole('heading', { name: '新对话' });
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
    expect(screen.getByRole('button', { name: '压缩上下文' })).toHaveProperty('disabled', true);
    view.unmount(); history.mockResolvedValue([{ id: 'user', role: 'user', text: '已有要求' }]); task.mockResolvedValue({ status: 'running' });
    renderPanel(); await screen.findAllByRole('button', { name: /停止/ });
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
    expect(screen.getByRole('button', { name: '压缩上下文' })).toHaveProperty('disabled', true);
    expect(compact).not.toHaveBeenCalled();
  });

  it.each([320, 1280])('宽度 %s：压缩只从聊天菜单发起，成功刷新原历史但保留输入草稿', async width => {
    vi.stubGlobal('innerWidth', width); stubServices();
    const original = [{ id: 'user', role: 'user' as const, text: '原始要求' }, { id: 'answer', role: 'agent' as const, text: '原始回答' }];
    const history = vi.spyOn(promptAgentService, 'getSession').mockResolvedValue(original);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    let finish!: (value: PromptAgentCompactionResult) => void;
    const compact = vi.spyOn(promptAgentService, 'compactSession').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderPanel(); await screen.findByText('原始回答');
    const input = screen.getByRole('textbox', { name: '任务要求' });
    fireEvent.change(input, { target: { value: '还没发送的下一条' } });
    expect(screen.queryByRole('button', { name: '压缩上下文' })).toBeNull();
    const readsBefore = history.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
    const button = screen.getByRole('button', { name: '压缩上下文' });
    expect(button.classList.contains('min-h-11')).toBe(true); fireEvent.click(button);
    expect(compact).toHaveBeenCalledExactlyOnceWith('session-1');
    expect(screen.getByText('正在压缩上下文…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '助手权限' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '模型与思考设置' })).toHaveProperty('disabled', true);
    expect(input).toHaveProperty('value', '还没发送的下一条');
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
    expect(screen.getByRole('button', { name: '压缩上下文' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '压缩上下文' })); expect(compact).toHaveBeenCalledOnce();
    await act(async () => finish({ compacted: true, context: { beforeTokens: 30000, afterTokens: 6000, retainedMessages: 8, contextWindow: 64000 } }));
    expect(await screen.findByText('上下文已压缩')).toBeTruthy();
    expect(history.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(screen.getByText('原始要求')).toBeTruthy(); expect(screen.getByText('原始回答')).toBeTruthy();
    expect(input).toHaveProperty('value', '还没发送的下一条');
    expect(screen.getByRole('button', { name: '执行' })).toHaveProperty('disabled', false);
    expect(original).toHaveLength(2);
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('6,000');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('摘要压缩后的上下文估算');
  });

  it('自动压缩事件更新状态与估算，真实回复回执覆盖估算且摘要不成为聊天发言', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    let emit!: (event: PromptAgentEvent) => void, finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation((_input, onEvent) => { emit = onEvent; return new Promise<undefined>(resolve => { finish = () => resolve(undefined); }); });
    renderPanel(); const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: '继续当前目标' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    act(() => emit({ type: 'compaction_start' })); expect(screen.getAllByText('正在压缩上下文…').length).toBeGreaterThan(0);
    fireEvent.change(input, { target: { value: '执行期间继续写' } });
    act(() => emit({ type: 'compaction_end', context: { beforeTokens: 30000, afterTokens: 5000, retainedMessages: 6, contextWindow: 64000 }, usage: { input: 25000, output: 1000, cacheRead: 0, cacheWrite: 0, totalTokens: 26000 } }));
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('5,000');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('摘要压缩后的上下文估算');
    act(() => { emit({ type: 'response_start', id: 'response' }); emit({ type: 'text_delta', delta: '继续后的真实回答' }); emit({ type: 'response_end', provider: 'deepseek', model: 'deepseek-chat', usage: { input: 5100, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 5200 }, stopReason: 'stop', timestamp: 2 }); });
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('5,200');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).not.toContain('估算');
    expect(screen.getAllByText('继续当前目标')).toHaveLength(1); expect(screen.getByText('继续后的真实回答')).toBeTruthy();
    expect(input).toHaveProperty('value', '执行期间继续写');
    await act(async () => finish());
  });

  it('重开会话和远端任务事件恢复压缩估算与失败通知，不显示摘要为新消息', async () => {
    const context = { beforeTokens: 30000, afterTokens: 4500, retainedMessages: 6, contextWindow: 64000 };
    stubServices({ context });
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'u', role: 'user', text: '原始用户内容' }]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ events: [{ type: 'compaction_start' }, { type: 'compaction_end', error: '自动摘要失败，原文保留' }] });
    renderPanel(); await screen.findByText('原始用户内容');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('4,500');
    expect(await screen.findByText('自动摘要失败，原文保留')).toBeTruthy();
    expect(screen.queryByText('上下文已压缩')).toBeNull();
  });

  it('手动摘要可用现有停止按钮取消，保留输入和附件并恢复发送及权限', async () => {
    stubServices({ imageInput: true });
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'u', role: 'user', text: '原始内容' }]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.spyOn(promptAgentCoordinator, 'loadComposer').mockReturnValue({ text: '尚未发送', attachments: [{ name: 'synthetic.png', data: 'c3ludGhldGlj', mimeType: 'image/png' }] });
    let cancel!: (reason: Error) => void;
    vi.spyOn(promptAgentService, 'compactSession').mockImplementation(() => new Promise((_resolve, reject) => { cancel = reject; }));
    const abort = vi.spyOn(promptAgentService, 'control').mockImplementation(async () => { cancel(new Error('摘要压缩已停止')); });
    renderPanel(); await screen.findByText('原始内容');
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' })); fireEvent.click(screen.getByRole('button', { name: '压缩上下文' }));
    expect(screen.getByRole('button', { name: '助手权限' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(await screen.findByText('摘要压缩已停止')).toBeTruthy(); expect(abort).toHaveBeenCalledExactlyOnceWith('session-1', 'abort');
    expect(screen.getByRole('textbox', { name: '任务要求' })).toHaveProperty('value', '尚未发送');
    expect(screen.getByRole('button', { name: '移除附件 synthetic.png' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: '助手权限' })).toHaveProperty('disabled', false);
    promptAgentCoordinator.saveComposer('session-1', '', []);
  });

  it('切模型清除旧压缩估算，旧任务回放不会抹掉最新手动压缩估算', async () => {
    const context = { beforeTokens: 30000, afterTokens: 4500, retainedMessages: 6, contextWindow: 64000 };
    stubServices({ context });
    const usage = { input: 20000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 20100 };
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'u', role: 'user', text: '旧任务内容' }, { id: 'a', role: 'agent', text: '旧任务回答', provider: 'deepseek', model: 'deepseek-chat', usage }]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ runId: 'old', cursor: 1, status: 'completed', events: [{ type: 'response_end', provider: 'deepseek', model: 'deepseek-chat', usage, stopReason: 'stop', timestamp: 1 }] });
    vi.spyOn(promptAgentService, 'getAvailableModels').mockResolvedValue(['deepseek-chat', 'other'].map(id => ({ id, name: id, provider: 'deepseek', reasoning: false, imageInput: false, contextWindow: 64000, maxTokens: 8192, thinkingLevels: ['off'] })));
    const update = vi.spyOn(promptAgentService, 'updateSession').mockResolvedValue({ ...mockSession, model: 'other', context });
    renderPanel(); await screen.findByText('旧任务回答');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('4,500');
    fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '模型与思考' })).getByRole('button', { name: 'deepseek-chat' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择模型：other' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('meter')).toBeNull());
    expect(screen.getByRole('img', { name: '上下文使用情况：尚未收到当前模型的用量数据' })).toBeTruthy();
  });

  it('压缩失败就地提示原因，保留原聊天和未发送草稿', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'user', role: 'user', text: '不能丢的要求' }, { id: 'answer', role: 'agent', text: '不能丢的回答' }]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.spyOn(promptAgentService, 'compactSession').mockRejectedValue(new Error('摘要模型暂不可用'));
    renderPanel(); await screen.findByText('不能丢的回答');
    const input = screen.getByRole('textbox', { name: '任务要求' }); fireEvent.change(input, { target: { value: '继续写草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' })); fireEvent.click(screen.getByRole('button', { name: '压缩上下文' }));
    const notice = await screen.findByText('摘要模型暂不可用'); expect(notice.getAttribute('role')).toBe('status');
    expect(screen.getByText('不能丢的要求')).toBeTruthy(); expect(screen.getByText('不能丢的回答')).toBeTruthy();
    expect(input).toHaveProperty('value', '继续写草稿'); expect(screen.queryByText('上下文已压缩')).toBeNull();
    expect(screen.getByRole('button', { name: '执行' })).toHaveProperty('disabled', false);
  });

  it('对话差异在实际应用回调后才标为已应用，撤回重做保存回执且不调用模型', async () => {
    stubServices();
    const save = vi.spyOn(promptAgentService, 'updateSession').mockResolvedValue(mockSession);
    let applied!: (before: PromptAgentDraft, after: PromptAgentDraft) => void;
    let before!: PromptAgentDraft, after!: PromptAgentDraft;
    const runner = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, emit) => {
      before = input.draft; after = { ...before, basePrompt: 'new style' };
      emit({ type: 'done', status: 'completed', draftChanged: true, draft: after, message: '完成', provider: 'synthetic', model: 'synthetic', promptChange: createAgentPromptChange(before, after, 'diff-run') });
    });
    const apply = vi.fn((_draft: PromptAgentDraft, _review: boolean, onApplied: typeof applied) => { applied = onApplied; });
    const undo = vi.fn();
    renderPanel(false, { onFinalDraft: apply, onPromptChange: undo });
    const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: '改提示词' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByText('待应用')).toBeTruthy(); expect(save).not.toHaveBeenCalled();
    await act(async () => applied(before, after));
    expect(await screen.findByText('已应用')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: '撤回本次提示词修改' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '撤回本次提示词修改' }));
    expect(await screen.findByText('已撤回')).toBeTruthy();
    expect(undo).toHaveBeenCalledWith(expect.objectContaining({ id: 'diff-run' }), 'undo', expect.any(Function));
    await waitFor(() => expect((screen.getByRole('button', { name: '重做本次提示词修改' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '重做本次提示词修改' }));
    expect(await screen.findByText('已应用')).toBeTruthy();
    expect(undo).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'diff-run' }), 'redo', expect.any(Function));
    expect(runner).toHaveBeenCalledOnce();
    expect(save.mock.calls.map(call => call[1].promptChange?.status)).toEqual(['applied', 'undone', 'applied']);
  });

  it('真实raw版本先保存，实际清理旧分栏的完整回执绑定原对话和版本，完成后才补写after', async () => {
    stubServices();
    const raw = { basePrompt: 'style', subjectPrompt: '', negativePrompt: 'blur', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler', _promptSections: { scene: 'tree', sectionNegatives: { scene: 'legacy negative' }, sectionMeta: { scene: { source: 'library', entryId: 'raw-source' } } } }, target: { chainId: 'raw-work', mode: 'text-to-image', fingerprint: 'raw-target' } } as unknown as PromptAgentDraft;
    const visible = normalizeAgentLabDraft(raw);
    const version = vi.spyOn(promptAgentService, 'savePromptVersion').mockResolvedValue({ id: 'raw-old', versionId: 'raw-old', fingerprint: 'hash' });
    const finish = vi.spyOn(promptAgentService, 'finishPromptVersion').mockResolvedValue(undefined);
    const save = vi.spyOn(promptAgentService, 'updateSession').mockResolvedValue(mockSession);
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, emit) => {
      const after = { ...visible, negativePrompt: 'blur' };
      emit({ type: 'done', status: 'completed', draftChanged: true, draft: after, message: '完成', provider: 'synthetic', model: 'synthetic', promptChange: createAgentPromptChange(visible, after, 'raw-round') });
    });
    const apply = vi.fn(async (selected: PromptAgentDraft, _review: boolean, applied?: AgentPromptApplied, beforeApply?: AgentPromptBeforeApply) => {
      const actual = restoreUnchangedAgentLabFields(raw, selected);
      const saved = await beforeApply!(raw, actual);
      applied?.(raw, actual, { beforeVersionId: saved ? saved.versionId : undefined, selectedAfter: selected });
      if (saved && saved.finish) await saved.finish(actual);
    });
    renderPanel(false, { draft: visible, onFinalDraft: apply });
    const input = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: '删除旧负面' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('session-1', { promptChange: expect.objectContaining({ beforeVersionId: 'raw-old', rawAfter: expect.anything(), selectedAfter: expect.anything(), appliedChanges: expect.arrayContaining([expect.objectContaining({ path: ['params', '_promptSections', 'sectionNegatives'], before: { scene: 'legacy negative' } })]) }) }));
    expect(version).toHaveBeenCalledWith('session-1', expect.objectContaining({ source: 'page', reason: 'before_apply', draft: raw, changeId: 'raw-round' }));
    expect(finish).toHaveBeenCalledWith('session-1', 'raw-old', expect.objectContaining({ negativePrompt: 'blur' }));
  });

  it('重新打开会话保留红绿差异与重做状态，旧消息不补造差异', async () => {
    stubServices();
    const promptChange: AgentPromptChange = { id: 'saved-change', target: { chainId: 'lab', mode: 'text-to-image' }, status: 'undone', changes: [{ path: ['basePrompt'], before: 'old', after: 'new' }] };
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ id: 'old-message', role: 'agent', text: '旧消息' }, { id: 'with-change', role: 'agent', text: '已修改', promptChange }]);
    renderPanel();
    expect(await screen.findByText('已撤回')).toBeTruthy();
    expect(screen.getAllByRole('region', { name: '提示词修改' })).toHaveLength(1);
    expect((screen.getByRole('button', { name: '重做本次提示词修改' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('首次启动忽略旧会话偏好并发创建一次，严格模式和重挂载沿用本次会话', async () => {
    const old = { ...mockSession, id: 'old-session', title: '旧历史对话' };
    const fresh = { ...mockSession, id: 'fresh-session', title: '本次新对话' };
    localStorage.setItem('nai_prompt_agent_session', old.id);
    const stub = stubServices({}, { sessions: [old], createdSession: fresh });
    const loaded: string[] = [];
    vi.spyOn(promptAgentService, 'getSession').mockImplementation(async id => { loaded.push(id); return []; });
    const view = render(React.createElement(React.StrictMode, null, React.createElement(React.Fragment, null, panelElement(), panelElement())));
    expect((await screen.findAllByRole('heading', { name: '本次新对话' })).length).toBe(2);
    await waitFor(() => expect(stub.createCount()).toBe(1));
    expect(promptAgentCoordinator.selectedSessionId()).toBe(fresh.id);
    expect(loaded).not.toContain(old.id);

    view.rerender(React.createElement(React.StrictMode, null, panelElement()));
    expect(await screen.findByRole('heading', { name: '本次新对话' })).toBeTruthy();
    expect(stub.createCount()).toBe(1);
    expect(loaded).not.toContain(old.id);
  });

  it('用户手选历史会话后，卸载重开仍沿用所选会话且不创建新对话', async () => {
    const old = { ...mockSession, id: 'old-session', title: '手选历史' };
    const fresh = { ...mockSession, id: 'fresh-session', title: '本次新对话' };
    const stub = stubServices({}, { sessions: [old], createdSession: fresh });
    const loaded: string[] = [];
    vi.spyOn(promptAgentService, 'getSession').mockImplementation(async id => { loaded.push(id); return []; });
    const view = renderPanel();
    expect(await screen.findByRole('heading', { name: fresh.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    fireEvent.click(screen.getByRole('button', { name: /手选历史/ }));
    expect(await screen.findByRole('heading', { name: old.title })).toBeTruthy();
    expect(promptAgentCoordinator.selectedSessionId()).toBe(old.id);
    view.unmount();

    const reopened = renderPanel();
    expect(await screen.findByRole('heading', { name: old.title })).toBeTruthy();
    expect(promptAgentCoordinator.selectedSessionId()).toBe(old.id);
    expect(stub.createCount()).toBe(1);
    expect(loaded).toContain(old.id);
    reopened.unmount();
  });

  it('会话抽屉首读期间显示加载，失败后可原位重试，后台刷新失败保留已读列表', async () => {
    stubServices();
    let resolveInitial!: (sessions: PromptAgentSession[]) => void;
    const list = vi.spyOn(promptAgentService, 'listSessions')
      .mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; }))
      .mockRejectedValueOnce(new Error('synthetic refresh failure'))
      .mockResolvedValue([mockSession]);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    const drawer = screen.getByRole('complementary', { name: '助手会话历史' });
    expect(within(drawer).getByRole('status').textContent).toBe('正在加载对话…');
    expect(within(drawer).queryByText('没有找到匹配的对话')).toBeNull();
    await act(async () => resolveInitial([mockSession]));
    expect(await within(drawer).findByText('新对话')).toBeTruthy();

    await act(async () => window.dispatchEvent(new Event('nai-agent-runtime-changed')));
    expect(await within(drawer).findByText('无法连接助手服务，请确认本地服务正在运行')).toBeTruthy();
    expect(within(drawer).getByText('新对话')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: '重试' }));
    expect(await within(drawer).findByText('新对话')).toBeTruthy();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  });

  it('会话抽屉首读失败显示重试而不是空列表', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'listSessions')
      .mockRejectedValueOnce(new Error('synthetic first read failure'))
      .mockResolvedValue([mockSession]);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    const drawer = screen.getByRole('complementary', { name: '助手会话历史' });
    expect(await within(drawer).findByRole('alert')).toBeTruthy();
    expect(within(drawer).queryByText('没有找到匹配的对话')).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: '重试' }));
    expect(await within(drawer).findByText('新对话')).toBeTruthy();
    expect(within(drawer).queryByRole('alert')).toBeNull();
  });

  it('聊天向上滚动时自动追加更早消息，不再要求点击显示更多', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue(Array.from({ length: 125 }, (_, index) => ({ id: `message-${index}`, role: 'user' as const, text: `历史消息 ${index}` })));
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    renderPanel();
    expect(await screen.findByText('历史消息 124')).toBeTruthy();
    expect(screen.getByText('历史消息 65')).toBeTruthy();
    expect(screen.queryByText('历史消息 64')).toBeNull();
    expect(screen.queryByRole('button', { name: /再显示前面的/ })).toBeNull();

    const scroll = screen.getByRole('main').querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(scroll, { scrollTop: { value: 0, writable: true, configurable: true }, clientHeight: { value: 300, configurable: true }, scrollHeight: { value: 1200, configurable: true } });
    fireEvent.scroll(scroll);
    expect(screen.getByText('历史消息 5')).toBeTruthy();
    expect(screen.queryByText('历史消息 4')).toBeNull();

    fireEvent.scroll(scroll);
    expect(screen.getByText('历史消息 0')).toBeTruthy();
  });

  it('新会话创建失败不退回旧历史，重试成功后进入新会话', async () => {
    const old = { ...mockSession, id: 'old-session', title: '不能自动恢复' };
    const fresh = { ...mockSession, id: 'fresh-session', title: '恢复后的新会话' };
    const stub = stubServices({}, { sessions: [old], createdSession: fresh, createFailures: 1 });
    const loaded: string[] = [];
    localStorage.setItem('nai_prompt_agent_session', old.id);
    vi.spyOn(promptAgentService, 'getSession').mockImplementation(async id => { loaded.push(id); return []; });
    renderPanel();
    expect(await screen.findByText('无法连接助手服务，请确认本地服务正在运行')).toBeTruthy();
    expect(stub.createCount()).toBe(1);
    expect(loaded).not.toContain(old.id);
    expect(screen.queryByRole('heading', { name: old.title })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: fresh.title })).toBeTruthy();
    expect(promptAgentCoordinator.selectedSessionId()).toBe(fresh.id);
    expect(stub.createCount()).toBe(2);
    expect(loaded).not.toContain(old.id);
  });

  it('删除失败显示实际错误，保留会话与当前选中项', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'listSessions').mockResolvedValue([mockSession, { ...mockSession, id: 'session-2', title: '第二条对话' }]);
    const remove = vi.spyOn(promptAgentService, 'deleteSession').mockRejectedValue(new Error('synthetic EACCES'));
    renderPanel();
    await screen.findByRole('heading', { name: '新对话' });
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    fireEvent.click(screen.getAllByRole('button', { name: '会话操作' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除对话' }));
    await screen.findByText('synthetic EACCES');
    expect(remove).toHaveBeenCalledWith('session-1');
    expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    expect(screen.getByText('第二条对话')).toBeTruthy();
  });
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    promptAgentCoordinator.selectSession(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    promptAgentCoordinator.selectSession(undefined);
    sessionStorage.clear(); localStorage.clear();
  });

  it.each([false, true])('聊天输入在暗色=%s 时透出工具栏表面，不被通用表单底色覆盖', async dark => {
    stubServices();
    const previousDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    const style = document.createElement('style');
    // 模拟不同预设的父面板和通用表单底色，使用真实 CSS 验证输入覆盖的优先级。
    style.textContent = `.appearance-surface { background-color: ${dark ? 'rgb(23, 27, 36)' : 'rgb(255, 255, 255)'}; } .agent-theme textarea { background-color: rgb(220, 235, 255); }\n` + readFileSync('components/AgentSurface.css', 'utf8');
    document.head.append(style);
    try {
      renderPanel();
      const box = screen.getByRole('textbox', { name: '任务要求' });
      await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
      expect(getComputedStyle(box).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(box.closest('.appearance-surface')!).backgroundColor).toBe(dark ? 'rgb(23, 27, 36)' : 'rgb(255, 255, 255)');
    } finally { style.remove(); document.documentElement.classList.toggle('dark', previousDark); }
  });

  it('回到底部使用共用主题表面，点击后恢复跟随且滚动到实际末尾', async () => {
    stubServices(); renderPanel();
    await screen.findByRole('heading', { name: '新对话' });
    const scroll = screen.getByRole('textbox', { name: '任务要求' }).closest('main')!.querySelector('.space-y-6')!;
    Object.defineProperties(scroll, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 200, configurable: true }, scrollTop: { value: 0, writable: true, configurable: true } });
    fireEvent.scroll(scroll);
    const button = screen.getByRole('button', { name: '回到底部' });
    expect(button.classList.contains('appearance-surface')).toBe(true);
    expect(button.className).not.toMatch(/bg-gray-900\/90|bg-white\/90|text-white|dark:text-gray-900/);
    fireEvent.click(button);
    expect(scroll.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1000 }));
    expect(screen.queryByRole('button', { name: '回到底部' })).toBeNull();
  });

  it.each([false, true])('发送与停止按钮在暗色=%s 时使用实时强调色，禁用状态保留中性灰', async dark => {
    stubServices(); const root = document.documentElement;
    const previousDark = root.classList.contains('dark'), previousAccent = root.style.getPropertyValue('--nai-accent');
    root.classList.toggle('dark', dark); root.style.setProperty('--nai-accent', '#14b8a6');
    const style = document.createElement('style');
    style.textContent = `button:disabled { background-color: ${dark ? 'rgb(27, 32, 44)' : 'rgb(221, 225, 238)'}; }\n` + readFileSync('components/AgentSurface.css', 'utf8');
    document.head.append(style);
    let finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
    try {
      renderPanel(); const box = screen.getByRole('textbox', { name: '任务要求' });
      await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
      const send = screen.getByRole('button', { name: '执行' }) as HTMLButtonElement;
      expect(send.disabled).toBe(true); expect(getComputedStyle(send).backgroundColor).toBe(dark ? 'rgb(27, 32, 44)' : 'rgb(221, 225, 238)');
      fireEvent.change(box, { target: { value: '主题验证' } }); expect(send.disabled).toBe(false);
      // JSDOM 保留变量表达式；检查真实 CSS 引用，浏览器由根节点实时解析强调色。
      expect(getComputedStyle(send).backgroundColor).toBe('var(--nai-accent, #0ea5e9)');
      expect(send.className).not.toMatch(/(?:^|\s)(?:dark:)?(?:hover:)?(?:bg-gray-900|bg-gray-100|text-gray-900)(?:\s|$)/);
      root.style.setProperty('--nai-accent', '#e11d48'); expect(getComputedStyle(send).backgroundColor).toBe('var(--nai-accent, #0ea5e9)');
      fireEvent.click(send); await waitFor(() => expect(finish).toBeTypeOf('function'));
      const stop = screen.getByRole('button', { name: '停止' });
      expect(getComputedStyle(stop).backgroundColor).toBe('var(--nai-accent, #0ea5e9)'); expect(getComputedStyle(stop).color).toBe('var(--nai-on-accent, white)');
      expect(stop.className).not.toMatch(/bg-gray|text-gray/);
      await act(async () => { finish(); });
    } finally { await act(async () => { finish?.(); }); style.remove(); root.classList.toggle('dark', previousDark); if (previousAccent) root.style.setProperty('--nai-accent', previousAccent); else root.style.removeProperty('--nai-accent'); }
  });

  it('执行中没有排队入口，Enter 保留下一条草稿，结束后由用户手动发送', async () => {
    stubServices(); const control = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    let finish!: () => void;
    const run = vi.spyOn(promptAgentService, 'run').mockImplementationOnce(async (input, emit) => {
      await new Promise<void>(resolve => { finish = resolve; });
      emit({ type: 'done', status: 'completed', draft: input.draft, message: '完成', provider: 'deepseek', model: 'deepseek-chat' });
    }).mockResolvedValue(undefined);
    renderPanel(); const box = screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.change(box, { target: { value: '第一条' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.queryByLabelText('追加处理方式')).toBeNull(); expect(screen.queryByText('清空排队')).toBeNull();
    fireEvent.change(box, { target: { value: '第二条草稿' } }); fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('第二条草稿'); expect(control).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '追加要求' })).toBeNull(); expect(screen.queryByRole('button', { name: '执行' })).toBeNull();
    await act(async () => { finish(); });
    expect(box.value).toBe('第二条草稿'); expect(run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2)); expect(run.mock.calls[1][0].message).toBe('第二条草稿');
  });

  it('默认展开的思考及打开的工具回执跟随最新内容，最新过程展开后聊天也定位末尾', async () => {
    stubServices(); localStorage.setItem('nai_agent_display', JSON.stringify({ thinkingExpanded: true, toolsExpanded: true }));
    let emit!: Parameters<typeof promptAgentService.run>[1], finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { emit = onEvent; await new Promise<void>(resolve => { finish = resolve; }); });
    renderPanel(); const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '修改' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    act(() => { emit({ type: 'thinking_delta', delta: '开始思考' }); emit({ type: 'tool_start', toolCallId: 't', toolName: 'get_lab_state', args: {} }); });
    const thinking = screen.getByLabelText('思考输出'); const receipt = screen.getByLabelText('工具回执');
    const scroll = box.closest('main')!.querySelector('.space-y-6')!;
    for (const element of [thinking, receipt, scroll]) Object.defineProperties(element, { scrollHeight: { value: 1400, configurable: true }, clientHeight: { value: 200, configurable: true }, scrollTop: { value: 0, writable: true, configurable: true } });
    const details = receipt.closest('details')!; details.open = true; fireEvent(details, new Event('toggle'));
    expect(receipt.scrollTop).toBe(1400); expect(scroll.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1400 }));
    thinking.scrollTop = 0; receipt.scrollTop = 0;
    act(() => { emit({ type: 'thinking_delta', delta: '\n最新思考' }); emit({ type: 'tool_end', toolCallId: 't', toolName: 'get_lab_state', isError: false, result: { newest: '最新回执' } }); });
    expect(thinking.scrollTop).toBe(1400); expect(receipt.scrollTop).toBe(1400);
    await act(async () => { finish(); });
  });

  it('没有模型时直接提供 API 接入入口，并阻止发起模型任务', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getAvailableModels').mockResolvedValue([]);
    const run = vi.spyOn(promptAgentService, 'run'); const open = vi.fn();
    window.addEventListener('nai-open-global-settings', open);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '接入 API' }));
    expect(open.mock.calls[0][0].detail).toEqual({ section: 'agent' });
    expect((screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(run).not.toHaveBeenCalled(); window.removeEventListener('nai-open-global-settings', open);
  });
  it('页面读取栏跟随当前页面，移除恢复和撤销，回答用量常驻展开', async () => {
    stubServices();
    const workspace = document.createElement('main'); workspace.dataset.agentView = 'history'; document.body.append(workspace);
    workspace.innerHTML = '<button>打开作品</button>';
    const controlRect = vi.spyOn(workspace.querySelector('button')!, 'getBoundingClientRect');
    try {
      vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ role: 'agent', id: 'a', text: '收到', model: 'model', usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 } }]);
      renderPanel(true);
      expect(await screen.findByText(/已读取：生成历史/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '撤销修改' })).toBeNull();
      expect(screen.queryByText('上次完成的草稿已保留。')).toBeNull();
      expect((await screen.findByLabelText('回答用量')).closest('details')).toBeNull();
      workspace.dataset.agentView = 'characters'; fireEvent(window, new Event('nai-workspace-changed'));
      expect(screen.getByText(/已读取：角色库/)).toBeTruthy();
      expect(controlRect).not.toHaveBeenCalled();
    } finally { workspace.remove(); }
  });
  it.each([
    { receipt: { ok: false, success: false, partial: true, outcome: 'partial', completedCount: 2, failedCount: 1, resultId: 'directory-result' }, text: '该项目操作仅部分完成：已完成 2 项，失败 1 项。' },
    { receipt: { ok: false, success: false, outcome: 'failed', completedCount: 0, failedCount: 1, resultId: 'failed-result' }, text: '该项目操作未完成，请核对实际结果。' },
    { receipt: { ok: false, accepted: true, outcome: 'unconfirmed' }, text: '该项目操作未完成，请核对实际结果。' },
    { receipt: { ok: true, success: true, outcome: 'succeeded' }, text: '已在你确认后完成该项目操作。' },
  ])('项目确认accepted与真实业务回执分开，不因HTTP200报全部成功：$receipt.outcome', async ({ receipt, text }) => {
    stubServices();
    const control = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    const execute = vi.spyOn(promptAgentService, 'executeProjectAction').mockResolvedValue({ action: 'delete_directory', ...receipt });
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'action', action: { kind: 'request_project_action', patch: { action: 'delete_directory', requestId: 'directory-delete', title: '删除目录', consequence: '只删除目录关系' } } });
    });
    renderPanel();
    const box = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '删除指定目录' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
    await screen.findByText(text);
    expect(execute).toHaveBeenCalledOnce();
    expect(control).toHaveBeenCalledWith('session-1', 'confirm', 'directory-delete', { requestId: 'directory-delete', accepted: true });
    expect(control.mock.calls.some(call => call[1] === 'finalize')).toBe(false);
    if (!receipt.ok) expect(screen.queryByText('已在你确认后完成该项目操作。')).toBeNull();
  });

  it.each([true, false])('实际面板生成回调批准 %s 时发送正确确认与完成顺序', async accepted => {
    stubServices(); const controls: Array<{ action: string; accepted?: boolean; success?: boolean }> = [];
    vi.spyOn(promptAgentService, 'control').mockImplementation(async (_session, action, _message, payload) => { controls.push({ action, ...payload }); });
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'request-1' } } });
    });
    renderPanel(false, { onRequestGeneration: async (_draft: unknown, _reason: unknown, approve: () => Promise<void>) => { if (accepted) await approve(); return accepted; } });
    await waitFor(() => expect((screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole('textbox', { name: '任务要求' }), { target: { value: '生成一张' } });
    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(controls.length).toBe(accepted ? 2 : 1));
    expect(controls.map(value => value.action)).toEqual(accepted ? ['confirm', 'finalize'] : ['confirm']);
    expect(controls[0].accepted).toBe(accepted); if (accepted) expect(controls[1].success).toBe(true);
  });
  it('关闭自动应用时，完成后的修改进入审阅且图片展示偏好传到后端', async () => {
    stubServices(); localStorage.setItem('nai_agent_display', JSON.stringify({ autoApplyDraft: false, autoShowGenerated: false }));
    const apply = vi.fn();
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'action', action: { kind: 'update_prompts', patch: { basePrompt: 'new prompt' } } });
      onEvent({ type: 'done', draft: { ...input.draft, basePrompt: 'new prompt' }, message: '已准备', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(false, { onFinalDraft: apply });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '调整提示词' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ basePrompt: 'new prompt' }), true, undefined, expect.any(Function)));
    expect(run.mock.calls[0][0].context.clientSettings?.autoShowGenerated).toBe(false);
  });
  it('助手运行不读取或注入旧画师收藏名册，保留旧存储内容', async () => {
    stubServices();
    const legacy = JSON.stringify(['legacy_artist']);
    localStorage.setItem('nai_fav_artists', legacy);
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'done', draft: input.draft, message: '已读取', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel();
    const box = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '查看当前页面' } });
    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0].context.clientSettings).not.toHaveProperty('artistFavorites');
    expect(read.mock.calls.some(([key]) => key === 'nai_fav_artists')).toBe(false);
    expect(localStorage.getItem('nai_fav_artists')).toBe(legacy);
  });
  it('附件拒绝原因可见，格式错误不会消失在后台', async () => {
    stubServices({ imageInput: true }); renderPanel();
    const chooser = await screen.findByLabelText('选择图片附件');
    await waitFor(() => expect((chooser as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(chooser, { target: { files: [new File(['synthetic'], 'document.pdf', { type: 'application/pdf' })] } });
    expect((await screen.findByRole('alert')).textContent).toContain('document.pdf：仅支持');
  });
  it('生成完成回执包含准确历史 ID，后续保存不猜最新图片', async () => {
    stubServices(); const controls = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { onEvent({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'request-1' } } }); });
    renderPanel(false, { onRequestGeneration: async (_draft: unknown, _reason: unknown, approve: () => Promise<void>) => { await approve(); return { success: true, historySaved: true, historyId: 'actual-image-id' }; } });
    await waitFor(() => expect((screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole('textbox', { name: '任务要求' }), { target: { value: '生成后保存' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(controls).toHaveBeenCalledWith('session-1', 'finalize', 'request-1', expect.objectContaining({ success: true, result: expect.objectContaining({ success: true, historySaved: true, historyId: 'actual-image-id' }) })));
  });

  it('持续模型流切换模型后生成及最终应用调用最新编辑器回调', async () => {
    stubServices();
    const controls = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    let emit!: Parameters<typeof promptAgentService.run>[1], finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { emit = onEvent; await new Promise<void>(resolve => { finish = resolve; }); });
    const oldGenerate = vi.fn(), oldApply = vi.fn(), latestApply = vi.fn();
    const latestGenerate = vi.fn(async (_draft, _reason, approve) => { await approve(); return { success: true, historySaved: false }; });
    const view = renderPanel(false, { onRequestGeneration: oldGenerate, onFinalDraft: oldApply });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '改完后生成' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    const draft = { basePrompt: 'latest', subjectPrompt: '', negativePrompt: '', modules: [], params: { model: 'nai-diffusion-5-full' } as NAIParams };
    view.rerender(panelElement(false, { draft, onRequestGeneration: latestGenerate, onFinalDraft: latestApply }));
    act(() => { emit({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'latest' } }, draft }); });
    await waitFor(() => expect(controls).toHaveBeenCalledWith('session-1', 'finalize', 'latest', expect.objectContaining({ success: true })));
    expect(latestGenerate).toHaveBeenCalledWith(draft, undefined, expect.any(Function), undefined, undefined); expect(oldGenerate).not.toHaveBeenCalled();
    await act(async () => { emit({ type: 'done', draft, draftChanged: true, status: 'completed', message: '完成', provider: 'deepseek', model: 'deepseek-chat' }); finish(); });
    expect(latestApply).toHaveBeenCalledWith(draft, false, undefined, expect.any(Function)); expect(oldApply).not.toHaveBeenCalled();
  });

  it.each([false, true])('批准=%s 的实际生成失败将具体回执传给后端并显示原因', async approved => {
    stubServices(); const controls = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { onEvent({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'failed' } } }); });
    const receipt = { success: false, historySaved: false, outcome: approved ? 'failed' : 'blocked', code: approved ? 'generation_failed' : 'target_changed', error: approved ? '合成接口失败' : '合成目标已变化' };
    renderPanel(false, { onRequestGeneration: async (_draft: unknown, _reason: unknown, approve: () => Promise<void>) => { if (approved) await approve(); return receipt; } });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '生成' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await screen.findByText(receipt.error);
    expect(controls).toHaveBeenCalledWith('session-1', approved ? 'finalize' : 'confirm', 'failed', expect.objectContaining({ success: false, result: receipt }));
    expect(screen.queryByText(/用户取消/)).toBeNull();
  });
  it('确认期间更换 Key 以明确拦截回执结束，不批准原 Key 的生成请求', async () => {
    stubServices(); const controls = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
    let emit!: Parameters<typeof promptAgentService.run>[1], finish!: () => void, proceed!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => { emit = onEvent; await new Promise<void>(resolve => { finish = resolve; }); });
    const generate = vi.fn(async (_draft, _reason, approve) => { await new Promise<void>(resolve => { proceed = resolve; }); await approve(); return true; });
    const view = renderPanel(false, { apiKey: 'synthetic-key-a', onRequestGeneration: generate });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '生成' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    act(() => { emit({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'key-change' } } }); });
    await waitFor(() => expect(proceed).toBeTypeOf('function'));
    view.rerender(panelElement(false, { apiKey: 'synthetic-key-b', onRequestGeneration: generate }));
    await act(async () => { proceed(); });
    await waitFor(() => expect(controls).toHaveBeenCalledWith('session-1', 'confirm', 'key-change', expect.objectContaining({ accepted: false, success: false, result: expect.objectContaining({ outcome: 'blocked', code: 'key_changed' }) })));
    expect(controls.mock.calls.some(call => call[3]?.accepted === true)).toBe(false);
    await act(async () => { finish(); });
  });
  it('重新回答保留尚未发送的输入草稿', async () => {
    stubServices();
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'text_delta', delta: '合成回复' });
      onEvent({ type: 'done', draft: input.draft, message: '合成回复', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel();
    const box = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: 'first' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    const retry = await screen.findByRole('button', { name: '重新生成' });
    fireEvent.change(box, { target: { value: 'unsent next request' } }); fireEvent.click(retry);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1][0].mode).toBe('retry');
    expect((box as HTMLTextAreaElement).value).toBe('unsent next request');
  });
  it('聊天布局正文与气泡分离，工具失败在折叠摘要可见，纯聊天不提示恢复草稿', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'thinking_delta', delta: '合成思考内容' });
      onEvent({ type: 'tool_start', toolCallId: 't', toolName: 'get_local_time', args: {} });
      onEvent({ type: 'tool_end', toolCallId: 't', toolName: 'get_local_time', isError: true, result: { error: '合成错误' } });
      onEvent({ type: 'text_delta', delta: '简洁正文' });
      onEvent({ type: 'done', draft: input.draft, message: '简洁正文', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(); const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: '你好' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    const response = await screen.findByText('简洁正文');
    expect(response.closest('article')?.className).not.toContain('max-w-[88%]');
    expect(screen.getByText('你好').className).toContain('w-fit');
    expect(screen.getByLabelText('工具活动').textContent).toContain('有未完成项');
    expect((screen.getByLabelText('工具活动').closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText('上次完成的草稿已保留。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
    fireEvent.click(screen.getByRole('switch', { name: '默认展开工具' }));
    await waitFor(() => expect(screen.getByText('失败 · 查询本机时间与时区')).toBeTruthy());
  });
  it('长分析、标题及列表不因逗号多被套成提示词框，保留加粗、引用和链接', async () => {
    const explanation = '**数值权重 6** 会强调细节，皮肤纹理会更明显，布料也会更明显，头发也会被强调，多个概念还会共同影响画面，因此需要结合实际图片判断。'.repeat(2)
      + ' 例如 `realistic_skin`，可参考[官方文档](https://docs.novelai.net/)。';
    const answer = [`### ${explanation}`, explanation, `- ${explanation}`, `1. ${explanation}`].join('\n');
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ role: 'agent', id: 'format', text: answer }]);
    renderPanel();
    const article = (await screen.findAllByText('数值权重 6'))[0].closest('article')!;
    expect(article.querySelector('section')).toBeNull();
    expect(article.querySelectorAll('strong')).toHaveLength(8);
    expect(article.querySelectorAll('code')).toHaveLength(4);
    expect(within(article).getAllByRole('link', { name: '官方文档' })).toHaveLength(4);
    expect(article.textContent).not.toContain('**数值权重 6**');
    expect(article.textContent).toContain('•');
    expect(article.textContent).toContain('1.');
  });
  it.each([
    ['```prompt', '```', '提示词'],
    ['~~~PROMPT', '~~~', '提示词'],
    ['```', '```', '文本'],
    ['```text', '```', '文本'],
    ['```plaintext', '```', '文本'],
    ['```json', '```', '代码 · json'],
  ])('明确围栏 %s 的类型并原样复制，仅复制框内正文', async (opening, closing, title) => {
    const content = '6::realistic_skin, fine fabric, 发丝细节::\n  **保留原文**, {braces}, [brackets]';
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: copy } });
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ role: 'agent', id: 'format', text: `${opening}\n${content}\n${closing}\n**框外说明**` }]);
    renderPanel();
    const card = (await screen.findByText(title)).closest('section')!;
    expect(card.textContent).toContain(content);
    expect(card.querySelector('strong')).toBeNull();
    expect(screen.getByText('框外说明').tagName).toBe('STRONG');
    fireEvent.click(within(card).getByRole('button', { name: '复制' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(content));
    expect(copy).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card).getByRole('button', { name: '收起' }));
    expect(within(card).queryByRole('button', { name: '展开' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '展开' }));
    expect(card.textContent).toContain(content);
  });
  it('未闭合提示词围栏支持流式补全，闭合后分析恢复正文格式', async () => {
    stubServices();
    let emit!: Parameters<typeof promptAgentService.run>[1]; let finish!: () => void;
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      emit = onEvent; await new Promise<void>(resolve => { finish = resolve; });
      onEvent({ type: 'done', draft: input.draft, message: '```prompt\n1.2::artist:sample::, soft light\n```\n**解释在框外**', provider: 'synthetic', model: 'synthetic' });
    });
    renderPanel();
    const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: '合成格式检查' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    await act(async () => { emit({ type: 'text_delta', delta: '```prompt\n1.2::artist:sample::' }); });
    expect((await screen.findByText('提示词')).closest('section')?.textContent).toContain('1.2::artist:sample::');
    await act(async () => {
      emit({ type: 'text_delta', delta: ', soft light\n```\n**解释在框外**' });
      finish();
    });
    expect(screen.getByText('解释在框外').tagName).toBe('STRONG');
    const card = screen.getByText('提示词').closest('section')!;
    expect(card.textContent).toContain('1.2::artist:sample::, soft light');
    expect(card.textContent).not.toContain('解释在框外');
  });
  it('围栏示例里的较短或异类围栏不会提前结束外层文本框', async () => {
    const content = '```prompt\nsoft light\n```\n~~~';
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ role: 'agent', id: 'format', text: `\`\`\`\`text\n${content}\n\`\`\`\`\n**外层之后**` }]);
    renderPanel();
    const card = (await screen.findByText('文本')).closest('section')!;
    expect(card.textContent).toContain(content);
    expect(card.textContent).not.toContain('外层之后');
    expect(screen.getByText('外层之后').tagName).toBe('STRONG');
  });
  it('自动中止显示具体原因，不应用草稿也不补已完成文案', async () => {
    stubServices(); const apply = vi.fn(), interrupted = vi.fn();
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'action', action: { kind: 'update_prompts', patch: { basePrompt: '未完成草稿' } } });
      onEvent({ type: 'done', status: 'aborted', stopReason: 'turn_limit', error: '本次任务达到连续执行上限，可以继续。', draft: { ...input.draft, basePrompt: '未完成草稿' }, message: '', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(false, { onFinalDraft: apply, onGenerationInterrupted: interrupted });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '修改提示词' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByText('本次任务达到连续执行上限，可以继续。')).toBeTruthy();
    expect(apply).not.toHaveBeenCalled(); expect(screen.queryByText('已完成。')).toBeNull();
    expect(interrupted).toHaveBeenCalledOnce();
  });

  it('限额停止后提供「继续处理」，点击以 resume 模式接续；用户主动停止不提供', async () => {
    stubServices(); const inputs: Array<{ message: string; mode?: string }> = [];
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      inputs.push(input);
      const stopReason = inputs.length === 1 ? 'turn_limit' : 'user_stop';
      onEvent({ type: 'done', runId: 'run-' + inputs.length, status: 'aborted', stopReason, error: stopReason === 'turn_limit' ? '达到连续执行上限。' : '任务已停止。', draft: input.draft, message: '', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(false);
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '整理提示词' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续处理' }));
    await waitFor(() => expect(inputs.length).toBe(2));
    expect(inputs[1].mode).toBe('resume'); expect(inputs[1].message).toBe('继续处理');
    expect(await screen.findByText('任务已停止。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '继续处理' })).toBeNull();
  });

  it('实验室分类编辑状态随请求交给助手，整段编辑明确为关闭', async () => {
    stubServices();
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'done', draft: input.draft, message: '已读取', provider: 'deepseek', model: 'deepseek-chat' });
    });
    for (const promptClassificationEnabled of [true, false]) {
      const view = renderPanel(false, { promptClassificationEnabled });
      const box = screen.getByRole('textbox', { name: '任务要求' });
      await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
      fireEvent.change(box, { target: { value: '填写外貌栏' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
      await waitFor(() => expect(run.mock.calls.length).toBe(promptClassificationEnabled ? 1 : 2));
      expect(run.mock.calls.at(-1)![0].context.clientSettings?.promptClassificationEnabled).toBe(promptClassificationEnabled);
      view.unmount();
    }
  });

  it('回复被截断时仍应用草稿、不中断生成，并如实显示截断提示', async () => {
    stubServices(); const apply = vi.fn(), interrupted = vi.fn();
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'action', action: { kind: 'update_prompts', patch: { basePrompt: '已改草稿' } } });
      onEvent({ type: 'done', status: 'completed', stopReason: 'truncated', error: '这条回复达到模型输出上限被截断，内容可能不完整。', draftChanged: true, draft: { ...input.draft, basePrompt: '已改草稿' }, message: '半句回复', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(false, { onFinalDraft: apply, onGenerationInterrupted: interrupted });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '修改提示词' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByText('这条回复达到模型输出上限被截断，内容可能不完整。')).toBeTruthy();
    expect(apply).toHaveBeenCalledOnce(); expect(apply.mock.calls[0][0].basePrompt).toBe('已改草稿');
    expect(interrupted).not.toHaveBeenCalled();
  });

  it('重新打开会话仍显示停止原因，恢复草稿完成后进入正常应用', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ status: 'aborted', runId: 'stopped', error: '任务等待超时；工作草稿已保留。', stopReason: 'timeout' });
    const apply = vi.fn();
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'done', status: 'completed', draftChanged: true, draft: { ...input.draft, basePrompt: '恢复的草稿' }, message: '接续完成', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(false, { onFinalDraft: apply });
    expect(await screen.findByText('任务等待超时；工作草稿已保留。')).toBeTruthy();
    const box = screen.getByRole('textbox', { name: '任务要求' });
    fireEvent.change(box, { target: { value: '继续' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0][0].basePrompt).toBe('恢复的草稿');
  });

  it('点击继续发送 resume 与当前编辑、分类设置，保留尚未发送的输入', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ status: 'interrupted', runId: 'interrupted', error: '服务中断，草稿已保留。' });
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, emit) => {
      emit({ type: 'done', status: 'completed', draft: input.draft, message: '接续完成', provider: 'deepseek', model: 'deepseek-chat' });
    });
    const view = renderPanel(false, { promptClassificationEnabled: true });
    const resume = await screen.findByRole('button', { name: '继续处理' });
    const box = screen.getByRole('textbox', { name: '任务要求' });
    fireEvent.change(box, { target: { value: '尚未发送的下一条' } });
    const draft = { basePrompt: '新的人工内容', subjectPrompt: '', negativePrompt: '', modules: [], params: {} as NAIParams };
    view.rerender(panelElement(false, { draft, promptClassificationEnabled: true }));
    fireEvent.click(resume);
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0]).toMatchObject({ mode: 'resume', draft, images: [], context: { clientSettings: { promptClassificationEnabled: true } } });
    expect((box as HTMLTextAreaElement).value).toBe('尚未发送的下一条');
    await waitFor(() => expect(screen.queryByRole('button', { name: '继续处理' })).toBeNull());
  });

  it.each([
    { status: 'aborted' as const, stopReason: 'user_stop', error: '用户停止', resumable: false },
    { status: 'failed' as const, stopReason: 'authentication', error: '鉴权失败', resumable: false },
    { status: 'completed' as const, stopReason: 'stop', error: undefined, resumable: false },
    { status: 'completed' as const, stopReason: 'output_truncated', error: '回复被截断', resumable: true },
    { status: 'aborted' as const, stopReason: 'model_timeout', error: '模型超时', resumable: true },
  ])('终态 $stopReason 按真实原因提供继续入口', async ({ status, stopReason, error, resumable }) => {
    stubServices();
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, emit) => {
      emit({ type: 'done', status, stopReason, error, draft: input.draft, message: '本轮回复', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel();
    const box = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '处理当前任务' } });
    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    await waitFor(() => expect(Boolean(screen.queryByRole('button', { name: '继续处理' }))).toBe(resumable));
    if (status === 'completed' && !error) expect(screen.queryByText('任务没有完成，请查看工具回执。')).toBeNull();
    expect(run).toHaveBeenCalledOnce();
  });

  it('任务轮询结束后加载历史不会抹掉自动停止原因', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    let reads = 0;
    vi.spyOn(promptAgentService, 'getTask').mockImplementation(async () => ++reads <= 2 ? { status: 'running', runId: 'r' } : { status: 'aborted', runId: 'r', error: '自动执行达到上限，尚未完成。', stopReason: 'turn_limit' });
    renderPanel();
    expect(await screen.findByText('自动执行达到上限，尚未完成。', {}, { timeout: 3500 })).toBeTruthy();
    expect(screen.queryByText('已完成。')).toBeNull();
  });

  it('停止请求失败明确反馈，正在执行状态仍保留', async () => {
    stubServices(); vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({ status: 'running' });
    vi.spyOn(promptAgentService, 'control').mockRejectedValue(new Error('电脑连接中断，请重试停止'));
    renderPanel();
    const buttons = await screen.findAllByRole('button', { name: /停止/ }); fireEvent.click(buttons[0]);
    expect(await screen.findByText('电脑连接中断，请重试停止')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /停止/ }).length).toBeGreaterThan(0);
  });
  it('只有工具调用的模型回复仍可查看用量，不出现空复制操作', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'response_start', id: 'first' });
      onEvent({ type: 'response_end', model: 'deepseek-chat', provider: 'deepseek', stopReason: 'toolUse', timestamp: 1, usage: { input: 12000, output: 345, cacheRead: 0, cacheWrite: 0, totalTokens: 12345, cost: null } });
      onEvent({ type: 'tool_start', toolCallId: 't', toolName: 'get_local_time', args: {} });
      onEvent({ type: 'tool_end', toolCallId: 't', toolName: 'get_local_time', isError: false });
      onEvent({ type: 'response_start', id: 'second' });
      onEvent({ type: 'text_delta', delta: '最终简短回复' });
      onEvent({ type: 'response_end', model: 'deepseek-chat', provider: 'deepseek', stopReason: 'stop', timestamp: 2, usage: { input: 10, output: 11, cacheRead: 0, cacheWrite: 0, totalTokens: 21, cost: null } });
      onEvent({ type: 'done', draft: input.draft, message: '最终简短回复', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(); const input = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: '查时间' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await screen.findByText('最终简短回复');
    const usage = screen.getAllByLabelText('回答用量'); expect(usage.length).toBe(2);
    expect(usage[0].closest('article')?.textContent).toContain('12,345 tokens');
    expect(usage[0].closest('article')?.textContent).not.toContain('费用');
    expect(usage[0].closest('article')?.querySelector('button[aria-label="复制"]')).toBeNull();
  });

  it('其他操作窗口在前景时 Esc 保留后台 Agent 菜单状态', async () => {
    stubServices(); renderPanel(false);
    await screen.findByRole('heading', { name: '新对话' });
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }));
    const before = screen.getByRole('button', { name: '更多会话操作' }).parentElement!.textContent;
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.className = 'fixed z-[1250]';
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '更多会话操作' }).parentElement!.textContent).toBe(before);
    dialog.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '更多会话操作' }).parentElement!.textContent).not.toBe(before);
  });

  it('电脑停靠助手不是模态窗口：层级更低的其他窗口在前景时 Esc 与焦点循环归该窗口', async () => {
    vi.stubGlobal('innerWidth', 1280);
    const onClose = vi.fn();
    stubServices(); renderPanel(false, { onClose });
    await screen.findByRole('heading', { name: '新对话' });
    const panel = screen.getByRole('dialog', { name: '助手控制面板' });
    expect(panel.getAttribute('aria-modal')).toBeNull();
    // Roll 设置等窗口层级（1000）低于助手（1100），曾被助手抢走 Esc 与 Tab 圈禁。
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.className = 'fixed z-[1000]';
    document.body.appendChild(dialog);
    const { isTopmostModal } = await import('../../components/useModalA11y');
    expect(isTopmostModal(dialog)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    dialog.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('手机底部助手仍是模态窗口，会话列表打开时隐藏高度把手', async () => {
    vi.stubGlobal('innerWidth', 390);
    stubServices(); renderPanel(false);
    await screen.findByRole('heading', { name: '新对话' });
    expect(screen.getByRole('dialog', { name: '助手控制面板' }).getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: '调整助手高度' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    // 会话列表打开时隐藏高度把手，避免 44px 命中区盖住列表顶栏按钮。
    expect(screen.queryByRole('button', { name: '调整助手高度' })).toBeNull();
  });

  it('改名时 Esc 只取消改名，不连带关闭会话列表', async () => {
    vi.stubGlobal('innerWidth', 390);
    stubServices(); renderPanel(false);
    await screen.findByRole('heading', { name: '新对话' });
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    fireEvent.click(screen.getByRole('button', { name: '会话操作' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    const input = screen.getByDisplayValue('新对话');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByDisplayValue('新对话')).toBeNull();
    expect(screen.getByRole('complementary', { name: '助手会话历史' }).className).toContain('translate-x-0');
  });

  it('手机高度把手在系统接管手势（pointercancel）后卸载拖动监听，下一次触摸不再改尺寸', async () => {
    vi.stubGlobal('innerWidth', 390);
    stubServices(); renderPanel(false);
    await screen.findByRole('heading', { name: '新对话' });
    const panel = screen.getByRole('dialog', { name: '助手控制面板' });
    const before = panel.style.getPropertyValue('--agent-mobile-height');
    fireEvent.pointerDown(screen.getByRole('button', { name: '调整助手高度' }), { clientY: 600, pointerId: 1 });
    fireEvent(window, new Event('pointercancel'));
    fireEvent(window, Object.assign(new Event('pointermove'), { clientY: 100 }));
    expect(panel.style.getPropertyValue('--agent-mobile-height')).toBe(before);
  });

  it('顶栏保留会话操作，模型入口移到发送键旁且不再重复展示', async () => {
    stubServices();
    renderPanel(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    });

    const backBtn = screen.getByRole('button', { name: '返回' });
    const listBtn = screen.getByRole('button', { name: '会话列表' });
    const modelBtn = screen.getByRole('button', { name: '模型与思考设置' });
    const moreBtn = screen.getByRole('button', { name: '更多会话操作' });

    for (const btn of [backBtn, listBtn, moreBtn]) {
      expect(btn.className).toContain('h-9');
      expect(btn.className).toContain('w-9');
      expect(btn.className).not.toContain('px-2');
    }
    expect(modelBtn.closest('header')).toBeNull();
    expect(modelBtn.parentElement?.nextElementSibling).toBe(screen.getByRole('button', { name: '执行' }));
    expect(modelBtn.textContent).toContain('deepseek-chat');

    // 根本不需要 agent 全屏，全屏按钮已彻底移除
    expect(screen.queryByRole('button', { name: /全屏/ })).toBeNull();
  });

  it('当前模型失效时，发送区仍可选择可用模型恢复对话', async () => {
    stubServices({ model: 'unavailable-model' });
    const update = vi.spyOn(promptAgentService, 'updateSession').mockResolvedValue(mockSession);
    renderPanel();
    await waitFor(() => expect((screen.getByRole('button', { name: '模型与思考设置' }) as HTMLButtonElement).disabled).toBe(false));
    const trigger = screen.getByRole('button', { name: '模型与思考设置' });
    expect((screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(trigger); fireEvent.click(await screen.findByRole('button', { name: '选择模型：deepseek-chat' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement).disabled).toBe(false));
    expect(update).toHaveBeenCalledWith('session-1', { provider: 'deepseek', model: 'deepseek-chat' });
  });

  it('思考设置保存期间阻止按钮与 Enter 发送，保存后使用新设置继续对话', async () => {
    stubServices({ thinkingLevel: 'low' });
    vi.spyOn(promptAgentService, 'getAvailableModels').mockResolvedValue([
      { id: 'deepseek-chat', name: 'DeepSeek-V3', provider: 'deepseek', providerName: 'DeepSeek', reasoning: true, imageInput: false, contextWindow: 64000, maxTokens: 8192, thinkingLevels: ['off', 'low', 'high'] },
    ]);
    let saved!: (session: Awaited<ReturnType<typeof promptAgentService.updateSession>>) => void;
    const update = vi.spyOn(promptAgentService, 'updateSession').mockImplementation(() => new Promise(resolve => { saved = resolve; }));
    const run = vi.spyOn(promptAgentService, 'run').mockResolvedValue(undefined);
    renderPanel(); const box = screen.getByRole('textbox', { name: '任务要求' });
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '继续这个任务' } });
    fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }));
    const slider = screen.getByRole('slider', { name: '思考强度' });
    fireEvent.change(slider, { target: { value: '2' } }); fireEvent.pointerUp(slider);
    const send = screen.getByRole('button', { name: '执行' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); fireEvent.click(send); fireEvent.keyDown(box, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled(); expect((box as HTMLTextAreaElement).value).toBe('继续这个任务');
    await act(async () => { saved({ ...mockSession, thinkingLevel: 'high' }); });
    expect(update).toHaveBeenCalledWith('session-1', { thinkingLevel: 'high' });
    expect(send.disabled).toBe(false); expect(screen.getByRole('button', { name: '模型与思考设置' }).textContent).toContain('高');
    fireEvent.keyDown(box, { key: 'Enter' }); await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it('保留模型名称，移除独立视觉服务与注入选择', async () => {
    stubServices({
      model: 'deepseek-chat',
    });
    renderPanel(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    });

    expect(screen.queryByLabelText('选择本会话注入预设')).toBeNull();
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
    expect(screen.queryByText('普通')).toBeNull();

    expect(screen.queryByText(/视觉：|单独计费/)).toBeNull();
    expect(screen.queryByText(/识图/)).toBeNull();
  });

  it('旧会话带有注入标记时，聊天顶栏和会话列表均不再显示或选择注入', async () => {
    stubServices({ creativeMode: true, presetName: '内置默认', model: 'deepseek-chat' });
    renderPanel(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    });

    expect(screen.queryByLabelText('选择本会话注入预设')).toBeNull();
    expect(screen.queryByText('注入')).toBeNull();
    expect(screen.queryByLabelText('选择注入预设')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('creative-presets'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '会话列表' }));
    expect(await screen.findByText('就绪')).toBeTruthy();
    expect(screen.queryByText(/注入开|注入关|内置默认/)).toBeNull();
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
  });

it.each(['completed', 'aborted', 'failed'] as const)('面板关闭不停止已批准生成，后台 %s 事件按实际任务状态处理', async status => {
  stubServices();
  let emit!: Parameters<typeof promptAgentService.run>[1]; let finish!: () => void;
  vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
    emit = onEvent; await new Promise<void>(resolve => { finish = resolve; });
  });
  const stop = vi.fn(); const view = renderPanel(false, { onGenerationInterrupted: stop });
  const input = screen.getByRole('textbox', { name: '任务要求' });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(input, { target: { value: '合成后台任务' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
  await waitFor(() => expect(emit).toBeTypeOf('function'));
  view.rerender(panelElement(false, { open: false, onGenerationInterrupted: stop }));
  expect(stop).not.toHaveBeenCalled();
  await act(async () => {
    emit({ type: 'done', status, message: '', provider: 'synthetic', model: 'synthetic-model', draft: { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} as NAIParams } });
    finish();
  });
  expect(stop).toHaveBeenCalledTimes(status === 'completed' ? 0 : 1);
});

it('Agent 面板转交整轮张数并回传部分结果，不把停止误报成全成功', async () => {
  stubServices(); const controls = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
  vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
    onEvent({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'series', count: 3 } } });
  });
  const generate = vi.fn(async (_draft: unknown, _reason: unknown, approve: () => Promise<void>, count?: number) => {
    expect(count).toBe(3); await approve();
    return { success: false, historySaved: false, outcome: 'cancelled' as const, code: 'user_stopped', error: '已停止', requestedCount: 3, completedCount: 1, historyIds: ['actual-image'] };
  });
  renderPanel(false, { onRequestGeneration: generate });
  await waitFor(() => expect((screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('textbox', { name: '任务要求' }), { target: { value: '连续生成三张' } });
  fireEvent.click(screen.getByRole('button', { name: '执行' }));
  await waitFor(() => expect(controls).toHaveBeenCalledWith('session-1', 'finalize', 'series', expect.objectContaining({ success: false, result: expect.objectContaining({ requestedCount: 3, completedCount: 1, historyIds: ['actual-image'] }) })));
});

it('批准后切换编辑器，后台中断仍停止原生成并回传实际部分结果', async () => {
  stubServices(); const controls = vi.spyOn(promptAgentService, 'control').mockResolvedValue(undefined);
  let emit!: Parameters<typeof promptAgentService.run>[1]; let finish!: () => void; let generated!: () => void;
  vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
    emit = onEvent;
    onEvent({ type: 'action', action: { kind: 'request_generation', patch: { requestId: 'background-series', count: 2 } } });
    await new Promise<void>(resolve => { finish = resolve; });
  });
  const generate = vi.fn(async (_draft: unknown, _reason: unknown, approve: () => Promise<void>) => {
    await approve(); await new Promise<void>(resolve => { generated = resolve; });
    return { success: false, historySaved: false, outcome: 'cancelled' as const, requestedCount: 2, completedCount: 1, historyIds: ['actual-image'] };
  });
  const originalStop = vi.fn(), otherStop = vi.fn();
  const view = renderPanel(false, { onRequestGeneration: generate, onGenerationInterrupted: originalStop });
  const input = screen.getByRole('textbox', { name: '任务要求' });
  await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(input, { target: { value: '合成两张' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
  await waitFor(() => expect(generated).toBeTypeOf('function'));
  view.rerender(panelElement(false, { open: false, onRequestGeneration: generate, onGenerationInterrupted: otherStop }));
  expect(originalStop).not.toHaveBeenCalled();
  await act(async () => {
    emit({ type: 'done', status: 'aborted', message: '', provider: 'synthetic', model: 'synthetic-model', draft: { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: {} as NAIParams } });
    generated(); finish();
  });
  expect(originalStop).toHaveBeenCalledOnce(); expect(otherStop).not.toHaveBeenCalled();
  await waitFor(() => expect(controls).toHaveBeenCalledWith('session-1', 'finalize', 'background-series', expect.objectContaining({ success: false, result: expect.objectContaining({ completedCount: 1, historyIds: ['actual-image'] }) })));
});

});

describe('创作助手输入 @ 引用角色库角色', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    promptAgentCoordinator.selectSession(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    promptAgentCoordinator.selectSession(undefined);
    sessionStorage.clear(); localStorage.clear();
  });

  const openMention = async (value: string) => {
    const input = screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value } });
    input.setSelectionRange(value.length, value.length);
    fireEvent.select(input);
    return input;
  };

  it('自定义角色候选中选后插入名称，资料只随本轮任务发送并在发送后清除', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async () => {});
    renderPanel(false, { characters: [characterChain()] });
    const input = await openMention('请用 @芙');
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    const option = within(list).getByRole('option', { name: /@芙宁娜/ });
    expect(within(list).getByText('自定义')).toBeTruthy();
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    expect(input.value).toBe('请用 @芙宁娜 ');
    expect(screen.getByRole('button', { name: '移除引用角色 芙宁娜' })).toBeTruthy();
    fireEvent.change(input, { target: { value: '请用 @芙宁娜 画一张' } });
    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0].message).toBe('请用 @芙宁娜 画一张');
    expect(run.mock.calls[0][0].characterReferences).toEqual([expect.objectContaining({ source: 'custom', name: '芙宁娜', prompt: 'furina (genshin impact), blue eyes' })]);
    await waitFor(() => expect(screen.queryByRole('button', { name: '移除引用角色 芙宁娜' })).toBeNull());
  });

  it('@ 词库角色使用角色库补全并标注来源，Esc 只收起候选不关闭面板', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.mocked(searchCharacterDictionary).mockResolvedValueOnce([{ name: 'hu tao', chinese: '胡桃', postCount: 1234 }]);
    const close = vi.fn();
    renderPanel(false, { onClose: close });
    const input = await openMention('@胡');
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    await within(list).findByRole('option', { name: /@胡桃/ });
    expect(searchCharacterDictionary).toHaveBeenCalledWith('胡', 6);
    expect(within(list).getByText('角色库')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: '引用角色库角色' })).toBeNull();
    expect(input.value).toBe('@胡');
    expect(close).not.toHaveBeenCalled();
  });

  it('方向键移动和 Enter 选择，输入法组字中的 Enter 不误选也不发送', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const run = vi.spyOn(promptAgentService, 'run');
    renderPanel(false, { characters: [characterChain(), characterChain({ id: 'character-raiden', name: '雷电将军', basePrompt: 'raiden shogun', updatedAt: 2 })] });
    const input = await openMention('@');
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    expect(within(list).getAllByRole('option').map(item => item.textContent)).toEqual([expect.stringContaining('雷电将军'), expect.stringContaining('芙宁娜')]);
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(input.value).toBe('@');
    expect(run).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('@芙宁娜 ');
  });

  it('从正文删除 @名称 时同步移除引用标签', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    renderPanel(false, { characters: [characterChain()] });
    const input = await openMention('@芙');
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    fireEvent.click(await within(list).findByRole('option', { name: /@芙宁娜/ }));
    expect(screen.getByRole('button', { name: '移除引用角色 芙宁娜' })).toBeTruthy();
    fireEvent.change(input, { target: { value: '不要了' } });
    expect(screen.queryByRole('button', { name: '移除引用角色 芙宁娜' })).toBeNull();
  });

  it('历史消息显示引用标签，编辑重发时恢复引用并随消息保存', async () => {
    stubServices();
    const history = [
      { id: 'saved-0', role: 'user' as const, text: '@芙宁娜 画一张', characterReferences: [{ source: 'custom' as const, name: '芙宁娜', prompt: 'furina' }] },
      { id: 'saved-1', role: 'agent' as const, text: '好的' },
    ];
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue(history);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const revise = vi.spyOn(promptAgentService, 'reviseMessage').mockResolvedValue(history);
    const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async () => {});
    renderPanel(false, { characters: [characterChain()] });
    await screen.findByText('好的');
    expect(screen.getByText('@芙宁娜')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑重发' }));
    const input = screen.getByRole('textbox', { name: '任务要求' });
    expect(input).toHaveProperty('value', '@芙宁娜 画一张');
    expect(screen.getByRole('button', { name: '移除引用角色 芙宁娜' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新发送' }));
    await waitFor(() => expect(revise).toHaveBeenCalledWith('session-1', 'saved-0', '@芙宁娜 画一张', [expect.objectContaining({ name: '芙宁娜' })]));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
  });

  it('英文无空格输入也能联想词库角色（hutao → hu tao）', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    vi.mocked(searchCharacterDictionary).mockResolvedValueOnce([]);
    vi.mocked(getCharacterDictionaryEntries).mockResolvedValueOnce([{ name: 'hu tao', chinese: '胡桃', postCount: 100 }]);
    renderPanel();
    const input = await openMention('@hutao');
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    const option = await within(list).findByRole('option', { name: /@胡桃/ });
    fireEvent.click(option);
    expect(input.value).toBe('@胡桃 ');
  });
});

describe('创作助手引用角色数量上限', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    promptAgentCoordinator.selectSession(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    promptAgentCoordinator.selectSession(undefined);
    sessionStorage.clear(); localStorage.clear();
  });

  const openMention = async (value: string) => {
    const input = screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value } });
    input.setSelectionRange(value.length, value.length);
    fireEvent.select(input);
    return input;
  };

  it('引用数量跟随当前模型上限，超过上限不再新增并提示', async () => {
  stubServices();
  vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
  vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
  const characters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((letter, index) => characterChain({ id: `character-${letter}`, name: `角色${letter}`, basePrompt: `character ${letter}`, updatedAt: index + 1 }));
  renderPanel(false, { characters });
  const input = await openMention('@');
  const choose = async (name: string) => {
    const base = input.value === '@' ? '' : input.value;
    const nextValue = `${base}@${name}`;
    fireEvent.change(input, { target: { value: nextValue } });
    input.setSelectionRange(nextValue.length, nextValue.length);
    fireEvent.select(input);
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    const option = await within(list).findByRole('option', { name: new RegExp(`@${name}`) });
    fireEvent.click(option);
    await new Promise(resolve => setTimeout(resolve, 20));
  };
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) await choose(`角色${letter}`);
  expect(screen.getAllByRole('button', { name: /移除引用角色/ })).toHaveLength(6);
  await choose('角色G');
  expect(screen.getAllByRole('button', { name: /移除引用角色/ })).toHaveLength(6);
  expect((await screen.findByRole('alert')).textContent).toBe('当前模型最多引用 6 个角色');
  });
});

describe('创作助手引用上限跟随模型', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    promptAgentCoordinator.selectSession(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    promptAgentCoordinator.selectSession(undefined);
    sessionStorage.clear(); localStorage.clear();
  });

  const openMention = async (value: string) => {
    const input = screen.getByRole('textbox', { name: '任务要求' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value } });
    input.setSelectionRange(value.length, value.length);
    fireEvent.select(input);
    return input;
  };

  it('引用上限跟随草稿模型：V5 允许更多角色', async () => {
    stubServices();
    vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([]);
    vi.spyOn(promptAgentService, 'getTask').mockResolvedValue({});
    const draft = { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { model: 'nai-diffusion-5-full', steps: 28, scale: 5, width: 832, height: 1216, sampler: 'k_euler', seed: 0 } as unknown as NAIParams };
    renderPanel(false, { draft });
    await openMention('@');
    const list = await screen.findByRole('listbox', { name: '引用角色库角色' });
    expect(within(list).getByText('角色库 · 最多引用 32 个')).toBeTruthy();
  });
});
