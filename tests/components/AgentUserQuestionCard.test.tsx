// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentQuestionHistory, AgentUserQuestionCard } from '../../components/AgentUserQuestionCard';
import type { AgentQuestionRequest } from '../../services/promptAgent';

afterEach(cleanup);
const request: AgentQuestionRequest = { requestId: 'question', runId: 'run', questions: [
  { id: 'style', prompt: '想要什么画风？', options: [{ id: 'custom', label: '动画', description: '柔和线条' }, { id: 'real', label: '写实' }] },
  { id: 'scene', prompt: '场景在哪里？', options: [] },
] };

it('没有默认选择，每题始终可自定义，逐题保留回答且仅显式提交继续', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<AgentUserQuestionCard request={request} onAnswer={submit} />);
  expect(screen.getByRole('button', { name: '下一题' })).toHaveProperty('disabled', true);
  expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /动画.*柔和线条/ }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下一题' }));
  expect(screen.getByRole('button', { name: '提交回答并继续' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByRole('textbox', { name: '自定义回答内容' })).toHaveProperty('value', '');
  fireEvent.change(screen.getByRole('textbox', { name: '自定义回答内容' }), { target: { value: '  森林小屋  ' } });
  fireEvent.click(screen.getByRole('button', { name: '上一题' }));
  expect(screen.getByRole('radio', { name: /动画.*柔和线条/ })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '下一题' }));
  expect(screen.getByRole('textbox')).toHaveProperty('value', '  森林小屋  ');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '提交回答并继续' }));
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith([{ questionId: 'style', optionId: 'custom' }, { questionId: 'scene', customText: '森林小屋' }]));
});

it('失联保留填写和原问题，提交期间不重发，可显式重试相同回答', async () => {
  let reject!: (error: Error) => void;
  const submit = vi.fn().mockImplementationOnce(() => new Promise((_resolve, rejectNext) => { reject = rejectNext; })).mockResolvedValue(undefined);
  render(<AgentUserQuestionCard request={{ ...request, questions: [request.questions[1]] }} onAnswer={submit} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '海边' } });
  fireEvent.click(screen.getByRole('button', { name: '提交回答并继续' }));
  expect(screen.getByRole('button', { name: '正在提交…' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('textbox').closest('fieldset')).toHaveProperty('disabled', true);
  reject(new Error('连接中断'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '连接中断');
  expect(screen.getByRole('textbox')).toHaveProperty('value', '海边');
  fireEvent.click(screen.getByRole('button', { name: '提交回答并继续' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
});

it('完整历史问题、选项与真实自定义回答直接可见，取消不假报为已回答', () => {
  const text = '完整回答'.repeat(1200);
  const view = render(<AgentQuestionHistory args={{ questions: request.questions }} result={[{ type: 'text', text: JSON.stringify({ answered: true, answers: [{ questionId: 'style', optionId: 'real', label: '写实' }, { questionId: 'scene', customText: text }] }) }]} />);
  expect(screen.getByRole('region', { name: '问题与回答' }).textContent).toContain(text);
  expect(screen.getByText('想要什么画风？')).toBeTruthy();
  expect(screen.getByText('动画 · 柔和线条')).toBeTruthy();
  view.rerender(<AgentQuestionHistory args={{ questions: [{ prompt: '未经规范化的旧问题' }] }} result={[{ type: 'text', text: JSON.stringify({ answered: true, questions: request.questions, answers: [{ questionId: 'style', optionId: 'real', label: '写实' }] }) }]} />);
  expect(screen.getByText('想要什么画风？')).toBeTruthy();
  expect(screen.queryByText('未经规范化的旧问题')).toBeNull();
  view.rerender(<AgentQuestionHistory args={{ questions: request.questions }} result={[{ type: 'text', text: JSON.stringify({ answered: false, error: '任务已停止' }) }]} />);
  expect(screen.getAllByText('未回答')).toHaveLength(2);
  expect(screen.getByText('任务已停止')).toBeTruthy();
});
