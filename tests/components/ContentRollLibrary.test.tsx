// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentRollLibrary } from '../../components/ContentRollLibrary';
import { contentSnapshotOf } from '../../services/contentRoll';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { PromptChain } from '../../types';

vi.mock('../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', filled: true, name: '夜景', text: 'moonlight', negative: 'daylight', constraints: { notes: '保留月光' } } } }, '2026-10-21');
const record = { id: 'saved', type: 'style', name: '夜游', tags: [], params: { ...LAB_DEFAULT_PARAMS, _rollContentSnapshot: snapshot }, updatedAt: 1 } as unknown as PromptChain;
const props = () => ({ active: true, chains: [record], notify: vi.fn(), onLoad: vi.fn(), onRename: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onSetCover: vi.fn(async () => {}) });

it('原文与组合分区独立，可按原文搜索、查看与逐字复制，不载入抽取器', async () => {
  const text = '  {{winter}}, 1.2::hair::\r\n[smile]  ';
  const collected = { ...record, ...prepareCollectedPrompt(text, '冬日'), type: 'preset', id: 'collected' } as PromptChain;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const p = props(); p.chains.push(collected); render(<ContentRollLibrary {...p} section="originals" />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'winter' } });
  expect(screen.queryByRole('button', { name: '载入组合' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /冬日/ }));
  expect(document.querySelector('[data-content-roll-preview="collected"] p')?.textContent).toBe(text);
  fireEvent.click(screen.getByRole('button', { name: '复制提示词' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
  expect(p.onLoad).not.toHaveBeenCalled();
});

it('搜索组合内提示词与负面，在本卡片展开详情，原快照交给载入且不写库', () => {
  const p = props(); render(<ContentRollLibrary {...p} />);
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'daylight' } });
  const title = screen.getByRole('button', { name: /夜游/ });
  fireEvent.click(title);
  const article = title.closest('article')!;
  expect(article.querySelector('[data-content-roll-preview="saved"]')?.textContent).toContain('daylight');
  fireEvent.click(screen.getByRole('button', { name: '载入组合' }));
  expect(p.onLoad).toHaveBeenCalledWith(record);
  expect(p.onRename).not.toHaveBeenCalled(); expect(p.onDelete).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(screen.queryByRole('button', { name: /夜游/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByRole('button', { name: /夜游/ })).toBeTruthy();
});

it('切走不移除组合卡片，返回保留预览节点和滚动位置', () => {
  const p = props(); const view = render(<ContentRollLibrary {...p} />);
  fireEvent.click(screen.getByRole('button', { name: /夜游/ }));
  const preview = document.querySelector('[data-content-roll-preview="saved"]');
  const viewport = document.querySelector('.workspace-scroll-viewport')!;
  viewport.scrollTop = 180;
  view.rerender(<ContentRollLibrary {...p} active={false} />);
  expect(document.querySelector('[data-content-roll-preview="saved"]')).toBe(preview);
  view.rerender(<ContentRollLibrary {...p} />);
  expect(viewport.scrollTop).toBe(180);
});

it('改名回车与失焦只提交一次，失败保留输入，Esc 不提交', async () => {
  const p = props(); let fail!: (error: Error) => void;
  p.onRename = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  render(<ContentRollLibrary {...p} />);
  fireEvent.click(screen.getByRole('button', { name: /夜游/ }));
  fireEvent.click(screen.getByRole('button', { name: '改名' }));
  const input = screen.getByRole('textbox', { name: '重命名这条记录' });
  fireEvent.change(input, { target: { value: '月下' } });
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
  expect(p.onRename).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('synthetic')));
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('改名失败，请重试', 'error'));
  expect((screen.getByRole('textbox', { name: '重命名这条记录' }) as HTMLInputElement).value).toBe('月下');
  fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.blur(input);
  expect(p.onRename).toHaveBeenCalledTimes(1);
});
