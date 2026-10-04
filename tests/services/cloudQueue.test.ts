// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitCloudQueueStatus, getCurrentCloudQueueStatus, reportCloudQueueCleanupError, scheduleCloudQueueStatusClear, watchCloudQueueTask } from '../../services/cloudQueue';
import { api } from '../../services/api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloudQueueStatus, InlineCloudQueueStatus } from '../../components/CloudQueueStatus';

const waitingStatus = (taskId: string) => ({
  taskId,
  phase: 'waiting' as const,
  position: 1,
  queueSize: 2,
  cancelable: true,
});

describe('cloud queue key scoping', () => {
  beforeEach(() => {
    sessionStorage.clear();
    emitCloudQueueStatus(null);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    emitCloudQueueStatus(null);
    vi.useRealTimers();
  });

  it('切换 Key 后清理旧任务并拒绝旧 Key 的迟到状态', () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('task-a');

    sessionStorage.setItem('nai_api_key', 'key-b');
    window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'key-b' }));
    expect(getCurrentCloudQueueStatus()).toBeNull();

    emitCloudQueueStatus(waitingStatus('late-task-a'), 'key-a');
    expect(getCurrentCloudQueueStatus()).toBeNull();
    emitCloudQueueStatus(waitingStatus('task-b'), 'key-b');
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('task-b');
  });

  it('同一任务的释放失败警告不会被随后写入的成功终态覆盖', () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    reportCloudQueueCleanupError('task-a', 'key-a');
    emitCloudQueueStatus({ taskId: 'task-a', phase: 'completed' }, 'key-a');
    expect(getCurrentCloudQueueStatus()?.phase).toBe('completed');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    const html = renderToStaticMarkup(createElement(InlineCloudQueueStatus));
    expect(html).toContain('生成完成');
    expect(html).toContain('释放失败');
    expect(html).toContain('queue-status-surface--failure');
    expect(html).not.toContain('queue-status-spinner');
    emitCloudQueueStatus(waitingStatus('task-new'), 'key-a');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toBeUndefined();
  });

  it('旧任务或旧 Key 的释放失败不能污染当前任务', () => {
    sessionStorage.setItem('nai_api_key', 'key-b');
    emitCloudQueueStatus(waitingStatus('task-b'), 'key-b');
    reportCloudQueueCleanupError('task-a', 'key-a');
    reportCloudQueueCleanupError('task-b', 'key-a');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toBeUndefined();
  });

  it('正常完成后立即隐藏行内和跨页面提示，内部终态自动清理', async () => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'done', phase: 'completed' });
    expect(renderToStaticMarkup(createElement(InlineCloudQueueStatus))).toBe('');
    expect(renderToStaticMarkup(createElement(CloudQueueStatus))).toBe('');
    await vi.advanceTimersByTimeAsync(1500);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it.each(['cancelled', 'error'] as const)('%s 终态自行收尾，不依赖生成入口另设计时器', async phase => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'done', phase });
    expect(renderToStaticMarkup(createElement(CloudQueueStatus))).not.toBe('');
    await vi.advanceTimersByTimeAsync(phase === 'error' ? 8000 : 1500);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it('旧任务的清理计时不能取消当前错误提示的自动收尾', async () => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'current', phase: 'error' });
    scheduleCloudQueueStatusClear('old', 100);
    await vi.advanceTimersByTimeAsync(8000);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it('同一 Key 的旧请求终态不能覆盖新任务', () => {
    emitCloudQueueStatus(waitingStatus('current'));
    emitCloudQueueStatus({ taskId: 'old', phase: 'completed' });
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('current');
    expect(getCurrentCloudQueueStatus()?.phase).toBe('waiting');
  });

  it('网关完成后仍以成图接收为准，慢速传图期间保留清理警告', async () => {
    vi.useFakeTimers();
    emitCloudQueueStatus({ taskId: 'task', phase: 'generating' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ taskId: 'task', phase: 'completed' }))));
    await watchCloudQueueTask('task', () => false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getCurrentCloudQueueStatus()?.phase).toBe('generating');
    reportCloudQueueCleanupError('task', '');
    emitCloudQueueStatus({ taskId: 'task', phase: 'completed' });
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    await vi.advanceTimersByTimeAsync(8000);
    expect(getCurrentCloudQueueStatus()).toBeNull();
  });

  it.each(['finished', 'cleared', 'new-task', 'new-key'] as const)('迟到轮询在 %s 后不能恢复旧排队提示', async change => {
    vi.useFakeTimers();
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('old'), 'key-a');
    let finish = false;
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const watcher = watchCloudQueueTask('old', () => finish, 'key-a');
    if (change === 'new-task') emitCloudQueueStatus(waitingStatus('new'), 'key-a');
    else if (change === 'new-key') {
      sessionStorage.setItem('nai_api_key', 'key-b');
      window.dispatchEvent(new Event('nai-api-key-changed'));
    } else {
      finish = true;
      emitCloudQueueStatus({ taskId: 'old', phase: 'completed' }, 'key-a');
      if (change === 'cleared') await vi.advanceTimersByTimeAsync(1500);
    }
    const expected = getCurrentCloudQueueStatus();
    respond(new Response(JSON.stringify(waitingStatus('old'))));
    await watcher;
    expect(getCurrentCloudQueueStatus()).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (change === 'finished') {
      await vi.advanceTimersByTimeAsync(1500);
      expect(getCurrentCloudQueueStatus()).toBeNull();
    }
  });

  it('ZIP 响应释放失败时仍交付图片并保留警告', async () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    const fetchMock = vi.fn().mockResolvedValue(new Response('image', { headers: {
      'X-Nai-Queue-Task-Id': 'task-a', 'X-Nai-Queue-Cleanup-Failed': '1',
    } }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await api.postBinary('/generate', {}, { Authorization: 'Bearer key-a' });
    const image = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(image).toBe('image');
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('SSE 释放失败事件不丢弃 final、不发起重试', async () => {
    sessionStorage.setItem('nai_api_key', 'key-a');
    emitCloudQueueStatus(waitingStatus('task-a'), 'key-a');
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'event: final\ndata: {"image":"image"}\n\nevent: nai_queue_cleanup_error\ndata: {"message":"释放失败"}\n\n',
      { headers: { 'X-Nai-Queue-Task-Id': 'task-a' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const events: string[] = [];
    await api.postSse('/generate-stream', {}, { Authorization: 'Bearer key-a' }, event => events.push(event.event));
    expect(events).toEqual(['final', 'nai_queue_cleanup_error']);
    expect(getCurrentCloudQueueStatus()?.cleanupError).toContain('释放失败');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
