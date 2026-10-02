// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalImageTools } from './ExternalImageTools';
import { db } from '../services/dbService';
import { imageTaggerService, type ImageTaggerResult } from '../services/imageTaggerService';
import { externalImageAnalysis, type ExternalImageTags } from '../services/externalImageTags';
import type { Inspiration } from '../types';

vi.mock('../services/dbService', () => ({ db: { getInspirationsBySource: vi.fn() } }));
vi.mock('../services/imageTaggerService', () => ({ imageTaggerService: {
  getStatus: vi.fn(async () => ({ downloaded: true })), tagFile: vi.fn(),
} }));
const result: ImageTaggerResult = { model: 'test', threshold: 0.35, characterThreshold: 0.85, rating: null, character: [], general: [], tags: [
  { name: 'blue_hair', confidence: 0.9, category: 'general' }, { name: 'long_hair', confidence: 0.8, category: 'general' },
] };
const reverse: ExternalImageTags = { result, prompt: 'blue hair, custom words', createdAt: 1 };
const saved = (page = 0): Inspiration => ({ id: `saved-${page}`, userId: 'owner', title: 'saved', imageUrl: '/api/assets/saved', prompt: reverse.prompt, sourceType: 'pixiv', sourceId: '100', notes: 'keep notes', boardId: 'board', createdAt: 1, analysis: externalImageAnalysis(['原站标签'], page, reverse) });
let serial = 0;
const props = () => ({ source: 'danbooru' as const, sourceId: String(++serial), imageUrl: '/api/media/current.png', sourcePrompt: 'solo, original tag', onImport: vi.fn(),
  onSave: vi.fn(async (draft: ExternalImageTags | undefined) => ({ ...saved(), analysis: externalImageAnalysis(['original tag'], 0, draft) })), notify: vi.fn(), sourceActions: <a href="https://example.invalid/post">查看原帖</a>, sourceTags: <span>原始分类</span> });
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(db.getInspirationsBySource).mockResolvedValue([]); vi.mocked(imageTaggerService.tagFile).mockResolvedValue(result);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic'], { type: 'image/png' }) })));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:synthetic'; static revokeObjectURL = vi.fn(); });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: '图片反推' }).hasAttribute('disabled')).toBe(false));

it('反推直接可达，原站和预测分别复制／导入，保存前允许编辑并保留模型结果', async () => {
  const p = { ...props(), sourceCopy: 'original_artist, solo, original_tag, metadata' }; render(<ExternalImageTools {...p} />); await ready();
  expect(screen.queryByRole('button', { name: '更多' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '复制 Danbooru Tag' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('original_artist, solo, original_tag, metadata'));
  fireEvent.click(screen.getByRole('button', { name: '原站 Tag 送往实验室' })); expect(p.onImport).toHaveBeenCalledWith('solo, original tag');
  fireEvent.click(screen.getByRole('button', { name: '图片反推' }));
  await screen.findByText('识别出 2 个 Tag');
  fireEvent.click(screen.getByRole('button', { name: /long hair/ }));
  fireEvent.click(screen.getByRole('button', { name: '完成选择' }));
  expect((screen.getByRole('textbox', { name: '反推 Tag' }) as HTMLTextAreaElement).value).toBe('blue hair');
  fireEvent.change(screen.getByRole('textbox', { name: '反推 Tag' }), { target: { value: 'blue hair, edited' } });
  fireEvent.click(screen.getByRole('button', { name: '复制反推 Tag' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('blue hair, edited'));
  fireEvent.click(screen.getByRole('button', { name: '反推 Tag 送往实验室' })); expect(p.onImport).toHaveBeenLastCalledWith('blue hair, edited');
  fireEvent.click(screen.getByRole('button', { name: '加入灵感库' }));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ result, prompt: 'blue hair, edited' }), undefined));
  expect(await screen.findByText('已保存到灵感库 · 模型预测')).toBeTruthy();
});

it('保存结果按作品与页恢复，重新打开不重复推理或吞掉自定义文字，Pixiv 标签不直接送生图', async () => {
  vi.mocked(db.getInspirationsBySource).mockResolvedValue([saved(0), saved(1)]);
  const p = { ...props(), source: 'pixiv' as const, sourceId: '100', page: 1 };
  render(<ExternalImageTools {...p} />); await ready();
  expect(db.getInspirationsBySource).toHaveBeenCalledWith('pixiv', '100');
  expect(screen.queryByRole('button', { name: '原站 Tag 送往实验室' })).toBeNull();
  expect((screen.getByRole('textbox', { name: '反推 Tag' }) as HTMLTextAreaElement).value).toBe(reverse.prompt);
  fireEvent.click(screen.getByRole('button', { name: '图片反推' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '关闭' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(imageTaggerService.tagFile).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '反推 Tag' }) as HTMLTextAreaElement).value).toBe(reverse.prompt);
  fireEvent.click(screen.getByRole('button', { name: '更新灵感库' }));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(reverse, saved(1)));
});

it('关闭或送往实验室也保留反推草稿，返回同一作品不丢失', async () => {
  const p = props(); const view = render(<ExternalImageTools {...p} />); await ready();
  fireEvent.click(screen.getByRole('button', { name: '图片反推' })); await screen.findByText('识别出 2 个 Tag');
  fireEvent.click(screen.getByRole('button', { name: '送往实验室' }));
  expect(p.onImport).toHaveBeenCalledWith('blue hair, long hair');
  view.unmount(); render(<ExternalImageTools {...p} />); await ready();
  expect((screen.getByRole('textbox', { name: '反推 Tag' }) as HTMLTextAreaElement).value).toBe('blue hair, long hair');
  expect(p.onSave).not.toHaveBeenCalled();
});

it('读取失败不能重复创建已保存图片，重试后恢复；保存失败不伪装为已保存', async () => {
  vi.mocked(db.getInspirationsBySource).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([saved()]);
  const p = props(); p.onSave.mockRejectedValueOnce(new Error('保存失败'));
  render(<ExternalImageTools {...p} />);
  await screen.findByText('无法读取已保存的 Tag');
  expect(screen.getByRole('button', { name: '加入灵感库' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试读取' })); await ready();
  fireEvent.change(screen.getByRole('textbox', { name: '反推 Tag' }), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: '更新灵感库' }));
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('保存失败', 'error'));
  expect(screen.getByText('尚未保存 · 模型预测')).toBeTruthy();
});

it('换页后旧读取的迟到结果不覆盖当前页', async () => {
  let finish!: (items: Inspiration[]) => void;
  vi.mocked(db.getInspirationsBySource).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]);
  const p = props(); const view = render(<ExternalImageTools key="old" {...p} page={0} />);
  view.rerender(<ExternalImageTools key="new" {...p} page={1} />); await ready();
  await act(async () => finish([saved(0)]));
  expect(screen.queryByRole('textbox', { name: '反推 Tag' })).toBeNull();
});

it('局域网无 Clipboard API 时仍可主动复制，失败不报告成功', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  const copy = vi.fn(() => true); Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  const p = props(); render(<ExternalImageTools {...p} />); await ready();
  fireEvent.click(screen.getByRole('button', { name: '复制 Danbooru Tag' }));
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('已复制Danbooru Tag'));
  expect(copy).toHaveBeenCalledWith('copy'); expect(document.querySelector('textarea')).toBeNull();
  copy.mockReturnValue(false); fireEvent.click(screen.getByRole('button', { name: '复制 Danbooru Tag' }));
  await waitFor(() => expect(p.notify).toHaveBeenLastCalledWith('复制失败，请重试', 'error'));
});
