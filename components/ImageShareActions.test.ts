// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageShareActions } from './ImageShareActions';
import { copySharedImage, downloadSharedImage, setCleanSharedImages } from '../services/imageSharing';

vi.mock('../services/imageSharing', async importOriginal => ({
  ...await importOriginal<typeof import('../services/imageSharing')>(),
  copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}),
}));
beforeEach(() => { localStorage.clear(); vi.mocked(copySharedImage).mockReset().mockResolvedValue(); vi.mocked(downloadSharedImage).mockReset().mockResolvedValue(); });
afterEach(() => { cleanup(); });

describe('共用图片分享操作', () => {
  it.each(['overlay', 'toolbar', 'compact'] as const)('%s 始终仅两个按钮，复制和下载都跟随设置', async variant => {
    const parentClick = vi.fn();
    const notify = vi.fn();
    render(React.createElement('div', { onClick: parentClick }, React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png', variant, notify })));
    for (const clean of [false, true, false]) {
      act(() => setCleanSharedImages(clean));
      expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['复制', '下载']);
      fireEvent.click(screen.getByRole('button', { name: '复制' }));
      await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith('/original-image', clean));
      await waitFor(() => expect(notify).toHaveBeenCalledWith('已复制图片', 'success'));
      await waitFor(() => expect((screen.getByRole('button', { name: '下载' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '下载' }));
      await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith('/original-image', 'NAI.png', clean));
      await waitFor(() => expect((screen.getByRole('button', { name: '复制' }) as HTMLButtonElement).disabled).toBe(false));
    }
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('操作失败可见，清洗失败不调用原图下载，结束后按钮恢复', async () => {
    setCleanSharedImages(true);
    vi.mocked(downloadSharedImage).mockRejectedValue(new Error('清洗失败'));
    render(React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png' }));
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '清洗失败');
    expect(downloadSharedImage).toHaveBeenCalledTimes(1);
    expect(downloadSharedImage).toHaveBeenCalledWith('/original-image', 'NAI.png', true);
    expect((screen.getByRole('button', { name: '复制' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('处理期间不重复发起复制或下载', async () => {
    let resolveCopy!: () => void;
    vi.mocked(copySharedImage).mockImplementation(() => new Promise(resolve => { resolveCopy = resolve; }));
    render(React.createElement(ImageShareActions, { imageUrl: '/original-image', filename: 'NAI.png' }));
    const copy = screen.getByRole('button', { name: '复制' });
    fireEvent.click(copy); fireEvent.click(copy);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    expect(copySharedImage).toHaveBeenCalledTimes(1);
    expect(downloadSharedImage).not.toHaveBeenCalled();
    await act(async () => resolveCopy());
    expect((copy as HTMLButtonElement).disabled).toBe(false);
  });
});
