// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { plugin } = vi.hoisted(() => ({ plugin: { systemBars: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: {}, registerPlugin: () => plugin }));
import { isDarkColor, opaqueHex, syncSystemBars } from '../../../mobile/systemBars';

beforeEach(() => {
  vi.clearAllMocks();
  plugin.systemBars.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', () => ({ addEventListener: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.className = ''; document.body.style.background = ''; });

it('计算样式颜色转为不透明十六进制，透明底返回空', () => {
  expect(opaqueHex('rgb(17, 24, 39)')).toBe('#111827');
  expect(opaqueHex('rgba(255, 255, 255, 0.92)')).toBe('#ffffff');
  expect(opaqueHex('rgb(18 21 28 / 88%)')).toBe('#12151c');
  expect(opaqueHex('rgba(0, 0, 0, 0)')).toBeNull();
  expect(opaqueHex('transparent')).toBeNull();
});

it('按底色亮度决定图标明暗，不看手机系统深色模式', () => {
  expect(isDarkColor('#111827')).toBe(true);
  expect(isDarkColor('#f5f7fb')).toBe(false);
  expect(isDarkColor('#6b7280')).toBe(true);
});

it('系统栏跟随页面底色，主题切换后重新同步且相同颜色不重复调用', async () => {
  document.body.style.background = 'rgb(245, 247, 251)';
  syncSystemBars();
  expect(plugin.systemBars).toHaveBeenLastCalledWith({ color: '#f5f7fb', dark: false });
  document.body.style.background = 'rgb(17, 24, 39)';
  document.documentElement.classList.add('dark');
  await Promise.resolve();
  expect(plugin.systemBars).toHaveBeenLastCalledWith({ color: '#111827', dark: true });
  document.documentElement.dataset.density = 'compact';
  document.documentElement.setAttribute('style', '--x: 1');
  await Promise.resolve();
  expect(plugin.systemBars).toHaveBeenCalledTimes(2);
});
