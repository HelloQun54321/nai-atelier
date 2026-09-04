// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptAgentCreativePreset, PromptAgentInjectionItem } from '../services/promptAgent';
import { ConfirmDialogProvider } from './ConfirmDialog';
import { PromptAgentSettings, fillMissingSlots, formatPresetSessionLabel, makeEmptySlot } from './PromptAgentSettings';

/** 破限提示词与预设实验室 UI 行为测试（渲染 + fetch-stub）。 */

vi.mock('./MobileUI', () => ({
  useMobileHistoryLayer: (_open: boolean, onClose: () => void) => onClose,
}));

const responseFor = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => '',
}) as Response;

const makeItem = (overrides: Partial<PromptAgentInjectionItem>): PromptAgentInjectionItem => ({
  id: '', name: '', target: 'system_head', enabled: true, content: '', ...overrides,
});

const builtinPreset: PromptAgentCreativePreset = {
  id: 'builtin-1', name: '内置默认', description: '系统内置', isBuiltin: true, createdAt: 1, updatedAt: 1,
  slots: [
    makeItem({ id: 'b1', target: 'system_head', content: '内置头部正文' }),
    makeItem({ id: 'b2', target: 'conversation_tail', role: 'user', content: '内置尾部正文' }),
    makeItem({ id: 'b3', target: 'context_depth', content: '深度策略正文', depth: 3 }),
  ],
};

const customPreset: PromptAgentCreativePreset = {
  id: 'custom-1', name: '我的预设', description: '演示', isBuiltin: false, createdAt: 2, updatedAt: 2,
  slots: [makeItem({ id: 'c1', target: 'user_preamble', content: '前导正文' })],
};

const SettingsHarness = () => React.createElement(
  ConfirmDialogProvider, null,
  React.createElement(PromptAgentSettings, { notify: () => {} }),
);

const stubConfig = () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/creative-presets')) {
      return responseFor({ items: [builtinPreset, customPreset], activeCreativePresetId: 'custom-1', warnings: [] });
    }
    if (url.includes('/config')) return responseFor({ provider: '', model: '', imageInput: false, visionProvider: '', visionModel: '', visionAvailable: false, visionDedicated: false, visionMode: 'auto', configured: false, configuredProviders: [], policyVersion: '', policyFingerprint: '', creativeMode: false, runtimeStartedAt: 0 });
    if (url.includes('/providers')) return responseFor({ items: [] });
    if (url.includes('/custom-providers')) return responseFor({ items: [] });
    if (url.includes('/available-models')) return responseFor({ items: [] });
    return responseFor({});
  }));
};

const openLab = async () => {
  stubConfig();
  render(React.createElement(SettingsHarness));
  fireEvent.click(await screen.findByRole('button', { name: /破限预设实验室/ }));
  await screen.findByRole('dialog', { name: /破限提示词与预设实验室/ });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CreativeLab UI', () => {
  it('渲染 9 个固定槽位标签（含 textarea）并默认选中 active 预设', async () => {
    await openLab();
    // 9 个 target 的 section 标签都应出现（每个 label 可能同时出现于 <b> 与 <label>）
    const labelExpect = ['系统提示词（头部）', '系统提示词（中段）', '系统提示词（尾部）', '上下文头部消息', '上下文窗口深度', '用户消息前导', '用户消息尾部', '会话尾部拦截', 'Assistant 预填'];
    for (const label of labelExpect) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // 自定义预设的 textarea（用户消息前导）与补齐缺失槽位的空正文框（assistant_prefill）
    expect(await screen.findByDisplayValue('前导正文')).toBeTruthy();
    expect(screen.getByLabelText('Assistant 预填 正文')).toBeTruthy();
  });

  it('内置预设只读展示正文，修改入口为复制为自定义', async () => {
    await openLab();
    // 切到内置预设
    fireEvent.click(screen.getByRole('button', { name: /内置默认/ }));
    expect(await screen.findByDisplayValue('内置头部正文')).toBeTruthy();
    expect(screen.getByDisplayValue('内置尾部正文')).toBeTruthy();
    const readOnly = screen.getAllByLabelText(/（只读）/);
    expect(readOnly.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /复制为自定义以编辑/ })).toBeTruthy();
    // builtin 行没有删除按钮（只读）
    expect(screen.queryByRole('button', { name: '删除预设 内置默认' })).toBeNull();
  });

  it('提供导入 JSON 与导出当前/导出全部入口', async () => {
    await openLab();
    expect(screen.getByRole('button', { name: /导入预设 JSON/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /导出全部预设/ })).toBeTruthy();
    // 选中自定义预设后出现导出当前（点行内标题文本）
    fireEvent.click(screen.getByText('我的预设'));
    expect(await screen.findByRole('button', { name: /导出当前预设/ })).toBeTruthy();
  });

  it('导入文件触发 importCreativePresets 并 reload', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/creative-presets') && init?.method === 'POST') return responseFor({ ok: true, imported: 1, skipped: [], activeCreativePresetId: 'custom-1' });
      if (url.includes('/creative-presets')) return responseFor({ items: [builtinPreset, customPreset], activeCreativePresetId: 'custom-1', warnings: [] });
      if (url.includes('/config')) return responseFor({ provider: '', model: '', imageInput: false, visionProvider: '', visionModel: '', visionAvailable: false, visionDedicated: false, visionMode: 'auto', configured: false, configuredProviders: [], policyVersion: '', policyFingerprint: '', creativeMode: false, runtimeStartedAt: 0 });
      if (url.includes('/providers')) return responseFor({ items: [] });
      if (url.includes('/custom-providers')) return responseFor({ items: [] });
      if (url.includes('/available-models')) return responseFor({ items: [] });
      return responseFor({});
    });
    vi.stubGlobal('fetch', fetcher);
    render(React.createElement(SettingsHarness));
    fireEvent.click(await screen.findByRole('button', { name: /破限预设实验室/ }));
    await screen.findByRole('dialog', { name: /破限提示词与预设实验室/ });

    const file = new File([JSON.stringify({ schema: 'creative-presets', version: 1, presets: [customPreset] })], 'presets.json', { type: 'application/json' });
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    expect(input).not.toBeNull();
    Object.defineProperty(input!, 'files', { value: [file] });
    fireEvent.change(input!);
    await waitFor(() => {
      const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(posts.length).toBeGreaterThan(0);
      expect(String(posts[0][0])).toBe('/api/prompt-agent/creative-presets/import');
    });
  });

  it('Inspector 面板含可编辑模拟用户消息与非 wire 说明，可展开正文', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/creative-presets/inspect')) return responseFor({
        ok: true,
        systemPrompt: '拼装后的系统提示词',
        canonicalMessages: [{ role: 'user', content: '模拟消息' }, { role: 'assistant', content: '规范化回复' }],
        sourceSegments: [{ label: 'context_head', target: 'context_head', presetName: '我的预设', characterCount: 4 }],
        tokenEstimate: { policyTokens: 1, draftTokens: 2, historyTokens: 3, presetTokens: 4, totalTokens: 10, contextWindow: 128000, contextDepth: 2, projectedBuffer: 100 },
        warnings: [],
        hashes: { presetRevisionHash: 'abc123' },
      });
      if (url.includes('/creative-presets')) return responseFor({ items: [customPreset], activeCreativePresetId: 'custom-1', warnings: [] });
      if (url.includes('/config')) return responseFor({ provider: '', model: '', imageInput: false, visionProvider: '', visionModel: '', visionAvailable: false, visionDedicated: false, visionMode: 'auto', configured: false, configuredProviders: [], policyVersion: '', policyFingerprint: '', creativeMode: false, runtimeStartedAt: 0 });
      if (url.includes('/providers')) return responseFor({ items: [] });
      if (url.includes('/custom-providers')) return responseFor({ items: [] });
      if (url.includes('/available-models')) return responseFor({ items: [] });
      return responseFor({});
    });
    vi.stubGlobal('fetch', fetcher);
    render(React.createElement(SettingsHarness));
    fireEvent.click(await screen.findByRole('button', { name: /破限预设实验室/ }));
    await screen.findByRole('dialog', { name: /破限提示词与预设实验室/ });
    fireEvent.click(await screen.findByRole('button', { name: /规范化上下文估算/ }));
    expect(await screen.findByText(/Pi 规范化上下文估算（非供应商 wire payload）/)).toBeTruthy();
    const textarea = screen.getByLabelText('模拟用户消息');
    fireEvent.change(textarea, { target: { value: '你好，测试消息' } });
    fireEvent.click(screen.getByRole('button', { name: /发送并估算/ }));
    expect(await screen.findByText(/拼装后的系统提示词/)).toBeTruthy();
    // 展开 canonicalMessages：summary 与正文标题都含“规范化消息”，取 summary 点击
    const canonicalSummary = screen.getAllByText(/规范化消息/)[0];
    fireEvent.click(canonicalSummary);
    expect(await screen.findByText(/模拟消息/)).toBeTruthy();
  });
});

describe('formatPresetSessionLabel（Panel 预设只读展示）', () => {
  it('存在 presetName 时返回 名称 + 短指纹（优先 effectivePolicyFingerprint）', () => {
    expect(formatPresetSessionLabel({ presetName: '我的破限', effectivePolicyFingerprint: 'abcdef123456', presetRevisionHash: 'zzz' })).toBe('我的破限 · abcdef1');
    expect(formatPresetSessionLabel({ presetName: '无指纹预设' })).toBe('无指纹预设');
    expect(formatPresetSessionLabel({ presetName: '我的破限', presetRevisionHash: 'revision-hash-xx' })).toBe('我的破限 · revisio');
  });

  it('无 presetName 时返回 null（不拉正文、不显示空 chip）', () => {
    expect(formatPresetSessionLabel({})).toBeNull();
    expect(formatPresetSessionLabel({ presetName: '' })).toBeNull();
    expect(formatPresetSessionLabel({ effectivePolicyFingerprint: 'abc' })).toBeNull();
  });
});

describe('fillMissingSlots（自定义预设恒渲染 9 槽框）', () => {
  it('缺失槽位补齐为可编辑空槽，context_head 不强制补条目（由成对区域管理）', () => {
    const source: PromptAgentInjectionItem[] = [makeItem({ id: 'x1', target: 'system_head', content: '头部' })];
    const filled = fillMissingSlots(source);
    const targets = new Set(filled.map(item => item.target));
    // 8 个 text/number 槽位必须出现；context_head 由成对区渲染，不在此强制
    for (const target of ['system_head', 'system_middle', 'system_tail', 'context_depth', 'user_preamble', 'user_suffix', 'conversation_tail', 'assistant_prefill'] as const) {
      expect(targets.has(target)).toBe(true);
    }
    expect(filled.find(item => item.target === 'context_depth')?.depth).toBe(1);
    expect(filled.every(item => item.content !== undefined)).toBe(true);
  });

  it('makeEmptySlot 生成的临时 id 稳定唯一（新预设/补齐均不共用空 id）', () => {
    const a = makeEmptySlot('system_head');
    const b = makeEmptySlot('system_tail');
    expect(a.id).not.toBe('');
    expect(a.id).not.toBe(b.id);
    // fillMissingSlots 补齐多个槽位时 id 全唯一（crypto.randomUUID 优先）
    const source = [makeItem({ id: 'keep-1', target: 'system_head', content: 'x' })];
    const filled = fillMissingSlots(source);
    const ids = filled.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(filled.find(item => item.id === 'keep-1')).toBeTruthy();
    // 空预设（全部槽位缺失）同样全唯一
    const blank = fillMissingSlots([]);
    expect(new Set(blank.map(item => item.id)).size).toBe(blank.length);
    expect(blank.every(item => item.id !== '')).toBe(true);
  });
});

describe('每 target 都有可见正文输入框（不只数 textarea）', () => {
  it('自定义预设：9 个 target 均有对应正文可编辑框（context_depth 含正文 + depth）', async () => {
    await openLab();
    // 默认选中 customPreset（仅含 user_preamble）
    // 每个非 list target 都应有正文 box（含补齐的空槽）
    const bodyLabels: Array<{ label: string; ariaLabel: string }> = [
      { label: '系统提示词（头部）', ariaLabel: '系统提示词（头部） 正文' },
      { label: '系统提示词（中段）', ariaLabel: '系统提示词（中段） 正文' },
      { label: '系统提示词（尾部）', ariaLabel: '系统提示词（尾部） 正文' },
      { label: '上下文窗口深度', ariaLabel: '上下文窗口深度 正文' },
      { label: '用户消息前导', ariaLabel: '用户消息前导 正文' },
      { label: '用户消息尾部', ariaLabel: '用户消息尾部 正文' },
      { label: '会话尾部拦截', ariaLabel: '会话尾部拦截 正文' },
      { label: 'Assistant 预填', ariaLabel: 'Assistant 预填 正文' },
    ];
    for (const { ariaLabel } of bodyLabels) {
      const textarea = screen.getByLabelText(ariaLabel);
      expect(textarea).toBeTruthy();
      expect(textarea.tagName).toBe('TEXTAREA');
      // 输入可编辑（disabled 仅 busy）
      fireEvent.change(textarea, { target: { value: `${ariaLabel}-内容` } });
      expect((screen.getByLabelText(ariaLabel) as HTMLTextAreaElement).value).toBe(`${ariaLabel}-内容`);
    }
    // context_depth 另有数字输入（按 label 文本精确定位到 number input）
    const depthInput = document.querySelector<HTMLInputElement>('input[type=number][min="1"]');
    expect(depthInput).not.toBeNull();
    expect(depthInput!.value).toBe('1');
  });

  it('context_head 为空时也渲染至少一对 user/assistant 空正文框', async () => {
    await openLab();
    // customPreset 无 context_head → 应展示 1 user + 1 assistant 空框
    const userHead = screen.getByLabelText('上下文头部消息 user 正文');
    const assistantHead = screen.getByLabelText('上下文头部消息 assistant 正文');
    expect(userHead.tagName).toBe('TEXTAREA');
    expect(assistantHead.tagName).toBe('TEXTAREA');
    expect((userHead as HTMLTextAreaElement).value).toBe('');
    expect((assistantHead as HTMLTextAreaElement).value).toBe('');
  });

  it('内置预设 context_depth 带正文时只读展示正文', async () => {
    await openLab();
    fireEvent.click(screen.getByRole('button', { name: /内置默认/ }));
    await screen.findByDisplayValue('内置头部正文');
    // context_depth 提供正文 → 只读 textarea 展示正文
    const depthBody = screen.getByLabelText('上下文窗口深度（只读）');
    expect(depthBody.tagName).toBe('TEXTAREA');
    expect((depthBody as HTMLTextAreaElement).readOnly).toBe(true);
    expect((depthBody as HTMLTextAreaElement).value).toBe('深度策略正文');
  });
});
