// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCleanSharedImages } from '../../../services/imageSharing';
import { InspirationDetail } from '../../../components/inspiration/InspirationDetail';
import { DetailSidePanel } from '../../../components/DetailPanel';
import { Inspiration, User } from '../../../types';
import { db } from '../../../services/dbService';
import { readAgentPage } from '../../../services/agentWorkspace';
import { IMPORT_SESSION_KEY } from '../../../services/metadataService';
import { DEFAULT_PARAMS } from '../../../components/inspiration/InspirationShared';
import { setLanguage, t } from '../../../services/i18n';

vi.mock('../../../services/dbService', () => ({
  db: {
    updateInspiration: vi.fn(async () => undefined),
    markInspirationUsed: vi.fn(async () => undefined),
  },
}));

vi.mock('../../../components/SmartImage', () => ({
  OriginalImage: (props: any) => React.createElement('img', props),
  SmartImage: ({ eager: _eager, thumbnailVariant: _thumbnailVariant, ...props }: any) => React.createElement('img', props),
}));

vi.mock('../../../components/ParamsViewer', () => ({
  ParamsViewer: ({ params, section }: any) => React.createElement('div', { 'data-testid': section === 'params' ? 'params-viewer' : `params-${section}`, 'data-params': JSON.stringify(params) }, '参数视图'),
}));

vi.mock('../../../components/ImageTaggerPanel', () => ({
  ImageTaggerPanel: (props: any) => props.open ? React.createElement('div', { 'data-testid': 'image-tagger-panel', 'data-image-url': props.imageUrl, 'data-action-label': props.actionLabel }, '反推面板') : null,
}));

vi.mock('../../../components/MobileUI', () => ({
  useMobileHistoryLayer: () => vi.fn(),
}));

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  setLanguage('zh-CN');
  vi.clearAllMocks();
});

it('添加标签可复用其他作品的原名，回车后不重复生成标签，并保留已有标签', async () => {
  const items = [mockItem, { ...mockItem, id: 'other', tags: ['逆光', '雨天'] }];
  render(React.createElement(InspirationDetail, { item: mockItem, items, currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }));
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  const input = screen.getByPlaceholderText('输入标签回车保存...');
  expect(input.hasAttribute('list')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(within(screen.getByRole('dialog', { name: '选择已有标签' })).getByRole('button', { name: '#逆光' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.change(input, { target: { value: '逆光' } }); fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(db.updateInspiration).toHaveBeenCalledWith(mockItem.id, { tags: [...(mockItem.tags || []), '逆光'] }));
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(within(screen.getByRole('dialog', { name: '选择已有标签' })).queryByRole('button', { name: '#逆光' })).toBeNull();
});

it('收藏详情去除评分、置顶、相似推荐和资产菜单，保留已有资料', () => {
  render(React.createElement(InspirationDetail, { item: { ...mockItem, rating: 5, isPinned: true }, items: [mockItem], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn() }));
  expect(screen.queryByRole('group', { name: '评分' })).toBeNull();
  expect(screen.queryByRole('button', { name: '置顶收藏' })).toBeNull();
  expect(screen.queryByRole('button', { name: /提取资产/ })).toBeNull();
  expect(screen.queryByText('相似收藏')).toBeNull();
  expect(db.updateInspiration).not.toHaveBeenCalled();
});

it('提示词失焦保存原文，允许清空；空负面词仍能添加并在导入时使用当前内容', async () => {
  const item = { ...mockItem, negativePrompt: undefined };
  render(React.createElement(InspirationDetail, { item, items: [item], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }));
  const prompt = screen.getByLabelText('提示词');
  fireEvent.change(prompt, { target: { value: '  rain, [blue hair]  ' } });
  expect(db.updateInspiration).not.toHaveBeenCalled();
  fireEvent.blur(prompt);
  expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-1', { prompt: '  rain, [blue hair]  ' });
  const negative = screen.getByLabelText('负面提示词');
  fireEvent.change(negative, { target: { value: 'bad hands' } }); fireEvent.blur(negative);
  expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-1', { negativePrompt: 'bad hands' });
  fireEvent.change(prompt, { target: { value: '' } }); fireEvent.blur(prompt);
  expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-1', { prompt: '' });
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  await waitFor(() => expect(db.markInspirationUsed).toHaveBeenCalledWith('insp-1'));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: '', negativePrompt: 'bad hands', targetMode: 'text-to-image', sourceInspirationId: 'insp-1' });
});

it('提示词保存失败显示错误并保留草稿，重新失焦可重试', async () => {
  vi.mocked(db.updateInspiration).mockRejectedValueOnce(new Error('合成写入失败'));
  const notify = vi.fn(), onRefresh = vi.fn(async () => {});
  render(React.createElement(InspirationDetail, { item: mockItem, items: [mockItem], currentUser: mockUser, notify, onClose: vi.fn(), onRefresh }));
  const prompt = screen.getByLabelText('提示词') as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: 'manual edit' } }); fireEvent.blur(prompt);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成写入失败', 'error'));
  expect(prompt.value).toBe('manual edit'); expect(onRefresh).not.toHaveBeenCalled();
  fireEvent.blur(prompt);
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-1', { prompt: 'manual edit' });
});

it('修改后恢复原文字仍会保存，正负词遵循同一失焦规则', async () => {
  render(React.createElement(InspirationDetail, { item: mockItem, items: [mockItem], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }));
  const fields = [
    ['prompt', screen.getByLabelText('提示词'), mockItem.prompt],
    ['negativePrompt', screen.getByLabelText('负面提示词'), mockItem.negativePrompt!],
  ] as const;
  for (const [key, input, original] of fields) {
    fireEvent.change(input, { target: { value: 'temporary edit' } }); fireEvent.blur(input);
    await waitFor(() => expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-1', { [key]: 'temporary edit' }));
    fireEvent.change(input, { target: { value: original } }); fireEvent.blur(input);
    await waitFor(() => expect(db.updateInspiration).toHaveBeenLastCalledWith('insp-1', { [key]: original }));
  }
});

it('非所有者的评分禁用、提示词只读，失焦不写入', () => {
  render(React.createElement(InspirationDetail, { item: mockItem, items: [mockItem], currentUser: { ...mockUser, id: 'other-user' }, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn() }));
  for (const label of ['提示词', '负面提示词']) {
    const input = screen.getByLabelText(label) as HTMLTextAreaElement;
    expect(input.readOnly).toBe(true); fireEvent.blur(input);
  }
  expect(screen.queryByRole('group', { name: '评分' })).toBeNull();
  expect(db.updateInspiration).not.toHaveBeenCalled();
});

it('无参数的收藏显示未记录，导入时才使用默认参数；已有参数保持原样展示和导入', async () => {
  const props = { item: mockItem, items: [mockItem], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) };
  const view = render(React.createElement(InspirationDetail, props));
  expect(screen.queryByTestId('params-viewer')).toBeNull();
  expect(screen.getByText('未记录生成参数')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  await waitFor(() => expect(db.markInspirationUsed).toHaveBeenCalledOnce());
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!).params).toEqual(DEFAULT_PARAMS);
  const params = { ...DEFAULT_PARAMS, width: 1152, height: 768, seed: 54321, characters: [{ id: 'character', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 }] };
  const item = { ...mockItem, params };
  view.rerender(React.createElement(InspirationDetail, { ...props, item, items: [item] }));
  expect(screen.queryByText('未记录生成参数')).toBeNull();
  expect(JSON.parse(screen.getByTestId('params-viewer').dataset.params!)).toEqual(params);
  fireEvent.click(screen.getByRole('button', { name: '更多底图模式' }));
  fireEvent.click(screen.getByRole('button', { name: '底图：图生图' }));
  await waitFor(() => expect(db.markInspirationUsed).toHaveBeenCalledTimes(2));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ params, mode: 'image-edit', imageEditOperation: 'image-to-image', baseImageUrl: mockItem.imageUrl });
});

it.each(['zh-CN', 'zh-TW', 'en', 'ja', 'ko'] as const)('%s 的评分和未知参数跟随语言，创作原文保留', language => {
  setLanguage(language);
  render(React.createElement(InspirationDetail, { item: mockItem, items: [mockItem], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn() }));
  expect(screen.queryByRole('group', { name: t('评分') })).toBeNull();
  expect(screen.getByText(t('未记录生成参数'))).toBeTruthy();
  expect((screen.getByLabelText(t('提示词')) as HTMLTextAreaElement).value).toBe(mockItem.prompt);
});

const mockUser: User = {
  id: 'user-1',
  username: 'test-user',
  role: 'user',
  createdAt: 1,
};


const mockItem: Inspiration = {
  id: 'insp-1',
  userId: 'user-1',
  title: '海边少女',
  imageUrl: 'data:image/png;base64,mock',
  prompt: '1girl, beach, masterpiece',
  negativePrompt: 'low quality, blurry',
  notes: '适合夏日氛围图',
  tags: ['夏日', '少女'],
  boardId: '',
  rating: 3,
  isPinned: false,
  archived: false,
  sourceType: 'history',
  createdAt: 1700000000000,
};

describe('InspirationDetail 全新重构界面走查', () => {
  it('Agent 优先读取当前收藏详情身份，换作品更新、关闭后恢复列表', () => {
    const draw = (item?: Inspiration) => React.createElement('main', { 'data-agent-view': 'inspiration' },
      React.createElement('p', null, '收藏列表摘要 '.repeat(400)), item && React.createElement(DetailSidePanel, { open: true, title: item.title + ' · #' + item.id, onClose: vi.fn(), children: React.createElement(InspirationDetail, { item, items: [item], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }) }));
    const view = render(draw(mockItem));
    const first = readAgentPage(); expect(first).toMatchObject({ foreground: 'detail', view: 'inspiration' }); expect(first.title).toBe('收藏库 · 作品详情：海边少女 · #insp-1'); expect(first.text).not.toContain('收藏列表摘要');
    view.rerender(draw({ ...mockItem, id: 'insp-2', title: '合成夜景' }));
    const next = readAgentPage(); expect(next.title).toBe('收藏库 · 作品详情：合成夜景 · #insp-2'); expect(next.snapshotId).not.toBe(first.snapshotId);
    view.rerender(draw()); expect(readAgentPage().title).toBe('收藏库'); expect(readAgentPage().text).toContain('收藏列表摘要');
  });
  it('外部作品原站与反推标签分别可查和复制，分类标签保持原样', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
    const reverse = { prompt: 'blue hair', createdAt: 1, result: { model: 'test', tags: [], general: [], character: [], rating: null } };
    const item = { ...mockItem, sourceType: 'pixiv' as const, analysis: { externalSourceTags: ['原站标签'], externalSourcePage: 1, imageTagger: reverse } };
    render(React.createElement(InspirationDetail, { item, items: [item], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }));
    expect(screen.getByText('Pixiv 原站标签 · 1')).toBeTruthy();
    expect(screen.getByText('反推 Tag · 模型预测')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制原站标签', hidden: true }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('原站标签'));
    fireEvent.click(screen.getByRole('button', { name: '复制反推 Tag', hidden: true }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('blue hair'));
    expect(screen.getByText('#夏日')).toBeTruthy(); expect(screen.queryByText('#blue hair')).toBeNull();
  });
  it('默认浏览标题，铅笔提供改名入口，来源与收藏夹不再占据名称上方', () => {
    const notify = vi.fn();
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        currentUser: mockUser,
        notify,
        onClose: vi.fn(),
        onRefresh: vi.fn(),
      })
    );

    expect(screen.getByRole('heading', { name: '海边少女' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '收藏标题' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '修改收藏标题' }));
    expect(screen.getByLabelText('收藏标题')).toBe(document.activeElement);
    expect(screen.queryByTitle('切换所属收藏夹')).toBeNull();
    expect(document.querySelector('header')!.textContent).not.toContain('生成历史');
    expect(screen.queryByText('整理备注')).toBeNull();
    expect(screen.queryByDisplayValue(mockItem.notes!)).toBeNull();

    // 独立复制按钮
    const copyButtons = screen.getAllByRole('button', { name: '复制图片' });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);

    // 标签胶囊化展示
    expect(screen.getByText('#夏日')).toBeTruthy();
    expect(screen.getByText('#少女')).toBeTruthy();

    // 图片识别在标签区；底部保留导入和提取资产，分享位于图片右上。
    expect(screen.getByRole('button', { name: /识别图片 Tag/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /导入实验室/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /提取资产/ })).toBeNull();
    expect(screen.getByRole('button', { name: '下载图片' })).toBeTruthy();
    expect(screen.getByTitle('复制图片')).toBeTruthy();
  });

  it('开启清洗后保持两个分享按钮，图片右上竖排且脱离工作区隔离层', () => {
    setCleanSharedImages(true);
    render(React.createElement(InspirationDetail, {
      item: mockItem, items: [mockItem], currentUser: mockUser,
      notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}),
    }));
    expect(screen.getByRole('button', { name: '下载图片' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /原图|分享版/ })).toBeNull();
    expect(screen.getByTitle('复制图片').closest('article')).toBeTruthy();
    expect(document.querySelector('.ui-backdrop-enter')).toBeNull();
    const group = screen.getByTitle('复制图片').parentElement!;
    expect(group.className).toContain('absolute right-2 top-2');
    expect(group.classList.contains('flex-col')).toBe(true);
    expect(group.closest('footer')).toBeNull();
    const footer = document.querySelector('footer');
    expect(footer?.firstElementChild?.classList.contains('flex-wrap')).toBe(true);
  });

  it('作品名称行识别当前图片，结果追加到收藏标签', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
      })
    );

    const taggerBtn = screen.getByRole('button', { name: /识别图片 Tag/ });
    fireEvent.click(taggerBtn);
    const panel = screen.getByTestId('image-tagger-panel');
    expect(panel.dataset.imageUrl).toBe(mockItem.imageUrl);
    expect(panel.dataset.actionLabel).toBe('追加 {count} 个 Tag 到收藏标签');
    expect(taggerBtn.closest('footer')).toBeNull();
  });


  it('详情只读隐藏旧来源标签，自定义标签仍可移除', async () => {
  render(React.createElement(InspirationDetail, { item: { ...mockItem, sourceType: 'history', tags: ['生成历史', '自定义'] }, items: [mockItem], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn() }));
  expect(screen.queryByText('#生成历史')).toBeNull();
  expect(screen.queryByTitle('删除 #生成历史')).toBeNull();
  expect(db.updateInspiration).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('删除 #自定义'));
  await waitFor(() => expect(db.updateInspiration).toHaveBeenCalledWith(mockItem.id, { tags: [] }));
});

  it('底部工具条可展开底图模式，不再提供资产提取', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
      })
    );

    // 展开底图菜单
    const labMenuBtn = screen.getByRole('button', { name: '更多底图模式' });
    fireEvent.click(labMenuBtn);
    expect(screen.getByRole('button', { name: /底图：图生图/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /底图：局部重绘/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /底图：扩图/ })).toBeTruthy();

    expect(screen.queryByRole('button', { name: /提取资产/ })).toBeNull();
  });

  it('标题修改失焦后即时持久化保存', () => {
    render(
      React.createElement(InspirationDetail, {
        item: mockItem,
        items: [mockItem],
        currentUser: mockUser,
        notify: vi.fn(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole('button', { name: '修改收藏标题' }));
    const titleInput = screen.getByDisplayValue('海边少女');
    fireEvent.change(titleInput, { target: { value: '日落海滩少女' } });
    fireEvent.blur(titleInput);

    expect(db.updateInspiration).toHaveBeenCalledWith('insp-1', { title: '日落海滩少女' });
  });
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));


it('侧栏刷新保留当前未保存的输入，未编辑的生成参数仍随资料更新，换图重置草稿', async () => {
  const props = { item: mockItem, items: [mockItem], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) };
  const view = render(React.createElement(InspirationDetail, props));
  fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: '尚未失焦的草稿' } });
  const updated = { ...mockItem, params: { ...DEFAULT_PARAMS, seed: 12 } };
  view.rerender(React.createElement(InspirationDetail, { ...props, item: updated }));
  expect((screen.getByRole('textbox', { name: '提示词' }) as HTMLTextAreaElement).value).toBe('尚未失焦的草稿');
  expect(JSON.parse(screen.getByTestId('params-viewer').dataset.params!)).toMatchObject({ seed: 12 });
  fireEvent.blur(screen.getByRole('textbox', { name: '提示词' }));
  await waitFor(() => expect(db.updateInspiration).toHaveBeenLastCalledWith(mockItem.id, { prompt: '尚未失焦的草稿' }));
  view.rerender(React.createElement(InspirationDetail, { ...props, item: { ...mockItem, id: 'new-image', prompt: '另一张原词' } }));
  expect((screen.getByRole('textbox', { name: '提示词' }) as HTMLTextAreaElement).value).toBe('另一张原词');
});

it('标签始终在最前，其余已有模块实时跟随文生图顺序，切换排序不丢编辑草稿', () => {
  const item: Inspiration = { ...mockItem, params: {
    ...DEFAULT_PARAMS,
    characters: [{ id: 'character', prompt: 'blue hair', x: 0.5, y: 0.5 }],
    characterReferences: { enabled: true, slots: [{ assetId: 'ref', type: 'character', strength: 1, fidelity: 1 }] },
    vibes: { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'vibe', encodingId: 'encoding', informationExtracted: 1, strength: 1 }] },
  } };
  const props = { item, items: [item], currentUser: mockUser, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) };
  const view = render(React.createElement(InspirationDetail, props));
  const order = () => Array.from(view.container.querySelectorAll('[data-collection-section]'), element => element.getAttribute('data-collection-section'));
  expect(order()).toEqual(['tags', 'prompt', 'characters', 'params', 'negative', 'characterReference', 'vibe']);
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: '尚未保存' } });
  view.rerender(React.createElement(InspirationDetail, { ...props, labModuleOrder: ['vibe', 'negative', 'params', 'characterReference', 'characters', 'prompt'] }));
  expect(order()).toEqual(['tags', 'vibe', 'negative', 'params', 'characterReference', 'characters', 'prompt']);
  expect((screen.getByLabelText('提示词') as HTMLTextAreaElement).value).toBe('尚未保存');
  expect(db.updateInspiration).not.toHaveBeenCalled();
});

it('铅笔改名失焦保存，失败保留输入可重试，空名称和 Escape 不写入', async () => {
  const notify = vi.fn();
  render(React.createElement(InspirationDetail, { item: mockItem, items: [mockItem], currentUser: mockUser, notify, onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }));
  const edit = () => { fireEvent.click(screen.getByRole('button', { name: '修改收藏标题' })); return screen.getByLabelText('收藏标题') as HTMLInputElement; };
  let input = edit();
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(mockItem.title.length);
  fireEvent.change(input, { target: { value: '  ' } }); fireEvent.blur(input);
  expect(screen.getByRole('heading', { name: mockItem.title })).toBeTruthy();
  input = edit(); fireEvent.change(input, { target: { value: '取消的名称' } }); fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('heading', { name: mockItem.title })).toBeTruthy();
  expect(db.updateInspiration).not.toHaveBeenCalled();
  input = edit(); fireEvent.change(input, { target: { value: '  新名称  ' } });
  vi.mocked(db.updateInspiration).mockRejectedValueOnce(new Error('合成保存失败'));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败', 'error'));
  expect(input.value).toBe('新名称');
  fireEvent.focus(input); fireEvent.blur(input);
  await waitFor(() => expect(screen.queryByLabelText('收藏标题')).toBeNull());
  expect(db.updateInspiration).toHaveBeenLastCalledWith(mockItem.id, { title: '新名称' });
  expect(screen.getByRole('heading', { name: '新名称' })).toBeTruthy();
});

it('他人收藏不显示改名铅笔', () => {
  render(React.createElement(InspirationDetail, { item: mockItem, items: [mockItem], currentUser: { ...mockUser, id: 'other' }, notify: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(async () => {}) }));
  expect(screen.queryByRole('button', { name: '修改收藏标题' })).toBeNull();
  expect(screen.queryByLabelText('收藏标题')).toBeNull();
});
