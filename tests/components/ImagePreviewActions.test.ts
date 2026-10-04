// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewActions } from '../../components/ImagePreviewActions';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('小图和全屏大图的共用操作', () => {
  it.each([false, true])('全屏=%s：左上管理、右上分享和封面，均使用紧凑尺寸', fullscreen => {
    const remove = vi.fn();
    const clear = vi.fn();
    const cover = vi.fn();
    const back = vi.fn();
    const parentClick = vi.fn();
    const backButtonRef = React.createRef<HTMLButtonElement>();
    render(React.createElement('div', { onClick: parentClick }, React.createElement(ImagePreviewActions, {
      imageUrl: '/current.png', filename: 'NAI.png', canManageHistoryGroup: true,
      onRemoveCurrentHistory: remove, onClearHistoryGroup: clear, onSetCover: cover,
      onBack: fullscreen ? back : undefined, backButtonRef,
    })));
    const removeButton = screen.getByRole('button', { name: '删除' });
    const clearButton = screen.getByRole('button', { name: '清除' });
    const coverButton = screen.getByRole('button', { name: '设为封面' });
    const left = removeButton.closest<HTMLElement>('[data-card-action]')!;
    const right = coverButton.parentElement!;
    expect(left.classList.contains('top-4')).toBe(true);
    expect(left.classList.contains('left-4')).toBe(true);
    expect(left.classList.contains(fullscreen ? 'gap-6' : 'gap-2')).toBe(true);
    expect(right.classList.contains('top-4')).toBe(true);
    expect(right.classList.contains('right-4')).toBe(true);
    expect(right.classList.contains('w-28')).toBe(false);
    expect(right.classList.contains('md:w-32')).toBe(false);
    expect(removeButton.parentElement?.classList.contains(fullscreen ? 'hover-reveal-touch' : 'hover-reveal-lg')).toBe(true);
    expect(right.classList.contains('hover-reveal-lg')).toBe(!fullscreen);
    expect(within(right).getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(['复制', '下载', '设为封面']);
    expect(within(left).getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(fullscreen ? ['返回小图', '删除', '清除'] : ['删除', '清除']);
    for (const button of [removeButton, clearButton, coverButton, screen.getByRole('button', { name: '复制' }), screen.getByRole('button', { name: '下载' })]) {
      expect(button.classList.contains('py-1.5')).toBe(true);
      expect(button.classList.contains('leading-4')).toBe(true);
      expect(button.classList.contains('min-h-10')).toBe(false);
      expect(button.classList.contains('mobile-touch')).toBe(false);
      expect(button.classList.contains('justify-center')).toBe(true);
    }
    fireEvent.click(removeButton);
    fireEvent.click(clearButton);
    fireEvent.click(coverButton);
    expect(remove.mock.calls).toEqual([[]]);
    expect(clear.mock.calls).toEqual([[]]);
    expect(cover).toHaveBeenCalledOnce();
    if (fullscreen) {
      expect(backButtonRef.current).toBe(screen.getByRole('button', { name: '返回小图' }));
      expect(backButtonRef.current?.querySelector('svg.lucide-arrow-left')).toBeTruthy();
      expect(backButtonRef.current?.classList.contains('h-12')).toBe(true);
      expect(left.classList.contains('pointer-events-none')).toBe(true);
      expect(backButtonRef.current?.classList.contains('pointer-events-auto')).toBe(true);
      expect(backButtonRef.current?.classList.contains('w-12')).toBe(true);
      expect(backButtonRef.current?.querySelector('svg')?.classList.contains('h-7')).toBe(true);
      fireEvent.click(backButtonRef.current!);
      expect(back).toHaveBeenCalledOnce();
    } else expect(screen.queryByRole('button', { name: '返回小图' })).toBeNull();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('编辑模式、封面图与无图状态保留各自权限，没有历史项不提供删除或清除', () => {
    const view = render(React.createElement(ImagePreviewActions, { imageUrl: '/edit.png', filename: 'NAI.png', onBack: vi.fn() }));
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['返回小图', '复制', '下载']);
    expect(screen.queryByRole('button', { name: '设为封面' })).toBeNull();
    view.rerender(React.createElement(ImagePreviewActions, { imageUrl: null, filename: 'NAI.png' }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('上传入口在大小图都保留于右下，上传期间禁止再次设置或上传封面', () => {
    const upload = vi.fn();
    const view = render(React.createElement(ImagePreviewActions, {
      imageUrl: '/image.png', filename: 'NAI.png', onSetCover: vi.fn(), onUploadCover: upload,
    }));
    const button = screen.getByRole('button', { name: '手动上传' });
    const group = button.parentElement!;
    expect(group.classList.contains('bottom-4')).toBe(true);
    expect(group.classList.contains('right-4')).toBe(true);
    const input = group.querySelector('input')!;
    const choose = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(choose).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { files: [new File(['test'], 'cover.png', { type: 'image/png' })] } });
    expect(upload).toHaveBeenCalledOnce();
    view.rerender(React.createElement(ImagePreviewActions, {
      imageUrl: '/image.png', filename: 'NAI.png', onSetCover: vi.fn(), onUploadCover: upload, isUploading: true, onBack: vi.fn(),
    }));
    expect(screen.getAllByRole('button', { name: '上传中...' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole('button', { name: '复制' }).hasAttribute('disabled')).toBe(false);
  });
});
