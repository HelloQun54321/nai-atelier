// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../../services/i18n';
import { PromptExtractDialog } from '../../components/PromptExtractDialog';
import { EXTRACT_DRAFT_STORAGE_KEY, EXTRACT_DRAFT_VERSION } from '../../services/promptExtractDraft';

const mocks = vi.hoisted(() => ({
  extract: vi.fn(), config: vi.fn(), notify: vi.fn(), close: vi.fn(), save: vi.fn(), metadata: vi.fn(), attachment: vi.fn(), confirm: vi.fn(),
}));

vi.mock('../../services/promptAgent', () => ({
  promptAgentService: { extractCandidates: mocks.extract, getConfig: mocks.config },
  PROMPT_LIBRARY_KIND_LABELS: {
    appearance: '人物形象', wardrobe: '服饰', pose: '姿势',
    expression: '表情状态', scene: '场景', camera: '镜头画面',
  },
}));
vi.mock('../../services/pngMetadata.mjs', () => ({ extractPngMetadata: mocks.metadata }));
vi.mock('../../services/agentAttachments', () => ({ prepareAgentAttachment: mocks.attachment }));
/* 词库来自 /tag-data 静态分片：组件测试不需要它，桩成空词典，释义走手动 AI 补译路径。 */
vi.mock('../../services/tagDictionary', () => ({
  normalizeTagQuery: (value: string) => String(value || '').trim().toLowerCase(),
  preloadTagDictionary: () => undefined,
  searchTagDictionary: async () => [],
  lookupTagTranslations: async () => new Map(),
  /* 上游 1.121.1 起输入框会查词典释义；这里同样桩成空表，不影响提取流程断言。 */
  lookupTagCatalogEntries: async () => new Map(),
}));
/* 清空草稿走全局确认框：这里用可编程桩，既能自动确认也能断言「取消确认时不丢数据」。 */
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));

beforeEach(() => {
  setLanguage('zh-CN');
  vi.clearAllMocks();
  /* 草稿会真写进 localStorage：每个用例从空草稿开始，避免相互串味。 */
  window.localStorage.clear();
  mocks.confirm.mockResolvedValue(true);
  mocks.config.mockResolvedValue({ provider: 'test-provider', model: 'test-model', imageInput: true });
  mocks.metadata.mockResolvedValue(null);
  mocks.attachment.mockResolvedValue({ data: 'AAAA', mimeType: 'image/webp', name: '合成.webp' });
  mocks.save.mockResolvedValue(undefined);
  // jsdom 没有实现对象 URL：给出稳定桩，删除图片时的回收调用也因此不会抛错。
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', writable: true, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true, configurable: true });
  /* 共享标签编辑器会用 fetch 查词库释义：给出只读桩，默认每个词都有中文释义。 */
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const tags: string[] = Array.isArray(body?.tags) ? body.tags : [];
    const chinese = body?.action === 'translate' ? '译:释义' : '释义';
    return { ok: true, json: async () => ({ items: tags.map(tag => ({ tag, chinese })) }) } as unknown as Response;
  }));
});

afterEach(() => {
  cleanup();
  setLanguage('zh-CN');
  vi.unstubAllGlobals();
});

const textResult = () => ({
  mode: 'text',
  provider: 'test-provider',
  model: 'test-model',
  items: [
    { kind: 'appearance', name: '白发红瞳少女', prompt: 'long_white_hair, red_eyes', original: '' },
    { kind: 'wardrobe', name: '白色连衣裙', prompt: 'white_dress', original: '' },
    { kind: 'pose', name: '站姿', prompt: 'standing', original: '' },
    { kind: 'camera', name: '俯视', prompt: 'from_above', original: '' },
  ],
  unclassified: { name: '未归类内容', prompt: 'masterpiece', original: '' },
  excluded: { negative: 'bad hands', positive: '', parameters: 'Steps: 28' },
});

const renderDialog = (overrides: Partial<React.ComponentProps<typeof PromptExtractDialog>> = {}) => render(
  <PromptExtractDialog open onClose={mocks.close} notify={mocks.notify} onSave={mocks.save} {...overrides} />,
);

/** 共享标签编辑器的 textarea 带 aria-autocomplete，无障碍角色会算成 combobox，按标签文本取更稳。 */
const fieldByLabel = (name: string) => screen.getByLabelText(name) as HTMLTextAreaElement;

const pasteText = (value = '1.3::white hair::, white dress, standing, from above') =>
  fireEvent.change(fieldByLabel('提示词原文'), { target: { value } });

const kindNames = () => Array.from(document.querySelectorAll('[data-extract-kind]')).map(node => node.getAttribute('data-extract-kind'));

it('提取发送当前目录树并显示完整路径，可修改目录后保存自定义片段', async () => {
  const directories = { revision: 3, nodes: [
    { id: 'style-root', parentId: null, name: '绘画方式' },
    { id: 'watercolor', parentId: 'style-root', name: '水彩' },
    { id: 'paper', parentId: 'watercolor', name: '纸纹' },
  ] };
  mocks.extract.mockResolvedValue({ ...textResult(), items: [{ kind: 'preset', name: '水彩纸张', prompt: 'watercolor, paper', directoryIds: ['paper'] }], unclassified: null });
  renderDialog({ directories });
  pasteText('watercolor, paper');
  expect(screen.getByText('文字分类发送输入框文字与当前提示词目录')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await screen.findByText('绘画方式 / 水彩 / 纸纹');
  expect(mocks.extract.mock.calls[0][0]).toEqual({ mode: 'text', text: 'watercolor, paper', directories });
  expect(screen.queryByRole('combobox', { name: '水彩纸张分类' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '未归类' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '绘画方式 / 水彩' }));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ kind: 'preset', directoryIds: ['watercolor'], name: '水彩纸张' });
});

it('未知目录候选持久保留且阻止直接保存，人工指定未归类后失败重试沿用身份', async () => {
  const directories = { revision: 4, nodes: [] };
  mocks.extract.mockResolvedValue({ ...textResult(), items: [{ kind: 'preset', name: '未知归属', prompt: 'paper', directoryIds: ['removed'], needsDirectoryReview: true, directoryReviewNote: '未知目录 removed' }], unclassified: null });
  mocks.save.mockRejectedValueOnce(new Error('合成保存失败')).mockResolvedValueOnce(undefined);
  const view = renderDialog({ directories });
  pasteText('paper');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await screen.findByText('未知目录 removed');
  expect(screen.getByRole('button', { name: '保存所选片段（0）' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  view.unmount();
  renderDialog({ directories });
  expect(fieldByLabel('提示词原文').value).toBe('paper');
  expect(screen.getByText('未知目录 removed')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择未知归属' }));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('选择实际目录');
  fireEvent.click(screen.getByRole('checkbox', { name: '未归类' }));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('合成保存失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[0][0].entryId).toBe(mocks.save.mock.calls[1][0].entryId);
  expect(mocks.save.mock.calls[1][0].directoryIds).toEqual([]);
  expect(mocks.extract).toHaveBeenCalledTimes(1);
});

/** jsdom 的 File 没有 arrayBuffer：补一个，模拟「从原始文件读取字节」。 */
const makeImageFile = (name = '合成.png', type = 'image/png') => {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  return file;
};

it('原文默认收起编辑工具，展开收起保留权重与空白，清空仍可撤销', async () => {
  mocks.config.mockResolvedValue({ provider: 'custom-private-provider-id', model: 'test-model', imageInput: true });
  renderDialog();
  const source = '  1.3::white hair, red eyes::,\n white dress  ';
  pasteText(source);
  const toggle = screen.getByRole('button', { name: '编辑工具' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('group', { name: '权重类型' })).toBeNull();
  expect(screen.queryByLabelText('添加提示词')).toBeNull();
  expect(screen.queryByRole('button', { name: '收录到提示词库' })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('group', { name: '权重类型' })).toBeTruthy();
  fireEvent.click(toggle);
  expect(fieldByLabel('提示词原文').value).toBe(source);
  expect(screen.queryByLabelText('添加提示词')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清空当前提示词' }));
  expect(fieldByLabel('提示词原文').value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '撤销清空' }));
  expect(fieldByLabel('提示词原文').value).toBe(source);
  await waitFor(() => expect(screen.getByText(/AI 分析使用 test-model/)).toBeTruthy());
  expect(document.body.textContent).not.toContain('custom-private-provider-id');
  expect(mocks.extract).not.toHaveBeenCalled();
});

it('主按钮随分析与保存阶段切换，重分析失败仍保留可保存的候选', async () => {
  let finish!: (value: ReturnType<typeof textResult>) => void;
  mocks.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  renderDialog();
  pasteText();
  const primary = () => screen.getByRole('dialog').querySelectorAll('button[data-tone="primary"]');
  expect(primary()).toHaveLength(1);
  expect(primary()[0].textContent).toBe('按文字分类');
  fireEvent.click(primary()[0]);
  expect(primary()).toHaveLength(1);
  expect(primary()[0].textContent).toBe('正在提取…');
  expect(primary()[0].hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '中止分析' }).hasAttribute('disabled')).toBe(false);
  await act(async () => finish(textResult()));
  expect(primary()).toHaveLength(1);
  expect(primary()[0].textContent).toBe('保存所选片段（4）');
  expect(screen.getByRole('button', { name: '重新按文字分类' }).getAttribute('data-tone')).toBe('neutral');
  mocks.extract.mockRejectedValueOnce(new Error('合成分析失败'));
  fireEvent.click(screen.getByRole('button', { name: '重新按文字分类' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('合成分析失败'));
  expect(primary()[0].textContent).toBe('保存所选片段（4）');
  expect(kindNames()).toHaveLength(4);
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  expect(primary()[0].textContent).toBe('保存所选片段（0）');
  expect(primary()[0].hasAttribute('disabled')).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('同时有文字与图片时说明文字优先，看图按钮只发送图片副本', async () => {
  mocks.metadata.mockResolvedValue(JSON.stringify({ prompt: 'embedded scene' }));
  mocks.extract.mockResolvedValue(textResult());
  renderDialog();
  pasteText('typed scene');
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile()] } });
  await screen.findByText('已读取内嵌提示词');
  expect(screen.getByText('文字分类仅发送输入框文字')).toBeTruthy();
  expect(screen.getByText('看图提取会发送图片副本，结果为视觉推断。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '按文字分类' }).getAttribute('data-tone')).toBe('primary');
  expect(screen.getByRole('button', { name: 'AI 看图提取' }).getAttribute('data-tone')).toBe('neutral');
  expect(mocks.extract).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toHaveLength(4));
  expect(mocks.extract.mock.calls[0][0]).toEqual({ mode: 'text', text: 'typed scene' });
  expect(mocks.attachment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'AI 看图提取' }));
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(2));
  expect(mocks.extract.mock.calls[1][0]).toEqual({ mode: 'vision', images: [{ data: 'AAAA', mimeType: 'image/webp' }] });
});

it('打开时不自动调用模型；点击后才按文字分类，并按六类分组展示、默认全部勾选', async () => {
  mocks.extract.mockResolvedValue(textResult());
  renderDialog();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(screen.getByText(/模型服务可能收费/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /保存所选片段/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'AI 看图提取' })).toBeNull();

  pasteText();
  expect(screen.getByText('文字分类仅发送输入框文字')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance', 'wardrobe', 'pose', 'camera']));
  expect(mocks.extract).toHaveBeenCalledTimes(1);
  const [payload] = mocks.extract.mock.calls[0];
  expect(payload.mode).toBe('text');
  expect(payload.text).toBe('1.3::white hair::, white dress, standing, from above');

  // 有内容的类别才出现：没有表情状态与场景，就不摆空分组。
  expect(kindNames()).not.toContain('expression');
  expect(kindNames()).not.toContain('scene');
  for (const label of ['人物形象', '服饰', '姿势', '镜头画面']) {
    expect((screen.getByLabelText(`选择${label}`) as HTMLInputElement).checked).toBe(true);
  }
  // 未归类与剥离内容如实展示，不静默丢弃。
  expect(within(document.querySelector('[data-extract-unclassified]') as HTMLElement).getByText(/masterpiece/)).toBeTruthy();
  const excluded = document.querySelector('[data-extract-excluded]') as HTMLElement;
  expect(within(excluded).getByText(/bad hands/)).toBeTruthy();
  expect(within(excluded).getByText(/Steps: 28/)).toBeTruthy();
  // 权重组内的原词与结构原样显示，不被模型改写。
  expect((fieldByLabel('人物形象提示词') as HTMLTextAreaElement).value).toBe('long_white_hair, red_eyes');
});

it('未确认不入库；改名称与分类、取消勾选后只保存勾选项', async () => {
  mocks.extract.mockResolvedValue(textResult());
  renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  expect(mocks.save).not.toHaveBeenCalled();

  fireEvent.change(fieldByLabel('人物形象名称'), { target: { value: '银发少女' } });
  fireEvent.change(screen.getByRole('combobox', { name: '人物形象分类' }), { target: { value: 'scene' } });
  fireEvent.click(screen.getByLabelText('选择服饰'));
  fireEvent.click(screen.getByLabelText('选择姿势'));
  fireEvent.click(screen.getByLabelText('选择镜头画面'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));

  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save).toHaveBeenCalledWith({ entryId: expect.any(String), kind: 'scene', name: '银发少女', prompt: 'long_white_hair, red_eyes', original: '' });
  // 没勾选的三条留在面板里等用户处理，保存完不会连窗口一起关掉。
  expect(mocks.close).not.toHaveBeenCalled();
  expect(kindNames().length).toBe(3);
});

it('部分保存失败时保留失败项，重试不会重复创建已成功的条目', async () => {
  mocks.extract.mockResolvedValue(textResult());
  const attempts: string[] = [];
  mocks.save.mockImplementation(async draft => { attempts.push(draft.name); throw new Error('合成写入失败'); });
  renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（4）' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('保存失败'), 'error'));
  expect(mocks.close).not.toHaveBeenCalled();
  // 四条都失败：全部保留在面板里等重试。
  await waitFor(() => expect(kindNames().length).toBe(4));

  // 第二轮：只有「白色连衣裙」失败，其余三条成功并移出面板。
  attempts.length = 0;
  mocks.save.mockReset();
  mocks.save.mockImplementation(async draft => {
    attempts.push(draft.name);
    if (draft.name === '白色连衣裙') throw new Error('单条失败');
  });
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（4）' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存所选片段（1）' })).toBeTruthy());
  expect(attempts).toEqual(['白发红瞳少女', '白色连衣裙', '站姿', '俯视']);
  expect(kindNames()).toEqual(['wardrobe']);
  expect(mocks.close).not.toHaveBeenCalled();

  // 第三轮只重试失败的那一条：已成功的三条不会被再建一次。
  attempts.length = 0;
  mocks.save.mockReset();
  mocks.save.mockImplementation(async draft => { attempts.push(draft.name); });
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
  expect(attempts).toEqual(['白色连衣裙']);
});

it('看图提取：先发送压缩副本并在结果里标明视觉推断来源；未声明图片能力时按钮禁用', async () => {
  mocks.extract.mockResolvedValue({
    mode: 'vision', provider: 'test-provider', model: 'test-model',
    items: [{ kind: 'appearance', name: '人物 A · 白发少女', prompt: 'long_white_hair', original: '' }],
    unclassified: null, ignored: 0,
  });
  renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile()] } });
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));

  expect(screen.getByText('未找到内嵌提示词')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '按文字分类' })).toBeNull();
  expect(screen.getByRole('button', { name: 'AI 看图提取' }).getAttribute('data-tone')).toBe('primary');
  expect(mocks.extract).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'AI 看图提取' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance']));
  const [payload] = mocks.extract.mock.calls[0];
  expect(payload.mode).toBe('vision');
  expect(payload.images).toEqual([{ data: 'AAAA', mimeType: 'image/webp' }]);
  expect(screen.getByText(/视觉推断，不是原始提示词/)).toBeTruthy();
});

it('图片内嵌元数据优先按原始提示词分类，不需要额外调用看图', async () => {
  mocks.metadata.mockResolvedValue(JSON.stringify({ prompt: 'long hair, white dress', uc: 'bad hands' }));
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'test-provider', model: 'test-model',
    items: [{ kind: 'appearance', name: '长发', prompt: 'long hair', original: '' }],
    unclassified: null, excluded: { negative: 'bad hands', parameters: '' },
  });
  renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile('归档.png')] } });
  await waitFor(() => expect(screen.getByText(/已读取内嵌提示词/)).toBeTruthy());
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(screen.getByText('文字分类仅发送图片内嵌提示词')).toBeTruthy();
  expect(screen.getByRole('button', { name: '按文字分类' }).getAttribute('data-tone')).toBe('primary');
  expect(screen.getByRole('button', { name: 'AI 看图提取' }).getAttribute('data-tone')).toBe('neutral');

  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));
  const [payload] = mocks.extract.mock.calls[0];
  expect(payload.mode).toBe('text');
  expect(payload.text).toContain('long hair, white dress');
  expect(payload.text).toContain('Negative prompt: bad hands');
  // 有元数据时不会先自动跑一次看图，也不会连调两次模型。
  expect(mocks.attachment).not.toHaveBeenCalled();
  expect(screen.getByText(/图片内嵌原始提示词/)).toBeTruthy();
});

it('模型声明不支持图片输入时禁用看图按钮；接口失败保留原始输入且不写入库', async () => {
  mocks.config.mockResolvedValue({ provider: 'test-provider', model: 'text-only', imageInput: false });
  mocks.extract.mockRejectedValue(Object.assign(new Error('当前模型不支持图片输入'), { status: 400 }));
  renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile()] } });
  await waitFor(() => expect(screen.getByText('当前模型不支持看图，可按文字分类。')).toBeTruthy());
  expect((screen.getByRole('button', { name: 'AI 看图提取' }) as HTMLButtonElement).disabled).toBe(true);

  pasteText('red eyes');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/当前模型不支持图片输入/));
  // 失败后原文还在，可以直接改一改再试；也没有任何条目入库。
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('red eyes');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('图片预处理期间关闭窗口：不再发出模型请求', async () => {
  let finish!: (value: unknown) => void;
  mocks.attachment.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.extract.mockResolvedValue({ mode: 'vision', provider: 'p', model: 'm', items: [], unclassified: null, ignored: 0 });
  const view = renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile()] } });
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'AI 看图提取' }));
  // 预处理阶段就要能中止：按钮在发送请求前已经出现。
  await waitFor(() => expect(screen.getByRole('button', { name: '中止分析' })).toBeTruthy());

  view.rerender(<PromptExtractDialog open={false} onClose={mocks.close} notify={mocks.notify} onSave={mocks.save} />);
  await act(async () => finish({ data: 'AAAA', mimeType: 'image/webp', name: '合成.webp' }));
  await act(async () => { await Promise.resolve(); });
  expect(mocks.extract).not.toHaveBeenCalled();
});

it('图片预处理期间换图：旧任务作废不发送，连点也只请求一次', async () => {
  let finishFirst!: (value: unknown) => void;
  mocks.attachment
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue({ data: 'BBBB', mimeType: 'image/png', name: '第二张.png' });
  mocks.extract.mockResolvedValue({ mode: 'vision', provider: 'p', model: 'm', items: [], unclassified: null, ignored: 0 });
  renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile('第一张.png')] } });
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'AI 看图提取' }));
  await waitFor(() => expect(mocks.attachment).toHaveBeenCalledTimes(1));

  // 换图：旧任务随即作废，它的预处理结果返回后也不再发送。
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile('第二张.png')] } });
  await act(async () => finishFirst({ data: 'AAAA', mimeType: 'image/webp', name: '第一张.webp' }));
  await act(async () => { await Promise.resolve(); });
  expect(mocks.extract).not.toHaveBeenCalled();

  // 新图重新发起，连点两下只有一次请求。
  mocks.extract.mockResolvedValue({ mode: 'vision', provider: 'p', model: 'm', items: [], unclassified: null, ignored: 0 });
  const button = screen.getByRole('button', { name: 'AI 看图提取' }) as HTMLButtonElement;
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));
  expect(mocks.extract.mock.calls[0][0].images).toEqual([{ data: 'BBBB', mimeType: 'image/png' }]);
});

it('保存过程中锁住输入与编辑，不能改动正在保存的这一批', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.extract.mockResolvedValue(textResult());
  mocks.save.mockImplementation(async () => { await gate; });
  renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（4）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByLabelText('选择服饰') as HTMLInputElement).disabled).toBe(true);
  expect((fieldByLabel('服饰提示词') as HTMLTextAreaElement).disabled).toBe(true);
  // 保存期间换图事件也不生效：不再读取新文件的元数据。
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile('打断.png')] } });
  await act(async () => { await Promise.resolve(); });
  expect(mocks.metadata).not.toHaveBeenCalled();
  await act(async () => release());
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
});

it('中文片段没有可用英文译文时默认不勾选，勾上也不许直接入库', async () => {
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'p', model: 'm',
    items: [
      { kind: 'appearance', name: '人物形象', prompt: '粉色长发女孩', original: '粉色长发女孩', needsTranslation: true },
      { kind: 'scene', name: '海边', prompt: 'seaside', original: '海边' },
    ],
    unclassified: null,
    excluded: { negative: '', parameters: '' },
  });
  renderDialog();
  pasteText('粉色长发女孩在海边');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance', 'scene']));

  // 没译法的那条默认不勾选，避免把中文当英文提示词入库。
  expect((screen.getByLabelText('选择人物形象') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('选择场景') as HTMLInputElement).checked).toBe(true);
  await waitFor(() => expect(screen.getByRole('button', { name: '保存所选片段（1）' })).toBeTruthy());

  fireEvent.click(screen.getByLabelText('选择人物形象'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（2）' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/还是中文/));
  expect(mocks.save).not.toHaveBeenCalled();
});

it('权重结构没能还原的候选默认不勾选，显示原因且不许直接入库', async () => {
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'p', model: 'm',
    items: [
      { kind: 'appearance', name: '人物形象', prompt: 'long white hair', original: '(白色长发]', needsReview: true, reviewNote: '括号没有成对闭合，无法把译法套回原结构' },
      { kind: 'scene', name: '海边', prompt: 'seaside', original: '海边' },
    ],
    unclassified: null,
    excluded: { negative: '', parameters: '' },
  });
  renderDialog();
  pasteText('(白色长发], 海边');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance', 'scene']));

  expect((screen.getByLabelText('选择人物形象') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('选择场景') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/括号没有成对闭合/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: '保存所选片段（1）' })).toBeTruthy());

  fireEvent.click(screen.getByLabelText('选择人物形象'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（2）' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/结构没能可靠还原/));
  expect(mocks.save).not.toHaveBeenCalled();
});

it('取消与关闭不保存；重新分析后旧响应不覆盖新草稿', async () => {
  let finish!: (value: unknown) => void;
  mocks.extract.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  renderDialog();
  pasteText('red eyes');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));

  // 分析期间改输入：这次响应已作废，迟到结果不能写进草稿。
  pasteText('blue hair');
  await act(async () => finish(textResult()));
  await waitFor(() => expect(kindNames().length).toBe(0));
  expect(mocks.save).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('分析中可以中止：断开本地请求并如实说明服务端可能仍会完成，结果不写入草稿', async () => {
  mocks.extract.mockImplementation((_input: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  renderDialog();
  pasteText('red eyes');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: '中止分析' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/已中止本次提取/));
  expect(screen.getByRole('alert').textContent).toMatch(/模型服务可能仍会完成/);
  // 中止后原文仍在，草稿为空，也没有条目入库。
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('red eyes');
  expect(kindNames().length).toBe(0);
  expect(mocks.save).not.toHaveBeenCalled();
});

/** 等自动暂存（350ms 防抖）落盘，再断言持久副本。 */
const waitPersist = async () => {
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 420); }); });
};

const rerenderOpen = (view: ReturnType<typeof render>, open: boolean) => {
  view.rerender(<PromptExtractDialog open={open} onClose={mocks.close} notify={mocks.notify} onSave={mocks.save} />);
};

it('本端存储写不进去时如实提示暂存失败，页面上的工作不受影响', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
  mocks.extract.mockResolvedValue(textResult());
  renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  await waitPersist();

  expect(screen.getByText(/草稿暂存失败/)).toBeTruthy();
  // 降级到「只在当前页面」而不是谎称已保存：候选与编辑都还在。
  expect(kindNames().length).toBe(4);
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toContain('white hair');
  setItem.mockRestore();
});

it('点遮罩不关闭面板；关闭重开后保留输入、候选与手工编辑', async () => {
  mocks.extract.mockResolvedValue(textResult());
  const view = renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  fireEvent.change(screen.getByLabelText('人物形象名称'), { target: { value: '白发少女' } });
  fireEvent.click(screen.getByLabelText('选择姿势'));

  // 遮罩是面板的父容器：点它不该再被当成关闭手势。
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
  expect(mocks.close).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  rerenderOpen(view, false);
  rerenderOpen(view, true);

  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toContain('white hair');
  expect((screen.getByLabelText('人物形象名称') as HTMLInputElement).value).toBe('白发少女');
  expect((screen.getByLabelText('选择姿势') as HTMLInputElement).checked).toBe(false);
  // 重开不自动重新分析：不会二次付费，也不会覆盖刚保留的草稿。
  expect(mocks.extract).toHaveBeenCalledTimes(1);
});

it('刷新式恢复：重新挂载后从本端草稿恢复候选、编辑与勾选，且不自动调用模型', async () => {
  mocks.extract.mockResolvedValue(textResult());
  const view = renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  fireEvent.change(screen.getByLabelText('服饰名称'), { target: { value: '白裙' } });
  await waitPersist();
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeTruthy();

  view.unmount();
  mocks.extract.mockClear();
  renderDialog();

  expect(screen.getByText(/已恢复上次未完成的提取草稿/)).toBeTruthy();
  expect(kindNames()).toEqual(['appearance', 'wardrobe', 'pose', 'camera']);
  expect((screen.getByLabelText('服饰名称') as HTMLInputElement).value).toBe('白裙');
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toContain('white hair');
  expect(mocks.extract).not.toHaveBeenCalled();
});

it('部分保存后重开只恢复未保存项；全部保存完成后草稿结束、不再复活', async () => {
  mocks.extract.mockResolvedValue(textResult());
  mocks.save.mockRejectedValueOnce(new Error('broken')).mockResolvedValue(undefined);
  const view = renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（4）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(kindNames()).toEqual(['appearance']));

  view.unmount();
  renderDialog();
  expect(kindNames()).toEqual(['appearance']);

  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalled());
  await waitFor(() => expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull());
});

it('清空草稿需要确认：取消不丢内容，确认后清空且不留持久副本', async () => {
  mocks.extract.mockResolvedValue(textResult());
  renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));

  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '清空草稿' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(kindNames().length).toBe(4);

  mocks.confirm.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: '清空草稿' }));
  await waitFor(() => expect(kindNames().length).toBe(0));
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('');
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();
});

it('本端草稿损坏时明确提示并按空草稿开始，之后仍可正常使用', async () => {
  window.localStorage.setItem(EXTRACT_DRAFT_STORAGE_KEY, '{"version":99,"candidates":"oops"}');
  mocks.extract.mockResolvedValue(textResult());
  renderDialog();
  expect(screen.getByText(/读不出来/)).toBeTruthy();
  expect(kindNames().length).toBe(0);

  pasteText('red eyes');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames().length).toBe(4));
});

it('关闭时有在途请求：迟到响应不写入草稿，重开仍是原来的输入', async () => {
  let finish!: (value: unknown) => void;
  mocks.extract.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderDialog();
  pasteText('red eyes');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  rerenderOpen(view, false);
  await act(async () => finish(textResult()));
  await waitPersist();
  expect(String(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY) || '')).not.toContain('long_white_hair');

  rerenderOpen(view, true);
  expect(kindNames().length).toBe(0);
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('red eyes');
});

it('中文释义只做展示：不改英文提示词、不改勾选、不解除待处理标记', async () => {
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'p', model: 'm',
    items: [
      { kind: 'appearance', name: '人物形象', prompt: 'long white hair', original: '白色长发', needsReview: true, reviewNote: '内层还嵌套了数值权重组' },
      { kind: 'scene', name: '海边', prompt: 'seaside', original: '海边' },
    ],
    unclassified: null,
    excluded: { negative: '', parameters: '' },
  });
  renderDialog();
  pasteText('白色长发, 海边');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance', 'scene']));

  // 中英对照面板出现，但英文原文与勾选状态都不受影响。
  await waitFor(() => expect(screen.getAllByLabelText('提示词中文翻译').length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getAllByText('释义').length).toBeGreaterThan(0));
  expect((fieldByLabel('人物形象提示词') as HTMLTextAreaElement).value).toBe('long white hair');
  expect((screen.getByLabelText('选择人物形象') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/内层还嵌套了数值权重组/)).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('缺词只显示待翻译；只有点击「翻译缺失项」才发起 AI 补译', async () => {
  const fetchMock = vi.fn(async (_input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const tags: string[] = Array.isArray(body?.tags) ? body.tags : [];
    const chinese = body?.action === 'translate' ? '译:蜂翼' : '';
    return { ok: true, json: async () => ({ items: tags.map(tag => ({ tag, chinese })) }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  /* 用其他用例没出现过的词，避免命中模块级已缓存译文。 */
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'p', model: 'm',
    items: [{ kind: 'appearance', name: '人物形象', prompt: 'bee wings', original: '蜂翼' }],
    unclassified: null,
    excluded: { negative: '', parameters: '' },
  });
  renderDialog();
  pasteText('蜂翼');
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance']));

  const translateCalls = () => fetchMock.mock.calls.filter(([, init]) => String((init as { body?: string })?.body || '').includes('"translate"'));
  await waitFor(() => expect(screen.getAllByText('待翻译').length).toBeGreaterThan(0));
  const buttons = await screen.findAllByRole('button', { name: /翻译缺失项/ });
  expect(buttons.length).toBeGreaterThan(0);
  // 打开、恢复、编辑都不会自动触发补译。
  expect(translateCalls().length).toBe(0);

  fireEvent.click(buttons[0]);
  await waitFor(() => expect(translateCalls().length).toBe(1));
});

/** 直接把一份草稿写进隔离的本端存储，模拟「上一次没做完就关了页面」。 */
const seedDraft = (patch: Record<string, unknown>) => {
  window.localStorage.setItem(EXTRACT_DRAFT_STORAGE_KEY, JSON.stringify({
    version: EXTRACT_DRAFT_VERSION,
    updatedAt: Date.now(),
    text: '',
    sourceLabel: '',
    image: null,
    candidates: [],
    unclassified: '',
    excluded: { negative: '', parameters: '' },
    nextId: 0,
    ...patch,
  }));
};

const storedDraft = () => {
  const raw = window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY);
  return raw ? JSON.parse(raw) as { text: string; image: { name: string } | null; candidates: Array<{ prompt: string }> } : null;
};

it('恢复图片草稿后仍可分类内嵌词，没有原文件时禁用看图而不发送请求', () => {
  seedDraft({ image: {
    name: 'restored-without-live-file.png', state: 'ready', note: '',
    stored: { globalPrompt: 'seaside', characters: [], negative: '' },
  } });
  renderDialog();
  expect(screen.getByText('原图未保留，请重新选择图片')).toBeTruthy();
  const classify = screen.getByRole('button', { name: '按文字分类' });
  expect(classify.getAttribute('data-tone')).toBe('primary');
  expect(classify.hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'AI 看图提取' }).hasAttribute('disabled')).toBe(true);
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.attachment).not.toHaveBeenCalled();
});

it('图片来源的候选全部保存后，关开、等待暂存与重新挂载都不会复活旧图片', async () => {
  mocks.metadata.mockResolvedValue(JSON.stringify({ prompt: 'classroom, sunset', uc: 'bad quality' }));
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'test-provider', model: 'test-model',
    items: [{ kind: 'scene', name: '教室黄昏', prompt: 'classroom, sunset', original: '' }],
    unclassified: null, excluded: { negative: 'bad quality', parameters: '' },
  });
  const view = renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile('synthetic.png')] } });
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['scene']));
  await waitPersist();
  expect(storedDraft()?.image?.name).toBe('synthetic.png');

  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  // 保存成功那一刻旧副本就清掉了，不会留下「只剩一张用过的旧图片」的草稿。
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();

  rerenderOpen(view, false);
  rerenderOpen(view, true);
  await waitPersist();
  expect(screen.queryByAltText('待分析图片')).toBeNull();
  expect(kindNames()).toEqual([]);
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();

  // 卸载重挂载（刷新式恢复）同样不能把旧任务带回来。
  view.unmount();
  renderDialog();
  await waitPersist();
  expect(screen.queryByAltText('待分析图片')).toBeNull();
  expect(kindNames()).toEqual([]);
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();
});

it('图片来源的部分保存只留下失败项及其来源，成功项不再复活', async () => {
  mocks.metadata.mockResolvedValue(JSON.stringify({ prompt: 'classroom, sunset', uc: 'bad quality' }));
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'test-provider', model: 'test-model',
    items: [
      { kind: 'scene', name: '教室', prompt: 'classroom', original: '' },
      { kind: 'scene', name: '夕阳', prompt: 'sunset', original: '' },
    ],
    unclassified: null, excluded: { negative: 'bad quality', parameters: '' },
  });
  mocks.save.mockImplementation(async (draft: { prompt: string }) => {
    if (draft.prompt === 'sunset') throw new Error('单条失败');
  });
  renderDialog();
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [makeImageFile('synthetic.png')] } });
  await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['scene']));

  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（2）' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存所选片段（1）' })).toBeTruthy());
  expect(mocks.close).not.toHaveBeenCalled();
  // 失败项与它依赖的图片来源都还在面板上。
  expect(screen.queryByAltText('待分析图片')).toBeTruthy();
  expect((fieldByLabel('场景提示词') as HTMLTextAreaElement).value).toBe('sunset');

  await waitPersist();
  const draft = storedDraft();
  expect(draft?.image?.name).toBe('synthetic.png');
  expect(draft?.candidates.map(item => item.prompt)).toEqual(['sunset']);
});

it('只有文字的旧草稿被手动删空后，等待暂存、关开与重新挂载都保持空', async () => {
  seedDraft({ text: 'old input', sourceLabel: '输入框提示词' });
  const view = renderDialog();
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('old input');

  fireEvent.change(fieldByLabel('提示词原文'), { target: { value: '' } });
  await waitPersist();
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();

  rerenderOpen(view, false);
  rerenderOpen(view, true);
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByText(/已恢复上次未完成的提取草稿/)).toBeNull();

  view.unmount();
  renderDialog();
  await waitPersist();
  expect((fieldByLabel('提示词原文') as HTMLTextAreaElement).value).toBe('');
  expect(kindNames()).toEqual([]);
  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();
});

it('文字为空但仍有图片元数据时不误清草稿', async () => {
  seedDraft({
    image: {
      name: '合成.png', state: 'ready', note: '',
      stored: { globalPrompt: 'classroom, sunset', characters: [], negative: 'bad quality' },
    },
  });
  renderDialog();
  await waitPersist();

  expect(screen.queryByAltText('待分析图片')).toBeNull();
  expect(screen.getByText('原图未保留，请重新选择图片')).toBeTruthy();
  expect(document.querySelector('img[src=""]')).toBeNull();
  const draft = storedDraft();
  expect(draft?.image?.name).toBe('合成.png');
});

it('删除内容后，更早排队的延迟写入不会把旧草稿写回来', async () => {
  renderDialog();
  pasteText('white hair');
  // 先让第一次暂存排队但还没到 350ms，再清空：旧任务必须被作废。
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 120); }); });
  fireEvent.change(fieldByLabel('提示词原文'), { target: { value: '' } });
  await waitPersist();

  expect(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)).toBeNull();
});


it('失败候选编辑并刷新后仍用同一 entryId 重试，新分析才换身份', async () => {
  mocks.extract.mockResolvedValue({ ...textResult(), items: [textResult().items[0]] });
  mocks.save.mockRejectedValue(new Error('合成回执丢失'));
  const view = renderDialog();
  pasteText();
  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance']));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('保存失败'), 'error'));
  expect(screen.getByRole('alert').textContent).toContain('合成回执丢失');
  const firstId = mocks.save.mock.calls[0][0].entryId;
  expect(firstId).toEqual(expect.any(String));
  expect(JSON.parse(window.localStorage.getItem(EXTRACT_DRAFT_STORAGE_KEY)!).candidates[0].entryId).toBe(firstId);
  fireEvent.change(fieldByLabel('人物形象提示词'), { target: { value: 'edited hair' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭并保留草稿' }));
  view.unmount();
  renderDialog();
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ entryId: firstId, prompt: 'edited hair' });
  await waitFor(() => expect(screen.getByRole('button', { name: '重新按文字分类' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '重新按文字分类' }));
  await waitFor(() => expect(fieldByLabel('人物形象提示词').value).toBe('long_white_hair, red_eyes'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选片段（1）' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(mocks.save.mock.calls[2][0].entryId).not.toBe(firstId);
});


it.each(['助手没有返回可用的提取结果', 'Provider error: upstream overload'])('英文界面提取错误翻译已知原因并保留未知原文：%s', async reason => {
  setLanguage('en');
  mocks.extract.mockRejectedValue(new Error(reason));
  renderDialog();
  fireEvent.change(fieldByLabel(t('提示词原文')), { target: { value: 'white hair' } });
  fireEvent.click(screen.getByRole('button', { name: t('按文字分类') }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('提取失败：{0}', [t(reason)])));
  if (reason.startsWith('助手')) expect(screen.getByRole('alert').textContent).not.toContain('助手');
});

it('英文界面元数据读取和逐项保存错误也翻译内层原因，重分析说明真实替换边界', async () => {
  setLanguage('en');
  mocks.metadata.mockRejectedValue(new Error('助手没有返回可用的提取结果'));
  mocks.extract.mockResolvedValue({ ...textResult(), items: [textResult().items[0]] });
  mocks.save.mockRejectedValue(new Error('助手没有返回可用的提取结果'));
  renderDialog();
  fireEvent.change(screen.getByLabelText(t('选择图片')), { target: { files: [makeImageFile('translate-error.png')] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('读取图片内嵌信息失败：{0}；可以改用看图提取', [t('助手没有返回可用的提取结果')])));
  fireEvent.change(fieldByLabel(t('提示词原文')), { target: { value: 'white hair' } });
  fireEvent.click(screen.getByRole('button', { name: t('按文字分类') }));
  await waitFor(() => expect(kindNames()).toEqual(['appearance']));
  expect(document.body.textContent).toContain(t('重新分析成功后替换未保存候选'));
  fireEvent.click(screen.getByRole('button', { name: t('保存所选片段（{0}）', ['1']) }));
  await waitFor(() => expect(screen.getAllByRole('alert').some(node => node.textContent === '白发红瞳少女：' + t('助手没有返回可用的提取结果'))).toBe(true));
});
