// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PromptAgentPanel } from './PromptAgentPanel';
import { ConfirmDialogProvider } from './ConfirmDialog';
import { NAIParams } from '../types';
import { promptAgentService } from '../services/promptAgent';

vi.mock('./MobileUI', () => ({
  useMobileHistoryLayer: (_open: boolean, onClose: () => void) => onClose,
}));

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

const stubServices = (sessionOverrides: { imageInput?: boolean; [key: string]: unknown } = {}) => {
  const currentSession = { ...mockSession, ...sessionOverrides };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/prompt-agent/sessions') && !url.includes('audit-log')) {
      return responseFor({ items: [currentSession] });
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
};

const panelElement = (canUndo = false, overrides = {}) => {
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
        onUndo: () => {},
        canUndo,
        tagAssistEnabled: true,
        ...overrides,
      })
    )
  );
};
const renderPanel = (canUndo = false, overrides = {}) => render(panelElement(canUndo, overrides));

describe('PromptAgentPanel 顶栏前端布局规范', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
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
    try {
      vi.spyOn(promptAgentService, 'getSession').mockResolvedValue([{ role: 'agent', id: 'a', text: '收到', model: 'model', usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 } }]);
      renderPanel(true);
      expect(await screen.findByText(/已读取：生成历史/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '撤销修改' })).toBeNull();
      expect(screen.queryByText('上次完成的草稿已保留。')).toBeNull();
      expect((await screen.findByLabelText('回答用量')).closest('details')).toBeNull();
      workspace.dataset.agentView = 'characters'; fireEvent(window, new Event('nai-workspace-changed'));
      expect(screen.getByText(/已读取：角色库/)).toBeTruthy();
    } finally { workspace.remove(); }
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
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ basePrompt: 'new prompt' }), true));
    expect(run.mock.calls[0][0].context.clientSettings?.autoShowGenerated).toBe(false);
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
    expect(latestGenerate).toHaveBeenCalledWith(draft, undefined, expect.any(Function)); expect(oldGenerate).not.toHaveBeenCalled();
    await act(async () => { emit({ type: 'done', draft, draftChanged: true, status: 'completed', message: '完成', provider: 'deepseek', model: 'deepseek-chat' }); finish(); });
    expect(latestApply).toHaveBeenCalledWith(draft, false); expect(oldApply).not.toHaveBeenCalled();
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
  it('自动中止显示具体原因，不应用草稿也不补已完成文案', async () => {
    stubServices(); const apply = vi.fn();
    vi.spyOn(promptAgentService, 'run').mockImplementation(async (input, onEvent) => {
      onEvent({ type: 'action', action: { kind: 'update_prompts', patch: { basePrompt: '未完成草稿' } } });
      onEvent({ type: 'done', status: 'aborted', stopReason: 'turn_limit', error: '本次任务达到连续执行上限，可以继续。', draft: { ...input.draft, basePrompt: '未完成草稿' }, message: '', provider: 'deepseek', model: 'deepseek-chat' });
    });
    renderPanel(false, { onFinalDraft: apply });
    const box = screen.getByRole('textbox', { name: '任务要求' }); await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: '修改提示词' } }); fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByText('本次任务达到连续执行上限，可以继续。')).toBeTruthy();
    expect(apply).not.toHaveBeenCalled(); expect(screen.queryByText('已完成。')).toBeNull();
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
});
