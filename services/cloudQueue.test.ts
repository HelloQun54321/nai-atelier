// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitCloudQueueStatus, getCurrentCloudQueueStatus, reportCloudQueueCleanupError } from './cloudQueue';
import { api } from './api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InlineCloudQueueStatus } from '../components/CloudQueueStatus';

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    emitCloudQueueStatus(null);
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
