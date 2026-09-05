// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptAgentPanel } from './PromptAgentPanel';
import { ConfirmDialogProvider } from './ConfirmDialog';
import { NAIParams } from '../types';

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
  messages: [],
  messageCount: 0,
  creativeMode: false,
  creativeModeLocked: false,
  running: false,
  createdAt: 1000,
  updatedAt: 1000,
};

const stubServices = (sessionOverrides = {}) => {
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
        visionProvider: '',
        visionModel: '',
        visionAvailable: false,
        visionDedicated: false,
        visionMode: 'auto',
        configured: true,
        configuredProviders: ['deepseek'],
        policyVersion: '1.0',
        policyFingerprint: 'fp123',
        creativeMode: false,
        runtimeStartedAt: 1000,
      });
    }
    if (url.includes('/api/prompt-agent/creative-presets')) {
      return responseFor({
        items: [
          { id: 'builtin-1', name: '内置默认', description: '系统内置', isBuiltin: true, createdAt: 1, updatedAt: 1, slots: [] },
        ],
        activeCreativePresetId: 'builtin-1',
        warnings: [],
      });
    }
    if (url.includes('/api/prompt-agent/available-models')) {
      return responseFor({
        items: [
          { id: 'deepseek-chat', name: 'DeepSeek-V3', provider: 'deepseek', providerName: 'DeepSeek', reasoning: false, imageInput: false, contextWindow: 64000, thinkingLevels: ['off'] },
        ],
      });
    }
    return responseFor({});
  }));
};

const renderPanel = (canUndo = false) => {
  return render(
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
      })
    )
  );
};

describe('PromptAgentPanel 顶栏前端布局规范', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('顶栏纯图标按钮（返回、会话列表、模型设置、更多）具有统一的 h-9 w-9 尺寸规范，且彻底移除全屏按钮', async () => {
    stubServices();
    renderPanel(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    });

    const backBtn = screen.getByRole('button', { name: '返回' });
    const listBtn = screen.getByRole('button', { name: '会话列表' });
    const modelBtn = screen.getByRole('button', { name: '模型与思考设置' });
    const moreBtn = screen.getByRole('button', { name: '更多会话操作' });

    for (const btn of [backBtn, listBtn, modelBtn, moreBtn]) {
      expect(btn.className).toContain('h-9');
      expect(btn.className).toContain('w-9');
      expect(btn.className).not.toContain('px-2');
    }

    // 根本不需要 agent 全屏，全屏按钮已彻底移除
    expect(screen.queryByRole('button', { name: /全屏/ })).toBeNull();
  });

  it('顶栏副行移除外置的破限选择下拉框与视觉搭配模型展示，模型名称完整舒展展示', async () => {
    stubServices({
      creativeMode: false,
      model: 'deepseek-chat',
      visionDedicated: true,
      visionModel: 'grok-4.6-vision',
      visionAvailable: true,
    });
    renderPanel(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    });

    expect(screen.queryByLabelText('选择本会话破限预设')).toBeNull();
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
    expect(screen.queryByText('普通')).toBeNull();

    // 不把视觉搭配模型显示在副行中，避免造成拥挤
    expect(screen.queryByText(/grok-4.6-vision/)).toBeNull();
    expect(screen.queryByText(/视觉/)).toBeNull();
    expect(screen.queryByText(/识图/)).toBeNull();
  });

  it('当开启破限时，顶栏副行仅以紧凑只读角标提示破限状态，不挤压模型名', async () => {
    stubServices({ creativeMode: true, presetName: '内置默认', model: 'deepseek-chat' });
    renderPanel(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新对话' })).toBeTruthy();
    });

    expect(screen.queryByLabelText('选择本会话破限预设')).toBeNull();
    const badge = screen.getByText('破限');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('shrink-0');
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
  });
});
