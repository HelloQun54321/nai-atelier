// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../../types';
import { ChainSimilarityDialog, type ChainSimilaritySession } from '../../../components/chain/ChainSimilarityDialog';
import { setLanguage } from '../../../services/i18n';
import { installPointerEvents } from '../../support/touchEvents';

const mocks = vi.hoisted(() => ({ dictionary: vi.fn() }));
vi.mock('../../../services/artistSamples', () => ({ getArtistSampleDictionary: mocks.dictionary }));
vi.mock('../../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt, thumbnailVariant }: { src: string; alt: string; thumbnailVariant: string }) => <img src={src} alt={alt} data-thumbnail={thumbnailVariant} /> }));
vi.mock('../../../components/ImageLightbox', () => ({ ImageLightbox: ({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) =>
  <div role="dialog" aria-label="合成原图预览"><img src={src} alt={alt} /><button onClick={onClose}>返回对比</button></div> }));
const chain = (id: string, prompt: string): PromptChain => ({
  id, name: id, userId: 'synthetic', type: 'style', description: '', tags: [], basePrompt: prompt,
  negativePrompt: '', modules: [], params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' },
  previewImage: '/synthetic/' + id + '.png', createdAt: 1, updatedAt: 1,
});
const data = () => [chain('原串 A', '1.2::artist:alpha_artist::, 1girl, forest'), chain('原串 B', '1.2::artist:alpha_artist::, 1boy, forest'), chain('原串 C', '1.0::artist:alpha_artist::, cat')];
const props = (chains = data()) => ({ chains, filteredChains: chains.slice(0, 1), onClose: vi.fn(), onOpenChain: vi.fn(), onDelete: vi.fn(async (_chain: PromptChain) => true) });
const card = (name: string) => screen.getByRole('region', { name });
const promptText = (name: string) => within(card(name)).getByRole('heading', { name: '全局正向提示词' }).parentElement!.querySelector('p')!;
const expandDetails = (name: string) => {
  const details = card(name).querySelector('details')!;
  fireEvent.click(within(card(name)).getByText('其余提示词与配置'));
  return details;
};

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLanguage('zh-CN');
  mocks.dictionary.mockResolvedValue([{ name: 'alpha_artist' }]);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('合成比较不得调用模型或真实写接口'); }));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('同组多串保留完整正词且只高亮全组交集，其余配置默认收起，原对象保留', async () => {
  const viewProps = props(), original = structuredClone(viewProps.chains);
  viewProps.chains[0].negativePrompt = 'bad hands'; original[0].negativePrompt = 'bad hands';
  const view = render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const dialog = screen.getByRole('dialog', { name: '查找相似' });
  expect(view.container.contains(dialog)).toBe(false);
  expect(screen.queryByRole('combobox')).toBeNull();
  for (const item of viewProps.chains) {
    expect(screen.getByRole('button', { name: '打开原串：' + item.name })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除：' + item.name })).toBeTruthy();
    expect(card(item.name).querySelector('details')?.open).toBe(false);
    expect(within(card(item.name)).queryByRole('heading', { name: '完整提示词' })).toBeNull();
  }
  for (const item of viewProps.chains) {
    expect(promptText(item.name).textContent).toBe(item.basePrompt);
    expect([...promptText(item.name).querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['artist:alpha_artist']);
  }
  const details = expandDetails('原串 A');
  await waitFor(() => expect(details.open).toBe(true));
  expect(within(details).getByText(viewProps.chains[0].basePrompt).tagName).toBe('PRE');
  expect(within(details).getByText('bad hands')).toBeTruthy();
  expect(within(details).getByRole('heading', { name: '生成参数' })).toBeTruthy();
  expect(dialog.querySelector('img')?.closest('[data-safe-mode-work]')).toBeTruthy();
  expect(viewProps.chains).toEqual(original); expect(fetch).not.toHaveBeenCalled(); expect(viewProps.onDelete).not.toHaveBeenCalled();
});

it('只在两条出现的词不属于三条交集，保留普通正文、不同权重与 HTML 原文', async () => {
  const chains = [chain('a', '1.2::artist:alpha_artist::, red hair, hair, forest, forest, <script>alert(1)</script>'),
    chain('b', '1.0::artist:alpha_artist::, blue hair, forest, <script>alert(1)</script>'), chain('c', 'artist:alpha_artist, hair, city')];
  render(<ChainSimilarityDialog {...props(chains)} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const text = promptText('a');
  const marks = [...text.querySelectorAll('mark')].map(mark => mark.textContent);
  expect(marks).toEqual(['artist:alpha_artist']);
  expect(text.textContent).toContain('red hair, hair, forest, forest');
  expect(text.textContent).toContain('1.2::artist:alpha_artist::');
  expect(text.querySelector('mark')?.className).toContain('text-indigo-700');
  expect(text.querySelector('mark')?.className).toContain('dark:text-indigo-300');
  expect(text.textContent).toContain('<script>alert(1)</script>'); expect(text.querySelector('script')).toBeNull();
});

it('范围切换丢弃迟到扫描；少于两条时不虚报重复', async () => {
  let finish!: (value: { name: string }[]) => void;
  mocks.dictionary.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const viewProps = props(); render(<ChainSimilarityDialog {...viewProps} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '仅当前筛选结果' }));
  await screen.findByText('已扫描 1 条 · 0 组相似 · 涉及 0 条 · 线索不足 0 条');
  await act(async () => finish([{ name: 'alpha_artist' }]));
  expect(screen.getByText('已扫描 1 条 · 0 组相似 · 涉及 0 条 · 线索不足 0 条')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '仅当前筛选结果' }));
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  expect(viewProps.onClose).not.toHaveBeenCalled();
});

it('全组等效括号和数字权重一起强调，未知语法及多余次数不冒充交集', async () => {
  const chains = [chain('a', '{artist:alpha_artist}, 1.2::forest, forest::, (city:1.2)'),
    chain('b', '1.05::artist:alpha_artist::, 1.2::forest::, (city:1.2)'),
    chain('c', '1.0500::artist:alpha_artist::, forest, forest, (city:1.2)')];
  render(<ChainSimilarityDialog {...props(chains)} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const a = [...promptText('a').querySelectorAll('mark')].map(mark => mark.textContent);
  const b = [...promptText('b').querySelectorAll('mark')].map(mark => mark.textContent);
  expect(a).toContain('{artist:alpha_artist}');
  expect(b).toContain('1.05::artist:alpha_artist::');
  expect(a.filter(value => value === '1.2::forest::')).toHaveLength(0);
  expect(a.filter(value => value === 'forest')).toHaveLength(1);
  expect(a).toContain('city'); expect(a).not.toContain('(city:1.2)');
  expect(promptText('c').querySelector('mark')?.textContent).toBe('1.0500::artist:alpha_artist::');
});

it.each([
  { prompts: ['1::forest::, 2::forest::', '2::forest::', '2::forest::'], marks: ['2::forest::'] },
  { prompts: ['2::forest, forest, forest::', '2::forest, forest::', '2::forest::'], marks: ['2::forest::'] },
  { prompts: ['1::forest::, 2::forest::', '2::forest::, 3::forest::', '2::forest::, 4::forest::'], marks: ['2::forest::', 'forest'] },
])('全组次数取最少且先配共同权重：$prompts', async ({ prompts, marks }) => {
  const chains = prompts.map((prompt, index) => chain(String(index), 'artist:alpha_artist, ' + prompt));
  render(<ChainSimilarityDialog {...props(chains)} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  for (const item of chains) {
    const text = promptText(item.name);
    const highlighted = [...text.querySelectorAll('mark')].map(mark => mark.textContent).filter(value => value?.includes('forest'));
    expect(highlighted.sort()).toEqual([...marks].sort());
    expect(text.textContent?.match(/forest/g)).toHaveLength(item.basePrompt.match(/forest/g)!.length);
  }
});

it('官方重置权重正确识别；无法确定的导入权重列在线索不足并可打开核对', async () => {
  const viewProps = props([chain('a', '{{artist:alpha_artist::'), chain('b', '1.1025::artist:alpha_artist::'), chain('c', '(artist:alpha_artist:1.2)')]);
  render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 2 条 · 线索不足 1 条');
  const a = expandDetails('a');
  await waitFor(() => expect(a.open).toBe(true));
  expect(within(a).queryByText('权重语义待核对')).toBeNull();
  expect(screen.queryByRole('region', { name: 'c' })).toBeNull();
  fireEvent.click(screen.getByText('线索不足 1 条'));
  fireEvent.click(screen.getByRole('button', { name: 'c 权重语义待核对' }));
  expect(viewProps.onOpenChain).toHaveBeenCalledWith('c');
});

it('同名词权重大幅颠倒不会被界面继续列为相似', async () => {
  render(<ChainSimilarityDialog {...props([chain('a', '2::artist:a::, 0.5::artist:b::'), chain('b', '0.5::artist:a::, 2::artist:b::')])} />);
  await screen.findByText('已扫描 2 条 · 0 组相似 · 涉及 0 条 · 线索不足 0 条');
  expect(screen.queryByRole('region', { name: 'a' })).toBeNull();
  expect(screen.getByText('未找到具有足够共同画风线索的风格串')).toBeTruthy();
});

it('组标题显示最低相似度并降序排列，删除后按剩余成员更新分值及顺序', async () => {
  const viewProps = props([...data(), chain('中分 A', 'artist:beta'), chain('中分 B', '0.9::artist:beta::'),
    chain('高分 A', 'artist:gamma'), chain('高分 B', 'artist:gamma')]);
  render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 7 条 · 3 组相似 · 涉及 7 条 · 线索不足 0 条');
  const headers = () => [...screen.getByRole('dialog', { name: '查找相似' }).querySelectorAll('article > button')].map(button => button.textContent);
  expect(headers()).toEqual(['高分 A2 条相似相似度 100%', '中分 A2 条相似相似度 90%', '原串 A3 条相似相似度 83.3%']);
  expect(card('高分 A')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '原串 A 3 条相似 相似度 83.3%' }));
  expect(screen.getAllByTitle('组内最低相似度')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '删除：原串 C' }));
  await screen.findByText('已扫描 6 条 · 3 组相似 · 涉及 6 条 · 线索不足 0 条');
  expect(headers()).toEqual(['高分 A2 条相似相似度 100%', '原串 A2 条相似相似度 100%', '中分 A2 条相似相似度 90%']);
  expect(card('原串 A')).toBeTruthy();
  expect(screen.getByRole('button', { name: '原串 A 2 条相似 相似度 100%' }).getAttribute('aria-expanded')).toBe('true');
});

it('完整正词默认限四行，按实际溢出展开收起，交集和普通文字均保留', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'P' ? 180 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('line-clamp-4') ? 72 : 180; });
  render(<ChainSimilarityDialog {...props()} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const element = promptText('原串 A'), text = element.textContent;
  expect(element.classList.contains('line-clamp-4')).toBe(true);
  const button = within(card('原串 A')).getByRole('button', { name: '展开提示词（3 项）' });
  fireEvent.click(button);
  expect(element.classList.contains('line-clamp-4')).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(element.textContent).toBe(text);
  expect(promptText('原串 B').classList.contains('line-clamp-4')).toBe(true);
  fireEvent.click(within(card('原串 A')).getByRole('button', { name: '收起提示词' }));
  expect(element.classList.contains('line-clamp-4')).toBe(true);
  expect(element.textContent).toBe(text);
});

it('删除取消、重复点击和失败不移除条目，成功后更新重复词及最后一组', async () => {
  const viewProps = props();
  let finish!: (success: boolean) => void;
  viewProps.onDelete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const button = screen.getByRole('button', { name: '删除：原串 B' });
  fireEvent.click(button); fireEvent.click(button);
  expect(viewProps.onDelete).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: '删除：原串 A' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(false));
  expect(card('原串 B')).toBeTruthy();
  viewProps.onDelete.mockRejectedValueOnce(new Error('合成删除失败'));
  fireEvent.click(button); await screen.findByText('合成删除失败');
  expect(card('原串 B')).toBeTruthy();
  fireEvent.click(button);
  await screen.findByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
  expect(screen.queryByRole('region', { name: '原串 B' })).toBeNull();
  expect(promptText('原串 A').textContent).toContain('forest');
  expect([...promptText('原串 A').querySelectorAll('mark')].some(mark => mark.textContent === 'forest')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '删除：原串 A' }));
  await screen.findByText('已扫描 1 条 · 0 组相似 · 涉及 0 条 · 线索不足 0 条');
  expect(screen.getByText('未找到具有足够共同画风线索的风格串')).toBeTruthy();
  expect(viewProps.onOpenChain).not.toHaveBeenCalled();
});

it('删除共享成员会同步移除全部重叠组，扫描总数只扣一次', async () => {
  const chains = [chain('a', 'artist:a, artist:b, artist:c'), chain('b', 'artist:a, artist:b, artist:c, artist:d'), chain('c', 'artist:a, artist:b, artist:d')];
  render(<ChainSimilarityDialog {...props(chains)} />);
  await screen.findByText('已扫描 3 条 · 2 组相似 · 涉及 3 条 · 线索不足 0 条');
  fireEvent.click(screen.getByRole('button', { name: '删除：b' }));
  await screen.findByText('已扫描 2 条 · 0 组相似 · 涉及 0 条 · 线索不足 0 条');
});

it('成功移除不含共同词的成员后，剩余全组重新计算词及权重交集', async () => {
  render(<ChainSimilarityDialog {...props()} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  expect([...promptText('原串 A').querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['artist:alpha_artist']);
  fireEvent.click(screen.getByRole('button', { name: '删除：原串 C' }));
  await screen.findByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
  for (const name of ['原串 A', '原串 B']) {
    expect([...promptText(name).querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['1.2::artist:alpha_artist::', 'forest']);
  }
});

it('父列表先刷新、删除回执后返回，不重复扣数也不关闭新结果的展开组', async () => {
  const viewProps = props(); let finish!: (success: boolean) => void;
  viewProps.onDelete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  fireEvent.click(screen.getByRole('button', { name: '删除：原串 A' }));
  const next = [viewProps.chains[1], viewProps.chains[2], chain('新串', 'artist:alpha_artist')];
  view.rerender(<ChainSimilarityDialog {...viewProps} chains={next} />);
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('false'));
  await act(async () => finish(true));
  expect(screen.getByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条')).toBeTruthy();
  expect(card('新串')).toBeTruthy(); expect(card('原串 B')).toBeTruthy();
});

it('重新打开保留范围、展开详情及滚动，无资料变化时复用扫描', async () => {
  const sessionRef = { current: null as ChainSimilaritySession | null };
  const viewProps = props(); viewProps.filteredChains = viewProps.chains.slice(0, 2);
  let view = render(<ChainSimilarityDialog {...viewProps} sessionRef={sessionRef} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  fireEvent.click(screen.getByRole('checkbox', { name: '仅当前筛选结果' }));
  await screen.findByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
  const details = expandDetails('原串 B'); await waitFor(() => expect(sessionRef.current?.detailsOpen['原串 B']).toBe(true));
  expect(details.open).toBe(true);
  const groupButton = screen.getByRole('button', { name: '原串 A 2 条相似 相似度 100%' });
  fireEvent.click(groupButton); fireEvent.click(groupButton);
  expect(card('原串 B').querySelector('details')?.open).toBe(true);
  const scroll = screen.getByRole('dialog').querySelector('.overflow-y-auto')!;
  fireEvent.scroll(scroll, { target: { scrollTop: 240 } });
  view.unmount();
  view = render(<ChainSimilarityDialog {...viewProps} sessionRef={sessionRef} />);
  expect(screen.getByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条')).toBeTruthy();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(card('原串 B').querySelector('details')?.open).toBe(true);
  expect(screen.getByRole('dialog').querySelector('.overflow-y-auto')?.scrollTop).toBe(240);
  expect(mocks.dictionary).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('同一个基准参与多个组时键值独立，可分别展开所有关联候选', async () => {
  const chains = [chain('a', 'artist:a, artist:b, artist:c, artist:d'), chain('b', 'artist:a, artist:b, artist:c'), chain('c', 'artist:a, artist:b, artist:d')];
  render(<ChainSimilarityDialog {...props(chains)} />);
  await screen.findByText('已扫描 3 条 · 2 组相似 · 涉及 3 条 · 线索不足 0 条');
  const buttons = screen.getAllByRole('button', { name: 'a 2 条相似 相似度 75%' });
  expect(buttons[0].getAttribute('aria-controls')).not.toBe(buttons[1].getAttribute('aria-controls'));
  fireEvent.click(buttons[1]); expect(card('c')).toBeTruthy(); expect(screen.queryByRole('region', { name: 'b' })).toBeNull();
  fireEvent.click(buttons[0]); expect(card('b')).toBeTruthy();
});

it('词库失败仍比较显式画师，线索不足可打开；语言切换保持多列与折叠状态', async () => {
  mocks.dictionary.mockRejectedValue(new Error('合成词库失败'));
  const viewProps = props([chain('a', 'artist:alpha_artist'), chain('b', 'artist:alpha_artist'), chain('裸名字', 'alpha_artist')]);
  render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 2 条 · 线索不足 1 条');
  expect(screen.getByRole('alert').textContent).toContain('裸画师名可能漏识别');
  expandDetails('b');
  await waitFor(() => expect(card('b').querySelector('details')?.open).toBe(true));
  act(() => setLanguage('en'));
  expect(screen.getAllByRole('heading', { name: 'Global positive prompt' })).toHaveLength(2);
  expect(card('b').querySelector('details')?.open).toBe(true);
  act(() => setLanguage('zh-CN'));
  fireEvent.click(screen.getByText('线索不足 1 条')); fireEvent.click(screen.getByRole('button', { name: '裸名字' }));
  expect(viewProps.onOpenChain).toHaveBeenCalledWith('裸名字');
});

it('关闭和 Esc 归还入口焦点；关闭中的迟到扫描不触发打开原串', async () => {
  const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
  const viewProps = props(), view = render(<ChainSimilarityDialog {...viewProps} />);
  const dialog = await screen.findByRole('dialog');
  const consumedEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  consumedEscape.preventDefault(); fireEvent(window, consumedEscape);
  expect(viewProps.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' }); expect(viewProps.onClose).toHaveBeenCalledOnce();
  fireEvent.pointerDown(dialog.parentElement!); expect(viewProps.onClose).toHaveBeenCalledTimes(2);
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
  await act(async () => {}); expect(viewProps.onOpenChain).not.toHaveBeenCalled();
});

it('手机长按显露单项删除，普通点击不删除；打开原串先退出弹层历史', async () => {
  installPointerEvents();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const viewProps = props(); render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const image = within(card('原串 B')).getByRole('img'); const surface = image.closest('.press-reveal-surface')!;
  expect(viewProps.onDelete).not.toHaveBeenCalled();
  vi.useFakeTimers();
  fireEvent.pointerDown(image, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(450));
  expect(surface.getAttribute('data-press-revealed')).toBe('true');
  fireEvent.pointerUp(image); vi.useRealTimers();
  expect(window.history.state.__naiMobileLayer).toContain('chain-similarity-');
  fireEvent.click(screen.getByRole('button', { name: '打开原串：原串 B' }));
  await waitFor(() => expect(viewProps.onOpenChain).toHaveBeenCalledWith('原串 B'));
  expect(viewProps.onClose).toHaveBeenCalledOnce();
  expect(window.history.state?.__naiMobileLayer).toBeUndefined();
  expect(viewProps.onClose.mock.invocationCallOrder[0]).toBeLessThan(viewProps.onOpenChain.mock.invocationCallOrder[0]);
});

it('大图卡使用清晰预览且不裁切，点击打开原图，返回保留当前对比', async () => {
  const viewProps = props(); render(<ChainSimilarityDialog {...viewProps} />);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  const image = within(card('原串 B')).getByRole('img');
  expect(image.getAttribute('data-thumbnail')).toBe('thumb-960');
  expect(image.closest('.press-reveal-surface')?.className).toContain('h-80');
  expect(image.closest('.press-reveal-surface')?.className).toContain('2xl:h-[28rem]');
  expect(card('原串 B').parentElement?.className).toContain('lg:grid-cols-3');
  fireEvent.click(screen.getByRole('button', { name: '放大查看：原串 B' }));
  expect(within(screen.getByRole('dialog', { name: '合成原图预览' })).getByRole('img').getAttribute('src')).toBe(viewProps.chains[1].previewImage);
  fireEvent.click(screen.getByRole('button', { name: '返回对比' }));
  expect(screen.queryByRole('dialog', { name: '合成原图预览' })).toBeNull();
  expect(card('原串 B')).toBeTruthy(); expect(viewProps.onClose).not.toHaveBeenCalled(); expect(viewProps.onDelete).not.toHaveBeenCalled();
});
