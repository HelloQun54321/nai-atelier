// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleCover } from '../../components/ArtistSampleCover';
import { ImageActivityContext } from '../../components/SmartImage';
import type { ArtistOwnSample } from '../../services/artistSamples';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), share: vi.fn(), observers: [] as IntersectionObserverCallback[] }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleLookup: mocks.lookup }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ eager, previewTransform, ...props }: any) => <img {...props} data-eager={String(eager)} data-preview-transform={previewTransform} /> }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: 'h-11 w-11 rounded-full md:h-8 md:w-8', ImageShareActions: (props: any) => { mocks.share(props); return <div className="image-share-actions" data-testid="share" data-card-action="true" data-url={props.imageUrl} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><button aria-label="收藏" onClick={() => props.onFavoriteChange?.(true)}>收藏</button><button aria-label="下载图片">下载</button><button aria-label="复制图片">复制</button></div>; } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.observers.length = 0;
  mocks.lookup.mockResolvedValue({ pack: 'v45', tag: 'synthetic artist', revision: 'one', imageCount: 2, sourceUrl: 'https://synthetic.invalid/pack' });
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { mocks.observers.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const visible = (value = true) => act(() => { mocks.observers.at(-1)!([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver); });
const setup = (ownSamples: ArtistOwnSample[] = [], hasPackSample = true) => {
  const props = { tag: 'synthetic artist', pack: 'v45' as const, revision: 'one', hasPackSample, ownSamples, alt: '合成画师', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  const view = render(<ArtistSampleCover {...props} />); return { ...view, props };
};

it('只在卡片可视时lookup，翻图同步分享身份，不伪造图包模型或配方；离屏保持已载图片', async () => {
  setup(); expect(mocks.lookup).not.toHaveBeenCalled(); visible();
  await screen.findByRole('img', { name: '合成画师' });
  expect(screen.getByRole('img').getAttribute('data-preview-transform')).toBe('artist-sample-padding-v1');
  expect(mocks.lookup).toHaveBeenCalledOnce();
  const first = mocks.share.mock.calls.at(-1)![0];
  expect(first.favorite.analysis.artistSample).toEqual({ pack: 'v45', tag: 'synthetic artist', revision: 'one', index: 0 });
  expect(first.favorite.params).toBeUndefined(); expect(first.favorite.prompt).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  const second = mocks.share.mock.calls.at(-1)![0]; expect(second.imageUrl).toContain('index=1');
  expect(second.favorite.imageId).not.toBe(first.favorite.imageId); expect(second.favorite.analysis.artistSample.index).toBe(1);
  const image = screen.getByRole('img'); visible(false);
  expect(screen.getByRole('img')).toBe(image); expect(image.getAttribute('data-eager')).toBe('false');
  visible(); expect(mocks.lookup).toHaveBeenCalledOnce();
});

it('自建样张优先展示真实元数据和标记，图片点击冒泡选择画师，仍可翻到图包', async () => {
  const own: ArtistOwnSample = { id: 'own-1', tag: 'synthetic artist', pack: 'v45', imageUrl: '/api/assets/own.png', prompt: 'own prompt', negativePrompt: 'own negative', createdAt: 1,
    params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' } };
  const select = vi.fn();
  const props = { tag: own.tag, pack: own.pack, revision: 'one', hasPackSample: true, ownSamples: [own], alt: '合成画师', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  render(<div onClick={select}><ArtistSampleCover {...props} /></div>);
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  expect(screen.getByText('自建样张')).toBeTruthy(); expect(screen.getByRole('img').getAttribute('src')).toBe(own.imageUrl);
  expect(screen.getByRole('img').getAttribute('data-preview-transform')).toBeNull();
  expect(mocks.share.mock.calls.at(-1)![0].favorite).toMatchObject({ prompt: own.prompt, negativePrompt: own.negativePrompt, params: own.params, analysis: { artistSample: { ownSampleId: own.id, model: own.params.model } } });
  fireEvent.click(screen.getByRole('img', { name: '合成画师' })); expect(select).toHaveBeenCalledOnce();
  visible(); await waitFor(() => expect(screen.getByRole('button', { name: '下一张' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); expect(screen.queryByText('自建样张')).toBeNull();
  expect(mocks.share.mock.calls.at(-1)![0].favorite.params).toBeUndefined();
});

it('收藏、分享、翻图操作不会冒泡选择画师', async () => {
  const select = vi.fn(), props = { tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: true, ownSamples: [], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  render(<div onClick={select}><ArtistSampleCover {...props} /></div>);
  visible(); await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
  fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(select).not.toHaveBeenCalled();
});

it('切换模型包会取消旧lookup，迟到结果不生成旧包图片；后台页面不lookup', async () => {
  let finish!: (value: unknown) => void;
  mocks.lookup.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ pack: 'v5', tag: 'synthetic artist', revision: 'two', imageCount: 1, sourceUrl: '' });
  const { props, rerender } = setup(); visible(); const signal = mocks.lookup.mock.calls[0][2] as AbortSignal;
  rerender(<ArtistSampleCover {...props} pack="v5" revision="two" />); expect(signal.aborted).toBe(true); visible();
  await act(async () => finish({ pack: 'v45', tag: props.tag, revision: 'one', imageCount: 9, sourceUrl: '' }));
  await screen.findByRole('img'); expect(screen.getByRole('img').getAttribute('src')).toContain('pack=v5');
  rerender(<ImageActivityContext.Provider value={false}><ArtistSampleCover {...props} /></ImageActivityContext.Provider>);
  const count = mocks.lookup.mock.calls.length; visible(); expect(mocks.lookup).toHaveBeenCalledTimes(count);
});

it('读取失败区别于无图，只有主动重试才再次lookup；缺图补充只调用已有动作', async () => {
  mocks.lookup.mockRejectedValueOnce(new Error('合成索引失败'));
  const { props, rerender } = setup(); visible(); await screen.findByText('合成索引失败');
  expect(mocks.lookup).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('img'); expect(mocks.lookup).toHaveBeenCalledTimes(2);
  rerender(<ArtistSampleCover {...props} hasPackSample={false} revision="missing" />);
  fireEvent.click(screen.getByRole('button', { name: '补充样张' })); expect(props.onSupplement).toHaveBeenCalledOnce();
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
});
it('缺图空态只保留版本胶囊和直接补充按钮，不提供设置菜单', () => {
  const select = vi.fn(), supplement = vi.fn();
  render(<div onClick={select}><ArtistSampleCover tag="artist" pack="v5" revision="one" hasPackSample={false} ownSamples={[]} alt="artist" onPackChange={vi.fn()} onSupplement={supplement} notify={vi.fn()} /></div>);
  expect(screen.getByText('V5 暂无样张')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '补图生成设置' })).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getAllByRole('button', { name: '补充样张' })).toHaveLength(1);
  const button = screen.getByRole('button', { name: '补充样张' }); expect(button.className).toContain('min-h-11'); expect(button.className).toContain('rounded-xl');
  fireEvent.click(button); expect(supplement).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
});

it.each(['v45', 'v5'] as const)('当前%s版本胶囊一次点击切另一版，键盘/指针事件不选卡且无弹层', pack => {
  const select = vi.fn(), key = vi.fn(), onPackChange = vi.fn(), target = pack === 'v45' ? 'v5' : 'v45';
  render(<div onClick={select} onKeyDown={key}><ArtistSampleCover tag="artist" pack={pack} revision="one" hasPackSample ownSamples={[]} alt="artist" onPackChange={onPackChange} onSupplement={vi.fn()} notify={vi.fn()} /></div>);
  const button = screen.getByRole('button', { name: /样张版本 .*切换为/ });
  expect(button.title).toContain(pack === 'v45' ? 'V4.5，切换为 V5' : 'V5，切换为 V4.5');
  expect(button.getAttribute('aria-haspopup')).toBeNull(); expect(button.className).toContain('bg-black/55'); expect(button.className).toContain('rounded-full');
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.keyDown(button, { key: ' ' }); expect(key).not.toHaveBeenCalled();
  fireEvent.click(button); expect(onPackChange).toHaveBeenCalledExactlyOnceWith(target); expect(select).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});

it('已有图包样张的读取中、错误与加载完成均不显示补图按钮，也不误选画师', async () => {
  const select = vi.fn(), onSupplement = vi.fn(); mocks.lookup.mockRejectedValueOnce(new Error('合成读取失败'));
  render(<div onClick={select}><ArtistSampleCover tag="artist" pack="v45" revision="one" hasPackSample ownSamples={[]} alt="artist" onPackChange={vi.fn()} onSupplement={onSupplement} notify={vi.fn()} /></div>);
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  visible(); const message = await screen.findByText('合成读取失败'); expect(message.className).toContain('max-h-[4.5em]'); expect(message.className).toContain('overflow-y-auto'); expect(message.className).toContain('break-words');
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('img');
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull(); expect(onSupplement).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});

it('实时预览仅覆盖图片区，旧成功样张保留；切版本后不残留旧预览或生成入口', () => {
  const own: ArtistOwnSample = { id: 'old', tag: 'synthetic artist', pack: 'v45', imageUrl: '/api/assets/old.png', prompt: 'old', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' }, createdAt: 1 };
  const { props, rerender } = setup([own], false);
  const generation: any = { target: { tag: own.tag, pack: own.pack }, phase: 'generating', session: { preview: { image: 'data:image/png;base64,c3ludGhldGlj' } } };
  rerender(<ArtistSampleCover {...props} generation={generation} pending />);
  expect(screen.getByRole('img', { name: '合成画师' }).getAttribute('src')).toBe(own.imageUrl);
  expect(screen.getByRole('img', { name: '样张生成预览' }).getAttribute('src')).toBe(generation.session.preview.image);
  expect(screen.queryByTestId('share')).toBeNull();
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  rerender(<ArtistSampleCover {...props} generation={{ ...generation, phase: 'failed', session: undefined }} />);
  expect(screen.getByRole('img', { name: '合成画师' }).getAttribute('src')).toBe(own.imageUrl);
  expect(screen.queryByRole('img', { name: '样张生成预览' })).toBeNull();
  rerender(<ArtistSampleCover {...props} pack="v5" ownSamples={[]} />);
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByRole('button', { name: '补充样张' })).toBeTruthy();
});

it('缺图任务进行中不提供第二次生成；归档失败展示真实历史且只留保存重试给外层固定区', () => {
  const { props, rerender } = setup([], false);
  rerender(<ArtistSampleCover {...props} pending generation={{ target: { id: 'target', tag: props.tag, pack: props.pack, historyIds: [] }, phase: 'preparing' }} />);
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  rerender(<ArtistSampleCover {...props} generation={{ target: { id: 'target', tag: props.tag, pack: props.pack, historyIds: ['history'] }, phase: 'save_failed', item: { id: 'history', imageUrl: '/api/assets/history.png' } as any }} />);
  expect(screen.getByRole('img', { name: '样张生成预览' }).getAttribute('src')).toBe('/api/assets/history.png');
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
});

it('有图的生成入口共用右侧小圆形操作样式，图包和自建区别文案，点击不会选卡；缺图仅固定入口', async () => {
  const select = vi.fn(), generate = vi.fn();
  const props = { tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: true, ownSamples: [] as ArtistOwnSample[], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), onGenerate: generate, notify: vi.fn() };
  const view = render(<div onClick={select}><ArtistSampleCover {...props} /></div>); visible();
  const button = await screen.findByRole('button', { name: '生成样张' });
  expect(button.title).toBe('生成样张'); expect(button.textContent).toBe('');
  expect(button.className).toContain('h-11'); expect(button.className).toContain('rounded-full'); expect(button.className).toContain('hover-reveal-md');
  expect(button.className).not.toMatch(/absolute|bottom-|right-/);
  expect(button.parentElement?.className).toContain('right-2'); expect(button.parentElement?.className).toContain('top-2'); expect(button.parentElement?.className).toContain('image-card-actions');
  expect(Array.from(button.parentElement?.querySelectorAll('button') || [], action => action.getAttribute('aria-label'))).toEqual(['收藏', '下载图片', '复制图片', '生成样张']);
  fireEvent.click(button); expect(generate).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
  const own: ArtistOwnSample = { id: 'new', tag: 'artist', pack: 'v45', imageUrl: '/api/assets/new.png', prompt: '', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' } as any, createdAt: 1 };
  view.rerender(<div onClick={select}><ArtistSampleCover {...props} ownSamples={[own]} /></div>);
  expect(screen.getByRole('button', { name: '重新生成样张' }).textContent).toBe('');
  expect(screen.queryByRole('button', { name: '生成样张' })).toBeNull();
  view.rerender(<div onClick={select}><ArtistSampleCover {...props} hasPackSample={false} /></div>);
  expect(screen.queryByRole('button', { name: '生成样张' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '补充样张' })).toHaveLength(1);
});
