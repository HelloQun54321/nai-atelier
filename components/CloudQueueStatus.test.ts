// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CloudQueueStatus, InlineCloudQueueStatus } from './CloudQueueStatus';
import { emitCloudQueueStatus } from '../services/cloudQueue';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  emitCloudQueueStatus(null);
});
afterEach(() => emitCloudQueueStatus(null));

describe('公共队列数量展示', () => {
  for (const { name, renderStatus } of [
    { name: '行内状态', renderStatus: () => renderToStaticMarkup(createElement(InlineCloudQueueStatus)) },
    { name: '全局状态', renderStatus: () => renderToStaticMarkup(createElement(CloudQueueStatus)) },
  ]) {
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
  }
});
