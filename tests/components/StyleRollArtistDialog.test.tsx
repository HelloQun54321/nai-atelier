// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StyleRollArtistDialog } from '../../components/roll/StyleRollArtistDialog';
import { DEFAULT_ROLL_RULES } from '../../services/styleRoll';
import { installPointerEvents } from '../support/touchEvents';
import type { ArtistDictionaryEntry } from '../../services/tagDictionary';

const mocks = vi.hoisted(() => ({ block: vi.fn(), favorite: vi.fn(), urls: vi.fn(), usage: vi.fn(), refresh: undefined as undefined | (() => void), items: [] as any[] }));
vi.mock('../../services/artistUsage', async original => ({ ...await original<typeof import('../../services/artistUsage')>(), getArtistUsage: mocks.usage }));
vi.mock('../../services/localHistory', () => ({ localHistory: { subscribe: (listener: () => void) => { mocks.refresh = listener; return () => { mocks.refresh = undefined; }; } } }));
vi.mock('../../services/artistSampleUrls', () => ({ loadArtistSampleUrls: mocks.urls }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => mocks.items, subscribeCollection: () => () => {}, ensureCollection: async () => {}, toggleArtistPreference: mocks.favorite }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: any) => <img src={src} alt={alt} /> }));
beforeEach(() => { vi.clearAllMocks(); mocks.usage.mockResolvedValue({ byTag: new Map(), indexed: 0, total: 0 }); localStorage.clear(); mocks.items = []; mocks.urls.mockImplementation(async () => new Map([['alpha', '/api/assets/alpha.png']])); mocks.block.mockResolvedValue(undefined); mocks.favorite.mockResolvedValue(true); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const Fixture = ({ library = ['alpha', 'beta'].map(name => ({ name, chinese: '', postCount: 1 })) }: { library?: ArtistDictionaryEntry[] }) => {
  const [pinned, setPinned] = useState<string[]>([]), [blocked, setBlocked] = useState<string[]>([]), [sampledOnly, setSampledOnly] = useState(false), [rules, setRules] = useState(DEFAULT_ROLL_RULES);
  return <StyleRollArtistDialog library={library} pinned={pinned} onPinnedChange={setPinned} blocked={blocked} onBlockedChange={async tags => { await mocks.block(tags); setBlocked(tags); }} excluded={[]} onExcludedChange={() => {}} sampledOnly={sampledOnly} onSampledOnlyChange={setSampledOnly} rules={rules} onRulesChange={setRules} onClose={() => {}} />;
};

it('使用量升降序和收录生成交集包含零值，保留锁定与偏好并重置分页', async () => {
  const library = Array.from({ length: 65 }, (_, i) => ({ name: `artist${String(i).padStart(2, '0')}`, chinese: '', postCount: 100 - i }));
  mocks.items = [{ sourceType: 'artist', sourceId: 'artist00' }];
  mocks.usage.mockResolvedValue({ byTag: new Map([
    ['artist00', { chains: 2, images: 0, lastAt: 1 }], ['artist01', { chains: 1, images: 4, lastAt: 1 }],
    ['artist64', { chains: 3, images: 7, lastAt: 1 }],
  ]), indexed: 7, total: 7 });
  localStorage.setItem('nai_artist_sort', 'usage-images');
  render(<Fixture library={library} />);
  await waitFor(() => expect(screen.getByText('收录 3 串 · 生成 7 张')).toBeTruthy());
  const order = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')?.split('：')[1]);
  expect(order().slice(0, 2)).toEqual(['artist64', 'artist01']);
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：artist00' }));
  fireEvent.click(screen.getByRole('button', { name: '加载更多' })); expect(order()).toHaveLength(65);
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!; gallery.scrollTop = 500;
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-chains' } });
  expect(order().slice(0, 3)).toEqual(['artist64', 'artist00', 'artist01']); expect(order()).toHaveLength(60); expect(gallery.scrollTop).toBe(0);
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-chains-asc' } });
  expect(order()[0]).toBe('artist02');
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-images-asc' } });
  expect(order()[0]).toBe('artist00');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  fireEvent.change(screen.getByRole('combobox', { name: '图片生成' }), { target: { value: 'unused' } });
  expect(order()).toEqual(['artist00']);
  expect(screen.getByRole('button', { name: '锁定画师：artist00' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '取消偏好画师：artist00' })).toBeTruthy();
  expect(mocks.favorite).not.toHaveBeenCalled(); expect(mocks.block).not.toHaveBeenCalled();
});

it('统计未知显示横杠且禁用筛选，失败重试和历史刷新不阻止普通选择', async () => {
  let reject!: (error: Error) => void;
  mocks.usage.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
  render(<Fixture />); await screen.findByAltText('alpha');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByText('正在统计画师使用…')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getAllByText('收录 — 串 · 生成 — 张')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：beta' }));
  reject(new Error('unavailable')); await screen.findByText('画师使用统计暂不可用');
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'name-desc' } });
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '重试统计' }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(false));
  expect(screen.getAllByText('收录 0 串 · 生成 0 张')).toHaveLength(2);
  mocks.refresh?.(); await waitFor(() => expect(mocks.usage).toHaveBeenCalledTimes(3));
});

it('使用筛选有可见标题，刷新等待和失败时继续保留上次完整排序及筛选', async () => {
  mocks.usage.mockResolvedValueOnce({ byTag: new Map([['beta', { chains: 2, images: 3, lastAt: 1 }]]), indexed: 1, total: 1 });
  localStorage.setItem('nai_artist_sort', 'usage-images');
  render(<Fixture />); await screen.findByText('收录 2 串 · 生成 3 张');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByText('风格串收录').tagName).toBe('P');
  expect(screen.getByText('图片生成').tagName).toBe('P');
  const filter = screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement;
  fireEvent.change(filter, { target: { value: 'used' } });
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：beta' }));
  let reject!: (error: Error) => void;
  mocks.usage.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
  mocks.refresh?.(); await screen.findByText('正在统计画师使用…');
  expect(filter.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  reject(new Error('refresh failed')); await screen.findByText('画师使用统计暂不可用');
  expect(filter.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  const sort = screen.getByRole('combobox', { name: '画师排序' });
  expect(sort.parentElement?.classList.contains('max-w-[44vw]')).toBe(true);
  expect(sort.classList.contains('truncate')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  expect(screen.getByRole('button', { name: '锁定画师：alpha' })).toBeTruthy();
  expect(filter.value).toBe('all');
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
});

it.each([390, 1280])('宽度 %s：爱心下面切单卡版本，保留另一张图片、滚动、锁定及偏好，不刷新目录', async width => {
  vi.stubGlobal('innerWidth', width);
  mocks.urls.mockImplementation(async pack => new Map(pack === 'v45' ? [['alpha', '/v45-alpha.png'], ['beta', '/v45-beta.png']] : [['alpha', '/v5-alpha.png']]));
  mocks.items = [{ sourceType: 'artist', sourceId: 'alpha' }];
  render(<Fixture />); await screen.findByAltText('alpha');
  const alpha = screen.getByRole('button', { name: '锁定画师：alpha' }), beta = screen.getByRole('button', { name: '锁定画师：beta' });
  const betaImage = within(beta).getByRole('img');
  fireEvent.click(alpha); fireEvent.click(beta);
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!; gallery.scrollTop = 480;
  const version = within(alpha).getByRole('button', { name: '样张版本 V4.5，切换为 V5' });
  expect(within(alpha).getByRole('button', { name: '取消偏好画师：alpha' }).nextElementSibling).toBe(version);
  fireEvent.keyDown(version, { key: 'Enter' }); fireEvent.click(version);
  expect(within(alpha).getByRole('img').getAttribute('src')).toBe('/v5-alpha.png');
  expect(within(beta).getByRole('img')).toBe(betaImage); expect(betaImage.getAttribute('src')).toBe('/v45-beta.png');
  expect(gallery.scrollTop).toBe(480); expect(alpha.getAttribute('aria-pressed')).toBe('true');
  expect(within(alpha).getByRole('button', { name: '取消偏好画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(beta).getByRole('button', { name: /样张版本/ }));
  expect(within(beta).queryByRole('img')).toBeNull(); expect(within(beta).getByText('暂无样张')).toBeTruthy();
  expect(beta.getAttribute('aria-pressed')).toBe('true'); expect(screen.getByRole('button', { name: '锁定画师：alpha' })).toBe(alpha);
  expect(mocks.urls).toHaveBeenCalledTimes(2); expect(mocks.block).not.toHaveBeenCalled(); expect(mocks.favorite).not.toHaveBeenCalled();
});

it('Roll 打开时沿用画师库默认版本，单卡切换不改全局选择', async () => {
  localStorage.setItem('nai_artist_sample_pack', 'v5');
  mocks.urls.mockImplementation(async pack => new Map([['alpha', `/${pack}-alpha.png`]]));
  render(<Fixture />); await screen.findByAltText('alpha');
  const alpha = screen.getByRole('button', { name: '锁定画师：alpha' });
  expect(within(alpha).getByRole('img').getAttribute('src')).toBe('/v5-alpha.png');
  fireEvent.click(within(alpha).getByRole('button', { name: '样张版本 V5，切换为 V4.5' }));
  expect(within(alpha).getByRole('img').getAttribute('src')).toBe('/v45-alpha.png');
  expect(localStorage.getItem('nai_artist_sample_pack')).toBe('v5');
});

it('复用画师库四种排序，排序重置滚动且保留锁定、筛选和输入资料', async () => {
  const library = [{ name: 'alpha', chinese: '', postCount: 20 }, { name: 'beta', chinese: '', postCount: 10 }, { name: 'charlie', chinese: '', postCount: 30 }];
  const before = structuredClone(library); mocks.items = library.slice(0, 2).map(entry => ({ sourceType: 'artist', sourceId: entry.name }));
  render(<Fixture library={library} />); await screen.findByAltText('alpha');
  const order = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')?.split('：')[1]);
  expect(order()).toEqual(['charlie', 'alpha', 'beta']);
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!; gallery.scrollTop = 500;
  const select = screen.getByRole('combobox', { name: '画师排序' });
  fireEvent.change(select, { target: { value: 'least' } });
  expect(order()).toEqual(['beta', 'alpha', 'charlie']); expect(gallery.scrollTop).toBe(0);
  fireEvent.change(select, { target: { value: 'name-asc' } }); expect(order()).toEqual(['alpha', 'beta', 'charlie']);
  fireEvent.change(select, { target: { value: 'name-desc' } }); expect(order()).toEqual(['charlie', 'beta', 'alpha']);
  fireEvent.click(screen.getByRole('button', { name: '偏好画师' })); expect(order()).toEqual(['beta', 'alpha']);
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  expect(library).toEqual(before); expect(localStorage.getItem('nai_roll_artist_sort')).toBe('name-desc');
  expect(mocks.favorite).not.toHaveBeenCalled(); expect(mocks.block).not.toHaveBeenCalled();
});

it('样张与缺图空封面同时可见，点击封面只锁定 Tag', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  expect(screen.getByText('暂无样张')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：beta' }));
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '只从有样张的画师中抽取' }));
  expect(screen.getByText('暂无样张')).toBeTruthy();
  expect(mocks.block).not.toHaveBeenCalled(); expect(mocks.favorite).not.toHaveBeenCalled();
});

it('屏蔽成功后卡片留在列表，移除锁定；失败保留原状态', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  fireEvent.click(screen.getByRole('button', { name: '屏蔽画师：alpha' }));
  await screen.findByRole('button', { name: '取消屏蔽画师：alpha' });
  expect(screen.getByAltText('alpha')).toBeTruthy();
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('false');
  mocks.block.mockRejectedValueOnce(new Error('保存屏蔽失败'));
  fireEvent.click(screen.getByRole('button', { name: '取消屏蔽画师：alpha' }));
  await screen.findByText('保存屏蔽失败');
  expect(screen.getByRole('button', { name: '取消屏蔽画师：alpha' })).toBeTruthy();
});

it('两个角分别是屏蔽和偏好，缺图也可收藏，用户可改倍率和保底', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  const favorite = screen.getByRole('button', { name: '偏好画师：beta' });
  expect(favorite.parentElement?.className).toContain('right-2');
  expect(screen.getByRole('button', { name: '屏蔽画师：beta' }).className).toContain('left-2');
  fireEvent.click(favorite); await waitFor(() => expect(mocks.favorite).toHaveBeenCalledWith('beta', ''));
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '抽取设置' }));
  fireEvent.change(screen.getByLabelText('偏好抽中倍率'), { target: { value: '4.5' } });
  fireEvent.change(screen.getByLabelText('每串偏好保底人数'), { target: { value: '2' } });
  expect(screen.getByLabelText('偏好抽中倍率')).toHaveProperty('value', '4.5');
  expect(screen.getByLabelText('每串偏好保底人数')).toHaveProperty('value', '2');
});

it('收藏库已有的画师会直接显示偏好，并可按偏好筛选', async () => {
  mocks.items = [{ sourceType: 'artist', sourceId: 'beta', archived: false }];
  render(<Fixture />); await screen.findByAltText('alpha');
  expect(screen.getByRole('button', { name: '取消偏好画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '偏好画师' }));
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  expect(screen.getByRole('button', { name: '锁定画师：beta' })).toBeTruthy();
});

it.each([390, 1280])('宽度 %s：参数以独立小卡片弹出，关闭保留输入、选择及原图片节点', async width => {
  vi.stubGlobal('innerWidth', width);
  render(<Fixture />); const image = await screen.findByAltText('alpha');
  expect(screen.queryByRole('spinbutton', { name: '偏好抽中倍率' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Roll 画师' }).querySelector('aside')).toBeNull();
  expect(screen.queryByText('1 倍不加权，0 位不保底；已锁定的偏好计入保底，不足时停止。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  const settings = screen.getByRole('button', { name: '抽取设置' });
  fireEvent.click(settings);
  const panel = screen.getByRole('dialog', { name: '抽取设置' });
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!;
  expect(panel.classList.contains('appearance-popover')).toBe(true);
  expect(panel.style.width).toBe('320px');
  expect(panel.style.position || panel.className).toContain('fixed');
  expect(screen.getByRole('dialog', { name: 'Roll 画师' }).contains(panel)).toBe(false);
  expect(gallery.contains(panel)).toBe(false);
  fireEvent.change(screen.getByRole('spinbutton', { name: '偏好抽中倍率' }), { target: { value: '2.5' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('spinbutton', { name: '偏好抽中倍率' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Roll 画师' })).toBeTruthy();
  expect(screen.getByAltText('alpha')).toBe(image);
  fireEvent.click(settings);
  expect(screen.getByRole('spinbutton', { name: '偏好抽中倍率' })).toHaveProperty('value', '2.5');
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' }); gallery.scrollTop = 600;
  fireEvent.click(screen.getByRole('button', { name: '已锁定' }));
  expect(gallery.scrollTop).toBe(0);
  expect(screen.queryByRole('button', { name: '锁定画师：beta' })).toBeNull();
});

it('卡片复用角色卡图文结构和图库动效，点击名字与键盘选择保持一致', async () => {
  installPointerEvents(); render(<Fixture />); const image = await screen.findByAltText('alpha');
  const card = image.closest('article')!;
  expect(card.classList.contains('gallery-image-card')).toBe(true);
  expect(card.classList.contains('press-reveal-surface')).toBe(true);
  expect(image.closest('.mobile-gallery-frame')).toBeTruthy();
  expect(card.classList.contains('gallery-card-visual')).toBe(true);
  expect(card.querySelector(':scope > .gallery-card-caption > p')?.textContent).toBe('alpha');
  expect(card.querySelector(':scope > .mobile-gallery-frame')).toBeTruthy();
  fireEvent.pointerEnter(card, { pointerType: 'mouse' });
  expect(card.getAttribute('data-press-input')).toBe('mouse');
  fireEvent.pointerEnter(card, { pointerType: 'touch' });
  expect(card.getAttribute('data-press-input')).toBe('touch');
  fireEvent.click(within(card).getByText('alpha', { exact: true }));
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(card, { key: 'Enter' });
  expect(card.getAttribute('aria-pressed')).toBe('false');
});
