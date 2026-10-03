// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomProviderForm } from './PromptAgentSettings';
import { mergePromptAgentModelCapabilities, previewPromptAgentEndpoint, type PromptAgentCustomModel, type PromptAgentCustomProvider } from '../services/promptAgent';

afterEach(cleanup);
const exactModel: PromptAgentCustomModel = { id: 'synthetic', reasoning: true, imageInput: false, contextWindow: 8192, maxTokens: 4096, thinkingLevels: ['low', 'high', 'xhigh'], thinkingLevelMap: { low: 'basic', high: 'high', xhigh: 'extreme' }, thinkingLevelsSource: 'metadata', capabilityDetection: { imageInput: 'metadata', reasoning: 'metadata' } };
it('接口档位在表单中精确显示，人工调整只改变所选档位并保留接口映射', () => {
  let current: PromptAgentCustomProvider;
  const Controlled = () => { const [value, setValue] = useState<PromptAgentCustomProvider>({ name: '合成接口', baseUrl: 'http://localhost/v1', api: 'openai-completions', models: [exactModel] }); current = value; return <CustomProviderForm value={value} onChange={setValue} busy={false} onTest={() => {}} onFetch={() => {}} onSave={() => {}} />; };
  render(<Controlled />);
  expect(screen.getByText('来源：接口声明。仅勾选接口支持的档位。')).toBeTruthy();
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
  fireEvent.change(screen.getByPlaceholderText('模型 ID，例如 deepseek-chat'), { target: { value: 'other-model' } });
  expect(change.mock.calls[0][0].models[0].thinkingLevels).toBeUndefined(); expect(change.mock.calls[0][0].models[0].reasoning).toBe(false);
  view.rerender(<CustomProviderForm {...props} value={{ ...props.value, models: [{ ...exactModel, thinkingLevelsSource: 'manual', capabilityDetection: { imageInput: 'manual', reasoning: 'manual' } }] }} />);
  fireEvent.change(screen.getByPlaceholderText('模型 ID，例如 deepseek-chat'), { target: { value: 'manual-model' } });
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
  const selection = screen.getByLabelText('保存后设为默认（已有对话保留自己的模型）') as HTMLInputElement;
  expect(selection.checked).toBe(false);
  expect(screen.queryByLabelText('用途')).toBeNull();
  expect(screen.queryByText('视觉服务（仅文本协议）')).toBeNull();
  expect((screen.getByLabelText('测试图片接受（需模型支持识图，可能另计费用）') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByText('＋ b'));
  expect(change.mock.calls[0][0].models.map((item: {id:string}) => item.id)).toEqual(['a', 'b']);
  fireEvent.click(screen.getByText('测试模型 · 可能收费')); expect(test).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('保存配置')); expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('文本：未测');
  expect(screen.getByRole('status').textContent).toContain('本次测试 a · 12 tokens');
  expect(screen.getByRole('status').textContent).not.toContain('费用');
  expect(screen.queryByText('模型能力与价格')).toBeNull();
  expect(screen.queryByLabelText(/Token 美元/)).toBeNull();
  expect(screen.getByText(/能力来源/).textContent).toContain('识图 未知 · 推理 名称推断');
});
