// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudQueueStatus, InlineCloudQueueStatus } from '../../components/CloudQueueStatus';
import { emitCloudQueueStatus } from '../../services/cloudQueue';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  emitCloudQueueStatus(null);
});
afterEach(() => { cleanup(); emitCloudQueueStatus(null); vi.unstubAllGlobals(); });

describe('公共队列数量展示', () => {
  for (const { name, renderStatus } of [
    { name: '行内状态', renderStatus: () => renderToStaticMarkup(createElement(InlineCloudQueueStatus)) },
    { name: '全局状态', renderStatus: () => renderToStaticMarkup(createElement(CloudQueueStatus)) },
  ]) {
    it.each([
      ['preparing', '准备生成…'], ['joining', '加入队列中…'], ['ready', '即将生成…'],
      ['generating', '生成中…'], ['cancelled', '已取消排队'],
    ] as const)(`${name}：%s 明确区分当前阶段`, (phase, label) => {
      emitCloudQueueStatus({ taskId: 'phase', phase });
      expect(renderStatus()).toContain(label);
    });
    it.each(['waiting', 'ready', 'generating'] as const)(`${name}：%s 始终显示 0，不冒充实时数据`, phase => {
      emitCloudQueueStatus({ taskId: 'count', phase, position: 0, queueSize: 0 });
      const html = renderStatus();
      expect(html).toContain(phase === 'waiting' ? '队列共 0 个任务' : '最近队列数： 0 个任务');
      expect(html).not.toContain('队列共 1 个任务');
      if (phase === 'waiting') expect(html).toContain('前方 0 个任务');
    });

    it.each([undefined, null, -1, 1.5, NaN, Infinity])(`${name}：非法或缺失数量 %s 显示未知`, queueSize => {
      emitCloudQueueStatus({ taskId: 'count', phase: 'waiting', position: null, queueSize });
      const html = renderStatus();
      expect(html).toContain('队列数量未知');
      expect(html).toContain('前方任务数未知');
      expect(html).not.toContain('前方 0');
      expect(html).not.toContain('队列共 0');
    });

    it(`${name}：前方任务与服务器总数分别展示，不扣除当前任务`, () => {
      emitCloudQueueStatus({ taskId: 'count', phase: 'waiting', position: 2, queueSize: 4 });
      const html = renderStatus();
      expect(html).toContain('前方 2 个任务');
      expect(html).toContain('队列共 4 个任务');
    });

    it(`${name}：加入时不伪造数量，正常完成后不残留`, () => {
      emitCloudQueueStatus({ taskId: 'count', phase: 'joining' });
      expect(renderStatus()).not.toContain('个任务');
      emitCloudQueueStatus({ taskId: 'count', phase: 'completed', queueSize: 0 });
      expect(renderStatus()).toBe('');
    });

    it(`${name}：中转等待不虚构排队人数、不展示 st-chatu 个性语`, () => {
      emitCloudQueueStatus({ taskId: 'proxy', phase: 'waiting', proxy: true, cancelable: true, greeting: '旧的个性语', position: 0, queueSize: 0 });
      const html = renderStatus();
      expect(html).toContain('中转排队／生成中…');
      expect(html).toContain('停止等待');
      expect(html).not.toMatch(/前方|队列共|队列数量|当前使用者|旧的个性语/);
      emitCloudQueueStatus({ taskId: 'proxy', phase: 'cancelled', cancelable: false });
      expect(renderStatus()).toContain('已停止等待');
    });

    it(`${name}：st-chatu 队列继续显示当前使用者话语`, () => {
      emitCloudQueueStatus({ taskId: 'queue', phase: 'waiting', greeting: '正在生成中～' });
      expect(renderStatus()).toContain('当前使用者：正在生成中～');
    });
  }
});

it('行内状态生成阶段显示 SSE 步数，排队阶段不误显示旧步数', () => {
  const renderStatus = () => renderToStaticMarkup(createElement(InlineCloudQueueStatus, { generationProgress: { step: 8, total: 28 } }));
  emitCloudQueueStatus({ taskId: 'steps', phase: 'generating' });
  expect(renderStatus()).toContain('生成中 8/28');
  emitCloudQueueStatus({ taskId: 'next', phase: 'waiting', position: 0 });
  expect(renderStatus()).toContain('排队中 · 前方 0 个任务');
  expect(renderStatus()).not.toContain('8/28');
});

it('取消请求期间禁用按钮并显示取消中，完成后显示已取消排队', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  emitCloudQueueStatus({ taskId: 'cancel', phase: 'waiting', cancelable: true });
  render(createElement(InlineCloudQueueStatus));
  fireEvent.click(screen.getByRole('button', { name: '取消排队' }));
  const button = screen.getByRole('button', { name: '取消中…' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]).toEqual(['/api/generation-queue/cancel', expect.objectContaining({ body: JSON.stringify({ taskId: 'cancel' }) })]);
  await act(async () => { finish(new Response(null, { status: 200 })); });
  act(() => emitCloudQueueStatus({ taskId: 'cancel', phase: 'cancelled', cancelable: false }));
  expect(screen.getByRole('status').textContent).toContain('已取消排队');
  expect(screen.queryByRole('button')).toBeNull();
});
