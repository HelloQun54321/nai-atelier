// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPromptChangeCard, AgentPromptDiff } from '../../components/AgentPromptDiff';
import type { AgentPromptChange } from '../../services/agentPromptChanges.mjs';

afterEach(cleanup);
const change: AgentPromptChange = { id: 'run', target: { chainId: 'lab', mode: 'text-to-image' }, status: 'applied', changes: [{ path: ['basePrompt'], before: '1.2::artist::, blue sky', after: '1.4::artist::, blue sky' }] };

it('仅变化字符红绿高亮，长上下文按需展开，正文权重保持原样', () => {
  const prefix = 'unchanged context '.repeat(20);
  const { container } = render(<AgentPromptDiff changes={[{ path: ['basePrompt'], before: prefix + '1.2::artist::', after: prefix + '1.4::artist::' }]} />);
  expect([...container.querySelectorAll('mark')].map(node => node.textContent)).toEqual(['2', '4']);
  expect(screen.getByLabelText('删除').textContent).toBe('−');
  expect(screen.getByLabelText('新增').textContent).toBe('+');
  expect(container.textContent).not.toContain(prefix);
  fireEvent.click(screen.getByRole('button', { name: '展开完整上下文' }));
  expect(container.textContent).toContain(prefix);
});

it('已应用与已撤回状态分别启用撤回和重做，工作中禁用操作', async () => {
  const onAction = vi.fn(async () => {});
  const view = render(<AgentPromptChangeCard change={change} disabled={false} onAction={onAction} />);
  expect((screen.getByRole('button', { name: '重做本次提示词修改' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '撤回本次提示词修改' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith('undo'));
  view.rerender(<AgentPromptChangeCard change={{ ...change, status: 'undone' }} disabled={false} onAction={onAction} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '重做本次提示词修改' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '重做本次提示词修改' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith('redo'));
  view.rerender(<AgentPromptChangeCard change={change} disabled onAction={onAction} />);
  expect((screen.getByRole('button', { name: '撤回本次提示词修改' }) as HTMLButtonElement).disabled).toBe(true);
});

it('拒绝覆盖手改时原位报错，保存回执重试不再次撤回', async () => {
  const onAction = vi.fn(async () => { throw new Error('相关提示词已被修改，未覆盖当前内容'); });
  const view = render(<AgentPromptChangeCard change={change} disabled={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: '撤回本次提示词修改' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '相关提示词已被修改，未覆盖当前内容');
  view.rerender(<AgentPromptChangeCard change={{ ...change, savePending: true }} disabled={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: '重试保存记录' }));
  await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('save'));
});
