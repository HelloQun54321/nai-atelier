// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewActions, previewActionLayout } from '../../components/ImagePreviewActions';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('小图和全屏大图的共用操作', () => {
  it.each([false, true])('全屏=%s：辅助操作统一圆形尺寸与材质，保留语义色及左右分组', fullscreen => {
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
    const removeButton = screen.getByRole('button', { name: '移除当前图片' });
    const clearButton = screen.getByRole('button', { name: '清空当前历史组' });
    const coverButton = screen.getByRole('button', { name: '设为封面' });
    const left = removeButton.closest<HTMLElement>('[data-card-action]')!;
    const right = coverButton.parentElement!;
    expect(left.classList.contains('top-4')).toBe(true);
    expect(left.classList.contains('left-4')).toBe(true);
    expect(left.classList.contains('gap-2')).toBe(true);
    expect(right.classList.contains('top-4')).toBe(true);
    expect(right.classList.contains('right-4')).toBe(true);
    expect(right.classList.contains('w-28')).toBe(false);
    expect(right.classList.contains('md:w-32')).toBe(false);
    expect(removeButton.classList.contains(fullscreen ? 'hover-reveal-md' : 'hover-reveal-lg')).toBe(true);
    expect(removeButton.parentElement?.classList.contains('gap-2')).toBe(true);
    expect(right.classList.contains('hover-reveal-lg')).toBe(false);
    expect(screen.getByRole('button', { name: '收藏' }).closest('.hover-reveal-lg')).toBeNull();
    expect(right.classList.contains('image-preview-action-group')).toBe(true);
    expect(within(right).getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(['收藏', '下载图片', '复制图片', '设为封面']);
    expect(within(left).getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(fullscreen ? ['返回小图', '移除当前图片', '清空当前历史组'] : ['移除当前图片', '清空当前历史组']);
    for (const button of [removeButton, clearButton, coverButton, screen.getByRole('button', { name: '下载图片' }), screen.getByRole('button', { name: '复制图片' })]) {
      for (const token of ['rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'mobile-touch', 'mobile-size-locked', 'border-white/60', 'backdrop-blur', 'focus-visible:ring-white', 'justify-center']) expect(button.classList.contains(token)).toBe(true);
      expect(button.textContent).toBe('');
      expect(button.classList.contains('px-3')).toBe(false);
    }
    expect(removeButton.classList.contains('!bg-red-600/90')).toBe(true);
    expect(removeButton.classList.contains('hover:!bg-red-500')).toBe(true);
    expect(removeButton.querySelector('svg.lucide-image-minus')).toBeTruthy();
    expect(clearButton.classList.contains('!bg-gray-900/85')).toBe(true);
    expect(clearButton.querySelector('svg.lucide-list-x')).toBeTruthy();
    expect(coverButton.classList.contains('!bg-indigo-600/90')).toBe(true);
    expect(coverButton.querySelector('svg.lucide-image')).toBeTruthy();
    expect(coverButton.querySelector('svg.lucide-check')).toBeTruthy();
    expect(removeButton.title).toContain('历史页仍会保留');
    expect(clearButton.title).toContain('历史页仍会保留');
    expect(coverButton.title).toBe('设为封面并保存');
    fireEvent.click(removeButton);
    fireEvent.click(clearButton);
    fireEvent.click(coverButton);
    expect(remove.mock.calls).toEqual([[]]);
    expect(clear.mock.calls).toEqual([[]]);
    expect(cover).toHaveBeenCalledOnce();
    if (fullscreen) {
      expect(backButtonRef.current).toBe(screen.getByRole('button', { name: '返回小图' }));
      expect(backButtonRef.current?.querySelector('svg.lucide-arrow-left')).toBeTruthy();
      expect(backButtonRef.current?.classList.contains('!h-12')).toBe(true);
      expect(backButtonRef.current?.classList.contains('rounded-full')).toBe(true);
      expect(backButtonRef.current?.classList.contains('border-white/60')).toBe(true);
      expect(left.classList.contains('pointer-events-none')).toBe(true);
      expect(backButtonRef.current?.classList.contains('pointer-events-auto')).toBe(true);
      expect(backButtonRef.current?.classList.contains('!w-12')).toBe(true);
      expect(backButtonRef.current?.querySelector('svg')?.classList.contains('h-7')).toBe(true);
      fireEvent.click(backButtonRef.current!);
      expect(back).toHaveBeenCalledOnce();
    } else expect(screen.queryByRole('button', { name: '返回小图' })).toBeNull();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('编辑模式、封面图与无图状态保留各自权限，没有历史项不提供移除或清空', () => {
    const view = render(React.createElement(ImagePreviewActions, { imageUrl: '/edit.png', filename: 'NAI.png', onBack: vi.fn() }));
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['返回小图', '收藏', '下载图片', '复制图片']);
    expect(screen.queryByRole('button', { name: '设为封面' })).toBeNull();
    view.rerender(React.createElement(ImagePreviewActions, { imageUrl: null, filename: 'NAI.png' }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each([false, true])('全屏=%s：圆形上传入口保留于右下，处理中尺寸与名称稳定且禁止重复操作', fullscreen => {
    const upload = vi.fn();
    const view = render(React.createElement(ImagePreviewActions, {
      imageUrl: '/image.png', filename: 'NAI.png', onSetCover: vi.fn(), onUploadCover: upload, onBack: fullscreen ? vi.fn() : undefined,
    }));
    const button = screen.getByRole('button', { name: '手动上传封面' });
    const group = button.parentElement!;
    expect(group.classList.contains('bottom-4')).toBe(true);
    expect(group.classList.contains('right-4')).toBe(true);
    for (const token of ['rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'mobile-touch', 'border-white/60', '!bg-gray-800/80']) expect(button.classList.contains(token)).toBe(true);
    expect(button.querySelector('svg.lucide-upload')).toBeTruthy();
    expect(button.title).toBe('手动上传封面并保存');
    const originalClasses = button.className;
    const input = group.querySelector('input')!;
    const choose = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(choose).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { files: [new File(['test'], 'cover.png', { type: 'image/png' })] } });
    expect(upload).toHaveBeenCalledOnce();
    view.rerender(React.createElement(ImagePreviewActions, {
      imageUrl: '/image.png', filename: 'NAI.png', onSetCover: vi.fn(), onUploadCover: upload, isUploading: true, onBack: fullscreen ? vi.fn() : undefined,
    }));
    for (const name of ['设为封面', '手动上传封面']) {
      const busy = screen.getByRole('button', { name });
      expect((busy as HTMLButtonElement).disabled).toBe(true);
      expect(busy.getAttribute('aria-busy')).toBe('true');
      expect(busy.title).toBe('封面处理中…');
      expect(busy.querySelector('svg.animate-spin')).toBeTruthy();
    }
    expect(button.className).toBe(originalClasses);
    fireEvent.click(button); expect(choose).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '复制图片' }).hasAttribute('disabled')).toBe(false);
  });
});

it('预览操作避让左右翻图、底部工具，换列后两侧也不相交', () => {
  for (const width of [260, 320, 520, 1200]) for (const height of [200, 300, 640]) {
    for (const size of [32, 44, 48]) for (const navigation of [0, 48, 56]) for (const gap of [8, 12]) {
      const counts = [3, 5], footer = 80;
      const inset = gap * 2;
      const { rows, minHeight } = previewActionLayout(width, height, counts, [size, size], size, navigation, footer, gap, inset);
      const actualHeight = Math.max(height, minHeight);
      const usedWidth = counts.reduce((sum, count) => sum + Math.ceil(count / rows) * (size + gap) - gap, inset * 2 + gap);
      expect(usedWidth).toBeLessThanOrEqual(width);
      const bottom = inset + rows * (size + gap) - gap;
      expect(bottom + (navigation ? gap + navigation / 2 : inset + footer)).toBeLessThanOrEqual(navigation ? actualHeight / 2 : actualHeight);
    }
  }
});

it('300px 预览按实际按钮与翻图尺寸向内换列，放大后恢复一列并保留焦点', () => {
  let width = 300, height = 300;
  const callbacks: Array<() => void> = [];
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'BUTTON' ? 32 : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-image-preview-navigation') ? 48 : this.tagName === 'BUTTON' ? 32 : 0; });
  const view = render(React.createElement('div', null, React.createElement('button', { 'data-image-preview-navigation': true }, '上一张'), React.createElement(ImagePreviewActions, { imageUrl: '/synthetic.png', filename: 'test.png', canManageHistoryGroup: true, onSetCover: vi.fn(), onSaveArtistSample: vi.fn() })));
  const cover = screen.getByRole('button', { name: '设为封面' }); cover.focus();
  expect(cover.parentElement!.style.gridTemplateRows).toBe('repeat(2, 32px)');
  width = 600; height = 700;
  act(() => callbacks.forEach(callback => callback()));
  expect(cover.parentElement!.style.gridTemplateRows).toBe('repeat(5, 32px)');
  expect(document.activeElement).toBe(cover);
  view.unmount(); expect(disconnect).toHaveBeenCalled();
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));

it('回调及忙碌状态连续更新不重新测量或创建观察器，点击使用最新回调', async () => {
  const callbacks: Array<() => void> = [];
  const disconnect = vi.fn(), observe = vi.fn(), unobserve = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe = observe; unobserve = unobserve; disconnect = disconnect; });
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
  const previous = vi.fn(), latest = vi.fn();
  const element = (callback: () => void, busy = false) => React.createElement('div', null, React.createElement(ImagePreviewActions, {
    imageUrl: '/synthetic.png', filename: 'test.png', onBack: callback, onSetCover: callback,
    onSaveArtistSample: callback, onUploadCover: callback, savingArtistSample: busy,
  }));
  const view = render(element(previous));
  const reads = width.mock.calls.length, targets = observe.mock.calls.length;
  const group = screen.getByRole('button', { name: '设为封面' }).parentElement!;
  const rowSetter = vi.spyOn(group.style, 'gridTemplateRows', 'set');
  for (let i = 0; i < 10; i++) {
    view.rerender(element(i === 9 ? latest : vi.fn(), i % 2 === 0));
    await act(async () => {});
  }
  expect(callbacks).toHaveLength(1);
  expect(disconnect).not.toHaveBeenCalled();
  expect(observe).toHaveBeenCalledTimes(targets);
  expect(width).toHaveBeenCalledTimes(reads);
  expect(rowSetter).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '设为封面' }));
  fireEvent.click(screen.getByRole('button', { name: '返回小图' }));
  fireEvent.click(screen.getByRole('button', { name: '保存为画师样张' }));
  fireEvent.change(screen.getByLabelText('上传作品封面'), { target: { files: [new File(['test'], 'cover.png')] } });
  expect(latest).toHaveBeenCalledTimes(4);
  expect(previous).not.toHaveBeenCalled();
  act(() => callbacks[0]());
  expect(rowSetter).not.toHaveBeenCalled();
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('实际按钮增减及迟到导航和底栏重新排布，无图和卸载还原原高度', async () => {
  let height = 300;
  const callbacks: Array<() => void> = [];
  const unobserve = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} unobserve = unobserve; disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-image-preview-navigation') ? 56 : this.hasAttribute('data-image-preview-footer') ? 80 : this.tagName === 'BUTTON' ? 44 : 0;
  });
  const element = (image = true, extras = false) => React.createElement('div', { style: { minHeight: '100px' } },
    React.createElement(ImagePreviewActions, { imageUrl: image ? '/synthetic.png' : null, filename: 'test.png', onSetCover: extras ? vi.fn() : undefined, onSaveArtistSample: extras ? vi.fn() : undefined }),
    extras && React.createElement('button', { 'data-image-preview-navigation': true }, '上一张'),
    extras && React.createElement('div', { 'data-image-preview-footer': true, style: { bottom: 16 } }));
  const view = render(element());
  const stage = view.container.firstElementChild as HTMLElement;
  const group = stage.querySelector<HTMLElement>('.image-preview-action-group')!;
  expect(group.style.gridTemplateRows).toBe('repeat(3, 44px)');
  view.rerender(element(true, true));
  await act(async () => {});
  expect(group.style.gridTemplateRows).toBe('repeat(2, 44px)');
  expect(stage.style.minHeight).toBe('max(100px, 296px)');
  height = 700;
  act(() => callbacks[0]());
  expect(group.style.gridTemplateRows).toBe('repeat(5, 44px)');
  view.rerender(element(true));
  await act(async () => {});
  expect(group.style.gridTemplateRows).toBe('repeat(3, 44px)');
  expect(stage.style.minHeight).toBe('max(100px, 76px)');
  view.rerender(element(false));
  await act(async () => {});
  expect(stage.style.minHeight).toBe('100px');
  expect(group.style.gridTemplateRows).toBe('');
  expect(unobserve).toHaveBeenCalledWith(group);
  expect(callbacks).toHaveLength(1);
  view.rerender(element(true, true));
  await act(async () => {});
  expect(stage.style.minHeight).toBe('max(100px, 296px)');
  view.unmount();
  expect(stage.style.minHeight).toBe('100px');
  expect(disconnect).toHaveBeenCalledOnce();
});
