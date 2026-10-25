// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMobileHistoryLayer } from '../../components/MobileUI';
import { ImageActivityContext } from '../../components/SmartImage';

const Layer = ({ name, open, onClose }: { name: string; open: boolean; onClose: () => void }) => {
  const close = useMobileHistoryLayer(open, onClose, name);
  return open ? <button onClick={close}>{name}</button> : null;
};
const returnTo = (state: unknown) => {
  window.history.replaceState(state, '');
  fireEvent(window, new PopStateEvent('popstate', { state }));
};
beforeEach(() => {
  window.history.replaceState({ source: 'synthetic' }, '');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, ''); });

it('StrictMode 新挂载只登记一次，真实关闭仍只返回一次', async () => {
  const push = vi.spyOn(window.history, 'pushState');
  vi.mocked(window.history.back).mockImplementation(() => {
    setTimeout(() => returnTo({ source: 'synthetic' }), 0);
  });
  const Harness = () => {
    const [open, setOpen] = useState(true);
    return <Layer name="条件窗口" open={open} onClose={() => setOpen(false)} />;
  };
  render(<React.StrictMode><Harness /></React.StrictMode>);
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(screen.queryByRole('button', { name: '条件窗口' })).not.toBeNull();
  expect(push).toHaveBeenCalledOnce();
  expect(window.history.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '条件窗口' }));
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(screen.queryByRole('button')).toBeNull();
  expect(window.history.back).toHaveBeenCalledOnce();
});

it('StrictMode 条件窗口真正卸载时清理自己的历史层', async () => {
  const { unmount } = render(<React.StrictMode><Layer name="条件收录窗口" open onClose={vi.fn()} /></React.StrictMode>);
  expect(window.history.back).not.toHaveBeenCalled();
  unmount();
  await act(async () => {});
  expect(window.history.back).toHaveBeenCalledOnce();
});

it('保留窗口断开后立即重连不返回，真实隐藏仍清理一次', async () => {
  const draw = (mode: 'visible' | 'hidden') => <React.Activity mode={mode}><Layer name="保留窗口" open onClose={vi.fn()} /></React.Activity>;
  const view = render(draw('visible'));
  const marker = window.history.state.__naiMobileLayer;
  view.rerender(draw('hidden'));
  view.rerender(draw('visible'));
  await act(async () => {});
  expect(window.history.back).not.toHaveBeenCalled();
  expect(window.history.state.__naiMobileLayer).toBe(marker);
  view.rerender(draw('hidden'));
  await act(async () => {});
  expect(window.history.back).toHaveBeenCalledOnce();
});

it('父子窗口立即重连时不重复登记已在栈内的父子标记', async () => {
  const push = vi.spyOn(window.history, 'pushState');
  const draw = (mode: 'visible' | 'hidden') => <React.Activity mode={mode}>
    <Layer name="父窗口" open onClose={vi.fn()} /><Layer name="子窗口" open onClose={vi.fn()} />
  </React.Activity>;
  const view = render(draw('visible'));
  const original = window.history.state.__naiMobileLayers;
  expect(original).toHaveLength(2);
  view.rerender(draw('hidden'));
  view.rerender(draw('visible'));
  await act(async () => {});
  expect(window.history.state.__naiMobileLayers).toEqual(original);
  expect(push).toHaveBeenCalledTimes(2);
  expect(window.history.back).not.toHaveBeenCalled();
});

it('详情、子窗口及孙窗口按返回顺序逐层关闭，父层监听仍保留', () => {
  const push = vi.spyOn(window.history, 'pushState');
  const Harness = () => {
    const [open, setOpen] = useState([true, true, true]);
    return <>{['图库详情', '图片反推', '参考选择'].map((name, index) => <Layer key={name} name={name} open={open[index]} onClose={() => setOpen(previous => previous.map((value, item) => item === index ? false : value))} />)}</>;
  };
  render(<Harness />);
  const states = push.mock.calls.map(call => call[0]);
  expect(states).toHaveLength(3);
  expect(states[2].source).toBe('synthetic');
  fireEvent.click(screen.getByRole('button', { name: '参考选择' }));
  expect(window.history.back).toHaveBeenCalledOnce();
  returnTo(states[1]);
  expect(screen.queryByRole('button', { name: '参考选择' })).toBeNull();
  expect(screen.getByRole('button', { name: '图片反推' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '图库详情' })).toBeTruthy();
  returnTo(states[0]);
  expect(screen.queryByRole('button', { name: '图片反推' })).toBeNull();
  expect(screen.getByRole('button', { name: '图库详情' })).toBeTruthy();
  returnTo({ source: 'synthetic' });
  expect(screen.queryByRole('button')).toBeNull();
  expect(window.history.back).toHaveBeenCalledOnce();
});

it.each(['aitag-detail', 'pixiv-detail', 'danbooru-detail', 'history-detail', 'inspiration-detail'])('%s 保留在后台时不响应其他页面返回，重新激活后正常关闭', name => {
  const close = vi.fn();
  const draw = (active: boolean) => <ImageActivityContext.Provider value={active}><Layer name={name} open onClose={close} /></ImageActivityContext.Provider>;
  const { rerender } = render(draw(true));
  expect(window.history.state.__naiMobileLayer).toContain(name);
  rerender(draw(false));
  returnTo({ source: 'synthetic' });
  expect(close).not.toHaveBeenCalled();
  rerender(draw(true));
  returnTo({ source: 'synthetic' });
  expect(close).toHaveBeenCalledOnce();
});

it('桌面侧栏不添加移动端返回层', () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  const close = vi.fn();
  render(<Layer name="desktop" open onClose={close} />);
  expect(window.history.state).toEqual({ source: 'synthetic' });
  fireEvent.click(screen.getByRole('button', { name: 'desktop' }));
  expect(close).toHaveBeenCalledOnce();
  expect(window.history.back).not.toHaveBeenCalled();
});
