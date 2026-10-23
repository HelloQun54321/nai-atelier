import { toggleCollectionTarget } from '../../services/collectionFavorites';
import { longPress } from '../support/touchEvents';
import { mockGalleryGeometry } from '../support/galleryGeometry';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AitagWorkSummary } from '../../services/aitagService';
import type { PromptChain, User } from '../../types';
import { copySharedImage, downloadSharedImage } from '../../services/imageSharing';
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}) }));
vi.mock('../../services/metadataService', async original => {
  const actual = await original<typeof import('../../services/metadataService')>();
  return { ...actual, parseNovelAIMetadata: vi.fn(actual.parseNovelAIMetadata) };
});

const mocks = vi.hoisted(() => ({
  search: vi.fn(), searchCache: vi.fn(), getWork: vi.fn(), getMonths: vi.fn(), getCacheStatus: vi.fn(), setFavorite: vi.fn(), waitForFirstImageCache: vi.fn(),
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
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleDictionary: vi.fn(async () => [{ name: 'synthetic bare' }]) }));
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
  mocks.waitForFirstImageCache.mockResolvedValue({ items: [] });
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
  delete document.documentElement.dataset.galleryFrostedCaption;
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});
const setup = async (layout = 'masonry', selectionFocusEnabled = true, chains?: PromptChain[]) => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout }));
  const { AitagGallery } = await import('../../components/AitagGallery');
  const { ImageActivityContext } = await import('../../components/SmartImage');
  const notify = vi.fn();
  const draw = (active: boolean) => <ImageActivityContext.Provider value={active}><AitagGallery active={active} selectionFocusEnabled={selectionFocusEnabled} currentUser={{ id: 'synthetic' } as User} notify={notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.createChain} chains={chains} /></ImageActivityContext.Provider>;
  const view = render(draw(true));
  await screen.findByRole('button', { name: '查看作品 合成作品 1' });
  return { ...view, draw, notify, main: view.container.querySelector('main')! };
};
const card = (id: number) => screen.getByRole('button', { name: `查看作品 合成作品 ${id}` });
const selected = (id: number) => expect(card(id).getAttribute('aria-pressed')).toBe('true');
it('瀑布流先用首图元数据比例，未知比例时完整显示图片并在加载后修正卡片高度', async () => {
  const items = [works[0], { ...works[1], firstImage: { ...works[1].firstImage!, ai_json: undefined } }];
  mocks.search.mockResolvedValue({ items, total: items.length, page: 1, page_size: 60 });
  await setup();

  const knownFrame = card(1).querySelector('.mobile-gallery-frame') as HTMLElement;
  expect(knownFrame.style.getPropertyValue('--mobile-image-ratio')).toBe('684 / 1000');
  expect(card(1).querySelector('img')?.className).toContain('object-contain');

  const unknownImage = card(2).querySelector('img') as HTMLImageElement;
  const unknownFrame = unknownImage.parentElement as HTMLElement;
  expect(unknownFrame.style.getPropertyValue('--mobile-image-ratio')).toBe('1');
  expect(unknownImage.className).toContain('object-contain');
  Object.defineProperty(unknownImage, 'naturalWidth', { configurable: true, value: 832 });
  Object.defineProperty(unknownImage, 'naturalHeight', { configurable: true, value: 1216 });
  fireEvent.load(unknownImage);
  await waitFor(() => expect(unknownFrame.style.getPropertyValue('--mobile-image-ratio')).toBe('684 / 1000'));
});

it.each(['portrait', 'square'])('%s 布局保留原有封面裁切', async layout => {
  await setup(layout);
  expect(card(1).querySelector('img')?.className).toContain('object-cover');
});

it.each(['masonry', 'portrait', 'square'].flatMap(layout => [true, false].map(frosted => [layout, frosted] as const)))('%s 布局／磨砂 %s：缓存色条替换为标题前圆点，未缓存不留空位', async (layout, frosted) => {
  document.documentElement.dataset.galleryFrostedCaption = String(frosted);
  const cachedWorks = ['full', 'first-image', 'none'].map((level, index) => ({
    ...works[0], id: index + 1, title: `合成作品 ${index + 1}`,
    hasFullyCachedImages: level === 'full',
    localFirstImageUrl: level === 'none' ? undefined : `/synthetic/${index + 1}.png`,
  }));
  mocks.search.mockResolvedValue({ items: cachedWorks, total: 3, page: 1, page_size: 60 });
  await setup(layout);
  cachedWorks.forEach((work, index) => {
    const first = card(work.id);
    const title = within(first).getByText(work.title);
    const marker = title.previousElementSibling;
    if (index < 2) {
      expect(marker?.className.split(' ')).toEqual(['h-2', 'w-2', 'shrink-0', 'rounded-full', index === 0 ? 'bg-emerald-500' : 'bg-sky-500']);
      expect(marker?.getAttribute('aria-hidden')).toBe('true');
    } else expect(marker).toBeNull();
    expect(title.getAttribute('data-safe-mode-title')).toBe('true');
    expect(first.lastElementChild?.classList.contains('gallery-card-caption')).toBe(true);
    expect(first.querySelector('.h-1')).toBeNull();
  });
  if (layout === 'masonry') {
    expect(mocks.masonry.mock.lastCall?.[0].estimateItemHeight(cachedWorks[0], 200)).toBe(200 / (832 / 1216) + (frosted ? 2 : 70));
  }
});
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
  const detailCard = surface.closest('.appearance-card')!;
  expect(surface.classList.contains('appearance-media')).toBe(true);
  expect(detailCard.classList.contains('appearance-media')).toBe(false);
  const prompt = within(detailCard as HTMLElement).getByText('synthetic prompt 1');
  expect(prompt.closest('.appearance-group')).toBeTruthy();
  expect(prompt.closest('.appearance-media')).toBeNull();
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

it('关闭选中聚焦后仍可打开详情，但不压暗其他作品或自动滚动', async () => {
  const { main } = await setup('masonry', false);
  fireEvent.click(card(1));
  await waitFor(() => selected(1));
  expect(main.scrollTop).toBe(0);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(card(1).className).toContain('ring-2');
  expect(card(2).className).not.toContain('brightness-');
});

it.each(['masonry', 'portrait', 'square'].flatMap(layout => ['click', 'Enter', ' '].map(input => [layout, input])))('%s／%s：详情缩窄前记录点击位置，先即时补偿再居中', async (layout, input) => {
  const { container } = await setup(layout);
  const { root, scrollCalls } = mockGalleryGeometry([card(1), card(2)], () => container.querySelector('.aitag-detail-panel--open') ? -600 : 0);
  root.scrollTop = 1400;
  if (input === 'click') fireEvent.click(card(1));
  else fireEvent.keyDown(card(1), { key: input });
  selected(1);
  expect(scrollCalls.slice(0, 2)).toEqual([{ top: 800, behavior: 'instant' }, { top: 1050, behavior: 'smooth' }]);
  expect(root.scrollTop).toBe(1050);
  expect(root.parentElement!.className).toContain('lg:grid-cols-[minmax(0,1fr)_460px]');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(root.scrollTop).toBe(1650);
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

it.each([1280, 390].flatMap(width => ['图生图', '局部重绘', '扩图'].map(label => [width, label] as const)))('%spx 第三个紫色按钮将对应图片送入%s，不取用元数据或自动保存', async (width, label) => {
  vi.stubGlobal('innerWidth', width);
  mocks.getWork.mockResolvedValue({ work: works[0], images: [works[0].firstImage, {
    ...works[0].firstImage!, id: 12, file_name: 'second.png', prompt_text: '', ai_json: undefined,
    local_image_url: width === 1280 ? '/synthetic/base-second.png' : undefined,
    remote_image_url: 'https://ai-img.10118899.xyz/NAI/1/second.webp',
  }] });
  await setup(); fireEvent.click(card(1));
  const trigger = await waitFor(() => {
    const buttons = screen.getAllByRole('button', { name: '用作底图' });
    expect(buttons).toHaveLength(2); return buttons[1];
  });
  const actions = trigger.parentElement!.parentElement!;
  expect(within(actions).getAllByRole('button').slice(0, 3).map(button => button.getAttribute('aria-label'))).toEqual(['保存到风格串', '导入实验室', '用作底图']);
  expect(trigger.classList.contains('bg-purple-600')).toBe(true);
  expect(trigger.classList.contains('dark:bg-purple-600/90')).toBe(true);
  expect(trigger.querySelector('svg.lucide-image-plus')).toBeTruthy();
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: '用作底图' });
  expect(panel.classList.contains('mobile-sheet')).toBe(width === 390);
  fireEvent.click(within(panel).getByRole('button', { name: label }));
  expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toEqual({ mode: 'base-image',
    imageEditOperation: { '图生图': 'image-to-image', '局部重绘': 'inpaint', '扩图': 'outpaint' }[label],
    baseImageUrl: width === 1280 ? '/synthetic/base-second.png' : '/api/media?source=https%3A%2F%2Fai-img.10118899.xyz%2FNAI%2F1%2Fsecond.webp&variant=original',
  });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.navigate).toHaveBeenCalledOnce();
  expect(mocks.createChain).not.toHaveBeenCalled(); expect(mocks.getWork).toHaveBeenCalledOnce();
});

it('用已显示的 JSON 和本地图片保存，立即显示忙碌并阻止连点，完成后才通知成功', async () => {
  let resolve!: () => void;
  mocks.createChain.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const { notify } = await setup();
  fireEvent.click(card(1));
  const button = await screen.findByRole('button', { name: '保存到风格串' });
  expect(button.querySelector('svg.lucide-layers')).toBeTruthy();
  expect(button.classList.contains('bg-emerald-700')).toBe(true);
  expect(button.classList.contains('dark:bg-emerald-700/90')).toBe(true);
  expect(button.classList.contains('text-white')).toBe(true);
  await act(async () => {});
  const observersBeforeSaving = [...callbacks];
  fireEvent.click(button); fireEvent.click(button);
  await act(async () => {});
  expect([...callbacks]).toEqual(observersBeforeSaving);
  expect(mocks.createChain).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.querySelector('svg.animate-spin')).toBeTruthy();
  expect(notify).not.toHaveBeenCalledWith('已保存到风格串');
  expect(mocks.createChain.mock.calls[0][0]).toMatchObject({
    name: '合成作品 1 P1', basePrompt: 'synthetic prompt 1', negativePrompt: 'synthetic negative',
    previewImage: '/api/assets/aitag/1.png', tags: [], params: { seed: 123, steps: 23 },
  });
  expect(mocks.getWork).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已保存到风格串'));
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(button.querySelector('svg.lucide-layers')).toBeTruthy();
  expect([...callbacks]).toEqual(observersBeforeSaving);
});

it('蓝色导入直接使用已有配置，取图失败或完整详情仍在等待也立即进入文生图', async () => {
  const fetchImage = vi.fn(() => { throw new Error('不允许重新取图'); });
  vi.stubGlobal('fetch', fetchImage);
  mocks.getWork.mockImplementation(() => new Promise(() => {}));
  await setup(); fireEvent.click(card(2));
  fireEvent.click(await screen.findByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toMatchObject({
    mode: 'prompt-fragments', fullMetadata: true, targetMode: 'text-to-image', prompt: 'synthetic prompt 2', negativePrompt: 'synthetic negative',
    params: { model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 23, seed: 123 },
  });
  expect(mocks.navigate).toHaveBeenCalledOnce(); expect(mocks.createChain).not.toHaveBeenCalled();
  expect(fetchImage).not.toHaveBeenCalled();
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

it('40 页详情只准备一遍收藏元数据，排序后保存和无关状态不重复解析整组', async () => {
  const images = Array.from({ length: 40 }, (_, index) => ({
    ...works[0].firstImage!, id: 0, file_name: `page-${40 - index}.png`,
    local_image_url: `/synthetic/page-${40 - index}.png`,
    ai_json: { prompt: `page prompt ${40 - index}`, seed: 40 - index },
  }));
  mocks.getWork.mockResolvedValue({ work: works[0], images });
  let finish!: () => void;
  mocks.createChain.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const { container } = await setup(); fireEvent.click(card(1));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '保存到风格串' })).toHaveLength(40));
  const { parseNovelAIMetadata } = await import('../../services/metadataService');
  const parseCount = vi.mocked(parseNovelAIMetadata).mock.calls.length;
  expect(parseCount).toBe(41);
  const surfaces = () => Array.from(container.querySelectorAll('img[alt="AITAG 作品图片"]')).map(image => image.closest('.press-reveal-surface') as HTMLElement);
  expect(surfaces()).toHaveLength(40);
  fireEvent.click(within(surfaces()[0]).getByRole('button', { name: '收藏' }));
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledOnce());
  expect(vi.mocked(toggleCollectionTarget).mock.calls[0][0]).toMatchObject({ imageId: 'page-1.png', prompt: 'page prompt 1', imageUrl: '/synthetic/page-1.png' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(parseNovelAIMetadata).toHaveBeenCalledTimes(parseCount);
  fireEvent.click(screen.getAllByRole('button', { name: '保存到风格串' })[0]);
  expect(mocks.createChain.mock.calls[0][0]).toMatchObject({ name: '合成作品 1 P1', basePrompt: 'page prompt 1', params: { seed: 1 } });
  expect(parseNovelAIMetadata).toHaveBeenCalledTimes(parseCount + 1);
  await act(async () => finish());
  expect(parseNovelAIMetadata).toHaveBeenCalledTimes(parseCount + 1);
});

it('同一作品预览升级完整详情及切换作品时收藏记录跟随新元数据', async () => {
  let finish!: (detail: unknown) => void;
  mocks.getWork.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { container } = await setup(); fireEvent.click(card(1));
  const favorite = () => within(container.querySelector('img[alt="AITAG 作品图片"]')!.closest('.press-reveal-surface') as HTMLElement).getByRole('button', { name: '收藏' });
  fireEvent.click(favorite());
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledTimes(1));
  expect(vi.mocked(toggleCollectionTarget).mock.calls[0][0]).toMatchObject({ prompt: 'synthetic prompt 1' });
  await act(async () => finish({ work: works[0], images: [{ ...works[0].firstImage!, ai_json: { prompt: 'updated prompt', seed: 456 } }] }));
  fireEvent.click(favorite());
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledTimes(2));
  expect(vi.mocked(toggleCollectionTarget).mock.calls[1][0]).toMatchObject({ imageId: '1.png', prompt: 'updated prompt', params: { seed: 456 } });
  fireEvent.click(card(2)); await screen.findByText('synthetic prompt 2');
  fireEvent.click(favorite());
  await waitFor(() => expect(toggleCollectionTarget).toHaveBeenCalledTimes(3));
  expect(vi.mocked(toggleCollectionTarget).mock.calls[2][0]).toMatchObject({ imageId: '2.png', sourceId: '2', prompt: 'synthetic prompt 2' });
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

const promptWorks = (prompts: string[]): AitagWorkSummary[] => prompts.map((prompt, index) => ({
  ...works[0], id: index + 1, title: `合成作品 ${index + 1}`,
  firstImage: { ...works[0].firstImage!, id: index + 1, work_id: index + 1, file_name: `${index + 1}.png`, prompt_text: undefined, ai_json: { prompt, width: 832, height: 1216 } },
}));
const visibleIds = () => screen.queryAllByRole('button', { name: /^查看作品 合成作品 / }).map(item => Number(item.getAttribute('aria-label')!.replace(/\D+/g, '')));

it('画师串与风格串筛选即时生效，条件标签可单独移除，清空全部恢复默认检索', async () => {
  const items = promptWorks(['artist:synthetic painter, 1girl', 'synthetic_bare, scenery', 'plain, scenery']);
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? items : [], total: 3, page: options.page, page_size: 60 }));
  await setup('portrait', true, [{ id: 'chain', type: 'style', description: 'Imported from aitag #2' } as PromptChain]);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));

  fireEvent.change(screen.getByLabelText('画师串'), { target: { value: 'with' } });
  await waitFor(() => expect(visibleIds()).toEqual([1, 2]));
  expect(screen.getByRole('button', { name: '移除筛选：含画师串' })).toBeTruthy();

  fireEvent.change(screen.getByLabelText('风格串'), { target: { value: 'unsaved' } });
  expect(visibleIds()).toEqual([1]);
  expect(screen.getByRole('button', { name: '筛选 2' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '移除筛选：含画师串' }));
  expect(visibleIds()).toEqual([1, 3]);
  expect(screen.queryByRole('button', { name: '移除筛选：含画师串' })).toBeNull();

  const calls = mocks.search.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '清空全部' }));
  await waitFor(() => expect(visibleIds()).toEqual([1, 2, 3]));
  expect(mocks.search.mock.calls.slice(calls)[0][0]).toMatchObject({ page: 1, q: '', prompt: '', sort: 'new', timeRange: 'all' });
  expect(screen.queryByRole('group', { name: '已生效的筛选条件' })).toBeNull();
});

it('提示词多条件只把最长条件交给服务端，其余包含与排除条件细筛已加载作品', async () => {
  const items = promptWorks(['artist:synthetic painter, 1girl', 'synthetic_bare, scenery', 'plain, scenery']);
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? items : [], total: 3, page: options.page, page_size: 60 }));
  await setup('portrait');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const input = screen.getByPlaceholderText('逗号分隔多个条件，- 开头排除');
  fireEvent.change(input, { target: { value: 'synthetic, scenery, -plain' } });
  // 未提交的草稿不显示为生效条件
  expect(screen.queryByRole('group', { name: '已生效的筛选条件' })).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => expect(visibleIds()).toEqual([2]));
  expect(mocks.search.mock.calls.filter(([options]) => options.page === 1).at(-1)?.[0]).toMatchObject({ prompt: 'synthetic' });
  const chip = screen.getByRole('button', { name: '移除筛选：提示词：synthetic, scenery, -plain' });

  fireEvent.click(chip);
  await waitFor(() => expect(visibleIds()).toEqual([1, 2, 3]));
  expect(mocks.search.mock.calls.filter(([options]) => options.page === 1).at(-1)?.[0]).toMatchObject({ prompt: '' });
});

it('切换排序后滚动追加仍按新条件接上下一页，不因旧条件签名被丢弃', async () => {
  // 记录被观察的元素：追加只响应实际观察目标的相交事件。
  const observers: Array<{ callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void; targets: Element[] }> = [];
  vi.stubGlobal('IntersectionObserver', class {
    private entry: { callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void; targets: Element[] };
    constructor(callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) { this.entry = { callback, targets: [] }; observers.push(this.entry); }
    observe(target: Element) { this.entry.targets.push(target); }
    disconnect() { this.entry.targets = []; }
  });
  const reachEnd = () => { const last = observers.filter(item => item.targets.length).at(-1); last?.callback(last.targets.map(target => ({ isIntersecting: true, target }))); };
  const nextPage = { ...works[1], id: 9, title: '合成作品 9' };
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? works : options.page === 2 ? [nextPage] : [], total: 120, page: options.page, page_size: 60 }));
  await setup('portrait');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'monthly' } });
  await waitFor(() => expect(mocks.search.mock.calls.some(([options]) => options.page === 1 && options.sort === 'monthly')).toBe(true));
  await waitFor(() => expect(screen.getByRole('button', { name: '移除筛选：月榜：当前月份' })).toBeTruthy());

  await act(async () => { reachEnd(); });
  await screen.findByRole('button', { name: '查看作品 合成作品 9' });
});

it.each([
  ['部分作品已就绪', [2]],
  ['全部作品待补齐（列表为空时也要轮询）', [1, 2]],
] as const)('%s：列表作品尚未带首图元数据时先隐藏并提示读取中，后端补齐后按画师串条件出现', async (_label, pendingIds) => {
  const full = promptWorks(['artist:synthetic painter, 1girl', 'artist:synthetic other, scenery']);
  const listed = full.map(work => (pendingIds as readonly number[]).includes(work.id)
    ? { ...work, firstImage: undefined, first_image: undefined, localFirstImageUrl: undefined, local_cover_url: undefined }
    : work);
  const readyIds = full.map(work => work.id).filter(id => !(pendingIds as readonly number[]).includes(id));
  const status = `正在读取 ${pendingIds.length} 个作品的元数据`;
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? listed : [], total: 2, page: options.page, page_size: 60 }));
  // 后端补齐前轮询一直等待；只回应筛选生效后的最新一次轮询（之前的轮询已随条件变化取消）。
  const waits: Array<(value: { items: AitagWorkSummary[] }) => void> = [];
  mocks.waitForFirstImageCache.mockImplementation(() => new Promise(resolve => { waits.push(resolve); }));
  await setup('portrait');
  const callsBeforeFilter = mocks.waitForFirstImageCache.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByLabelText('画师串'), { target: { value: 'with' } });

  await waitFor(() => expect(mocks.waitForFirstImageCache.mock.calls.length).toBeGreaterThan(callsBeforeFilter));
  expect(mocks.waitForFirstImageCache.mock.calls.at(-1)?.[0].ids).toEqual(pendingIds);
  expect(visibleIds()).toEqual(readyIds);
  expect(screen.getAllByText(status).length).toBeGreaterThan(0);

  await act(async () => { waits.at(-1)?.({ items: full.filter(work => (pendingIds as readonly number[]).includes(work.id)).map(work => ({ ...work, localFirstImageUrl: `/synthetic/${work.id}.png` })) }); });
  await waitFor(() => expect(visibleIds()).toEqual([1, 2]));
  expect(screen.queryByText(status)).toBeNull();
});

it('搜索框里未提交的草稿不阻断追加，追加仍按已生效条件接续当前结果', async () => {
  // 记录被观察的元素：追加只响应实际观察目标的相交事件。
  const observers: Array<{ callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void; targets: Element[] }> = [];
  vi.stubGlobal('IntersectionObserver', class {
    private entry: { callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void; targets: Element[] };
    constructor(callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) { this.entry = { callback, targets: [] }; observers.push(this.entry); }
    observe(target: Element) { this.entry.targets.push(target); }
    disconnect() { this.entry.targets = []; }
  });
  const reachEnd = () => { const last = observers.filter(item => item.targets.length).at(-1); last?.callback(last.targets.map(target => ({ isIntersecting: true, target }))); };
  const nextPage = { ...works[1], id: 9, title: '合成作品 9' };
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? works : options.page === 2 ? [nextPage] : [], total: 120, page: options.page, page_size: 60 }));
  await setup('portrait');
  fireEvent.change(screen.getByPlaceholderText('作品、作者、标题或标签，回车检索'), { target: { value: '未提交草稿' } });

  await act(async () => { reachEnd(); });
  await screen.findByRole('button', { name: '查看作品 合成作品 9' });
  expect(mocks.search.mock.calls.every(([options]) => options.q === '')).toBe(true);
});

it('待补齐元数据的作品超过一页时，第一批完成后继续轮询其余作品直到全部出现', async () => {
  const full = promptWorks(Array.from({ length: 70 }, (_, index) => `artist:synthetic ${index + 1}, 1girl`));
  const listed = full.map(work => ({ ...work, firstImage: undefined, first_image: undefined, localFirstImageUrl: undefined, local_cover_url: undefined }));
  mocks.search.mockImplementation(async options => ({ items: options.page === 1 ? listed : [], total: 70, page: options.page, page_size: 60 }));
  const waits: Array<{ ids: number[]; resolve: (value: { items: AitagWorkSummary[] }) => void }> = [];
  mocks.waitForFirstImageCache.mockImplementation(options => new Promise(resolve => { waits.push({ ids: options.ids, resolve }); }));
  await setup('portrait');
  const callsBeforeFilter = waits.length;
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByLabelText('画师串'), { target: { value: 'with' } });

  await waitFor(() => expect(waits.length).toBeGreaterThan(callsBeforeFilter));
  const firstBatch = waits.at(-1)!;
  expect(firstBatch.ids).toEqual(full.slice(0, 60).map(work => work.id));
  await act(async () => { firstBatch.resolve({ items: full.slice(0, 60).map(work => ({ ...work, localFirstImageUrl: `/synthetic/${work.id}.png` })) }); });

  await waitFor(() => expect(waits.at(-1)!.ids).toEqual(full.slice(60).map(work => work.id)));
  expect(visibleIds()).toHaveLength(60);
  expect(screen.getAllByText('正在读取 10 个作品的元数据').length).toBeGreaterThan(0);
  await act(async () => { waits.at(-1)!.resolve({ items: full.slice(60).map(work => ({ ...work, localFirstImageUrl: `/synthetic/${work.id}.png` })) }); });
  await waitFor(() => expect(visibleIds()).toHaveLength(70));
});

