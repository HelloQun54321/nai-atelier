// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleSettingsDialog } from '../../components/ArtistSampleSettingsDialog';
import type { ArtistSampleTemplate } from '../../services/artistSamples';
import { ImageActivityContext } from '../../components/SmartImage';

const mocks = vi.hoisted(() => ({ data: vi.fn(), save: vi.fn(), defaults: vi.fn(), runtime: vi.fn() }));
vi.mock('../../services/artistSampleDrafts', () => ({
  getArtistSampleData: mocks.data,
  saveArtistSampleTemplate: mocks.save,
  getDefaultArtistSampleTemplate: mocks.defaults,
  normalizeArtistSampleTemplate: (template: ArtistSampleTemplate) => ({
    ...structuredClone(template), prompt: template.prompt.replace(/artists?\s*:\s*\{artist\}|\{artist\}/gi, '{style}'),
  }),
  artistSampleModelMatches: (pack: string, model = '') => !model.endsWith('-inpainting') && (pack === 'v45' ? model.startsWith('nai-diffusion-4-5-') : /^nai-diffusion-5-full(?:-medium)?$/.test(model)),
  validateArtistSampleTemplate: (pack: string, value: ArtistSampleTemplate) => {
    const model = value.params.model ?? '';
    if ((pack === 'v45' ? !model.startsWith('nai-diffusion-4-5-') : !model.startsWith('nai-diffusion-5-')) || model.endsWith('-inpainting')) throw new Error('样张配置的模型与所选版本不一致');
    if (!value.prompt.includes('{style}') && !value.prompt.includes('{artist}')) throw new Error('公共提示词需要且只能包含一个 {style} 占位符，角色提示词不能包含替换位');
    if (!Number.isSafeInteger(value.params.seed) || value.params.seed! < 0) throw new Error('样张配置需要固定的非负 Seed');
  },
}));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: mocks.runtime, getNaiRuntimeConfig: async () => runtime }));
vi.mock('../../components/GenerationTemplateEditor', () => ({
  default: ({ value, onChange, recommendedTemplate, modelFilter, enforceFreeStepLimit, onBusyChange }: any) => <div data-testid="template-editor"
    data-prompt={value.prompt} data-character={value.characterPrompt || ''} data-negative={value.negativePrompt}
    data-model={value.params.model} data-characters={JSON.stringify(value.params.characters || [])}
    data-recommended={JSON.stringify(recommendedTemplate)} data-model-allowed={modelFilter(value.params.model)}
    data-step-limit={String(enforceFreeStepLimit)}>
    <button type="button" onClick={() => onChange({ ...value, characterPrompt: 'changed role content' })}>模拟修改角色栏</button>
    <button type="button" onClick={() => onChange({ ...value, params: { ...value.params, model: recommendedTemplate.params.model } })}>模拟切换到推荐模型</button>
    <button type="button" onClick={() => onBusyChange(true)}>模拟预设忙碌</button>
    <button type="button" onClick={() => onBusyChange(false)}>结束预设忙碌</button>
  </div>,
}));

const template: ArtistSampleTemplate = {
  prompt: '{style}, portrait', negativePrompt: 'negative sample', characterPrompt: 'role sample',
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 6, sampler: 'k_euler_ancestral', seed: 0,
    characters: [{ id: 'test-character', prompt: 'full character', negativePrompt: 'character negative', x: 0.2, y: 0.7 }] },
};
const runtime = { models: [], freeMaxSteps: 34 } as any;
const defaultFor = (pack: 'v45' | 'v5'): ArtistSampleTemplate => ({ ...structuredClone(template), prompt: 'recommended {style}', characterPrompt: 'recommended role',
  params: { ...template.params, model: pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full', steps: runtime.freeMaxSteps } });
const mount = (props: Partial<React.ComponentProps<typeof ArtistSampleSettingsDialog>> = {}) => {
  const onSaved = vi.fn(), onClose = vi.fn();
  const view = render(<ArtistSampleSettingsDialog pack="v45" generateAfterSave={false} onSaved={onSaved} onClose={onClose} {...props} />);
  return { ...view, onSaved, onClose };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  mocks.defaults.mockImplementation((pack: 'v45' | 'v5') => defaultFor(pack));
  mocks.save.mockResolvedValue(undefined);
  mocks.runtime.mockReturnValue(runtime);
});
afterEach(cleanup);

it('资料页隐藏再返回保留未保存模板，隐藏期间Escape不关闭，Portal焦点恢复', async () => {
  const onClose = vi.fn(), onSaved = vi.fn();
  const dialog = <ArtistSampleSettingsDialog pack="v45" generateAfterSave={false} onClose={onClose} onSaved={onSaved} />;
  const view = render(<ImageActivityContext.Provider value={true}>{dialog}</ImageActivityContext.Provider>);
  const editor = await screen.findByTestId('template-editor');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '模拟修改角色栏' }));
  view.rerender(<ImageActivityContext.Provider value={false}>{dialog}</ImageActivityContext.Provider>);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('dialog', { hidden: true }).className).toBe('hidden');
  fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).not.toHaveBeenCalled();
  view.rerender(<ImageActivityContext.Provider value={true}>{dialog}</ImageActivityContext.Provider>);
  expect(screen.getByTestId('template-editor')).toBe(editor);
  expect(editor.getAttribute('data-character')).toBe('changed role content');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  expect(mocks.data).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); fireEvent(window, escape);
  expect(escape.defaultPrevented).toBe(true); expect(onClose).toHaveBeenCalledOnce();
});

it.each(['v45', 'v5'] as const)('按%s读取推荐配置并将完整配置保存后交回调用方', async pack => {
  mocks.data.mockResolvedValue({ templates: {}, samples: [] });
  const onSaved = vi.fn(), onClose = vi.fn();
  mount({ pack, tag: 'synthetic artist', generateAfterSave: true, enforceFreeStepLimit: false, onSaved, onClose });
  const editor = await screen.findByTestId('template-editor');
  await waitFor(() => expect((screen.getByRole('button', { name: '保存并生成样张' }) as HTMLButtonElement).disabled).toBe(false));
  const model = pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full';
  expect(editor.getAttribute('data-model')).toBe(model);
  expect(editor.getAttribute('data-step-limit')).toBe('false');
  expect(JSON.parse(editor.getAttribute('data-recommended') || '{}')).toMatchObject({ characterPrompt: 'recommended role', params: { model, steps: 34 } });
  expect(mocks.defaults).toHaveBeenCalledWith(pack, runtime);
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存并生成样张' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(pack, expect.objectContaining({ params: expect.objectContaining({ model }) })));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ characterPrompt: 'recommended role', params: expect.objectContaining({ characters: template.params.characters }) }));
  expect(onClose).not.toHaveBeenCalled();
});

it('旧画师替换位只在内存规范化，不自动保存且完整保留角色和参数', async () => {
  const old: ArtistSampleTemplate = { ...structuredClone(template), prompt: 'artist:{artist}, old context' };
  mocks.data.mockResolvedValue({ templates: { v45: old }, samples: [] });
  const { onSaved } = mount();
  const editor = await screen.findByTestId('template-editor');
  expect(editor.getAttribute('data-prompt')).toBe('{style}, old context');
  expect(editor.getAttribute('data-character')).toBe('role sample');
  expect(JSON.parse(editor.getAttribute('data-characters') || '[]')).toEqual(template.params.characters);
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '模拟修改角色栏' }));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('v45', expect.objectContaining({
    prompt: '{style}, old context', characterPrompt: 'changed role content', params: expect.objectContaining({ characters: template.params.characters }),
  })));
  expect(onSaved).toHaveBeenCalledOnce();
});

it('读取失败保留弹窗，可重试；保存失败保留编辑且可取消', async () => {
  mocks.data.mockRejectedValueOnce(new Error('读取失败'));
  const { onSaved, onClose } = mount();
  await screen.findByText('读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重试读取配置' }));
  await screen.findByTestId('template-editor');
  await waitFor(() => expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.defaults).toHaveBeenCalledWith('v45', runtime);
  fireEvent.click(screen.getByRole('button', { name: '模拟修改角色栏' }));
  mocks.save.mockRejectedValueOnce(new Error('写入失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('写入失败');
  expect(screen.getByTestId('template-editor').getAttribute('data-character')).toBe('changed role content');
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('预设保存忙碌期间禁止保存和关闭', async () => {
  const { onClose } = mount();
  await screen.findByTestId('template-editor');
  fireEvent.click(screen.getByRole('button', { name: '模拟预设忙碌' }));
  expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onClose).not.toHaveBeenCalled();
});

it.each(['preset', 'saving'] as const)('窄屏%s忙碌时浏览器返回保留当前历史层', async busyKind => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const previousState = { source: 'synthetic' };
  window.history.replaceState(previousState, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.history.replaceState(previousState, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: previousState }));
  });
  let finishSave!: () => void;
  if (busyKind === 'saving') mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
  const { unmount, onClose } = mount();
  await screen.findByTestId('template-editor');
  const marker = window.history.state?.__naiMobileLayer as string;
  expect(marker).toMatch(/^artist-sample-settings-/);
  if (busyKind === 'preset') fireEvent.click(screen.getByRole('button', { name: '模拟预设忙碌' }));
  else fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  if (busyKind === 'saving') await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  act(() => window.history.back());
  expect(back).toHaveBeenCalledOnce();
  expect(window.history.state?.__naiMobileLayer).toBe(marker);
  expect(onClose).not.toHaveBeenCalled();
  if (busyKind === 'preset') fireEvent.click(screen.getByRole('button', { name: '结束预设忙碌' }));
  else await act(async () => finishSave());
  window.history.replaceState(previousState, '');
  unmount();
});

it('不匹配模型不自动改写、显示原因并禁止保存，用户改为正确版本后可保存', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: { ...template, params: { ...template.params, model: 'nai-diffusion-5-full' } } }, samples: [] });
  const { onSaved } = mount();
  const editor = await screen.findByTestId('template-editor');
  expect(editor.getAttribute('data-model')).toBe('nai-diffusion-5-full');
  expect(editor.getAttribute('data-model-allowed')).toBe('false');
  expect(await screen.findByText('样张配置的模型与所选版本不一致')).toBeTruthy();
  expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '模拟切换到推荐模型' }));
  expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-4-5-full' }) })));
});

it('V5 Medium 完整配置可选择和保存，不替换模型或步数', async () => {
  const medium: ArtistSampleTemplate = { ...structuredClone(template), params: {
    ...template.params, model: 'nai-diffusion-5-full-medium', steps: 14,
  } };
  mocks.data.mockResolvedValue({ templates: { v5: medium }, samples: [] });
  const { onSaved } = mount({ pack: 'v5' });
  const editor = await screen.findByTestId('template-editor');
  expect(editor.getAttribute('data-model')).toBe('nai-diffusion-5-full-medium');
  expect(editor.getAttribute('data-model-allowed')).toBe('true');
  expect(editor.getAttribute('data-characters')).toBe(JSON.stringify(template.params.characters));
  expect(screen.queryByText('样张配置的模型与所选版本不一致')).toBeNull();
  expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('v5', expect.objectContaining({
    params: expect.objectContaining({ model: 'nai-diffusion-5-full-medium', steps: 14 }),
  })));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-5-full-medium', steps: 14 }) }));
});

it('V5 Full 入口原样读取旧 Curated 配置并阻止保存生成，主动切 Full 后才继续', async () => {
  const curated = { ...structuredClone(template), params: { ...template.params, model: 'nai-diffusion-5-curated', seed: 777 } };
  mocks.data.mockResolvedValue({ templates: { v5: curated }, samples: [] });
  const { onSaved } = mount({ pack: 'v5', generateAfterSave: true });
  const editor = await screen.findByTestId('template-editor');
  expect(editor.getAttribute('data-model')).toBe('nai-diffusion-5-curated'); expect(editor.getAttribute('data-model-allowed')).toBe('false');
  expect(screen.getByText('NovelAI V5 Full')).toBeTruthy(); expect(await screen.findByText('画师样张仅支持 V5 Full')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存并生成样张' })); expect(mocks.save).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  expect(curated.params.model).toBe('nai-diffusion-5-curated'); expect(curated.params.seed).toBe(777);
  fireEvent.click(screen.getByRole('button', { name: '模拟切换到推荐模型' }));
  fireEvent.click(screen.getByRole('button', { name: '保存并生成样张' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-5-full', seed: 777 }) })));
});
