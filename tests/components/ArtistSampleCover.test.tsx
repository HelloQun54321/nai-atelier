// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleCover } from '../../components/ArtistSampleCover';
import { ImageActivityContext } from '../../components/SmartImage';
import type { ArtistOwnSample } from '../../services/artistSamples';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), share: vi.fn(), preference: vi.fn(), observers: [] as IntersectionObserverCallback[] }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleLookup: mocks.lookup }));
vi.mock('../../services/collectionFavorites', () => ({ toggleArtistPreference: mocks.preference }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ eager, previewTransform, ...props }: any) => <img {...props} data-eager={String(eager)} data-preview-transform={previewTransform} /> }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: 'h-11 w-11 rounded-full md:h-8 md:w-8', ImageShareActions: (props: any) => { mocks.share(props); return <div className="image-share-actions" data-testid="share" data-card-action="true" data-url={props.imageUrl} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{props.showFavorite !== false && <button aria-label="收藏">收藏</button>}<button aria-label="下载图片">下载</button><button aria-label="复制图片">复制</button></div>; } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.observers.length = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  mocks.lookup.mockResolvedValue({ pack: 'v45', tag: 'synthetic artist', revision: 'one', imageCount: 2, sourceUrl: 'https://synthetic.invalid/pack' });
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { mocks.observers.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const visible = (value = true) => act(() => { mocks.observers.at(-1)!([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver); });
const actions = { preferred: false, blocked: false, onBlock: vi.fn(async () => {}), onCloseTools: vi.fn(), toolsAnchor: { current: document.createElement('button') } };
const setup = (ownSamples: ArtistOwnSample[] = [], hasPackSample = true) => {
  const props = { tag: 'synthetic artist', pack: 'v45' as const, revision: 'one', hasPackSample, ownSamples, alt: '合成画师', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  const view = render(<ArtistSampleCover {...actions} {...props} />); return { ...view, props };
};

it('只在卡片可视时lookup，翻图同步分享身份，不伪造图包模型或配方；离屏保持已载图片', async () => {
  setup(); expect(mocks.lookup).not.toHaveBeenCalled(); visible();
  await screen.findByRole('img', { name: '合成画师' });
  expect(screen.getByRole('img').getAttribute('data-preview-transform')).toBe('artist-sample-padding-v2');
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
  render(<div onClick={select}><ArtistSampleCover {...actions} {...props} /></div>);
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
  render(<div onClick={select}><ArtistSampleCover {...actions} {...props} /></div>);
  visible(); await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: /偏好画师：/ }));
  fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
  fireEvent.click(screen.getByRole('button', { name: '复制图片' }));
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(select).not.toHaveBeenCalled();
});

it('切换模型包会取消旧lookup，迟到结果不生成旧包图片；后台页面不lookup', async () => {
  let finish!: (value: unknown) => void;
  mocks.lookup.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ pack: 'v5', tag: 'synthetic artist', revision: 'two', imageCount: 1, sourceUrl: '' });
  const { props, rerender } = setup(); visible(); const signal = mocks.lookup.mock.calls[0][2] as AbortSignal;
  rerender(<ArtistSampleCover {...actions} {...props} pack="v5" revision="two" />); expect(signal.aborted).toBe(true); visible();
  await act(async () => finish({ pack: 'v45', tag: props.tag, revision: 'one', imageCount: 9, sourceUrl: '' }));
  await screen.findByRole('img'); expect(screen.getByRole('img').getAttribute('src')).toContain('pack=v5');
  rerender(<ImageActivityContext.Provider value={false}><ArtistSampleCover {...actions} {...props} /></ImageActivityContext.Provider>);
  const count = mocks.lookup.mock.calls.length; visible(); expect(mocks.lookup).toHaveBeenCalledTimes(count);
});

it('读取失败区别于无图，只有主动重试才再次lookup；缺图补充只调用已有动作', async () => {
  mocks.lookup.mockRejectedValueOnce(new Error('合成索引失败'));
  const { props, rerender } = setup(); visible(); await screen.findByText('合成索引失败');
  expect(mocks.lookup).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('img'); expect(mocks.lookup).toHaveBeenCalledTimes(2);
  rerender(<ArtistSampleCover {...actions} {...props} hasPackSample={false} revision="missing" />);
  fireEvent.click(screen.getByRole('button', { name: '补充样张' })); expect(props.onSupplement).toHaveBeenCalledOnce();
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
});
it('静止封面保留屏蔽、偏好和版本切换；缺图也能操作，不产生收费请求或选择卡片', async () => {
  const select = vi.fn(), key = vi.fn(), onBlock = vi.fn(async () => {});
  render(<div onClick={select} onKeyDown={key}><ArtistSampleCover {...actions} toolsAnchor={undefined} tag="artist" pack="v5" revision="one" hasPackSample={false} ownSamples={[]} alt="artist" onPackChange={vi.fn()} onSupplement={vi.fn()} notify={vi.fn()} onBlock={onBlock} /></div>);
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['屏蔽画师：artist', '偏好画师：artist', '样张版本 V5，切换为 V4.5']);
  const block = screen.getByRole('button', { name: '屏蔽画师：artist' });
  fireEvent.keyDown(block, { key: 'Enter' }); fireEvent.click(block);
  await waitFor(() => expect(block.hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：artist' }));
  await waitFor(() => expect(mocks.preference).toHaveBeenCalledWith('artist', '', undefined));
  expect(onBlock).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['v45', 'v5'] as const)('封面爱心下方直接切换 %s 版本，不选卡、不打开弹卡', pack => {
  const select = vi.fn(), onPackChange = vi.fn(), key = vi.fn();
  render(<div onClick={select} onKeyDown={key}><ArtistSampleCover {...actions} toolsAnchor={undefined} tag="artist" pack={pack} revision="one" hasPackSample ownSamples={[]} alt="artist" onPackChange={onPackChange} onSupplement={vi.fn()} notify={vi.fn()} /></div>);
  const button = screen.getByRole('button', { name: /样张版本 .*切换为/ });
  const favorite = screen.getByRole('button', { name: '偏好画师：artist' });
  expect(favorite.nextElementSibling).toBe(button); expect(button.parentElement?.className).toContain('right-2'); expect(button.parentElement?.className).toContain('flex-col');
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button);
  expect(onPackChange).toHaveBeenCalledExactlyOnceWith(pack === 'v45' ? 'v5' : 'v45'); expect(select).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});

it('已有图包样张的读取中、错误与加载完成均不显示补图按钮，也不误选画师', async () => {
  const select = vi.fn(), onSupplement = vi.fn(); mocks.lookup.mockRejectedValueOnce(new Error('合成读取失败'));
  render(<div onClick={select}><ArtistSampleCover {...actions} tag="artist" pack="v45" revision="one" hasPackSample ownSamples={[]} alt="artist" onPackChange={vi.fn()} onSupplement={onSupplement} notify={vi.fn()} /></div>);
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
  rerender(<ArtistSampleCover {...actions} {...props} generation={generation} pending />);
  expect(screen.getByRole('img', { name: '合成画师' }).getAttribute('src')).toBe(own.imageUrl);
  expect(screen.getByRole('img', { name: '样张生成预览' }).getAttribute('src')).toBe(generation.session.preview.image);
  expect(screen.queryByTestId('share')).toBeNull();
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  rerender(<ArtistSampleCover {...actions} {...props} generation={{ ...generation, phase: 'failed', session: undefined }} />);
  expect(screen.getByRole('img', { name: '合成画师' }).getAttribute('src')).toBe(own.imageUrl);
  expect(screen.queryByRole('img', { name: '样张生成预览' })).toBeNull();
  rerender(<ArtistSampleCover {...actions} {...props} pack="v5" ownSamples={[]} />);
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByRole('button', { name: '补充样张' })).toBeTruthy();
});

it('缺图任务进行中不提供第二次生成；归档失败展示真实历史且只留保存重试给外层固定区', () => {
  const { props, rerender } = setup([], false);
  rerender(<ArtistSampleCover {...actions} {...props} pending generation={{ target: { id: 'target', tag: props.tag, pack: props.pack, historyIds: [] }, phase: 'preparing' }} />);
  expect(screen.getByRole('button', { name: '补充样张' }).hasAttribute('disabled')).toBe(true);
  rerender(<ArtistSampleCover {...actions} {...props} generation={{ target: { id: 'target', tag: props.tag, pack: props.pack, historyIds: ['history'] }, phase: 'save_failed', item: { id: 'history', imageUrl: '/api/assets/history.png' } as any }} />);
  expect(screen.getByRole('img', { name: '样张生成预览' }).getAttribute('src')).toBe('/api/assets/history.png');
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
});

it('生成与分享收进样张弹卡，当前图片和元数据随翻图更新；失败保留偏好状态', async () => {
  const select = vi.fn(), generate = vi.fn(), notify = vi.fn();
  const props = { tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: true, ownSamples: [] as ArtistOwnSample[], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), onGenerate: generate, notify };
  const view = render(<div onClick={select}><ArtistSampleCover {...actions} {...props} /></div>); visible();
  const button = await screen.findByRole('button', { name: '生成样张' });
  expect(button.closest('[role="dialog"]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: '收藏' })).toBeNull();
  fireEvent.click(button); expect(generate).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  mocks.preference.mockRejectedValueOnce(new Error('合成保存失败'));
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：artist' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败', 'error'));
  expect(mocks.preference).toHaveBeenCalledWith('artist', expect.stringContaining('index=1'), expect.objectContaining({ analysis: { artistSample: { pack: 'v45', tag: 'artist', revision: 'one', index: 1 } } }));
  expect(screen.getByRole('button', { name: '偏好画师：artist' }).getAttribute('aria-pressed')).toBe('false');
  const own: ArtistOwnSample = { id: 'new', tag: 'artist', pack: 'v45', imageUrl: '/api/assets/new.png', prompt: '', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' } as any, createdAt: 1 };
  view.rerender(<div onClick={select}><ArtistSampleCover {...actions} {...props} preferred blocked ownSamples={[own]} /></div>);
  expect(screen.getByRole('button', { name: '重新生成样张' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消偏好画师：artist' }).getAttribute('aria-pressed')).toBe('true');
  view.rerender(<div onClick={select}><ArtistSampleCover {...actions} {...props} preferred blocked pack="v5" hasPackSample={false} /></div>);
  expect(screen.getByRole('button', { name: '取消偏好画师：artist' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '取消屏蔽画师：artist' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '补充样张' })).toBeTruthy();
});
