// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitCloudQueueStatus, getCurrentCloudQueueStatus } from './cloudQueue';

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
});
