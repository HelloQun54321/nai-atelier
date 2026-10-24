// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleCover } from '../../components/ArtistSampleCover';
import { ImageActivityContext } from '../../components/SmartImage';
import type { ArtistOwnSample, ArtistSampleRemoval } from '../../services/artistSamples';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), preference: vi.fn(), observers: [] as IntersectionObserverCallback[] }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleLookup: mocks.lookup }));
vi.mock('../../services/collectionFavorites', () => ({ toggleArtistPreference: mocks.preference }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ eager, previewTransform, ...props }: any) => <img {...props} data-eager={String(eager)} data-preview-transform={previewTransform} /> }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: 'h-11 w-11 rounded-full md:h-8 md:w-8' }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.observers.length = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  mocks.lookup.mockResolvedValue({ pack: 'v45', tag: 'synthetic artist', revision: 'one', imageCount: 2, sourceUrl: 'https://synthetic.invalid/pack' });
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { mocks.observers.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const visible = (value = true) => act(() => { mocks.observers.at(-1)!([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver); });
const actions = { preferred: false, blocked: false, onBlock: vi.fn(async () => {}) };
const setup = (ownSamples: ArtistOwnSample[] = [], hasPackSample = true) => {
  const props = { tag: 'synthetic artist', pack: 'v45' as const, revision: 'one', hasPackSample, ownSamples, alt: '合成画师', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  const view = render(<ArtistSampleCover {...actions} {...props} />); return { ...view, props };
};

it('资料弹窗状态图标预留右下空间，不移动封面或缩小翻图按钮', async () => {
  const view = setup(); visible(); await screen.findByRole('img');
  const props = view.props;
  view.rerender(<ArtistSampleCover {...actions} {...props} ownSamples={[]} reserveStatusSpace />);
  const next = screen.getByRole('button', { name: '下一张' });
  expect(next.parentElement?.classList.contains('right-14')).toBe(true);
  expect(next.classList.contains('h-11')).toBe(true);
});

it('只在卡片可视时lookup，翻图后偏好保存当前图片身份而不伪造配方；离屏保持已载图片', async () => {
  setup(); expect(mocks.lookup).not.toHaveBeenCalled(); visible();
  await screen.findByRole('img', { name: '合成画师' });
  expect(screen.getByRole('img').getAttribute('data-preview-transform')).toBe('artist-sample-padding-v2');
  expect(mocks.lookup).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('share')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：synthetic artist' }));
  await waitFor(() => expect(mocks.preference).toHaveBeenCalledOnce());
  expect(mocks.preference.mock.calls[0][0]).toBe('synthetic artist');
  expect(mocks.preference.mock.calls[0][1]).toContain('index=0');
  expect(mocks.preference.mock.calls[0][2]).toMatchObject({ sourceType: 'artist', sourceId: 'synthetic artist', analysis: { artistSample: { pack: 'v45', tag: 'synthetic artist', revision: 'one', index: 0 } } });
  expect(mocks.preference.mock.calls[0][2].params).toBeUndefined(); expect(mocks.preference.mock.calls[0][2].prompt).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(screen.getByRole('img').getAttribute('src')).toContain('index=1');
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：synthetic artist' }));
  await waitFor(() => expect(mocks.preference).toHaveBeenCalledTimes(2));
  expect(mocks.preference.mock.calls[1][1]).toContain('index=1');
  expect(mocks.preference.mock.calls[1][2].analysis.artistSample.index).toBe(1);
  expect(mocks.preference.mock.calls[1][2].imageId).not.toBe(mocks.preference.mock.calls[0][2].imageId);
  const image = screen.getByRole('img'); visible(false);
  expect(screen.getByRole('img')).toBe(image); expect(image.getAttribute('data-eager')).toBe('false');
  visible(); expect(mocks.lookup).toHaveBeenCalledOnce();
});

it('自建样张优先展示真实元数据，图片点击冒泡选择画师，仍可翻到图包', async () => {
  const own: ArtistOwnSample = { id: 'own-1', tag: 'synthetic artist', pack: 'v45', imageUrl: '/api/assets/own.png', prompt: 'own prompt', negativePrompt: 'own negative', createdAt: 1,
    params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' } };
  const select = vi.fn();
  const props = { tag: own.tag, pack: own.pack, revision: 'one', hasPackSample: true, ownSamples: [own], alt: '合成画师', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  render(<div onClick={select}><ArtistSampleCover {...actions} {...props} /></div>);
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  expect(screen.queryByText('自建样张')).toBeNull(); expect(screen.getByRole('img').getAttribute('src')).toBe(own.imageUrl);
  expect(screen.getByRole('img').getAttribute('data-preview-transform')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：synthetic artist' }));
  await waitFor(() => expect(mocks.preference).toHaveBeenCalledOnce());
  expect(mocks.preference.mock.calls[0][1]).toBe(own.imageUrl);
  expect(mocks.preference.mock.calls[0][2]).toMatchObject({ prompt: own.prompt, negativePrompt: own.negativePrompt, params: own.params, analysis: { artistSample: { ownSampleId: own.id, model: own.params.model } } });
  fireEvent.click(screen.getByRole('img', { name: '合成画师' })); expect(select).toHaveBeenCalledOnce();
  visible(); await waitFor(() => expect(screen.getByRole('button', { name: '下一张' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); expect(screen.queryByText('自建样张')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：synthetic artist' }));
  await waitFor(() => expect(mocks.preference).toHaveBeenCalledTimes(2));
  expect(mocks.preference.mock.calls[1][1]).toContain('index=0'); expect(mocks.preference.mock.calls[1][2].params).toBeUndefined();
});

it('偏好和翻图操作不会冒泡选择画师，也不再提供下载复制弹卡入口', async () => {
  const select = vi.fn(), props = { tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: true, ownSamples: [], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), notify: vi.fn() };
  render(<div onClick={select}><ArtistSampleCover {...actions} {...props} /></div>);
  visible(); await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: /偏好画师：/ }));
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(screen.queryByRole('button', { name: '下载图片' })).toBeNull();
  expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull();
  expect(select).not.toHaveBeenCalled();
});

it('切换模型包会取消旧lookup，迟到结果不生成旧包图片；后台页面不lookup', async () => {
  let finish!: (value: unknown) => void;
  mocks.lookup.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ pack: 'v5', model: 'nai-diffusion-5-full', tag: 'synthetic artist', revision: 'two', imageCount: 1, sourceUrl: '' });
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
it('封面保留屏蔽、偏好和版本切换；缺图生成沿共用显露规则，不误选卡片', async () => {
  const select = vi.fn(), key = vi.fn(), onBlock = vi.fn(async () => {});
  render(<div onClick={select} onKeyDown={key}><ArtistSampleCover {...actions} tag="artist" pack="v5" revision="one" hasPackSample={false} ownSamples={[]} alt="artist" onPackChange={vi.fn()} onSupplement={vi.fn()} notify={vi.fn()} onBlock={onBlock} /></div>);
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['屏蔽画师：artist', '偏好画师：artist', '补充样张', '样张版本 V5 Full，切换为 V4.5']);
  const generate = screen.getByRole('button', { name: '补充样张' });
  expect(generate.textContent).toBe(''); expect(generate.className).toContain('hover-reveal-md');
  expect(generate.querySelector('.lucide-image-plus')).not.toBeNull(); expect(generate.querySelector('.lucide-refresh-cw')).toBeNull();
  const block = screen.getByRole('button', { name: '屏蔽画师：artist' });
  fireEvent.keyDown(block, { key: 'Enter' }); fireEvent.click(block);
  await waitFor(() => expect(block.hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '偏好画师：artist' }));
  await waitFor(() => expect(mocks.preference).toHaveBeenCalledWith('artist', '', undefined));
  expect(onBlock).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['v45', 'v5'] as const)('封面爱心下方直接切换 %s 版本，不选卡、不打开弹卡', pack => {
  const select = vi.fn(), onPackChange = vi.fn(), generate = vi.fn(), key = vi.fn();
  render(<div onClick={select} onKeyDown={key}><ArtistSampleCover {...actions} tag="artist" pack={pack} revision="one" hasPackSample ownSamples={[]} alt="artist" onPackChange={onPackChange} onSupplement={vi.fn()} onGenerate={generate} notify={vi.fn()} /></div>);
  const button = screen.getByRole('button', { name: /样张版本 .*切换为/ });
  const favorite = screen.getByRole('button', { name: '偏好画师：artist' });
  const generateButton = screen.getByRole('button', { name: '重新生成样张' });
  expect(favorite.nextElementSibling).toBe(generateButton); expect(generateButton.nextElementSibling).toBe(button);
  expect(button.parentElement?.className).toContain('right-2'); expect(button.parentElement?.className).toContain('image-card-actions');
  expect(button.className).toContain('hover-reveal-md'); expect(button.className).toContain('flex-col');
  expect(button.children[0].tagName.toLowerCase()).toBe('span'); expect(button.children[0].textContent).toBe(pack === 'v45' ? 'V4.5' : 'V5F');
  expect(button.children[1].tagName.toLowerCase()).toBe('svg'); expect(button.children[1].getAttribute('class')).toContain('h-2 w-2');
  expect(screen.getByRole('button', { name: '屏蔽画师：artist' }).getAttribute('data-image-action-left')).toBe('true');
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button);
  expect(onPackChange).toHaveBeenCalledExactlyOnceWith(pack === 'v45' ? 'v5' : 'v45'); expect(generate).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
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
  const generate = vi.fn();
  rerender(<ArtistSampleCover {...actions} {...props} onGenerate={generate} generation={generation} pending />);
  expect(screen.getByRole('img', { name: '合成画师' }).getAttribute('src')).toBe(own.imageUrl);
  expect(screen.getByRole('img', { name: '样张生成预览' }).getAttribute('src')).toBe(generation.session.preview.image);
  expect(screen.queryByTestId('share')).toBeNull();
  expect(screen.queryByRole('button', { name: '补充样张' })).toBeNull();
  const regenerate = screen.getByRole('button', { name: '重新生成样张' });
  expect(regenerate.hasAttribute('disabled')).toBe(true); fireEvent.click(regenerate); expect(generate).not.toHaveBeenCalled();
  rerender(<ArtistSampleCover {...actions} {...props} onGenerate={generate} generation={{ ...generation, phase: 'failed', session: undefined }} />);
  expect(screen.getByRole('img', { name: '合成画师' }).getAttribute('src')).toBe(own.imageUrl);
  expect(screen.queryByRole('img', { name: '样张生成预览' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新生成样张' })); expect(generate).toHaveBeenCalledOnce();
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

it('有图生成按钮就地叠循环标；翻图后偏好使用当前图片元数据', async () => {
  const select = vi.fn(), generate = vi.fn(), notify = vi.fn();
  const props = { tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: true, ownSamples: [] as ArtistOwnSample[], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), onGenerate: generate, notify };
  const view = render(<div onClick={select}><ArtistSampleCover {...actions} {...props} /></div>); visible();
  const button = await screen.findByRole('button', { name: '重新生成样张' });
  await screen.findByRole('img');
  expect(button.closest('[role="dialog"]')).toBeNull(); expect(button.textContent).toBe('');
  expect(button.querySelector('.lucide-image-plus')).not.toBeNull(); expect(button.querySelector('.lucide-refresh-cw')).not.toBeNull();
  expect(screen.queryByRole('button', { name: '收藏' })).toBeNull(); expect(screen.queryByTestId('share')).toBeNull();
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

it('无需选中即可翻遍新旧自建图与全部图包；新生成后回到最新图', async () => {
  const sample = (id: string): ArtistOwnSample => ({ id, tag: 'artist', pack: 'v45', imageUrl: `/api/assets/${id}.png`, prompt: id, negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' } as any, createdAt: 1 });
  const select = vi.fn(), key = vi.fn(), generate = vi.fn(), old = sample('old'), older = sample('older');
  const props = { tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: true, ownSamples: [old, older], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), onGenerate: generate, notify: vi.fn() };
  const draw = (ownSamples = props.ownSamples, pending = false) => <div onClick={select} onKeyDown={key}><ArtistSampleCover {...actions} {...props} ownSamples={ownSamples} pending={pending} /></div>;
  const view = render(draw()); visible();
  await waitFor(() => expect(screen.getByText('1 / 4')).toBeTruthy());
  const next = screen.getByRole('button', { name: '下一张' });
  expect(next.closest('.hover-reveal-md')).not.toBeNull();
  expect(screen.getByRole('button', { name: '上一张' }).hasAttribute('disabled')).toBe(true);
  for (const expected of [older.imageUrl, 'index=0', 'index=1']) {
    fireEvent.keyDown(next, { key: ' ' }); fireEvent.click(next);
    expect(screen.getByRole('img').getAttribute('src')).toContain(expected);
  }
  expect(next.hasAttribute('disabled')).toBe(true); expect(screen.getByText('4 / 4')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: '上一张' }), { key: 'Enter' }); fireEvent.click(screen.getByRole('button', { name: '上一张' }));
  expect(screen.getByRole('img').getAttribute('src')).toContain('index=0');
  const button = screen.getByRole('button', { name: '重新生成样张' });
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button); expect(generate).toHaveBeenCalledOnce();
  view.rerender(draw(undefined, true)); fireEvent.click(screen.getByRole('button', { name: '重新生成样张' })); expect(generate).toHaveBeenCalledOnce();
  const newest = sample('newest'); view.rerender(draw([newest, old, older]));
  expect(screen.getByRole('img').getAttribute('src')).toBe(newest.imageUrl);
  visible(); await waitFor(() => expect(screen.getByText('1 / 5')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); expect(screen.getByRole('img').getAttribute('src')).toBe(old.imageUrl);
  expect(select).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});

it('按原图包物理页删除当前张，等待中防重入；成功接下一页，末页退回前页而不回首张', async () => {
  mocks.lookup.mockResolvedValue({ pack: 'v45', tag: 'display artist', revision: 'one', imageCount: 5, sourceUrl: '' });
  const persist = vi.fn(async (_removal: ArtistSampleRemoval) => {}), select = vi.fn(), key = vi.fn();
  const remove = vi.fn();
  const Fixture = () => {
    const [removed, setRemoved] = React.useState<ArtistSampleRemoval[]>([{ source: 'pack', pack: 'v45', tag: 'canonical_artist', revision: 'one', index: 0, imageCount: 5 }]);
    remove.mockImplementation(async (removal: ArtistSampleRemoval) => { await persist(removal); setRemoved(current => [...current, removal]); });
    return <div onClick={select} onKeyDown={key}><ArtistSampleCover {...actions} tag="display artist" pack="v45" packTag="canonical_artist" revision="one" hasPackSample ownSamples={[]} removedSamples={removed} alt="artist" onPackChange={vi.fn()} onSupplement={vi.fn()} onDelete={remove} notify={vi.fn()} /></div>;
  };
  render(<Fixture />); expect(screen.queryByRole('button', { name: '删除当前样张' })).toBeNull();
  visible(); await screen.findByRole('img');
  expect(screen.getByRole('img').getAttribute('src')).toContain('index=1'); expect(screen.getByText('1 / 4')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  const button = screen.getByRole('button', { name: '删除当前样张' });
  expect(button.textContent).toBe(''); expect(button.className).toContain('hover-reveal-md'); expect(button.className).toContain('h-11'); expect(button.className).toContain('md:h-8');
  expect(button.querySelector('.lucide-image')).not.toBeNull(); expect(button.querySelector('.lucide-trash-2')).not.toBeNull();
  expect(button.parentElement?.className).toContain('left-2'); expect(button.parentElement?.className).toContain('top-14'); expect(button.parentElement?.getAttribute('data-image-action-left')).toBe('true');
  let finish!: () => void; persist.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button); fireEvent.click(button);
  expect(remove).toHaveBeenCalledOnce(); expect(button.hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '下一张' }).hasAttribute('disabled')).toBe(true);
  expect(persist).toHaveBeenCalledWith({ source: 'pack', pack: 'v45', tag: 'canonical_artist', revision: 'one', index: 2, imageCount: 5 });
  await act(async () => finish());
  expect(screen.getByRole('img').getAttribute('src')).toContain('index=3'); expect(screen.getByText('2 / 3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); fireEvent.click(button);
  await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());
  expect(screen.getByRole('img').getAttribute('src')).toContain('index=3'); expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ index: 4 });
  expect(mocks.lookup).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled();
});

it('自建样张删除失败保留原页及标记，主动重试成功后就近接续而不重置到最新图', async () => {
  const samples = ['new', 'old', 'older'].map(id => ({ id, tag: 'artist', pack: 'v45' as const, imageUrl: `/api/assets/${id}.png`, prompt: id, negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' } as any, createdAt: 1 }));
  const persist = vi.fn(async (_removal: ArtistSampleRemoval) => {}).mockRejectedValueOnce(new Error('合成删除失败')), notify = vi.fn();
  const Fixture = () => {
    const [removed, setRemoved] = React.useState<ArtistSampleRemoval[]>([]);
    return <ArtistSampleCover {...actions} preferred blocked tag="artist" pack="v45" revision="one" hasPackSample={false} ownSamples={samples} removedSamples={removed} alt="artist" onPackChange={vi.fn()} onSupplement={vi.fn()} notify={notify} onDelete={async removal => { await persist(removal); setRemoved(current => [...current, removal]); }} />;
  };
  render(<Fixture />); fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  fireEvent.click(screen.getByRole('button', { name: '删除当前样张' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成删除失败', 'error'));
  expect(screen.getByRole('img').getAttribute('src')).toBe(samples[1].imageUrl); expect(screen.getByText('2 / 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消偏好画师：artist' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '取消屏蔽画师：artist' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '删除当前样张' }));
  await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());
  expect(screen.getByRole('img').getAttribute('src')).toBe(samples[2].imageUrl);
  expect(persist).toHaveBeenLastCalledWith({ source: 'own', pack: 'v45', tag: 'artist', id: 'old' });
  expect(mocks.lookup).not.toHaveBeenCalled();
});

it('图片读取失败仍能删除已知目标；无图、生成预览和保存失败预览均不误删隐藏旧图', async () => {
  const sample = { id: 'old', tag: 'artist', pack: 'v45' as const, imageUrl: '/api/assets/old.png', prompt: '', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' } as any, createdAt: 1 };
  const props = { ...actions, tag: 'artist', pack: 'v45' as const, revision: 'one', hasPackSample: false, ownSamples: [sample], alt: 'artist', onPackChange: vi.fn(), onSupplement: vi.fn(), onDelete: vi.fn(async () => {}), notify: vi.fn() };
  const view = render(<ArtistSampleCover {...props} />);
  expect(screen.getByRole('button', { name: '删除当前样张' })).toBeTruthy();
  fireEvent.error(screen.getByRole('img')); fireEvent.click(screen.getByRole('button', { name: '删除当前样张' }));
  await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith({ source: 'own', pack: 'v45', tag: 'artist', id: 'old' }));
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  for (const generation of [{ phase: 'generating', session: { preview: { image: 'data:image/png;base64,c3ludGhldGlj' } } }, { phase: 'save_failed', item: { imageUrl: '/api/assets/failed.png' } }, { phase: 'save_failed' }, { phase: 'saving' }]) {
    view.rerender(<ArtistSampleCover {...props} generation={generation as any} />);
    expect(screen.queryByRole('button', { name: '删除当前样张' })).toBeNull();
  }
  view.rerender(<ArtistSampleCover {...props} ownSamples={[]} />);
  expect(screen.queryByRole('button', { name: '删除当前样张' })).toBeNull(); expect(props.onDelete).toHaveBeenCalledOnce();
});

it.each([undefined, 'nai-diffusion-5-curated'])('V5 Full 不展示来源模型为%s的原图包，不创建删除目标', async model => {
  mocks.lookup.mockResolvedValue({ pack: 'v5', model, tag: 'artist', revision: 'one', imageCount: 3, sourceUrl: '' });
  const remove = vi.fn();
  render(<ArtistSampleCover {...actions} tag="artist" pack="v5" revision="one" hasPackSample ownSamples={[]} alt="artist" onPackChange={vi.fn()} onSupplement={vi.fn()} onDelete={remove} notify={vi.fn()} />);
  visible(); await screen.findByText('当前图包未确认为 V5 Full，原文件已保留');
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('button', { name: '删除当前样张' })).toBeNull(); expect(remove).not.toHaveBeenCalled();
});

it('V5 Full 只浏览 Full 与 Medium 自建图，旧 Curated 及其元数据保持原样', () => {
  const samples = ['nai-diffusion-5-curated', 'nai-diffusion-5-full', 'nai-diffusion-5-full-medium'].map((model, index) => ({ id: String(index), tag: 'artist', pack: 'v5' as const, imageUrl: `/api/assets/${index}.png`, prompt: model, negativePrompt: '', params: { model } as any, createdAt: 1 }));
  render(<ArtistSampleCover {...actions} tag="artist" pack="v5" revision="one" hasPackSample={false} ownSamples={samples} alt="artist" onPackChange={vi.fn()} onSupplement={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByRole('img').getAttribute('src')).toBe(samples[1].imageUrl); expect(screen.getByText('1 / 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); expect(screen.getByRole('img').getAttribute('src')).toBe(samples[2].imageUrl);
  expect(samples).toHaveLength(3); expect(samples[0].params.model).toBe('nai-diffusion-5-curated');
});
