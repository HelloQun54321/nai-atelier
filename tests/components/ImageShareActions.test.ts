import { PressRevealSurface } from '../../components/PressRevealSurface';
import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageShareActions, ImageShareOverlay } from '../../components/ImageShareActions';
import { copySharedImage, downloadSharedImage, setCleanSharedImages } from '../../services/imageSharing';

vi.mock('../../services/imageSharing', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/imageSharing')>(),
  copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}),
}));
beforeEach(() => { localStorage.clear(); vi.mocked(copySharedImage).mockReset().mockResolvedValue(); vi.mocked(downloadSharedImage).mockReset().mockResolvedValue(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('共用图片分享操作', () => {
  it('图库浮层固定右上竖排，长按显露，键盘操作不会触发父卡片', () => {
    const parentKey = vi.fn();
    const view = render(React.createElement(PressRevealSurface, { onKeyDown: parentKey }, React.createElement(ImageShareOverlay, { imageUrl: '/synthetic.png', filename: 'synthetic.png' })));
    const surface = view.container.firstElementChild!;
    const group = screen.getByTitle('下载图片').parentElement!;
    expect(group.className).toContain('absolute right-2 top-2');
    expect(group.classList.contains('flex-col')).toBe(true);
    expect(group.classList.contains('hover-reveal-md')).toBe(true);
    expect(surface.hasAttribute('data-press-revealed')).toBe(false);
    longPress(surface);
    expect(surface.getAttribute('data-press-revealed')).toBe('true');
    fireEvent.keyDown(screen.getByTitle('下载图片'), { key: 'Enter' });
    expect(parentKey).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTitle('下载图片'), { key: 'Escape' });
    expect(parentKey).toHaveBeenCalledOnce();
  });
  it('复制带入当前图片的生成快照，下载仍只输出图片并跟随清洗设置', async () => {
    const generationData = { prompt: 'source scene', negativePrompt: '', params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral',
      characters: [{ id: 'source', prompt: 'blue hair', x: 0.2, y: 0.8 }] } };
    setCleanSharedImages(true);
    render(React.createElement(ImageShareActions, { imageUrl: '/source.png', filename: 'source.png', generationData }));
    fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
    await waitFor(() => expect(copySharedImage).toHaveBeenCalledWith('/source.png', true, generationData));
    await waitFor(() => expect((screen.getByRole('button', { name: '下载图片' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    await waitFor(() => expect(downloadSharedImage).toHaveBeenCalledWith('/source.png', 'source.png', true));
  });
  it.each(['overlay', 'toolbar', 'compact', 'card'] as const)('%s 始终仅两个按钮，复制和下载都跟随设置', async variant => {
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    const notify = vi.fn();
    render(React.createElement('div', { onClick: parentClick, onPointerDown: parentPointerDown }, React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png', variant, notify })));
    for (const clean of [false, true, false]) {
      act(() => setCleanSharedImages(clean));
      expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['下载图片', '复制图片']);
      fireEvent.pointerDown(screen.getByRole('button', { name: '复制图片' }));
      fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
      await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith('/original-image', clean));
      await waitFor(() => expect(notify).toHaveBeenCalledWith('已复制图片', 'success'));
      await waitFor(() => expect((screen.getByRole('button', { name: '下载图片' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
      await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith('/original-image', 'NAI.png', clean));
      await waitFor(() => expect((screen.getByRole('button', { name: '复制图片' }) as HTMLButtonElement).disabled).toBe(false));
    }
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
  });

  it('缩略图忙碌状态仍服从长按显隐，滚动收起后失败通过现有通知反馈', async () => {
    let rejectDownload!: (error: Error) => void;
    vi.mocked(downloadSharedImage).mockImplementation(() => new Promise((_, reject) => { rejectDownload = reject; }));
    const notify = vi.fn();
    const view = render(React.createElement(PressRevealSurface, { role: 'button', 'aria-label': '作品' }, React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png', variant: 'card', notify, className: 'hover-reveal-md' })));
    const card = view.container.querySelector('.press-reveal-surface')!; longPress(card);
    expect(card.getAttribute('data-press-revealed')).toBe('true');
    const download = screen.getByRole('button', { name: '下载图片' });
    expect(download.textContent).toBe('');
    expect(screen.getByRole('button', { name: '复制图片' }).textContent).toBe('');
    fireEvent.click(download);
    fireEvent.scroll(card); expect(card.hasAttribute('data-press-revealed')).toBe(false);
    expect(download.parentElement?.classList.contains('!opacity-100')).toBe(false);
    expect((screen.getByRole('button', { name: '复制图片' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => rejectDownload(new Error('下载失败')));
    expect(notify).toHaveBeenCalledWith('下载失败', 'error');
    expect(screen.getByRole('alert').className).toBe('sr-only');
    expect((download as HTMLButtonElement).disabled).toBe(false);
  });

  it('操作失败可见，清洗失败不调用原图下载，结束后按钮恢复', async () => {
    setCleanSharedImages(true);
    vi.mocked(downloadSharedImage).mockRejectedValue(new Error('清洗失败'));
    render(React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png' }));
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '清洗失败');
    expect(downloadSharedImage).toHaveBeenCalledTimes(1);
    expect(downloadSharedImage).toHaveBeenCalledWith('/original-image', 'NAI.png', true);
    expect((screen.getByRole('button', { name: '复制图片' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('处理期间不重复发起复制或下载', async () => {
    let resolveCopy!: () => void;
    vi.mocked(copySharedImage).mockImplementation(() => new Promise(resolve => { resolveCopy = resolve; }));
    render(React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png' }));
    const copy = screen.getByRole('button', { name: '复制图片' });
    fireEvent.click(copy); fireEvent.click(copy);
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect(copySharedImage).toHaveBeenCalledTimes(1);
    expect(downloadSharedImage).not.toHaveBeenCalled();
    await act(async () => resolveCopy());
    expect((copy as HTMLButtonElement).disabled).toBe(false);
  });
});
