// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AitagWorkSummary } from '../services/aitagService';
import type { User } from '../types';

const mocks = vi.hoisted(() => ({
  search: vi.fn(), searchCache: vi.fn(), getWork: vi.fn(), getMonths: vi.fn(), getCacheStatus: vi.fn(), setFavorite: vi.fn(),
  masonry: vi.fn(), createChain: vi.fn(), navigate: vi.fn(), saveInspiration: vi.fn(),
}));
vi.mock('../services/aitagService', async original => ({
  ...await original<typeof import('../services/aitagService')>(),
  aitagService: { ...mocks },
}));
vi.mock('../services/dbService', () => ({ db: { saveInspiration: mocks.saveInspiration } }));
vi.mock('./ShortestColumnMasonry', () => ({
  useMasonryColumnCount: () => 3,
  ShortestColumnMasonry: (props: { items: AitagWorkSummary[]; renderItem: (work: AitagWorkSummary) => React.ReactNode }) => {
    mocks.masonry(props);
    return <div>{props.items.map(props.renderItem)}</div>;
  },
}));
vi.mock('./SmartImage', async () => {
  const { createContext } = await import('react');
  return {
    ImageActivityContext: createContext(true),
    SmartImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
    OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
  };
});
vi.mock('./ImageTaggerPanel', () => ({ ImageTaggerAction: () => null }));
vi.mock('./ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: { children: React.ReactNode }) => children }));

const works: AitagWorkSummary[] = [1, 2].map(id => ({
  id, title: `合成作品 ${id}`, AI_type: 'NAI', image_count: 2, hasFullyCachedImages: true, hasCachedDetail: true,
  localFirstImageUrl: `/synthetic/${id}.png`,
  firstImage: { id, work_id: id, author_id: 1, image_type: 'nai', file_name: `${id}.png`, local_image_url: `/api/assets/aitag/${id}.png`, model: id === 1 ? 'NovelAI Diffusion V4.5' : 'NovelAI Diffusion V5', prompt_text: 'synthetic prompt', ai_json: { prompt: `synthetic prompt ${id}`, uc: 'synthetic negative', width: 832, height: 1216, steps: 23, seed: 123, model: id === 1 ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full' } },
}));
const callbacks = new Set<() => void>();
const tops: Record<number, number> = { 1: 1800, 2: 2500 };
const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 800, width: 800 } as DOMRect);

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); callbacks.clear();
  document.documentElement.className = ''; delete document.documentElement.dataset.safeMode;
  tops[1] = 1800; tops[2] = 2500;
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? works : [], total: 2, page: options.page, page_size: 60 }));
  mocks.searchCache.mockImplementation(mocks.search);
  mocks.getMonths.mockResolvedValue({ months: [] });
  mocks.getCacheStatus.mockResolvedValue({ total: 2 });
  mocks.setFavorite.mockResolvedValue({});
  mocks.createChain.mockResolvedValue(undefined);
  mocks.saveInspiration.mockResolvedValue(undefined);
  mocks.getWork.mockImplementation(async id => ({ work: works.find(work => work.id === id), images: [works[id - 1].firstImage] }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { callbacks.add(callback); }
    observe() {} unobserve() {} disconnect() { callbacks.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(4000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = Number(this.dataset.galleryWorkId);
    return id ? rect(100 + tops[id] - (this.closest('main')?.scrollTop ?? 0), 300) : rect(100, 600);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.className = ''; delete document.documentElement.dataset.safeMode; });
const setup = async (layout = 'masonry') => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout }));
  const { AitagGallery } = await import('./AitagGallery');
  const { ImageActivityContext } = await import('./SmartImage');
  const notify = vi.fn();
  const draw = (active: boolean) => <ImageActivityContext.Provider value={active}><AitagGallery active={active} currentUser={{ id: 'synthetic' } as User} notify={notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.createChain} /></ImageActivityContext.Provider>;
  const view = render(draw(true));
  await screen.findByRole('button', { name: '查看作品 合成作品 1' });
  return { ...view, draw, notify, main: view.container.querySelector('main')! };
};
const card = (id: number) => screen.getByRole('button', { name: `查看作品 合成作品 ${id}` });
const selected = (id: number) => expect(card(id).getAttribute('aria-pressed')).toBe('true');
const noSelection = () => works.forEach(work => {
  expect(card(work.id).getAttribute('aria-pressed')).toBe('false');
  expect(card(work.id).className).not.toContain('brightness-');
});

it('Agent 读取实际打开的 AITag 详情和作品编号，切换或关闭后同步更新', async () => {
  const { container } = await setup(); container.dataset.agentView = 'aitag';
  const { readAgentPage } = await import('../services/agentWorkspace');
  expect(readAgentPage().title).toBe('AITag');
  fireEvent.click(card(1)); await screen.findByText('synthetic prompt 1');
  const detail = readAgentPage(); expect(detail.title).toBe('AITag · 作品详情：合成作品 1'); expect(detail.foreground).toBe('detail');
  expect(detail.text).toContain('#1 · NAI'); expect(detail.text).toContain('synthetic prompt 1'); expect(detail.text).not.toContain('合成作品 2');
  fireEvent.click(card(2)); await screen.findByText('synthetic prompt 2');
  const next = readAgentPage(); expect(next.title).toBe('AITag · 作品详情：合成作品 2'); expect(next.snapshotId).not.toBe(detail.snapshotId); expect(next.text).not.toContain('synthetic prompt 1');
  fireEvent.click(screen.getByRole('button', { name: '关闭' })); expect(readAgentPage().title).toBe('AITag'); expect(readAgentPage().foreground).toBe('');
});

it.each(['masonry', 'portrait', 'square'])('%s 布局中选中正常亮度、其余压暗，主题与安全模式保留原规则', async layout => {
  const { main } = await setup(layout);
  fireEvent.click(card(1));
  await waitFor(() => selected(1));
  expect(main.scrollTop).toBe(1650);
  expect(card(1).className).toContain('ring-2');
  expect(card(1).className).not.toContain('brightness-');
  expect(card(2).className).toContain('brightness-[.7]');
  expect(card(1).getAttribute('data-safe-mode-work')).toBe('true');
  document.documentElement.classList.add('dark'); document.documentElement.dataset.safeMode = 'true';
  fireEvent.click(card(2));
  selected(2);
  expect(main.scrollTop).toBe(2350);
  expect(card(1).className).toContain('brightness-[.7]');
  expect(card(2).className).not.toContain('brightness-');
  if (layout === 'masonry') expect(mocks.masonry.mock.lastCall?.[0].stableColumns).toBe(true);
});

it('再次点击或使用 Enter／空格取消，❌ 也取消且关闭重排不跳离原作品', async () => {
  const { main } = await setup();
  fireEvent.click(card(1));
  await waitFor(() => expect(mocks.getWork).toHaveBeenCalledTimes(1));
  fireEvent.click(card(1));
  noSelection();
  fireEvent.keyDown(card(1), { key: 'Enter' }); selected(1);
  fireEvent.keyDown(card(1), { key: ' ' }); noSelection();
  fireEvent.click(card(1)); selected(1);
  fireEvent.scroll(main);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  noSelection();
  tops[1] += 400;
  act(() => callbacks.forEach(callback => callback()));
  expect(main.scrollTop).toBe(2050);
  expect(main.className).toContain('block');
});

it('收藏和收藏按钮键盘事件不切换焦点，也不关闭选中详情', async () => {
  await setup();
  fireEvent.click(card(1)); selected(1);
  const favorite = within(card(2)).getByRole('button', { name: '收藏' });
  fireEvent.keyDown(favorite, { key: 'Enter' }); selected(1);
  fireEvent.click(favorite);
  await waitFor(() => expect(mocks.setFavorite).toHaveBeenCalledWith(2, true, expect.any(Object)));
  selected(1);
  fireEvent.click(within(card(1)).getByRole('button', { name: '收藏' }));
  selected(1);
});

it('切换作品分别恢复详情滚动，再次打开同一作品仍从上次阅读处继续', async () => {
  const { container } = await setup();
  fireEvent.click(card(1));
  await waitFor(() => expect(mocks.getWork).toHaveBeenCalledTimes(1));
  const body = container.querySelector('aside > div')!;
  body.scrollTop = 760; fireEvent.scroll(body);
  fireEvent.click(card(2));
  expect(body.scrollTop).toBe(0);
  body.scrollTop = 420; fireEvent.scroll(body);
  fireEvent.click(card(1));
  expect(body.scrollTop).toBe(760);
  fireEvent.click(card(1)); noSelection();
  fireEvent.click(card(1)); selected(1);
  expect(body.scrollTop).toBe(760);
});

it('切换页面后选择、暗态、卡片定位和详情内部滚动一起恢复', async () => {
  const { main, draw, rerender, container } = await setup();
  fireEvent.click(card(1));
  await waitFor(() => expect(mocks.getWork).toHaveBeenCalledTimes(1));
  const body = container.querySelector('aside > div')!;
  body.scrollTop = 820; fireEvent.scroll(body); fireEvent.scroll(main);
  rerender(draw(false));
  main.scrollTop = 0; body.scrollTop = 0;
  fireEvent.scroll(main); fireEvent.scroll(body);
  tops[1] += 200;
  rerender(draw(true));
  selected(1);
  expect(card(2).className).toContain('brightness-[.7]');
  expect(main.scrollTop).toBe(1850);
  expect(body.scrollTop).toBe(820);
});

it('模型筛选移走当前作品时清除详情与暗态，搜索也不会留下旧选择', async () => {
  await setup();
  fireEvent.click(card(1)); selected(1);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const models = screen.getAllByLabelText('模型版本（已加载条目）')[0];
  const next = Array.from((models as HTMLSelectElement).options).find(option => option.textContent?.includes('V5'))!;
  fireEvent.change(models, { target: { value: next.value } });
  expect(screen.queryByRole('button', { name: '查看作品 合成作品 1' })).toBeNull();
  expect(card(2).className).not.toContain('brightness-');
  expect(document.querySelector('aside')!.className).toContain('aitag-detail-panel--closed');
  fireEvent.change(models, { target: { value: '' } });
  fireEvent.click(card(1)); selected(1);
  const input = screen.getByPlaceholderText('作品、作者、标题或标签，回车检索');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(noSelection);
});

it('窄屏返回取消详情，离开 AITag 后返回事件不清掉保留的作品选择', async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const { draw, rerender } = await setup();
  fireEvent.click(card(1)); selected(1);
  expect(window.history.state.__naiMobileLayer).toContain('aitag-detail-');
  rerender(draw(false));
  fireEvent(window, new PopStateEvent('popstate'));
  selected(1);
  rerender(draw(true));
  fireEvent(window, new PopStateEvent('popstate'));
  noSelection();
  expect(document.querySelector('aside')!.className).toContain('aitag-detail-panel--closed');
  window.history.replaceState({}, '');
});

it('详情请求尚未完成时取消，迟到结果不会重开详情或恢复暗态', async () => {
  let resolve!: (value: unknown) => void;
  mocks.getWork.mockImplementation(() => new Promise(done => { resolve = done; }));
  await setup();
  fireEvent.click(card(1)); selected(1);
  fireEvent.click(card(1)); noSelection();
  await act(async () => resolve({ work: works[0], images: [works[0].firstImage] }));
  noSelection();
  expect(document.querySelector('aside')!.className).toContain('aitag-detail-panel--closed');
});

it('用已显示的 JSON 和本地图片保存，立即显示忙碌并阻止连点，完成后才通知成功', async () => {
  let resolve!: () => void;
  mocks.createChain.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const { notify } = await setup();
  fireEvent.click(card(1));
  const button = await screen.findByRole('button', { name: '保存到风格串' });
  fireEvent.click(button); fireEvent.click(button);
  expect(mocks.createChain).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(notify).not.toHaveBeenCalledWith('已保存到风格串');
  expect(mocks.createChain.mock.calls[0][0]).toMatchObject({
    name: '合成作品 1 P1', basePrompt: 'synthetic prompt 1', negativePrompt: 'synthetic negative',
    previewImage: '/api/assets/aitag/1.png', tags: [], params: { seed: 123, steps: 23 },
  });
  expect(mocks.getWork).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已保存到风格串'));
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

it('失败只显示错误并恢复按钮，重试可以保存，其他复用入口仍使用当前元数据', async () => {
  const { notify } = await setup();
  mocks.createChain.mockRejectedValueOnce(new Error('模拟写入失败'));
  fireEvent.click(card(2));
  const button = await screen.findByRole('button', { name: '保存到风格串' });
  fireEvent.click(button);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('模拟写入失败', 'error'));
  expect(notify).not.toHaveBeenCalledWith('已保存到风格串');
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已保存到风格串'));
  expect(mocks.createChain).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toMatchObject({ prompt: 'synthetic prompt 2', params: { steps: 23, seed: 123 } });
  expect(mocks.getWork).toHaveBeenCalledTimes(1);
});

it('相邻的加入灵感库同样显示进度并拦截连点，保持原本不跳转的行为', async () => {
  let resolve!: () => void;
  mocks.saveInspiration.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const { notify } = await setup(); fireEvent.click(card(1));
  const button = await screen.findByRole('button', { name: '加入灵感库' });
  fireEvent.click(button); fireEvent.click(button);
  expect(mocks.saveInspiration).toHaveBeenCalledTimes(1);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect((screen.getByRole('button', { name: '保存到风格串' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.saveInspiration.mock.calls[0][0]).toMatchObject({ imageUrl: '/api/assets/aitag/1.png', prompt: 'synthetic prompt 1', sourceType: 'aitag' });
  await act(async () => resolve());
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已加入灵感库'));
  expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.createChain).not.toHaveBeenCalled();
  expect(mocks.getWork).toHaveBeenCalledTimes(1);
});
