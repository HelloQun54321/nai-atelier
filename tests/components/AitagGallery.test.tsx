import { toggleCollectionTarget } from '../../services/collectionFavorites';
import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AitagWorkSummary } from '../../services/aitagService';
import type { User } from '../../types';
import { copySharedImage, downloadSharedImage } from '../../services/imageSharing';
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}) }));

const mocks = vi.hoisted(() => ({
  search: vi.fn(), searchCache: vi.fn(), getWork: vi.fn(), getMonths: vi.fn(), getCacheStatus: vi.fn(), setFavorite: vi.fn(),
  masonry: vi.fn(), createChain: vi.fn(), navigate: vi.fn(), saveInspiration: vi.fn(), getInspirationBoards: vi.fn(),
  realMasonry: false,
}));
vi.mock('../../services/aitagService', async original => ({
  ...await original<typeof import('../../services/aitagService')>(),
  aitagService: { ...mocks },
}));
vi.mock('../../services/dbService', () => ({ db: { getInspirationBoards: mocks.getInspirationBoards, saveInspiration: mocks.saveInspiration } }));
vi.mock('../../components/ShortestColumnMasonry', async original => {
  const actual = await original<typeof import('../../components/ShortestColumnMasonry')>();
  return { ...actual, useMasonryColumnCount: () => 3,
    ShortestColumnMasonry: (props: Parameters<typeof actual.ShortestColumnMasonry<AitagWorkSummary>>[0]) => {
      mocks.masonry(props);
      if (mocks.realMasonry) return <actual.ShortestColumnMasonry {...props} />;
      return <div>{props.items.map(props.renderItem)}</div>;
    },
  };
});
vi.mock('../../components/SmartImage', async () => {
  const { createContext } = await import('react');
  return {
    ImageActivityContext: createContext(true),
    SmartImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
    OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
  };
});
vi.mock('../../components/ImageTaggerPanel', () => ({ ImageTaggerAction: () => null }));
vi.mock('../../components/ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: { children: React.ReactNode }) => children }));

const works: AitagWorkSummary[] = [1, 2].map(id => ({
  id, title: `合成作品 ${id}`, AI_type: 'NAI', image_count: 2, hasFullyCachedImages: true, hasCachedDetail: true,
  localFirstImageUrl: `/synthetic/${id}.png`,
  firstImage: { id, work_id: id, author_id: 1, image_type: 'nai', file_name: `${id}.png`, local_image_url: `/api/assets/aitag/${id}.png`, model: id === 1 ? 'NovelAI Diffusion V4.5' : 'NovelAI Diffusion V5', prompt_text: 'synthetic prompt', ai_json: { prompt: `synthetic prompt ${id}`, uc: 'synthetic negative', width: 832, height: 1216, steps: 23, seed: 123, model: id === 1 ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full' } },
}));
const callbacks = new Set<() => void>();
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; });
const tops: Record<number, number> = { 1: 1800, 2: 2500 };
const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 800, width: 800 } as DOMRect);

beforeEach(() => {
  document.documentElement.dataset.motion = 'full';
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); callbacks.clear();
  mocks.realMasonry = false;
  document.documentElement.className = ''; delete document.documentElement.dataset.safeMode;
  tops[1] = 1800; tops[2] = 2500;
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? works : [], total: 2, page: options.page, page_size: 60 }));
  mocks.searchCache.mockImplementation(mocks.search);
  mocks.getMonths.mockResolvedValue({ months: [] });
  mocks.getCacheStatus.mockResolvedValue({ total: 2 });
  mocks.setFavorite.mockResolvedValue({});
  mocks.createChain.mockResolvedValue(undefined);
  mocks.saveInspiration.mockResolvedValue(undefined);
  mocks.getInspirationBoards.mockResolvedValue([]);
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
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.className = ''; delete document.documentElement.dataset.safeMode; delete document.documentElement.dataset.motion;
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});
const setup = async (layout = 'masonry') => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout }));
  const { AitagGallery } = await import('../../components/AitagGallery');
  const { ImageActivityContext } = await import('../../components/SmartImage');
  const notify = vi.fn();
  const draw = (active: boolean) => <ImageActivityContext.Provider value={active}><AitagGallery active={active} currentUser={{ id: 'synthetic' } as User} notify={notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.createChain} /></ImageActivityContext.Provider>;
  const view = render(draw(true));
  await screen.findByRole('button', { name: '查看作品 合成作品 1' });
  return { ...view, draw, notify, main: view.container.querySelector('main')! };
};
const card = (id: number) => screen.getByRole('button', { name: `查看作品 合成作品 ${id}` });
const selected = (id: number) => expect(card(id).getAttribute('aria-pressed')).toBe('true');
it('首图操作跟随实际候选，点击和回车不打开详情；详情逐图导出且按文件顺序命名', async () => {
  await setup();
  const first = card(1);
  fireEvent.click(within(first).getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith('/synthetic/1.png', false));
  fireEvent.error(first.querySelector('img')!);
  fireEvent.click(within(first).getByRole('button', { name: '下载图片' }));
  await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith('/api/assets/aitag/1.png', 'aitag-1-p1.png', false));
  fireEvent.keyDown(within(first).getByRole('button', { name: '复制图片' }), { key: 'Enter' });
  expect(mocks.getWork).not.toHaveBeenCalled();
  expect(first.getAttribute('aria-pressed')).toBe('false');
  mocks.getWork.mockResolvedValueOnce({ work: works[0], images: [
    { ...works[0].firstImage!, id: 12, file_name: '2.png', local_image_url: '/synthetic/detail-2.png' },
    { ...works[0].firstImage!, id: 11, file_name: '1.png', local_image_url: '/synthetic/detail-1.png' },
  ] });
  fireEvent.click(first);
  // 两张详情图都沿用各自的长按容器，操作不会收起详情。
  await waitFor(() => expect(document.querySelector('img[src="/synthetic/detail-2.png"]')).toBeTruthy());
  const surface = document.querySelector('img[src="/synthetic/detail-2.png"]')!.closest('.press-reveal-surface')!;
  fireEvent.click(within(surface as HTMLElement).getByRole('button', { name: '下载图片' }));
  await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith('/synthetic/detail-2.png', 'aitag-1-p2.png', false));
  expect(first.getAttribute('aria-pressed')).toBe('true');
});
const noSelection = () => works.forEach(work => {
  expect(card(work.id).getAttribute('aria-pressed')).toBe('false');
  expect(card(work.id).className).not.toContain('brightness-');
});

it.each([['NAI', 1], ['SD', 4]])('猜测 p0 失败后使用 %s 作品实际的 p%s 首图，不必打开作品组', async (imageType, firstPage) => {
  const remote = `https://ai-img.10118899.xyz/${imageType}/1/1_p0.webp`;
  const work = { ...works[0], AI_type: imageType, firstImage: undefined, localFirstImageUrl: undefined, remoteFirstImageUrl: remote, hasCachedDetail: false, hasFullyCachedImages: false };
  mocks.search.mockResolvedValue({ items: [work, works[1]], total: 2, page: 1, page_size: 60 });
  mocks.getWork.mockResolvedValue({ work, images: [{ ...works[0].firstImage!, image_type: imageType, file_name: `1_p${firstPage}`, local_image_url: undefined }] });
  await setup();
  expect(card(1).querySelector('img')?.getAttribute('src')).toBe(remote);
  expect(mocks.getWork).not.toHaveBeenCalled();
  fireEvent.error(card(1).querySelector('img')!);
  await waitFor(() => expect(card(1).querySelector('img')?.getAttribute('src')).toBe(`https://ai-img.10118899.xyz/${imageType}/1/1_p${firstPage}.webp`));
  expect(mocks.getWork).toHaveBeenCalledExactlyOnceWith(1);
  noSelection();
  expect(document.querySelector('aside')!.className).toContain('aitag-detail-panel--closed');
  fireEvent.click(within(card(1)).getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(`/api/media?source=${encodeURIComponent(`https://ai-img.10118899.xyz/${imageType}/1/1_p${firstPage}.webp`)}&variant=original`, false));
  // 真实地址也失败时保留原有错误出口，不循环请求详情。
  fireEvent.error(card(1).querySelector('img')!);
  fireEvent.error(card(1).querySelector('img')!);
  expect(within(card(1)).getByText('图片加载失败')).toBeTruthy();
  expect(mocks.getWork).toHaveBeenCalledTimes(1);
});

it('首图详情请求失败后保留错误出口，重试可重新取得真实首图且不选择作品', async () => {
  const work = { ...works[0], firstImage: undefined, localFirstImageUrl: undefined, remoteFirstImageUrl: 'https://ai-img.10118899.xyz/NAI/1/1_p0.webp', hasCachedDetail: false, hasFullyCachedImages: false };
  mocks.search.mockResolvedValue({ items: [work, works[1]], total: 2, page: 1, page_size: 60 });
  mocks.getWork.mockRejectedValueOnce(new Error('模拟详情连接失败')).mockResolvedValue({ work, images: [{ ...works[0].firstImage!, local_image_url: '/synthetic/actual-p1.webp' }] });
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  await setup();
  fireEvent.error(card(1).querySelector('img')!);
  await waitFor(() => expect(errorLog).toHaveBeenCalled());
  expect(mocks.getWork).toHaveBeenCalledTimes(1);
  const retry = within(card(1)).getByRole('button', { name: '重试' });
  fireEvent.keyDown(retry, { key: 'Enter' }); fireEvent.click(retry);
  noSelection();
  fireEvent.error(card(1).querySelector('img')!);
  await waitFor(() => expect(card(1).querySelector('img')?.getAttribute('src')).toBe('/synthetic/actual-p1.webp'));
  expect(mocks.getWork).toHaveBeenCalledTimes(2);
  noSelection();
});

it('封面候选耗尽后显示失败、重试和原页入口，重试不误开详情', async () => {
  await setup();
  const preview = () => card(1).querySelector('img')!;
  expect(preview().getAttribute('src')).toBe('/synthetic/1.png');
  fireEvent.error(preview());
  expect(preview().getAttribute('src')).toBe('/api/assets/aitag/1.png');
  fireEvent.error(preview());
  expect(within(card(1)).getByText('图片加载失败')).toBeTruthy();
  expect(within(card(1)).getByRole('link', { name: '打开原页' }).getAttribute('href')).toContain('aitag.win');
  const retry = within(card(1)).getByRole('button', { name: '重试' });
  fireEvent.keyDown(retry, { key: 'Enter' }); fireEvent.click(retry);
  expect(preview().getAttribute('src')).toBe('/synthetic/1.png');
  expect(mocks.getWork).not.toHaveBeenCalled();
  noSelection();
});

it('详情首图完成本地缓存后，封面立即改用本地地址而不保留旧远程失败进度', async () => {
  const remote = 'https://ai-img.10118899.xyz/nai/1/synthetic.webp';
  const work = { ...works[0], localFirstImageUrl: undefined, firstImage: { ...works[0].firstImage!, local_image_url: undefined, remote_image_url: remote } };
  mocks.search.mockResolvedValue({ items: [work], total: 1, page: 1, page_size: 60 });
  let resolve!: (value: unknown) => void;
  mocks.getWork.mockImplementation(() => new Promise(done => { resolve = done; }));
  await setup();
  fireEvent.error(card(1).querySelector('img')!);
  expect(within(card(1)).getByText('图片加载失败')).toBeTruthy();
  fireEvent.click(card(1));
  await act(async () => resolve({ work, images: [{ ...work.firstImage, local_image_url: '/api/assets/aitag/completed.png' }] }));
  expect(card(1).querySelector('img')?.getAttribute('src')).toBe('/api/assets/aitag/completed.png');
  expect(within(card(1)).queryByText('图片加载失败')).toBeNull();
});

it('封面候选推进后收藏等无关重渲染不倒退到已失败的地址', async () => {
  await setup();
  fireEvent.error(card(1).querySelector('img')!);
  const preview = card(1).querySelector('img')!;
  expect(preview.getAttribute('src')).toBe('/api/assets/aitag/1.png');
  fireEvent.click(within(card(1)).getByRole('button', { name: '收藏整个作品组' }));
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalled());
  expect(card(1).querySelector('img')).toBe(preview);
  expect(preview.getAttribute('src')).toBe('/api/assets/aitag/1.png');
});

it('Agent 读取实际打开的 AITag 详情和作品编号，切换或关闭后同步更新', async () => {
  const { container } = await setup(); container.dataset.agentView = 'aitag';
  const { readAgentPage } = await import('../../services/agentWorkspace');
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
  works.forEach(work => expect(within(card(work.id)).getByText('2页')).toBeTruthy());
  fireEvent.click(card(1));
  await waitFor(() => selected(1));
  expect(main.scrollTop).toBe(1650);
  expect(scrollTo).toHaveBeenCalledWith({ top: 1650, behavior: 'smooth' });
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
  const favorite = within(card(2)).getByRole('button', { name: '收藏整个作品组' });
  fireEvent.keyDown(favorite, { key: 'Enter' }); selected(1);
  fireEvent.click(favorite);
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'aitag', sourceId: '2', getGroup: expect.any(Function) })));
  selected(1);
  fireEvent.click(within(card(1)).getByRole('button', { name: '收藏整个作品组' }));
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

it.each(['页面返回', '系统返回'])('真实瀑布流：%s 关闭手机详情后保留原作品及浏览位置，不重新从首页加载', async action => {
  mocks.realMasonry = true;
  let resize!: (width: number) => void;
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (element.classList.contains('chain-masonry')) {
        resize = width => this.callback([{ target: element, contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
        resize(390);
      }
    }
    unobserve() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.closest('main')?.classList.contains('hidden') ? 0 : 600;
  });
  window.history.replaceState({}, '');
  const returnToList = () => {
    window.history.replaceState({}, '');
    fireEvent(window, new PopStateEvent('popstate', { state: {} }));
  };
  vi.spyOn(window.history, 'back').mockImplementation(returnToList);
  const { main } = await setup();
  main.scrollTop = 1600; fireEvent.scroll(main);
  const original = card(1);
  const searchCount = mocks.search.mock.calls.length;
  fireEvent.click(original);
  expect(main.className).toContain('hidden lg:block');
  act(() => resize(0));
  // 模拟 display:none 清零；真实卡片必须仍在 DOM 中供返回定位使用。
  main.scrollTop = 0; fireEvent.scroll(main);
  expect(card(1)).toBe(original);
  if (action === '页面返回') fireEvent.click(screen.getByRole('button', { name: '返回' }));
  else returnToList();
  await waitFor(() => expect(main.classList.contains('hidden')).toBe(false));
  expect(main.scrollTop).toBe(1650);
  act(() => resize(390));
  expect(card(1)).toBe(original);
  expect(main.scrollTop).toBe(1650);
  noSelection();
  expect(mocks.search).toHaveBeenCalledTimes(searchCount);
  expect(mocks.searchCache).not.toHaveBeenCalled();
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

it('详情逐张收藏保持实际图片与元数据，爱心忙碌时阻止重复点击', async () => {
  let finish!: (active: boolean) => void;
  vi.mocked(toggleCollectionTarget).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { container, notify } = await setup(); fireEvent.click(card(1));
  const surface = await waitFor(() => { const node = container.querySelector('img[alt="AITAG 作品图片"]')?.closest('.press-reveal-surface'); expect(node).toBeTruthy(); return node!; });
  const button = within(surface as HTMLElement).getByRole('button', { name: '收藏' });
  fireEvent.click(button); fireEvent.click(button);
  expect(toggleCollectionTarget).toHaveBeenCalledTimes(1); expect(button.getAttribute('aria-busy')).toBe('true');
  expect(vi.mocked(toggleCollectionTarget).mock.calls[0][0]).toMatchObject({ imageUrl: '/api/assets/aitag/1.png', prompt: 'synthetic prompt 1', sourceType: 'aitag', sourceId: '1' });
  expect(screen.queryByRole('combobox', { name: '收藏夹' })).toBeNull();
  await act(async () => finish(true));
  expect(notify).toHaveBeenCalledWith('已加入收藏库', 'success');
  expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.createChain).not.toHaveBeenCalled();
});

it('手机 AITag 卡片长按显露收藏，松手不打开详情，收藏不选择作品', async () => {
  vi.stubGlobal('innerWidth', 390); await setup(); const item = card(1); longPress(item);
  expect(item.getAttribute('data-press-revealed')).toBe('true'); expect(item.getAttribute('aria-pressed')).toBe('false');
  expect(mocks.getWork).not.toHaveBeenCalled();
  const button = within(item).getByRole('button', { name: '收藏整个作品组' }); expect(button.closest('.hover-reveal-touch')).toBeNull();
  fireEvent.click(button); await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledOnce()); expect(item.getAttribute('aria-pressed')).toBe('false');
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));
