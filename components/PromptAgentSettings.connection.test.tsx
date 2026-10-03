// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomProviderForm } from './PromptAgentSettings';
import { previewPromptAgentEndpoint } from '../services/promptAgent';

afterEach(cleanup);
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
