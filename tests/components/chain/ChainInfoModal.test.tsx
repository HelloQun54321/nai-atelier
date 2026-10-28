// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../../types';
import { ChainInfoModal } from '../../../components/chain/ChainInfoModal';
import { resetTagDictionaryCache } from '../../../services/tagDictionary';
import { api } from '../../../services/api';
import { isTopmostModal } from '../../../components/useModalA11y';

const confirmAction = vi.hoisted(() => vi.fn(async () => true));
const tagDictionary = vi.hoisted(() => ({ search: vi.fn(), translations: vi.fn(), catalog: vi.fn(), preload: vi.fn() }));
const history = vi.hoisted(() => ({ getPage: vi.fn(), subscribe: vi.fn() }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../../services/localHistory', () => ({ localHistory: { getPage: history.getPage, subscribe: history.subscribe } }));
vi.mock('../../../components/SmartImage', async importOriginal => ({
  ...await importOriginal<typeof import('../../../components/SmartImage')>(),
  SmartImage: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} />,
}));
vi.mock('../../../services/tagDictionary', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/tagDictionary')>(),
  searchTagDictionary: tagDictionary.search,
  lookupTagTranslations: tagDictionary.translations,
  lookupTagCatalogEntries: tagDictionary.catalog,
  preloadTagDictionary: tagDictionary.preload,
}));

const chain: PromptChain = {
  id: 'synthetic', userId: 'test', type: 'style', name: '原名称', description: '原描述', tags: ['待实测'],
  basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', modules: [], previewImage: '/synthetic.png',
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 4 }, createdAt: 1, updatedAt: 1,
};
const callbacks = () => ({ onSave: vi.fn(), onClose: vi.fn(), notify: vi.fn() });
const objectUrls = { create: vi.fn((_file: Blob) => 'blob:synthetic-cover'), revoke: vi.fn((_url: string) => {}) };
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
beforeEach(() => {
  tagDictionary.search.mockReset().mockImplementation(async (query: string) => query.toLowerCase().startsWith('ma')
    ? [{ name: 'masterpiece', chinese: '杰作', category: 0, categoryLabel: '一般', postCount: 1000000, isNovelAI: false }]
    : query.toLowerCase().startsWith('red')
      ? [{ name: 'red coat', chinese: '红外套', category: 0, categoryLabel: '一般', postCount: 10, isNovelAI: false }]
      : []);
  tagDictionary.translations.mockImplementation(async (tags: string[]) => new Map(tags.map(tag => {
    const normalized = tag.toLowerCase();
    return [normalized, { name: normalized, chinese: normalized === 'masterpiece' ? '杰作' : '红外套', category: 0, categoryLabel: '一般', postCount: 10, isNovelAI: false }];
  })));
  tagDictionary.catalog.mockResolvedValue(new Map()); tagDictionary.preload.mockReturnValue(undefined);
  history.getPage.mockReset().mockResolvedValue({ items: [{ id: 'synthetic-history', imageUrl: 'data:image/webp;base64,c3ludGhldGlj', createdAt: 1, prompt: 'history prompt', params: { width: 640, height: 960 } }], count: 1, hasMore: false });
  history.subscribe.mockReset().mockReturnValue(() => {});
  objectUrls.create.mockReset().mockReturnValue('blob:synthetic-cover'); objectUrls.revoke.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: objectUrls.create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: objectUrls.revoke });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetTagDictionaryCache(); confirmAction.mockReset().mockResolvedValue(true);
  if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL); else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL); else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('卡片信息编辑', () => {
  it('显示分享声明和来源链接，普通资料保存不改写来源，也不执行非网页链接', async () => {
    const p = callbacks();
    const sources = [
      { author: '合成作者', sourceUrl: 'https://example.org/free-style', note: '免费分享，请勿购买' },
      { author: '整理者', sourceUrl: 'javascript:alert(1)', note: '保留原作者' },
    ];
    render(<ChainInfoModal chain={{ ...chain, params: { ...chain.params, _styleBundleSources: sources } }} {...p} />);
    expect(screen.getByRole('region', { name: '分享来源' }).textContent).toContain('合成作者');
    expect(screen.getAllByText('来源链接：')).toHaveLength(2);
    const link = screen.getByRole('link', { name: 'https://example.org/free-style' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
    expect(screen.getByText('免费分享，请勿购买')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave.mock.calls[0][1]).toEqual({ name: chain.name, description: chain.description, tags: chain.tags });
    expect(sources[0].author).toBe('合成作者');
  });

  it('打开后选中名称，弹层脱离工作区，保存仅提交名称、描述与标签', async () => {
    const p = callbacks();
    const view = render(<main className="isolate"><ChainInfoModal chain={chain} {...p} /></main>);
    const dialog = screen.getByRole('dialog', { name: '编辑风格串信息' });
    expect(view.container.contains(dialog)).toBe(false);
    const name = screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    expect(name.selectionStart).toBe(0); expect(name.selectionEnd).toBe(chain.name.length);
    fireEvent.change(name, { target: { value: '  新名称  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '新描述' } });
    fireEvent.change(screen.getByRole('textbox', { name: '添加标签' }), { target: { value: '新标签' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).toHaveBeenCalledExactlyOnceWith(chain.id, { name: '新名称', description: '新描述', tags: ['待实测', '新标签'] });
    expect(p.notify).toHaveBeenCalledWith('风格串信息已保存', 'success');
    expect(chain.name).toBe('原名称'); expect(chain.tags).toEqual(['待实测']);
  });

  it('空名称不可保存；取消与 Escape 均不写入资料', () => {
    const p = callbacks();
    render(<ChainInfoModal chain={chain} {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2); expect(p.onSave).not.toHaveBeenCalled();
  });

  it('保存失败保留输入和弹层，可继续保存', async () => {
    const p = callbacks(); p.onSave.mockRejectedValueOnce(new Error('合成保存失败')).mockResolvedValueOnce(undefined);
    render(<ChainInfoModal chain={chain} {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '保留修改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('合成保存失败', 'error'));
    expect(p.onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('保留修改');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).toHaveBeenCalledTimes(2);
  });

  it('在途保存只提交一次，避免关闭弹层造成结果不明', async () => {
    const p = callbacks(); let resolve!: () => void;
    p.onSave.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    render(<ChainInfoModal chain={{ ...chain, type: 'character' }} {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: '正面提示词' }), { target: { value: 'pending prompt' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.submit(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(p.onSave).toHaveBeenCalledOnce(); expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onSave).toHaveBeenCalledWith(chain.id, expect.objectContaining({ basePrompt: 'pending prompt' }));
    expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve());
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it('角色信息沿用同一编辑器，移除标签后不会重复追加已有标签', async () => {
    const p = callbacks(); render(<ChainInfoModal chain={{ ...chain, type: 'character', tags: ['待实测', '删除我', '标签'] }} {...p} />);
    expect(screen.queryByRole('button', { name: '移除标签 待实测' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '移除标签 删除我' }));
    fireEvent.change(screen.getByRole('textbox', { name: '添加标签' }), { target: { value: '标签' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).toHaveBeenCalledExactlyOnceWith(chain.id, { name: chain.name, description: chain.description, tags: ['待实测', '标签'] });
    expect(p.notify).toHaveBeenCalledWith('自定义角色信息已保存', 'success');
  });

  it('无封面上传先仅预览，上传失败可重选同文件，条目保存失败重试复用已上传URL', async () => {
    const file = new File(['synthetic cover'], 'cover.webp', { type: 'image/webp' });
    const coverUrl = '/api/assets/persisted-cover.webp';
    const upload = vi.spyOn(api, 'uploadFile')
      .mockRejectedValueOnce(new Error('合成上传失败'))
      .mockResolvedValue({ url: coverUrl } as Awaited<ReturnType<typeof api.uploadFile>>);
    const p = callbacks(); p.onSave.mockRejectedValueOnce(new Error('合成保存失败')).mockResolvedValueOnce(undefined);
    render(<ChainInfoModal chain={{ ...chain, type: 'character', previewImage: undefined, basePrompt: '原正向词', negativePrompt: '原负面词' }} {...p} />);
    const cover = screen.getByRole('region', { name: '角色封面' });
    const input = within(cover).getByLabelText('上传角色封面') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(objectUrls.create).toHaveBeenCalledWith(file);
    expect(within(cover).getByRole('img', { name: '角色封面' }).getAttribute('src')).toBe('blob:synthetic-cover');
    expect(upload).not.toHaveBeenCalled(); expect(p.onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('合成上传失败', 'error'));
    expect(p.onSave).not.toHaveBeenCalled();
    expect((screen.getByLabelText('上传角色封面') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('上传角色封面'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('合成保存失败', 'error'));
    const expected = { name: chain.name, description: chain.description, tags: chain.tags, previewImage: coverUrl };
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, file, 'covers'); expect(upload).toHaveBeenNthCalledWith(2, file, 'covers');
    expect(p.onSave).toHaveBeenCalledOnce(); expect(p.onSave).toHaveBeenCalledWith(chain.id, expected);
    expect(JSON.stringify(p.onSave.mock.calls[0])).not.toContain('blob:');
    expect((within(cover).getByRole('img', { name: '角色封面' }) as HTMLImageElement).src).toContain('blob:synthetic-cover');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledTimes(2);
    expect(p.onSave).toHaveBeenCalledTimes(2); expect(p.onSave).toHaveBeenLastCalledWith(chain.id, expected);
  });

  it('历史选图弹层优先接收Esc，只替换封面并可清除，不提供导入参数选项', async () => {
    const historyImage = 'data:image/webp;base64,c3ludGhldGljLWhpc3Rvcnk=';
    history.getPage.mockResolvedValue({ items: [{ id: 'synthetic-history', imageUrl: historyImage, createdAt: 1, prompt: 'history prompt', params: { width: 640, height: 960 } }], count: 1, hasMore: false });
    const upload = vi.spyOn(api, 'uploadFile');
    const p = callbacks();
    render(<ChainInfoModal chain={{ ...chain, type: 'character', previewImage: '/synthetic-existing-cover.webp', basePrompt: '原正向词', negativePrompt: '原负面词' }} {...p} />);
    const cover = screen.getByRole('region', { name: '角色封面' });
    expect((within(cover).getByRole('img', { name: '角色封面' }) as HTMLImageElement).src).toContain('/synthetic-existing-cover.webp');
    fireEvent.click(within(cover).getByRole('button', { name: '清除封面' }));
    expect(within(cover).queryByRole('img', { name: '角色封面' })).toBeNull();
    fireEvent.click(within(cover).getByRole('button', { name: '从历史选图' }));
    const parent = screen.getByRole('dialog', { name: '编辑自定义角色信息' });
    let picker = await screen.findByRole('dialog', { name: '选择历史图片' });
    expect(parent.parentElement!.classList.contains('z-[1100]')).toBe(true); expect(picker.style.zIndex).toBe('1600');
    expect(isTopmostModal(picker)).toBe(true);
    expect(history.getPage).toHaveBeenCalledWith(0, expect.any(Number), undefined, true);
    expect(within(picker).queryByRole('checkbox', { name: '同时导入该图参数' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择历史图片' })).toBeNull());
    expect(screen.getByRole('dialog', { name: '编辑自定义角色信息' })).toBeTruthy();
    expect(confirmAction).not.toHaveBeenCalled();

    fireEvent.click(within(cover).getByRole('button', { name: '从历史选图' }));
    picker = await screen.findByRole('dialog', { name: '选择历史图片' });
    expect(within(picker).queryByRole('checkbox', { name: '同时导入该图参数' })).toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: /选择历史生成图片/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择历史图片' })).toBeNull());
    expect((within(cover).getByRole('img', { name: '角色封面' }) as HTMLImageElement).src).toContain(historyImage);
    expect((screen.getByRole('combobox', { name: '正面提示词' }) as HTMLTextAreaElement).value).toBe('原正向词');
    expect((screen.getByRole('combobox', { name: '负面提示词' }) as HTMLTextAreaElement).value).toBe('原负面词');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(upload).not.toHaveBeenCalled();
    expect(p.onSave).toHaveBeenCalledExactlyOnceWith(chain.id, { name: chain.name, description: chain.description, tags: chain.tags, previewImage: historyImage });
  });

  it('清除封面属于未保存修改，离开前要求确认且不提前写入', async () => {
    const p = callbacks();
    render(<ChainInfoModal chain={{ ...chain, type: 'character', previewImage: '/synthetic-cover.webp' }} {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '清除封面' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '放弃未保存的修改？' })));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it('角色提示词使用真实 Tag 补全、翻译、权重、删除和撤销控件，只提交实际改动的正负词', async () => {
    resetTagDictionaryCache();
    tagDictionary.translations.mockImplementation(async (tags: string[]) => new Map(tags.map(tag => {
      const normalized = tag.toLowerCase();
      return [normalized, { name: normalized, chinese: normalized === 'masterpiece' ? '杰作' : '红外套', category: 0, categoryLabel: '一般', postCount: 10, isNovelAI: false }];
    })));
    const p = callbacks(); p.onSave.mockRejectedValueOnce(new Error('合成保存失败')).mockResolvedValueOnce(undefined);
    render(<ChainInfoModal chain={{ ...chain, type: 'character', basePrompt: '', negativePrompt: 'old negative' }} {...p} />);
    const positiveGroup = screen.getByRole('group', { name: '正面提示词' });
    const negativeGroup = screen.getByRole('group', { name: '负面提示词' });
    const positive = within(positiveGroup).getByRole('combobox', { name: '正面提示词' }) as HTMLTextAreaElement;
    fireEvent.change(positive, { target: { value: 'ma' } }); positive.setSelectionRange(2, 2); fireEvent.click(positive);
    fireEvent.click(await screen.findByRole('option', { name: /masterpiece/ }));
    const translation = within(positiveGroup).getByLabelText('提示词中文翻译');
    expect(await within(translation).findByText('杰作')).toBeTruthy();
    const append = within(positiveGroup).getByRole('combobox', { name: '添加提示词' });
    fireEvent.change(append, { target: { value: 'red coat' } }); fireEvent.keyDown(append, { key: 'Enter' });
    await within(translation).findByRole('button', { name: /red coat/ });
    const token = within(translation).getByRole('button', { name: /masterpiece/ });
    fireEvent.click(token); fireEvent.click(within(positiveGroup).getByRole('button', { name: '数值' }));
    expect(within(positiveGroup).getByRole('group', { name: '权重类型' })).toBeTruthy();
    const weight = within(positiveGroup).getByRole('textbox', { name: '数值权重' }) as HTMLInputElement;
    fireEvent.change(weight, { target: { value: '1.25' } });
    const enter = createEvent.keyDown(weight, { key: 'Enter' }); fireEvent(weight, enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(positive.value).toBe('1.25::masterpiece::, red coat'); expect(p.onSave).not.toHaveBeenCalled();
    fireEvent.click(within(positiveGroup).getByRole('button', { name: '删除模式' }));
    fireEvent.click(within(translation).getByRole('button', { name: /red coat/ }));
    fireEvent.click(within(positiveGroup).getByRole('button', { name: '删除 1 个 Tag' }));
    expect(positive.value).toBe('1.25::masterpiece::');
    fireEvent.click(within(positiveGroup).getByRole('button', { name: '撤销' }));
    expect(positive.value).toBe('1.25::masterpiece::, red coat');
    fireEvent.change(within(negativeGroup).getByRole('combobox', { name: '负面提示词' }), { target: { value: 'new negative' } });

    const expected = { name: chain.name, description: chain.description, tags: chain.tags, basePrompt: '1.25::masterpiece::, red coat', negativePrompt: 'new negative' };
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('合成保存失败', 'error'));
    expect((within(positiveGroup).getByRole('combobox', { name: '正面提示词' }) as HTMLTextAreaElement).value).toBe('1.25::masterpiece::, red coat');
    expect((within(negativeGroup).getByRole('combobox', { name: '负面提示词' }) as HTMLTextAreaElement).value).toBe('new negative');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).toHaveBeenCalledTimes(2);
    expect(p.onSave).toHaveBeenNthCalledWith(1, chain.id, expected);
    expect(p.onSave).toHaveBeenNthCalledWith(2, chain.id, expected);
  });

  it('角色提示词未保存时请求离开会保留弹窗，确认放弃只关闭且不写入', async () => {
    confirmAction.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const p = callbacks(); render(<ChainInfoModal chain={{ ...chain, type: 'character' }} {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: '正面提示词' }), { target: { value: 'unsaved prompt' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '放弃未保存的修改？', confirmLabel: '放弃修改', cancelLabel: '继续编辑', onSave: expect.any(Function) }));
    expect(p.onClose).not.toHaveBeenCalled(); expect(p.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '编辑自定义角色信息' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it('旧来源与类型标签不进入编辑，自定义标签正常保存，内部状态保留', async () => {
    const p = callbacks();
    render(<ChainInfoModal chain={{ ...chain, tags: ['aitag', 'NAI', '收集中', '待实测', '__character_catalog__', '个人分类'] }} {...p} />);
    for (const tag of ['aitag', 'NAI', '收集中', '待实测', '__character_catalog__']) expect(screen.queryByRole('button', { name: `移除标签 ${tag}` })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '添加标签' }), { target: { value: '新分类' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '添加标签' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave.mock.calls[0][1].tags).toEqual(['待实测', '__character_catalog__', '个人分类', '新分类']);
  });

  it('阻止重新添加来源、图片类型或状态，中文输入确认不提前添加', async () => {
    const p = callbacks(); render(<ChainInfoModal chain={chain} {...p} />);
    const input = screen.getByRole('textbox', { name: '添加标签' });
    fireEvent.change(input, { target: { value: 'NAI' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('button', { name: '移除标签 NAI' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('来源、图片类型和状态不用作自定义标签', 'error'));
    expect(p.onSave).not.toHaveBeenCalled(); expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '星空' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByRole('button', { name: '移除标签 星空' })).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '移除标签 星空' })).toBeTruthy();
  });
});


it('词库角色固定原名和完整变体Tag，补充文本保存到变量且保留其他变量', async () => {
  const p = callbacks();
  const source = { ...chain, type: 'character' as const, name: '胡滕', tags: ['__character_catalog__'], basePrompt: 'ulrich_von_hutten_(azur_lane)', variableValues: { subject: 'black hair', retained: '原变量' }, params: { ...chain.params, _characterCatalogTag: 'ulrich_von_hutten_(azur_lane)' } };
  render(<ChainInfoModal chain={source} catalogIdentity={{ tag: source.basePrompt, name: source.name }} {...p} />);
  expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).readOnly).toBe(true);
  const identity = screen.getByRole('textbox', { name: '角色 Tag' }) as HTMLInputElement;
  expect(identity.readOnly).toBe(true); expect(identity.value).toBe(source.basePrompt);
  fireEvent.change(screen.getByRole('combobox', { name: '补充提示词' }), { target: { value: '{black hair}, red eyes' } });
  fireEvent.change(screen.getByRole('combobox', { name: '负面提示词' }), { target: { value: 'extra arms' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
  expect(p.onSave).toHaveBeenCalledWith(source.id, { name: source.name, description: source.description, tags: source.tags, variableValues: { subject: '{black hair}, red eyes', retained: '原变量' }, negativePrompt: 'extra arms' });
  expect(source.basePrompt).toBe('ulrich_von_hutten_(azur_lane)'); expect(source.variableValues.subject).toBe('black hair');
});

it('词库角色仅编辑描述时不回写提示词、变量、封面或参数', async () => {
  const p = callbacks();
  const source = { ...chain, type: 'character' as const, tags: ['__character_catalog__'], variableValues: { subject: '已有补充' } };
  render(<ChainInfoModal chain={source} catalogIdentity={{ tag: source.basePrompt, name: source.name }} {...p} />);
  fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '本地描述' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
  expect(p.onSave).toHaveBeenCalledWith(source.id, { name: source.name, description: '本地描述', tags: source.tags });
});
