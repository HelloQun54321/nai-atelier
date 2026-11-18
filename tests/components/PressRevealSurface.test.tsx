// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PressRevealSurface } from '../../components/PressRevealSurface';
import { installPointerEvents } from '../support/touchEvents';

beforeEach(() => { installPointerEvents(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const down = (target: Element, extra: PointerEventInit = {}) => fireEvent.pointerDown(target, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20, ...extra });
const advance = (ms = 450) => act(() => vi.advanceTimersByTime(ms));
const revealed = (target: Element) => target.getAttribute('data-press-revealed') === 'true';
const sheetAction = (name: string) => within(screen.getByRole('dialog', { name: '作品操作' })).getByRole('button', { name });
const fixture = () => {
  const open = vi.fn(), action = vi.fn();
  const view = render(<PressRevealSurface role="button" aria-label="作品" tabIndex={0} onClick={open}>
    <button aria-label="图片" onClick={open}><img alt="图片" /></button>
    <button data-card-action="true" aria-label="收藏" className="hover-reveal-touch" onClick={event => { event.stopPropagation(); action(); }}>♥</button>
    <input aria-label="名称" onClick={event => event.stopPropagation()} />
  </PressRevealSurface>);
  return { ...view, root: screen.getByRole('button', { name: '作品' }), image: screen.getByRole('img'), open, action };
};

it('450ms 显露，松手和离开仍保留；消耗释放点击，不误开作品', () => {
  const { root, image, open } = fixture();
  expect(revealed(root)).toBe(false); down(image); advance(449); expect(revealed(root)).toBe(false);
  advance(1); expect(revealed(root)).toBe(true);
  fireEvent.pointerUp(image); fireEvent.pointerLeave(root); fireEvent.click(image, { detail: 1 });
  expect(open).not.toHaveBeenCalled(); expect(revealed(root)).toBe(true);
  down(root); advance(50); fireEvent.pointerUp(root); fireEvent.click(root);
  expect(open).toHaveBeenCalledOnce();
});
it('普通点按保留原行为且不会迟到显露', () => {
  const { root, open } = fixture(); down(root); advance(100); fireEvent.pointerUp(root); fireEvent.click(root); advance();
  expect(open).toHaveBeenCalledOnce(); expect(revealed(root)).toBe(false);
});
it.each([100, 450])('位移超过 10px 取消等待／收起已显露操作（%sms）', delay => {
  const { root, open } = fixture(); down(root); advance(delay);
  fireEvent.pointerMove(root, { pointerType: 'touch', clientX: 20, clientY: 35 }); advance();
  fireEvent.pointerUp(root); fireEvent.click(root, { detail: 1 }); expect(open).not.toHaveBeenCalled();
  expect(revealed(root)).toBe(false);
});
it.each([100, 450])('滚动立即取消等待／收起已显露操作（%sms）', delay => {
  const { root } = fixture(); down(root); advance(delay); fireEvent.scroll(root); advance();
  expect(revealed(root)).toBe(false);
});
it.each([100, 450])('系统接管手势时取消等待／收起操作（%sms）', delay => {
  const { root } = fixture(); down(root); advance(delay); fireEvent.pointerCancel(root); advance();
  expect(revealed(root)).toBe(false);
});
it('点外部收起，外部点按正常执行', () => {
  const { root } = fixture(); const outside = document.createElement('button'); document.body.append(outside);
  const click = vi.fn(); outside.onclick = click;
  down(root); advance(); fireEvent.pointerUp(root); down(outside); fireEvent.click(outside);
  expect(revealed(root)).toBe(false); expect(click).toHaveBeenCalledOnce();
});
it('长按另一张卡只保留一组显露操作', () => {
  const action = (label: string) => <button data-card-action="true" className="hover-reveal-md" aria-label={label}>{label}</button>;
  render(<><PressRevealSurface role="button" aria-label="A">{action('下载 A')}</PressRevealSurface><PressRevealSurface role="button" aria-label="B">{action('下载 B')}</PressRevealSurface></>);
  const a = screen.getByRole('button', { name: 'A' }), b = screen.getByRole('button', { name: 'B' });
  down(a); advance(); fireEvent.pointerUp(a); down(b); expect(revealed(a)).toBe(false); advance();
  expect(revealed(b)).toBe(true);
});
it('显露后操作直接可点；浏览器不发释放点击时也不会吞掉操作', () => {
  const { root, action, open } = fixture(); down(root); advance(); fireEvent.pointerUp(root);
  const favorite = within(root).getByRole('button', { name: '收藏' }); down(favorite); advance(); fireEvent.pointerUp(favorite); fireEvent.click(favorite);
  expect(action).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});
it.each([
  { pointerType: 'mouse', button: 0 }, { pointerType: 'touch', button: 2 }, { pointerType: 'touch', isPrimary: false },
])('鼠标／右键／多指不启动长按：%j', extra => {
  const { root } = fixture(); down(root, extra); advance(); expect(revealed(root)).toBe(false);
});
it('输入及显式操作不启动长按，键盘事件仍交给原控件', () => {
  const { root } = fixture(); const input = screen.getByRole('textbox'); down(input); advance(); expect(revealed(root)).toBe(false);
  const favorite = screen.getByRole('button', { name: '收藏' }); down(favorite); advance(); expect(revealed(root)).toBe(false);
  fireEvent.keyDown(favorite, { key: 'Enter' }); expect(revealed(root)).toBe(false);
});
it('进入独立选择流程停用长按，卸载清理未完成计时', () => {
  const view = render(<PressRevealSurface role="button" aria-label="作品" />); const root = screen.getByRole('button'); down(root); advance(100);
  view.rerender(<PressRevealSurface pressDisabled role="button" aria-label="作品" />); advance(); expect(revealed(root)).toBe(false);
  view.rerender(<PressRevealSurface role="button" aria-label="作品" />); down(root); view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('只有触摸抑制原生长按菜单，鼠标右键保留', () => {
  const { root } = fixture(); down(root); expect(fireEvent.contextMenu(root)).toBe(false);
  expect(fireEvent.contextMenu(screen.getByRole('textbox'))).toBe(true);
  fireEvent.pointerEnter(root, { pointerType: 'mouse' }); expect(fireEvent.contextMenu(root)).toBe(true);
});
it('手机界面里鼠标右键打开同一条操作条', () => {
  const media = (query: string) => ({ matches: query.includes('max-width: 767px'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('matchMedia', media);
  const { root, action, open } = fixture();
  fireEvent.pointerEnter(root, { pointerType: 'mouse' });
  expect(fireEvent.contextMenu(root, { button: 2 })).toBe(false);
  expect(root.getAttribute('data-mobile-ui')).toBe('true');
  expect(root.getAttribute('data-press-revealed')).toBeNull();
  expect(root.getAttribute('data-press-lift')).toBe('true');
  within(root).getByRole('button', { name: '收藏' }).style.pointerEvents = 'none';
  const item = sheetAction('收藏');
  fireEvent.pointerDown(item);
  expect(screen.getByRole('dialog', { name: '作品操作' })).toBeTruthy();
  expect(fireEvent.contextMenu(screen.getByRole('textbox'), { button: 2 })).toBe(true);
  fireEvent.click(item);
  expect(action).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(revealed(root)).toBe(false);
  expect(root.hasAttribute('data-press-input')).toBe(false);
});
it('窄窗鼠标右键的面板里，鼠标按下不会提前撤掉面板', () => {
  const media = (query: string) => ({ matches: query.includes('max-width: 767px'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('matchMedia', media);
  const { root, action, open } = fixture();
  fireEvent.pointerEnter(root, { pointerType: 'mouse' });
  expect(fireEvent.contextMenu(root, { button: 2 })).toBe(false);
  const item = sheetAction('收藏');
  // 面板是卡片的 React 子节点（portal），鼠标按在行上也会回到卡片的 pointerdown。
  // 这里若把输入模式按指针类型改回 mouse，面板会在 pointerup／click 之前被卸载。
  fireEvent.pointerDown(item, { pointerType: 'mouse', button: 0, isPrimary: true });
  expect(root.getAttribute('data-press-input')).toBe('touch');
  expect(screen.getByRole('dialog', { name: '作品操作' })).toBeTruthy();
  fireEvent.pointerUp(item, { pointerType: 'mouse', button: 0 });
  fireEvent.click(item);
  expect(action).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(revealed(root)).toBe(false);
});
it('窄窗右键面板里的关闭和空白点击不会同时点开作品', () => {
  const media = (query: string) => ({ matches: query.includes('max-width: 767px'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('matchMedia', media);
  const { root, open } = fixture();
  fireEvent.pointerEnter(root, { pointerType: 'mouse' });
  fireEvent.contextMenu(root, { button: 2 });
  const dialog = screen.getByRole('dialog', { name: '作品操作' });
  fireEvent.click(within(dialog).getByLabelText('关闭'));
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(dialog);
  expect(open).not.toHaveBeenCalled();
});
it('宽屏鼠标右键不打开操作条', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { root } = fixture();
  fireEvent.pointerEnter(root, { pointerType: 'mouse' });
  expect(fireEvent.contextMenu(root, { button: 2 })).toBe(true);
  expect(revealed(root)).toBe(false);
  expect(screen.queryByRole('dialog', { name: '作品操作' })).toBeNull();
});
it('手机界面里没有操作时右键仍保留系统菜单', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 767px'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<PressRevealSurface role="button" aria-label="作品"><img alt="图片" /></PressRevealSurface>);
  const root = screen.getByRole('button', { name: '作品' });
  fireEvent.pointerEnter(root, { pointerType: 'mouse' });
  expect(fireEvent.contextMenu(root, { button: 2 })).toBe(true);
  expect(revealed(root)).toBe(false);
});
it('长按打开底部操作条，点选后执行并收起', () => {
  const { root, action, open } = fixture();
  down(root); advance();
  expect(root.getAttribute('data-press-lift')).toBe('true');
  fireEvent.click(sheetAction('收藏'));
  expect(action).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(revealed(root)).toBe(false);
});
it.each(['touch', 'pen'])('宽屏的 %s 长按仍能打开和执行底部操作', pointerType => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { root, action, open } = fixture();
  down(root, { pointerType }); advance(); fireEvent.pointerUp(root);
  const dialog = screen.getByRole('dialog', { name: '作品操作' });
  // 触屏操作面板不受手机断点限制，宽屏的鼠标右键仍由原规则处理。
  expect(dialog.parentElement?.classList.contains('md:hidden')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: '收藏' }));
  expect(action).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: '作品操作' })).toBeNull();
});
it('没有可显露的操作时长按不拦截点按', () => {
  const open = vi.fn();
  render(<PressRevealSurface role="button" aria-label="作品" onClick={open}><img alt="图片" /></PressRevealSurface>);
  const root = screen.getByRole('button', { name: '作品' });
  down(root); advance(); fireEvent.pointerUp(root); fireEvent.click(root, { detail: 1 });
  expect(revealed(root)).toBe(false);
  expect(open).toHaveBeenCalledOnce();
});
it('手机上的详情直接用底栏，长按不再另开一层', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('hover: none'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<PressRevealSurface touchActions="bar" aria-label="大图"><button aria-label="下载图片" className="hover-reveal-md nai-float-btn">下载</button></PressRevealSurface>);
  expect(screen.getByRole('menuitem', { name: '下载图片' })).toBeTruthy();
  const root = screen.getByLabelText('大图');
  down(root); advance();
  expect(revealed(root)).toBe(false);
});
it('长按后即使没有释放点击，键盘点击也不会被吞掉', () => {
  const { root, open } = fixture(); down(root); advance(); fireEvent.pointerUp(root); fireEvent.click(root, { detail: 0 });
  expect(open).toHaveBeenCalledOnce();
});
it('内层图片长按只启动内层控件，父卡片不同时显露或打开',()=>{
  const open=vi.fn();render(<PressRevealSurface aria-label="父卡片" onClick={open}><PressRevealSurface aria-label="内层图片"><img src="synthetic.png" alt="合成预览" /><button data-card-action="true" className="hover-reveal-md" aria-label="下载">下载</button></PressRevealSurface></PressRevealSurface>);
  const parent=screen.getByLabelText('父卡片'),child=screen.getByLabelText('内层图片');down(screen.getByRole('img'));advance();fireEvent.pointerUp(child);fireEvent.click(child,{detail:1});
  expect(revealed(child)).toBe(true);expect(revealed(parent)).toBe(false);expect(open).not.toHaveBeenCalled();
});
