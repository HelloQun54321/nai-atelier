// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InfoPopover } from '../../components/InfoPopover';
import { InteractionPopover } from '../../components/InteractionPopover';
import { ImagePreviewPortal } from '../../components/ImagePreviewPortal';
import { MobileDetailView } from '../../components/MobileUI';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const RightPlacementExample: React.FC = () => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <div className="agent-stage"><button ref={anchorRef} onClick={() => setOpen(true)}>打开右侧菜单</button>
    {open && <ImagePreviewPortal><InteractionPopover id="right-test-menu" label="右侧菜单" anchorRef={anchorRef} onClose={() => setOpen(false)} width={240} placement="right"><div><button>来源一</button></div></InteractionPopover></ImagePreviewPortal>}
  </div>;
};
it.each([390, 1024, 1280])('宽度 %s 的说明留在根层并限制在视口中，不改变原容器结构', width => {
  vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', 800);
  const view = render(<div className="agent-stage safe-mode dark"><main className="isolate overflow-hidden"><InfoPopover label="详情" content={'完整说明'.repeat(20)} /></main></div>);
  const trigger = screen.getByRole('button', { name: '详情' }); const originalChildren = trigger.parentElement!.childElementCount;
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: width - 44, y: 744, width: 44, height: 44, left: width - 44, right: width, top: 744, bottom: 788, toJSON() {} });
  fireEvent.click(trigger); const dialog = screen.getByRole('dialog', { name: '详情' });
  expect(dialog.parentElement).toBe(view.container.firstElementChild); expect(dialog.closest('main')).toBeNull();
  expect(dialog.style.position).toBe('fixed'); expect(parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(8);
  expect(parseFloat(dialog.style.left) + parseFloat(dialog.style.width)).toBeLessThanOrEqual(width - 8);
  expect(parseFloat(dialog.style.top)).toBeLessThan(744); expect(trigger.parentElement!.childElementCount).toBe(originalChildren);
  fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
});
it('说明保持文本选区，Esc 只关闭顶层说明，关闭后继续编辑', () => {
  const parentEscape = vi.fn(); window.addEventListener('keydown', parentEscape);
  const view = render(<><textarea aria-label="提示词" defaultValue="masterpiece, 1girl" /><InfoPopover label="权重说明" content="所选整组" preserveSelection /></>);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement; input.focus(); input.setSelectionRange(0, 11);
  const help = screen.getByRole('button', { name: '权重说明' });
  expect(fireEvent.mouseDown(help)).toBe(false); expect(document.activeElement).toBe(input);
  fireEvent.click(help); fireEvent.keyDown(screen.getByRole('button', { name: '关闭说明' }), { key: 'Escape' });
  expect(parentEscape).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input); expect([input.selectionStart, input.selectionEnd]).toEqual([0, 11]);
  window.removeEventListener('keydown', parentEscape); view.unmount();
});

it('右侧弹层保持锚点右方与顶边对齐，贴近视口底部时向上夹住且保留内部滚动', () => {
  vi.stubGlobal('innerWidth', 1024); vi.stubGlobal('innerHeight', 800);
  const first = render(<RightPlacementExample />);
  const trigger = screen.getByRole('button', { name: '打开右侧菜单' });
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: 40, y: 90, width: 44, height: 44, left: 40, right: 84, top: 90, bottom: 134, toJSON() {} });
  fireEvent.click(trigger);
  const firstPanel = screen.getByRole('dialog', { name: '右侧菜单' });
  expect(parseFloat(firstPanel.style.left)).toBe(92);
  expect(parseFloat(firstPanel.style.top)).toBe(90);
  expect(firstPanel.style.transformOrigin).toBe('0px 22px');
  first.unmount();

  vi.stubGlobal('innerWidth', 1024); vi.stubGlobal('innerHeight', 300);
  render(<RightPlacementExample />);
  const bottomTrigger = screen.getByRole('button', { name: '打开右侧菜单' });
  vi.spyOn(bottomTrigger, 'getBoundingClientRect').mockReturnValue({ x: 40, y: 250, width: 44, height: 44, left: 40, right: 84, top: 250, bottom: 294, toJSON() {} });
  fireEvent.click(bottomTrigger);
  const bottomPanel = screen.getByRole('dialog', { name: '右侧菜单' });
  expect(parseFloat(bottomPanel.style.top)).toBe(8);
  expect(parseFloat(bottomPanel.style.maxHeight)).toBe(284);
  expect(bottomPanel.style.transformOrigin).toBe('0px 264px');
  expect(bottomPanel.className).toContain('overflow-y-auto');
});

const returnTo = (state: unknown) => {
  window.history.replaceState(state, '');
  fireEvent(window, new PopStateEvent('popstate', { state }));
};
const DetailWithInfo = () => {
  const [open, setOpen] = useState(true);
  return <div className="agent-stage"><MobileDetailView open={open} title="合成作品详情" onClose={() => setOpen(false)}>
    <InfoPopover label="作品信息" content="合成说明" />
  </MobileDetailView></div>;
};

it.each(['系统返回', '关闭说明', 'Escape', '点外关闭'])('手机详情内的信息浮层%s只退当前层，下一次返回才关闭详情', async method => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
  window.history.replaceState({ source: 'synthetic-info' }, '');
  const base = window.history.state;
  render(<DetailWithInfo />);
  const detailState = window.history.state;
  expect(detailState.__naiMobileLayers).toHaveLength(1);
  const trigger = screen.getByRole('button', { name: '作品信息' });
  trigger.focus(); fireEvent.click(trigger);
  expect(window.history.state.__naiMobileLayers).toHaveLength(2);
  if (method === '关闭说明') fireEvent.click(screen.getByRole('button', { name: '关闭说明' }));
  if (method === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  if (method === '点外关闭') fireEvent.pointerDown(document.body);
  if (method !== '系统返回') await waitFor(() => expect(window.history.back).toHaveBeenCalledOnce());
  returnTo(detailState);
  expect(screen.queryByRole('dialog', { name: '作品信息' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '合成作品详情' })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  returnTo(base);
  expect(screen.queryByRole('dialog', { name: '合成作品详情' })).toBeNull();
});

it('桌面独立信息浮层不添加手机返回层', () => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  window.history.replaceState({ source: 'synthetic-desktop' }, '');
  render(<InfoPopover label="桌面说明" content="合成说明" />);
  fireEvent.click(screen.getByRole('button', { name: '桌面说明' }));
  expect(window.history.state).toEqual({ source: 'synthetic-desktop' });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '桌面说明' })).toBeNull();
});
