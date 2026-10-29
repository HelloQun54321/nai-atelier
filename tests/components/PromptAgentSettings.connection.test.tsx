// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomProviderForm } from '../../components/PromptAgentSettings';
import { mergePromptAgentModelCapabilities, previewPromptAgentEndpoint, type PromptAgentCustomModel, type PromptAgentCustomProvider } from '../../services/promptAgent';
import { AGENT_PROVIDER_PRESETS } from '../../services/agentProviders';

afterEach(cleanup);
it('新连接只外露地址和 Key，名称与协议折叠，没有供应商选择或付费自动调用', () => {
  const fetch = vi.fn(), test = vi.fn();
  const Controlled = () => { const [value, setValue] = useState<PromptAgentCustomProvider>({ name: '', baseUrl: '', api: 'openai-completions', models: [], select: true }); return <CustomProviderForm value={value} onChange={setValue} busy={false} onTest={test} onFetch={fetch} onSave={() => {}} />; };
  render(<Controlled />);
  const advanced = screen.getByText('高级设置').closest('details'); expect(advanced?.open).toBe(false);
  expect(screen.getByLabelText('接口协议').closest('details')).toBe(advanced);
  expect(screen.queryByText('常用服务商登录')).toBeNull(); expect(screen.queryByText('DeepSeek')).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), { target: { value: 'https://test.example/v1' } });
  fireEvent.click(screen.getByText('获取模型')); expect(fetch).toHaveBeenCalledOnce(); expect(test).not.toHaveBeenCalled();
  expect((screen.getByText('保存连接') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('手动添加')); fireEvent.change(screen.getByPlaceholderText('手动输入模型 ID'), { target: { value: 'new-model' } });
  expect((screen.getByText('保存连接') as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByLabelText('图片输入能力 new-model') as HTMLSelectElement).value).toBe('unknown');
});
it('刷新窗口与输出上限跟随接口，人工设置及无声明的兼容默认不会覆盖原值', () => {
  const current: PromptAgentCustomModel = { ...exactModel, contextWindowSource: 'metadata', maxTokensSource: 'manual' };
  const found: PromptAgentCustomModel = { ...exactModel, contextWindow: 1048576, maxTokens: 393216, contextWindowSource: 'metadata', maxTokensSource: 'metadata' };
  const updated = mergePromptAgentModelCapabilities(current, found);
  expect(updated.contextWindow).toBe(1048576); expect(updated.maxTokens).toBe(4096);
  expect(mergePromptAgentModelCapabilities(current, { ...found, contextWindowSource: 'fallback' }).contextWindow).toBe(8192);
});
const exactModel: PromptAgentCustomModel = { id: 'synthetic', reasoning: true, imageInput: false, contextWindow: 8192, maxTokens: 4096, thinkingLevels: ['low', 'high', 'xhigh'], thinkingLevelMap: { low: 'basic', high: 'high', xhigh: 'extreme' }, thinkingLevelsSource: 'metadata', capabilityDetection: { imageInput: 'metadata', reasoning: 'metadata' } };
it('接口档位在表单中精确显示，人工调整只改变所选档位并保留接口映射', () => {
  let current: PromptAgentCustomProvider;
  const Controlled = () => { const [value, setValue] = useState<PromptAgentCustomProvider>({ name: '合成接口', baseUrl: 'http://localhost/v1', api: 'openai-completions', models: [exactModel] }); current = value; return <CustomProviderForm value={value} onChange={setValue} busy={false} onTest={() => {}} onFetch={() => {}} onSave={() => {}} />; };
  render(<Controlled />);
  expect(screen.getByText('支持的思考档位').title).toBe('接口声明');
  expect((screen.getByLabelText('支持思考档位：极高 (synthetic)') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('支持思考档位：中 (synthetic)') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('支持思考档位：关闭 (synthetic)') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByLabelText('支持思考档位：中 (synthetic)'));
  expect(current!.models[0].thinkingLevels).toEqual(['low', 'medium', 'high', 'xhigh']);
  expect(current!.models[0].thinkingLevelsSource).toBe('manual'); expect(current!.models[0].thinkingLevelMap?.xhigh).toBe('extreme');
  expect(current!.models[0].thinkingLevelMap?.max).toBeNull();
});
it('重新获取模型更新自动档位，人工档位和识图标记不会被覆盖', () => {
  const newer: PromptAgentCustomModel = { ...exactModel, thinkingLevels: ['high', 'max'], thinkingLevelMap: { high: 'advanced', max: 'maximum' }, imageInput: true };
  const current: PromptAgentCustomModel = { ...exactModel, capabilityDetection: { imageInput: 'manual', reasoning: 'metadata' } };
  const refreshed = mergePromptAgentModelCapabilities(current, newer);
  expect(refreshed.thinkingLevels).toEqual(['high', 'max']); expect(refreshed.thinkingLevelMap?.max).toBe('maximum'); expect(refreshed.imageInput).toBe(false);
  expect(mergePromptAgentModelCapabilities({ ...current, thinkingLevelsSource: 'manual' }, newer).thinkingLevels).toEqual(['low', 'high', 'xhigh']);
  const idsOnly: PromptAgentCustomModel = { ...newer, reasoning: false, imageInput: false, thinkingLevels: undefined, capabilityDetection: { imageInput: 'unknown', reasoning: 'unknown' } };
  expect(mergePromptAgentModelCapabilities(exactModel, idsOnly).reasoning).toBe(true);
  expect(mergePromptAgentModelCapabilities(exactModel, idsOnly).thinkingLevels).toEqual(exactModel.thinkingLevels);
});
it('修改模型 ID 清掉原模型自动识别的档位，保留人工选择', () => {
  const change = vi.fn();
  const props = { value: { name: '合成接口', baseUrl: 'http://localhost/v1', api: 'openai-completions' as const, models: [exactModel] }, onChange: change, busy: false, onTest: () => {}, onFetch: () => {}, onSave: () => {} };
  const view = render(<CustomProviderForm {...props} />);
  fireEvent.change(screen.getByPlaceholderText('手动输入模型 ID'), { target: { value: 'other-model' } });
  expect(change.mock.calls[0][0].models[0].thinkingLevels).toBeUndefined(); expect(change.mock.calls[0][0].models[0].reasoning).toBe(false);
  view.rerender(<CustomProviderForm {...props} value={{ ...props.value, models: [{ ...exactModel, thinkingLevelsSource: 'manual', capabilityDetection: { imageInput: 'manual', reasoning: 'manual' } }] }} />);
  fireEvent.change(screen.getByPlaceholderText('手动输入模型 ID'), { target: { value: 'manual-model' } });
  expect(change.mock.calls[1][0].models[0].thinkingLevels).toEqual(exactModel.thinkingLevels); expect(change.mock.calls[1][0].models[0].reasoning).toBe(true);
});
it('三种协议预览真实端点，保留自定义代理路径', () => {
  expect(previewPromptAgentEndpoint('https://example.com/proxy/v1', 'openai-completions')).toBe('https://example.com/proxy/v1/chat/completions');
  expect(previewPromptAgentEndpoint('https://example.com/v1', 'openai-responses')).toBe('https://example.com/v1/responses');
  expect(previewPromptAgentEndpoint('https://example.com', 'anthropic-messages')).toBe('https://example.com/v1/messages');
});
it('保存默认不选用，测试模型和图片用途显式选择，发现列表只加入选中项', () => {
  const model = { id: 'a', reasoning: false, imageInput: false, contextWindow: 8192, maxTokens: 1024, capabilityDetection: { imageInput: 'unknown' as const, reasoning: 'model_name' as const } };
  const change = vi.fn(), test = vi.fn(), save = vi.fn();
  render(<CustomProviderForm value={{ name: 'test', baseUrl: 'http://localhost:1234/v1', api: 'openai-completions', models: [model] }} discovered={[{ ...model, id: 'b' }]} onChange={change} busy={false} onTest={test} onSave={save} onFetch={() => {}} result={{ ok: false, message: '模拟失败', model: 'a', usage: [{ input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: null }], checks: { text: 'not_tested' } }}/>);
  const selection = screen.getByLabelText('保存后设为默认') as HTMLInputElement;
  expect(selection.checked).toBe(false);
  expect(screen.queryByLabelText('用途')).toBeNull();
  expect(screen.queryByText('视觉服务（仅文本协议）')).toBeNull();
  expect((screen.getByLabelText('测试图片输入') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByLabelText('选择模型 b'));
  expect(change.mock.calls[0][0].models.map((item: {id:string}) => item.id)).toEqual(['a', 'b']);
  fireEvent.click(screen.getByText('测试模型 · 可能收费')); expect(test).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('保存连接')); expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('文本：未测');
  expect(screen.getByRole('status').textContent).toContain('本次测试 a · 12 tokens');
  expect(screen.getByRole('status').textContent).not.toContain('费用');
  expect(screen.queryByText('模型能力与价格')).toBeNull();
  expect(screen.queryByLabelText(/Token 美元/)).toBeNull();
  expect(screen.getByLabelText('图片输入能力 a').closest('label')?.title).toBe('未知');
  expect(screen.getByLabelText('推理能力 a').closest('label')?.title).toBe('名称推断');
  expect(screen.getByText('图片能力未知，请手动确认。')).toBeTruthy();
});

it('发现模型列表滚动到末尾会自动连续载入后续模型', () => {
  const discovered: PromptAgentCustomModel[] = Array.from({ length: 230 }, (_, index) => ({
    id: `model-${String(index).padStart(3, '0')}`, reasoning: false, imageInput: false,
    contextWindow: 8192, maxTokens: 1024,
    capabilityDetection: { imageInput: 'unknown', reasoning: 'unknown' },
  }));
  render(<CustomProviderForm value={{ name: 'synthetic', baseUrl: 'https://models.example/v1', api: 'openai-completions', models: [] }} onChange={() => {}} discovered={discovered} busy={false} onTest={() => {}} onFetch={() => {}} onSave={() => {}} />);
  const list = screen.getByLabelText('搜索发现的模型').parentElement!.querySelector('.max-h-48') as HTMLDivElement;
  expect(screen.getByLabelText('选择模型 model-099')).toBeTruthy();
  expect(screen.queryByLabelText('选择模型 model-100')).toBeNull();

  Object.defineProperties(list, { scrollTop: { value: 1000, writable: true, configurable: true }, clientHeight: { value: 192, configurable: true }, scrollHeight: { value: 1050, configurable: true } });
  fireEvent.scroll(list);
  expect(screen.getByLabelText('选择模型 model-100')).toBeTruthy();
  expect(screen.getByLabelText('选择模型 model-199')).toBeTruthy();
  expect(screen.queryByLabelText('选择模型 model-200')).toBeNull();

  Object.defineProperty(list, 'scrollTop', { value: 2050, writable: true, configurable: true });
  Object.defineProperty(list, 'scrollHeight', { value: 2100, configurable: true });
  fireEvent.scroll(list);
  expect(screen.getByLabelText('选择模型 model-200')).toBeTruthy();
  expect(screen.getByLabelText('选择模型 model-229')).toBeTruthy();
});

it('第三方提供商标签选择预设、填入密钥后交给保存流程，自定义标签保留原表单', () => {
  const onSavePreset = vi.fn();
  render(<CustomProviderForm value={{ name: '', baseUrl: '', api: 'openai-completions', models: [] }} onChange={() => {}} discovered={[]} busy={false} onTest={() => {}} onFetch={() => {}} onSave={() => {}} presets={[{ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' }]} onSavePreset={onSavePreset} />);
  expect(screen.getByRole('tab', { name: '第三方模型提供商' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('接口地址：https://api.openai.com/v1')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/API 密钥/), { target: { value: 'sk-synthetic' } });
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
  expect(onSavePreset).toHaveBeenCalledWith({ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' }, 'sk-synthetic');
  fireEvent.click(screen.getByRole('tab', { name: '自定义模型 API' }));
  expect(screen.getByLabelText('API 地址')).toBeTruthy();
  expect(screen.getByRole('button', { name: '获取模型' })).toBeTruthy();
});

it('内置提供商预设包含 DeepSeek 等常见服务且 ID 唯一', () => {
  const ids = AGENT_PROVIDER_PRESETS.map(item => item.id);
  expect(ids).toContain('deepseek');
  expect(ids).toContain('openai');
  expect(ids).toContain('anthropic');
  expect(ids.length).toBeGreaterThanOrEqual(20);
  expect(new Set(ids).size).toBe(ids.length);
  for (const item of AGENT_PROVIDER_PRESETS) {
    expect(item.baseUrl).toMatch(/^https:\/\//);
    expect(['openai-completions', 'openai-responses', 'anthropic-messages']).toContain(item.api);
  }
});
