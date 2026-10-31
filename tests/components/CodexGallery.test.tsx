// @vitest-environment jsdom
import React from 'react';
import { mockGalleryGeometry } from '../support/galleryGeometry';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexBootstrap, CodexEntry, CodexImageMetadata } from '../../services/codexService';
import type { Inspiration } from '../../types';
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), book: vi.fn(), community: vi.fn(), file: vi.fn(), metadata: vi.fn(), notify: vi.fn(), navigate: vi.fn(), create: vi.fn(), realFavorites: false, saved: [] as Inspiration[] }));
vi.mock('../../services/codexService', async original => ({ ...await original<typeof import('../../services/codexService')>(), loadCodexBootstrap: mocks.bootstrap, loadCodexBook: mocks.book, loadCodexCommunity: mocks.community, readCodexImageFile: mocks.file, readCodexImageMetadata: mocks.metadata }));
vi.mock('../../services/collectionFavorites', async original => {
  const actual = await original<typeof import('../../services/collectionFavorites')>();
  return { ...actual, collectionRevision: () => mocks.realFavorites ? actual.collectionRevision() : 0,
    subscribeCollection: (listener: () => void) => mocks.realFavorites ? actual.subscribeCollection(listener) : () => {},
    collectionTargetActive: (target: Parameters<typeof actual.collectionTargetActive>[0]) => mocks.realFavorites && actual.collectionTargetActive(target),
    collectionTargetComplete: (target: Parameters<typeof actual.collectionTargetComplete>[0]) => mocks.realFavorites && actual.collectionTargetComplete(target) };
});
vi.mock('../../services/api', () => ({ ApiError: class extends Error {}, api: {
  get: async (path: string) => path === '/auth/me' ? { id: 'owner', username: 'user', role: 'admin' } : path === '/inspirations' ? mocks.saved : [],
  post: async (_path: string, item: Inspiration) => { mocks.saved = [...mocks.saved, item]; return { item }; },
  put: async (path: string, updates: Partial<Inspiration>) => { mocks.saved = mocks.saved.map(item => path.endsWith('/' + item.id) ? { ...item, ...updates } : item); },
  uploadFile: async () => ({ url: '/api/assets/synthetic-favorite.png' }),
} }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: async () => ({ items: [], count: 0 }) } }));
vi.mock('../../components/ImageShareActions', async original => {
  const actual = await original<typeof import('../../components/ImageShareActions')>();
  return { ...actual, ImageShareOverlay: (props: React.ComponentProps<typeof actual.ImageShareOverlay>) => mocks.realFavorites ? <actual.ImageShareOverlay {...props} /> : null };
});
vi.mock('../../components/ImageLightbox', () => ({ ViewableImage: ({ src, alt, width, height, className }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} width={width} height={height} className={className} /> }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt, className = 'h-full w-full object-cover', onLoad }: { src: string; alt: string; className?: string; onLoad?: React.ReactEventHandler<HTMLImageElement> }) => <img src={src} alt={alt} className={className} onLoad={onLoad} /> }));
import { CodexGallery, codexCollectionImage } from '../../components/CodexGallery';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';

const book = { id: 'synthetic', title: '合成书目', hasOriginal: true, type: 'codex', author: '作者', version: 'V5', entryCount: 1, originalSections: [], nsfw: false, exampleModel: '', dataUrl: '', assetBaseUrl: '', assetPathMode: '' };
const boot: CodexBootstrap = { release: 'r-abc', books: [book], media: {}, baseUrl: 'https://assets.quicktagcloud.com/data/releases/r-abc', files: {} };
const entry: CodexEntry = { key: 'codex:synthetic:one', id: 'one', source: 'codex', bookId: 'synthetic', bookTitle: '合成书目', title: '合成词条', path: ['绘画'], prompt: 'weighted prompt', negative: 'source negative', characters: [{ label: '角色', prompt: 'girl', negative: 'boy' }], note: '说明', author: '作者', sourceUrl: 'https://novelai.quicktagcloud.com/share/synthetic/one',
  images: [0, 1].map(page => ({ id: `image-${page}`, url: `https://assets.quicktagcloud.com/images/synthetic/${page}.jpg`, originalUrl: `https://assets.quicktagcloud.com/originals/synthetic/${page}.png`, width: 640, height: 960, raw: '', parameterSource: '' })), coverIndex: 0, nsfw: false, r18g: false, createdAt: 1000, likeCount: 10, updates: [], isNew: false };
const metadata: CodexImageMetadata = { prompt: 'image prompt, 1girl, bikini, standing', negativePrompt: 'image negative', rawPrompt: 'image raw prompt', rawNegative: 'image raw negative', params: { steps: 28, scale: 3, sampler: 'k_euler_ancestral', seed: 88, width: 832, height: 1216, model: 'nai-diffusion-5-full', characters: [{ id: 'original-role', prompt: 'original girl', negativePrompt: 'original boy', x: 0.2, y: 0.8 }], qualityToggle: false, ucPreset: 4 } };
const setup = (active = true, role: 'admin' | 'guest' = 'admin') => render(<CodexGallery active={active} currentUser={{ id: 'owner', username: 'user', role, createdAt: 1 }} notify={mocks.notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.create} />);
const ready = () => screen.findByText('image raw prompt');
const chooseSource = (name: string | RegExp) => {
  fireEvent.click(screen.getByTitle('法典来源'));
  fireEvent.click(within(screen.getByRole('dialog', { name: '法典来源' })).getByRole('button', { name }));
};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.realFavorites = false; mocks.saved = [];
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'portrait', columns: 2 }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  mocks.bootstrap.mockResolvedValue(boot); mocks.book.mockResolvedValue({ release: boot.release, entries: [entry] });
  mocks.community.mockResolvedValue({ entries: [{ ...entry, key: 'community:old', title: '旧投稿', createdAt: 1 }, { ...entry, key: 'community:new', title: '新投稿', createdAt: 2 }] });
  mocks.file.mockResolvedValue(new File(['synthetic'], 'source.png')); mocks.metadata.mockReset().mockResolvedValue(metadata);
  mocks.create.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('手机明确当前来源，全书卡片保留书名，目录和筛选独立可达并可清空结果条件', async () => {
  vi.stubGlobal('innerWidth', 390);
  mocks.bootstrap.mockResolvedValue({ ...boot, books: [book, { ...book, id: 'second', title: '另一本书' }] });
  mocks.book.mockImplementation(async value => ({ entries: [{ ...entry, key: value.id, bookId: value.id, bookTitle: value.title, title: value.id === 'second' ? '另一个词条' : entry.title, path: ['绘画', value.id === 'second' ? '白天' : '夜景'] }] }));
  setup(); await screen.findByRole('status', { name: '1 条结果' });
  const caption = document.querySelector('[data-toolbar-count-caption]');
  expect(caption?.textContent).toBe('1 条结果');
  expect(screen.getByTitle('法典来源').textContent).toBe('合成书目');
  expect(screen.getByTitle('法典来源').parentElement!.className).toContain('[&>button>span]:inline');
  expect(screen.getByRole('button', { name: '刷新' }).parentElement!.className).toBe('hidden sm:block');
  chooseSource('全部书目');
  await screen.findByRole('status', { name: '2 条结果' });
  expect(screen.getByTitle('法典来源').textContent).toBe('全部书目');
  expect(screen.getByText('合成书目 · 绘画 / 夜景')).toBeTruthy();
  expect(screen.getByText('另一本书 · 绘画 / 白天')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '目录' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '目录' })).getByRole('button', { name: '绘画/夜景' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('status', { name: '1 条结果' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /另一个词条/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '图片' }), { target: { value: 'none' } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(screen.getByRole('button', { name: '筛选 1' })).toBeTruthy();
  expect(screen.getByRole('status', { name: '0 条结果' })).toBeTruthy();
  expect(caption?.textContent).toBe('0 条结果');
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByRole('status', { name: '2 条结果' })).toBeTruthy();
  expect(screen.getByTitle('法典来源').textContent).toBe('全部书目');
  expect(screen.getByRole('button', { name: '目录' })).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('标题、提示词、作者或说明'), { target: { value: '不存在的词' } });
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect((screen.getByPlaceholderText('标题、提示词、作者或说明') as HTMLInputElement).value).toBe('');
  chooseSource('共创广场'); await screen.findByRole('button', { name: /新投稿/ });
  expect(screen.getByTitle('法典来源').textContent).toBe('共创广场');
  chooseSource(/另一本书/); await screen.findByRole('status', { name: '1 条结果' });
  expect(screen.getByTitle('法典来源').textContent).toBe('另一本书');
});
it('图片尚未加载或读取失败时仍预留比例空间，重试后可导入', async () => {
  mocks.metadata.mockRejectedValueOnce(new Error('原图不可用'));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  const preview = screen.getAllByAltText('合成词条').find(image => image.getAttribute('src')?.includes('originals'))!;
  const stage = preview.closest<HTMLElement>('.press-reveal-surface')!;
  expect(stage.style.aspectRatio).toBe('640 / 960');
  expect(stage.className).toContain('max-h-[42vh]');
  expect(preview.className).toContain('absolute');
  expect(preview.getAttribute('width')).toBe('640'); expect(preview.getAttribute('height')).toBe('960');
  fireEvent.error(preview); fireEvent.load(preview);
  expect(stage.style.aspectRatio).toBe('640 / 960');
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '导入实验室' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: metadata.prompt, negativePrompt: metadata.negativePrompt });
});
it.each(['books', 'community'])('%s 打开详情先抵消分栏位移再居中，关闭仍保留作品高度', async mode => {
  document.documentElement.dataset.motion = 'full';
  const { container } = setup();
  await screen.findByRole('button', { name: /合成词条/ });
  if (mode === 'community') chooseSource('共创广场');
  const button = await screen.findByRole('button', { name: mode === 'community' ? /新投稿/ : /合成词条/ });
  const card = button.closest<HTMLElement>('[data-gallery-work-id]')!;
  const { root, scrollCalls } = mockGalleryGeometry([card], () => container.querySelector('.aitag-detail-panel--open') ? -600 : 0);
  root.scrollTop = 1400;
  fireEvent.click(button);
  expect(scrollCalls.slice(0, 2)).toEqual([{ top: 800, behavior: 'instant' }, { top: 1050, behavior: 'smooth' }]);
  expect(root.scrollTop).toBe(1050);
  expect(root.parentElement!.className).toContain('lg:grid-cols-[minmax(0,1fr)_460px]');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(root.scrollTop).toBe(1650);
  delete document.documentElement.dataset.motion;
});
it('图片词条叠放图文，纯文本词条保留正文和独立信息栏', async () => {
  mocks.book.mockResolvedValue({ release: boot.release, entries: [entry, { ...entry, key: 'codex:synthetic:text', title: '纯文本词条', images: [], prompt: 'text-only prompt' }] });
  setup();
  const imageTitle = await screen.findByText('合成词条');
  const textTitle = await screen.findByText('纯文本词条');
  const caption = imageTitle.closest('.gallery-card-caption')!;
  expect(caption.parentElement?.classList.contains('gallery-card-visual')).toBe(true);
  expect(caption.parentElement?.querySelector(':scope > .mobile-gallery-frame')).toBeTruthy();
  expect(textTitle.closest('.gallery-card-caption')).toBeNull();
  expect(textTitle.closest('.gallery-image-card')).toBeNull();
  expect(screen.getByText('text-only prompt')).toBeTruthy();
});
it('法典瀑布流的无尺寸图片先完整显示，加载后按真实比例更新卡片', async () => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry', columns: 2 }));
  const pendingFrames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pendingFrames.push(callback); return pendingFrames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
    unobserve() {}
  });
  mocks.book.mockResolvedValue({ release: boot.release, entries: [{ ...entry, images: [{ ...entry.images[0], width: 0, height: 0 }] }] });
  const { container } = setup();
  const card = await waitFor(() => {
    const element = container.querySelector<HTMLElement>('[data-gallery-work-id]');
    expect(element).toBeTruthy();
    return element!;
  });
  const image = within(card).getByRole('img') as HTMLImageElement;
  const frame = card.querySelector<HTMLElement>('.mobile-gallery-frame')!;
  expect(image.className).toContain('object-contain');
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 800 } });
  fireEvent.load(image);
  act(() => pendingFrames.splice(0).forEach(callback => callback(0)));
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('1.5');
  expect(image.className).toContain('object-cover');
  expect(container.querySelector('.chain-masonry-column')).toBeTruthy();
});
it('未进入页面不读取法典；紧凑图标一键导入，不打开确认窗口', async () => {
  const view = setup(false); expect(mocks.bootstrap).not.toHaveBeenCalled();
  view.rerender(<CodexGallery active currentUser={{ id: 'owner', username: 'user', role: 'admin', createdAt: 1 }} notify={mocks.notify} onNavigateToPlayground={mocks.navigate} onCreateArtistChain={mocks.create} />);
  fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await ready();
  const button = screen.getByRole('button', { name: '导入实验室' });
  expect(button.textContent).toBe(''); expect(screen.getByRole('button', { name: '保存到风格串' }).textContent).toBe('');
  fireEvent.click(button); expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true, prompt: metadata.prompt, negativePrompt: metadata.negativePrompt,
    replace: true, importSettings: true, importSeed: true, importModel: true, params: metadata.params, characters: metadata.params.characters });
  expect(mocks.navigate).toHaveBeenCalledOnce(); expect(mocks.file).toHaveBeenCalledOnce();
});
it('共创广场默认按投稿时间排序，并保留书目返回状态', async () => {
  setup(); await screen.findByRole('button', { name: /合成词条/ });
  fireEvent.change(screen.getByPlaceholderText('标题、提示词、作者或说明'), { target: { value: 'weighted prompt' } });
  fireEvent.click(screen.getByRole('button', { name: '目录' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '目录' })).getByRole('button', { name: '绘画' }));
  chooseSource('共创广场');
  await screen.findByRole('button', { name: /新投稿/ });
  const cards = screen.getAllByRole('button').filter(button => /新投稿|旧投稿/.test(button.textContent || ''));
  expect(cards.map(button => button.textContent)).toEqual([expect.stringContaining('新投稿'), expect.stringContaining('旧投稿')]);
  chooseSource(/合成书目/); await screen.findByRole('button', { name: /合成词条/ });
  expect((screen.getByPlaceholderText('标题、提示词、作者或说明') as HTMLInputElement).value).toBe('weighted prompt');
  expect(screen.getByRole('button', { name: '绘画' }).getAttribute('title')).toBe('绘画');
});
it('原图参数读取迟到时不会改写另一页的默认导入', async () => {
  let finish!: (value: CodexImageMetadata) => void; mocks.metadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.metadata.mockResolvedValueOnce({ ...metadata, prompt: 'next image', rawPrompt: 'next raw', params: { ...metadata.params, seed: 99 } });
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await screen.findByText('next raw');
  await act(async () => finish(metadata));
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'next image', replace: true, params: { seed: 99 } });
});
it('多图收藏用稳定文件编号去重，保留展示词与当前图片的来源快照', () => {
  const image = codexCollectionImage(entry, 1);
  expect(image).toMatchObject({ sourceId: 'synthetic:one', imageId: 'image-1', analysis: { externalSourcePage: 1, collectionGroupSize: 2, codex: { prompt: 'weighted prompt', note: '说明' } } });
});

it('真实收藏快照中只存一页时组心亮且保留部分提示，详情逐页取消与补齐同步', async () => {
  mocks.realFavorites = true;
  mocks.saved = [{ id: 'synthetic-saved-page', userId: 'owner', username: 'user', title: entry.title,
    sourceType: 'codex', sourceId: 'synthetic:one', imageUrl: '/api/assets/old-first-page.png', prompt: 'old snapshot', tags: [],
    analysis: { collectionImageId: 'image-0', externalSourcePage: 0, collectionGroupSize: 2 }, createdAt: 1, updatedAt: 1 }];
  const service = await import('../../services/collectionFavorites');
  await service.loadCollection({ id: 'owner', username: 'user', role: 'admin', createdAt: 1 });
  setup();
  const open = await screen.findByRole('button', { name: /合成词条/ });
  const card = open.closest<HTMLElement>('[data-gallery-work-id]')!;
  const groupHeart = () => within(card).getByRole('button', { name: '取消整组收藏' });
  expect(groupHeart().getAttribute('aria-pressed')).toBe('true');
  expect(within(card).getByText(/部分已收藏/)).toBeTruthy();
  fireEvent.click(open);
  await ready();
  const detail = screen.getByRole('complementary', { name: '合成词条' });
  fireEvent.click(within(detail).getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(within(card).getByRole('button', { name: '收藏整个作品组' }).getAttribute('aria-pressed')).toBe('false'));
  expect(within(card).queryByText(/部分已收藏/)).toBeNull();
  fireEvent.click(within(detail).getByRole('button', { name: '收藏' }));
  await waitFor(() => expect(groupHeart().getAttribute('aria-pressed')).toBe('true'));
  expect(within(card).getByText(/部分已收藏/)).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: '下一页' }));
  expect(within(detail).getByRole('button', { name: '收藏' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(within(detail).getByRole('button', { name: '收藏' }));
  await waitFor(() => expect(within(detail).getByRole('button', { name: '取消收藏' }).getAttribute('aria-pressed')).toBe('true'));
  expect(groupHeart().getAttribute('aria-pressed')).toBe('true');
  expect(within(card).queryByText(/部分已收藏/)).toBeNull();
  expect(service.collectionSnapshot().filter(item => !item.archived).map(item => item.analysis?.collectionImageId).sort()).toEqual(['image-0', 'image-1']);
});

it.each(['books', 'community'] as const)('%s 的保存图标一键创建风格串，保留来源、当前图片及角色，不执行生图', async mode => {
  setup(); await screen.findByRole('button', { name: /合成词条/ });
  if (mode === 'community') chooseSource('共创广场');
  fireEvent.click(await screen.findByRole('button', { name: mode === 'community' ? /新投稿/ : /合成词条/ }));
  await ready();
  const save = screen.getByRole('button', { name: '保存到风格串' });
  expect(save.querySelector('svg.lucide-layers')).toBeTruthy();
  expect(save.classList.contains('bg-emerald-700')).toBe(true);
  expect(save.classList.contains('dark:bg-emerald-700/90')).toBe(true);
  expect(save.classList.contains('text-white')).toBe(true);
  fireEvent.click(save);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  const chain = mocks.create.mock.calls[0][0];
  expect(chain).toMatchObject({ userId: 'owner', type: 'style', basePrompt: metadata.prompt, negativePrompt: metadata.negativePrompt, description: entry.sourceUrl,
    previewImage: entry.images[0].originalUrl, modules: [], tags: [], params: metadata.params });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.file).toHaveBeenCalledOnce(); expect(mocks.navigate).not.toHaveBeenCalled();
});

it.each((['books', 'community'] as const).flatMap(mode => ['图生图', '局部重绘', '扩图'].map(label => [mode, label] as const)))('%s 的第三个紫色按钮投递%s当前页底图，不混入参数', async (mode, label) => {
  vi.stubGlobal('innerWidth', mode === 'books' ? 390 : 1280);
  setup(); await screen.findByRole('button', { name: /合成词条/ });
  if (mode === 'community') chooseSource('共创广场');
  fireEvent.click(await screen.findByRole('button', { name: mode === 'community' ? /新投稿/ : /合成词条/ }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  const trigger = screen.getByRole('button', { name: '用作底图' });
  const actions = trigger.parentElement!.parentElement!;
  expect(within(actions).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['保存到风格串', '导入实验室', '用作底图']);
  expect(actions.classList.contains('ml-auto')).toBe(true);
  expect(actions.parentElement!.classList.contains('flex-wrap')).toBe(true);
  expect(trigger.classList.contains('bg-purple-600')).toBe(true);
  expect(trigger.classList.contains('dark:bg-purple-600/90')).toBe(true);
  expect(trigger.querySelector('svg.lucide-image-plus')).toBeTruthy();
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: '用作底图' });
  expect(panel.classList.contains('mobile-sheet')).toBe(mode === 'books');
  fireEvent.click(within(panel).getByRole('button', { name: label }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toEqual({ mode: 'base-image', imageEditOperation: { '图生图': 'image-to-image', '局部重绘': 'inpaint', '扩图': 'outpaint' }[label], baseImageUrl: expect.stringContaining(encodeURIComponent(entry.images[1].originalUrl)) });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.navigate).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('原图元数据读取失败仍可取用图片作底图，无原图时使用当前展示图片', async () => {
  mocks.metadata.mockRejectedValueOnce(new Error('合成元数据读取失败'));
  const view = setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '用作底图' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '用作底图' })).getByRole('button', { name: '图生图' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toEqual({ mode: 'base-image', imageEditOperation: 'image-to-image', baseImageUrl: expect.stringContaining(encodeURIComponent(entry.images[0].originalUrl)) });
  view.unmount(); sessionStorage.clear(); mocks.navigate.mockClear();
  mocks.book.mockResolvedValue({ entries: [{ ...entry, images: entry.images.map(image => ({ ...image, originalUrl: '' })) }] });
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  fireEvent.click(screen.getByRole('button', { name: '用作底图' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '用作底图' })).getByRole('button', { name: '扩图' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toEqual({ mode: 'base-image', imageEditOperation: 'outpaint', baseImageUrl: expect.stringContaining(encodeURIComponent(entry.images[0].url)) });
  expect(mocks.navigate).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
});

it('保存中不重复创建，失败保留详情并可重试；纯文本条目也能保存', async () => {
  mocks.book.mockResolvedValue({ release: boot.release, entries: [{ ...entry, images: [] }] });
  let reject!: (error: Error) => void;
  mocks.create.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  const save = screen.getByRole('button', { name: '保存到风格串' });
  const base = screen.getByRole('button', { name: '用作底图' });
  expect((base as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(base); expect(screen.queryByRole('dialog', { name: '用作底图' })).toBeNull();
  expect(save.querySelector('svg.lucide-layers')).toBeTruthy();
  fireEvent.click(save); fireEvent.click(save); expect(mocks.create).toHaveBeenCalledOnce();
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect(save.getAttribute('aria-busy')).toBe('true');
  expect(save.querySelector('svg.animate-spin')).toBeTruthy();
  await act(async () => reject(new Error('合成保存失败')));
  expect(mocks.notify).toHaveBeenCalledWith('合成保存失败', 'error'); expect((save as HTMLButtonElement).disabled).toBe(false);
  expect(save.querySelector('svg.lucide-layers')).toBeTruthy();
  fireEvent.click(save); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1][0].previewImage).toBeUndefined();
});

it('封面抓取失败时自动去掉封面重试，提示词仍保存并显示降级提示', async () => {
  mocks.create
    .mockRejectedValueOnce(new Error('Failed to fetch and store external image: 外链响应不是支持的 PNG、JPEG 或 WebP 图片'))
    .mockResolvedValueOnce(undefined);
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '保存到风格串' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[0][0].previewImage).toBe(entry.images[0].originalUrl);
  expect(mocks.create.mock.calls[1][0].previewImage).toBeUndefined();
  expect(mocks.create.mock.calls[1][0].basePrompt).toBe(metadata.prompt);
  expect(mocks.notify).toHaveBeenCalledWith('封面未能保存，已只保存提示词到风格串');
  expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('外链响应不是支持的'), 'error');
});

it('非封面错误不自动去掉封面重试', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Forbidden'));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '保存到风格串' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('Forbidden', 'error'));
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][0].previewImage).toBe(entry.images[0].originalUrl);
});

it.each(['admin', 'guest'] as const)('%s 查看当前图片独立展示词并取用同一页，访客不能保存', async role => {
  const perImage = { ...entry, images: entry.images.map((image, page) => ({ ...image, originalUrl: '', prompt: `page ${page}`, negative: `negative ${page}`, characters: [] })) };
  mocks.book.mockResolvedValue({ release: boot.release, entries: [perImage] });
  setup(true, role); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('page 1')).toBeTruthy(); expect(screen.getByText('negative 1')).toBeTruthy();
  expect(screen.queryByText('weighted prompt')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'page 1' });
  const save = screen.getByRole('button', { name: '保存到风格串' });
  expect((save as HTMLButtonElement).disabled).toBe(role === 'guest'); fireEvent.click(save);
  if (role === 'guest') expect(mocks.create).not.toHaveBeenCalled();
  else {
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ basePrompt: 'page 1', previewImage: entry.images[1].url, params: { characters: [] } });
  }
});

it('原图读取失败时阻止导入和保存，不悄悄回退展示词；重读后恢复完整导入', async () => {
  mocks.metadata.mockRejectedValueOnce(new Error('合成读取失败'));
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '合成读取失败');
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' })); fireEvent.click(screen.getByRole('button', { name: '保存到风格串' }));
  expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(sessionStorage.getItem(IMPORT_SESSION_KEY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await ready();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ fullMetadata: true, params: metadata.params });
  mocks.metadata.mockRejectedValueOnce(new Error('再次读取失败'));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '再次读取失败');
  expect((screen.getByRole('button', { name: '导入实验室' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '保存到风格串' }) as HTMLButtonElement).disabled).toBe(true);
});

it('原图可读但不含 NAI 元数据时显示条目来源，直接导入已知正负词和角色', async () => {
  mocks.metadata.mockResolvedValueOnce(null);
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await screen.findByText('无可用原图配置，取用条目内容');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  const value = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
  expect(value).toMatchObject({ prompt: entry.prompt, negativePrompt: entry.negative, replace: false, characters: [{ prompt: 'girl', negativePrompt: 'boy' }] });
  expect(value.params).toBeUndefined(); expect(value.fullMetadata).toBeUndefined(); expect(mocks.navigate).toHaveBeenCalledOnce();
});

it('部分原图元数据仍一键取用所有已知字段，并标明未提供的参数保留当前设置', async () => {
  const partial = { ...metadata, negativePrompt: undefined, rawNegative: '', params: { steps: 20, sampler: 'k_euler', seed: 0 } };
  mocks.metadata.mockResolvedValueOnce(partial);
  setup(); fireEvent.click(await screen.findByRole('button', { name: /合成词条/ }));
  await screen.findByText('部分元数据，缺失参数保留当前设置');
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ fullMetadata: true, partialMetadata: true, params: partial.params, importSettings: true, importSeed: true, importModel: false });
});

it.each(['books', 'community'] as const)('%s 列表经过首批120条后触底连续追加直至真实末尾，不靠按钮', async mode => {
  const observers: { callback: IntersectionObserverCallback; targets: Set<Element> }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    state: typeof observers[number];
    constructor(callback: IntersectionObserverCallback) { this.state = { callback, targets: new Set() }; observers.push(this.state); }
    observe(target: Element) { this.state.targets.add(target); }
    disconnect() { this.state.targets.clear(); }
  });
  const entries = Array.from({ length: 241 }, (_, index) => ({ ...entry, key: 'entry-' + index, id: String(index), title: '连续词条 ' + index }));
  mocks.book.mockResolvedValue({ entries }); mocks.community.mockResolvedValue({ entries });
  const view = setup();
  await screen.findByText('连续词条 0');
  if (mode === 'community') { chooseSource('共创广场'); await waitFor(() => expect(mocks.community).toHaveBeenCalled()); }
  const cards = () => view.container.querySelectorAll('[data-gallery-work-id]');
  await waitFor(() => expect(cards()).toHaveLength(120));
  const next = async () => {
    const observer = observers.find(value => [...value.targets].some(target => target.closest('.workspace-scroll-viewport')))!;
    expect(observer).toBeTruthy();
    await act(async () => observer.callback([...observer.targets].map(target => ({ target, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver));
  };
  const first = cards()[0];
  await next(); expect(cards()).toHaveLength(240); expect(cards()[0]).toBe(first);
  await next(); expect(cards()).toHaveLength(241); expect(cards()[0]).toBe(first);
  expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  expect(mocks.book).toHaveBeenCalledTimes(1);
});
