// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import dictionary from '../../locales/messages.json';
import { PromptLibraryBundleDialog } from '../../components/PromptLibraryBundleDialog';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(), create: vi.fn(), notify: vi.fn(), close: vi.fn(), saved: vi.fn(), writeChain: vi.fn(),
}));

vi.mock('../../services/promptAgent', () => ({
  promptAgentService: { generateLibraryBundle: mocks.generate },
  PROMPT_LIBRARY_KIND_LABELS: {
    appearance: '人物形象', wardrobe: '服饰', pose: '姿势',
    expression: '表情状态', scene: '场景', camera: '镜头画面',
  },
}));

const KINDS: Array<[string, string]> = [
  ['appearance', '人物形象'],
  ['wardrobe', '服饰'],
  ['pose', '姿势'],
  ['expression', '表情状态'],
  ['scene', '场景'],
  ['camera', '镜头画面'],
];

const bundleItem = (kind: string, label: string) => ({
  kind, label, name: `${label}候选`, prompt: `${kind} prompt, night`, bilingual: `${label}候选 / 夜景`,
  negativePrompt: 'lowres, blurry', tags: [kind, '夜景'], note: `${label}说明`,
});
const bundleResult = (items = KINDS.map(([kind, label]) => bundleItem(kind, label)), missing: string[] = []) => ({
  items, missing, provider: 'test-provider', model: 'test-model', count: items.length,
});

const setup = () => render(
  <PromptLibraryBundleDialog
    open
    onClose={mocks.close}
    notify={mocks.notify}
    onCreate={mocks.create}
    onSaved={mocks.saved}
  />,
);

/** 带一条风格串的版本：用于「写入风格串」入口。 */
const styleChain = {
  id: 'chain-1', userId: 'owner', username: 'owner', name: '路西法5串1', description: '',
  type: 'style', tags: [], basePrompt: '', negativePrompt: '', modules: [],
  params: { model: 'nai-diffusion-4-5-full' }, variableValues: { subject: '旧主体' },
  createdAt: 1, updatedAt: 1,
};
const setupWithChain = () => render(
  <PromptLibraryBundleDialog
    open
    onClose={mocks.close}
    notify={mocks.notify}
    onCreate={mocks.create}
    onSaved={mocks.saved}
    styleChains={[styleChain as never]}
    onWriteToChain={mocks.writeChain}
  />,
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue('created-id');
  mocks.writeChain.mockResolvedValue('chain-1');
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('一段话生成六类候选，取消一条勾选后只保存勾选的五条，并带齐参数形状', async () => {
  mocks.generate.mockResolvedValue(bundleResult());
  setup();
  const generateButton = screen.getByRole('button', { name: '生成六条' }) as HTMLButtonElement;
  expect(generateButton.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('描述你想要的画面'), { target: { value: '雨夜天台，少女，湿发' } });
  expect(generateButton.disabled).toBe(false);
  fireEvent.click(generateButton);
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith({ brief: '雨夜天台，少女，湿发' }));

  await screen.findByText('已生成 6 条');
  expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).checked)).toBe(true);

  fireEvent.click(screen.getByLabelText('选择镜头画面'));
  expect((screen.getByLabelText('选择镜头画面') as HTMLInputElement).checked).toBe(false);
  const saveButton = screen.getByRole('button', { name: '全部保存到提示词库' }) as HTMLButtonElement;
  expect(saveButton.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('人物形象名称'), { target: { value: '改过的名字' } });
  fireEvent.change(screen.getByLabelText('人物形象提示词'), { target: { value: 'appearance prompt, edited' } });

  fireEvent.click(saveButton);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(5));

  expect(mocks.create).toHaveBeenNthCalledWith(1, '改过的名字', '人物形象说明', 'appearance', expect.objectContaining({
    basePrompt: 'appearance prompt, edited',
    negativePrompt: 'lowres, blurry',
    tags: ['appearance', '夜景'],
    variableValues: { subject: '' },
    modules: [],
    params: expect.objectContaining({
      width: 832,
      height: 1216,
      _promptLibrary: { bilingual: '人物形象候选 / 夜景', references: [] },
    }),
  }));
  expect(mocks.create).toHaveBeenNthCalledWith(5, '场景候选', '场景说明', 'scene', expect.objectContaining({ basePrompt: 'scene prompt, night' }));
  expect(mocks.create.mock.calls.map(call => call[2])).not.toContain('camera');

  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('已保存 5 条'));
  expect(mocks.saved).toHaveBeenCalledOnce();
  // 未勾选的镜头仍留在面板里，重新勾选即可再存。
  expect(screen.getByLabelText('选择镜头画面')).toBeTruthy();
  expect(mocks.close).not.toHaveBeenCalled();
});

it('缺库时提示可重试，生成失败给出可读原因且保留候选', async () => {
  mocks.generate.mockResolvedValueOnce(bundleResult(KINDS.slice(0, 5).map(([kind, label]) => bundleItem(kind, label)), ['camera']));
  setup();
  fireEvent.change(screen.getByLabelText('描述你想要的画面'), { target: { value: '海边黄昏' } });
  fireEvent.click(screen.getByRole('button', { name: '生成六条' }));
  await screen.findByText('已生成 5 条');
  expect(screen.getByRole('status').textContent).toBe('1 类缺失，可重试');

  mocks.generate.mockRejectedValueOnce(new Error('模型未配置'));
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('生成失败：模型未配置', 'error'));
  expect(screen.getByText('已生成 5 条')).toBeTruthy();
});

it('全部取消勾选后保存按钮禁用；保存全部失败时保留六条候选且不回调刷新', async () => {
  mocks.generate.mockResolvedValue(bundleResult());
  mocks.create.mockRejectedValue(new Error('写入失败'));
  setup();
  fireEvent.change(screen.getByLabelText('描述你想要的画面'), { target: { value: '废墟中的剑士' } });
  fireEvent.click(screen.getByRole('button', { name: '生成六条' }));
  await screen.findByText('已生成 6 条');

  const saveButton = () => screen.getByRole('button', { name: '全部保存到提示词库' }) as HTMLButtonElement;
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
  expect(saveButton().disabled).toBe(true);
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
  expect(saveButton().disabled).toBe(false);

  fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(6));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('保存失败：6', 'error'));
  expect(mocks.saved).not.toHaveBeenCalled();
  expect(screen.getAllByRole('checkbox')).toHaveLength(6);
});

it('六条可以按栏写进已有风格串：人物四栏进角色 1、场景/镜头进全局栏，主体只合并全局栏', async () => {
  mocks.generate.mockResolvedValue(bundleResult());
  setupWithChain();
  fireEvent.change(screen.getByLabelText('描述你想要的画面'), { target: { value: '苗族少女，废弃游乐园' } });
  fireEvent.click(screen.getByRole('button', { name: '生成六条' }));
  await screen.findByText('已生成 6 条');

  fireEvent.click(screen.getByRole('button', { name: '写入风格串…' }));
  // 默认是「新建风格串」，切到已有串后按钮变成「写入这条风格串」
  fireEvent.click(screen.getByLabelText('写入已有风格串'));
  const confirm = screen.getByRole('button', { name: '写入这条风格串' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);

  await waitFor(() => expect(mocks.writeChain).toHaveBeenCalledOnce());
  const payload = mocks.writeChain.mock.calls[0][0];
  expect(payload.chain).toMatchObject({ id: 'chain-1', name: '路西法5串1' });
  expect(payload.params.characters[0].sections).toMatchObject({
    appearance: 'appearance prompt, night',
    wardrobe: 'wardrobe prompt, night',
    pose: 'pose prompt, night',
    expression: 'expression prompt, night',
  });
  expect(payload.params._promptSections.scene).toBe('scene prompt, night');
  expect(payload.params._promptSections.camera).toBe('camera prompt, night');
  // 角色类不重复写进全局栏，主体只合并全局栏
  expect(payload.params._promptSections.appearance).toBeUndefined();
  expect(payload.variableValues.subject).toBe('scene prompt, night, camera prompt, night, 旧主体');
  expect(payload.params.characters[0].sectionNegatives).toEqual(Object.fromEntries(
    ['appearance', 'wardrobe', 'pose', 'expression'].map(kind => [kind, 'lowres, blurry']),
  ));
  expect(payload.params._promptSections.sectionNegatives).toEqual({ scene: 'lowres, blurry', camera: 'lowres, blurry' });
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('已写入风格串：角色 4 栏、全局 2 栏'));
});

it('没有风格串可写时不显示入口，取消勾选后写入按钮禁用', async () => {
  mocks.generate.mockResolvedValue(bundleResult());
  setup();
  fireEvent.change(screen.getByLabelText('描述你想要的画面'), { target: { value: '海边' } });
  fireEvent.click(screen.getByRole('button', { name: '生成六条' }));
  await screen.findByText('已生成 6 条');
  expect(screen.queryByRole('button', { name: '写入风格串…' })).toBeNull();
});

it('Esc、遮罩与取消都能关闭，且说明只走当前助手模型、可能收费、不消耗生图额度', async () => {
  setup();
  expect(screen.getByRole('dialog', { name: 'AI 一键六库' }).getAttribute('aria-modal')).toBe('true');
  expect(screen.getByText('用一段话一次生成六类提示词')).toBeTruthy();
  expect(screen.getByText('使用当前创作助手模型生成提示词，模型服务可能收费；不消耗生图额度。')).toBeTruthy();
  expect((screen.getByLabelText('描述你想要的画面') as HTMLTextAreaElement).placeholder).toBe('例如：雨夜天台，少女，湿发，霓虹倒影');

  const dialog = screen.getByRole('dialog', { name: 'AI 一键六库' });
  fireEvent.mouseDown(dialog.parentElement as HTMLElement);
  expect(mocks.close).toHaveBeenCalledOnce();
  mocks.close.mockClear();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(mocks.close).toHaveBeenCalledOnce();
  mocks.close.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(mocks.close).toHaveBeenCalledOnce();
});

it('一键六库相关文案在四语言字典中齐全且占位符一致', () => {
  const keys = ['AI 一键六库', '用一段话一次生成六类提示词', '描述你想要的画面', '例如：雨夜天台，少女，湿发，霓虹倒影',
    '生成六条', '正在生成…', '生成失败：{0}', '已生成 {0} 条', '{0} 类缺失，可重试', '勾选后一起保存', '选择{0}',
    '{0}提示词', '{0}名称', '全部保存到提示词库', '已保存 {0} 条', '保存失败：{0}', '条目名称', '提示词',
    '写入风格串', '写入风格串…', '新建风格串', '写入已有风格串', '写入这条风格串', '新建并写入',
    '已写入风格串：角色 {0} 栏、全局 {1} 栏', '来自一键六库内容'];
  for (const key of keys) {
    const variants = (dictionary as Record<string, string[]>)[key];
    expect(variants, key).toHaveLength(4);
    for (const value of variants) {
      expect(value.trim(), key).not.toBe('');
      expect([...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort(), key)
        .toEqual([...key.matchAll(/\{\d+\}/g)].map(match => match[0]).sort());
    }
  }
});
