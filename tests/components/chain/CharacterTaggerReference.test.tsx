// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorCharacters } from '../../../components/chain/ChainEditorCharacters';
import { CharacterTaggerReference } from '../../../components/chain/CharacterTaggerReference';
import { ConfirmDialogProvider } from '../../../components/ConfirmDialog';
import { imageTaggerService, type ImageTaggerResult, type ImageTaggerStatus } from '../../../services/imageTaggerService';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../../services/appearancePreferences';
import type { CharacterParams, NAIParams } from '../../../types';

const model = { id: 'SmilingWolf/wd-vit-tagger-v3', label: 'WD ViT V3', description: '轻量均衡', threshold: 0.35, characterThreshold: 0.85, downloaded: true, totalBytes: 378536310, receivedBytes: 378536310, stage: 'ready' as const, error: '' };
const status: ImageTaggerStatus = { model: model.id, downloaded: true, models: [model], busy: false, downloadingModel: null };

vi.mock('../../../services/imageTaggerService', () => ({ imageTaggerService: {
  tagFile: vi.fn(),
  getStatus: vi.fn(),
  selectModel: vi.fn(),
  downloadModel: vi.fn(),
  pauseDownload: vi.fn(),
  deleteModel: vi.fn(),
} }));
vi.mock('../../../components/TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: ({ value, onValueChange, ...props }: { value: string; onValueChange: (value: string) => void; tagAssistEnabled: boolean }) => {
  const { tagAssistEnabled: _assist, ...attributes } = props;
  return <textarea {...attributes} value={value} onChange={event => onValueChange(event.target.value)} />;
} }));

const result: ImageTaggerResult = { model: model.id, threshold: 0.53, characterThreshold: 0.85, rating: null,
  tags: [{ name: 'looking_at_viewer', category: 'general', confidence: 0.9 }, { name: 'sitting', category: 'general', confidence: 0.8 }], general: [], character: [] };
const initial: CharacterParams[] = [{ id: 'a', prompt: 'blue hair', negativePrompt: 'hat', x: 0.2, y: 0.4 }, { id: 'b', prompt: 'red hair', negativePrompt: 'glasses', x: 0.8, y: 0.6 }];

beforeEach(() => {
  const originalUrl = URL;
  vi.stubGlobal('URL', class extends originalUrl { static createObjectURL = vi.fn(() => 'blob:reference'); static revokeObjectURL = vi.fn(); });
  vi.mocked(imageTaggerService.tagFile).mockReset().mockResolvedValue(result);
  vi.mocked(imageTaggerService.getStatus).mockReset().mockResolvedValue(status);
  vi.mocked(imageTaggerService.downloadModel).mockReset().mockResolvedValue(undefined);
  vi.mocked(imageTaggerService.deleteModel).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const Harness = ({ scope = 'text-to-image', canEdit = true }: { scope?: string; canEdit?: boolean }) => {
  const [characters, setCharacters] = useState(initial);
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: true, ucPreset: 4, characters } as NAIParams;
  return <ConfirmDialogProvider><ChainEditorCharacters params={params} setParams={next => setCharacters(next.characters || [])} characters={characters}
    canEdit={canEdit} tagAssistEnabled={false} characterPresetSources={{}} markPresetSectionModified={vi.fn()} markChange={vi.fn()}
    addCharacter={vi.fn()} updateCharacter={(index, patch) => setCharacters(current => current.map((character, i) => i === index ? { ...character, ...patch } : character))}
    removeCharacter={index => setCharacters(current => current.filter((_, i) => i !== index))}
    activeLabLayout={DEFAULT_LAB_PAGE_LAYOUTS['text-to-image']} mobileEditorTab="character" scopeKey={scope} />
    <output data-testid="characters">{JSON.stringify(characters)}</output></ConfirmDialogProvider>;
};
const rows = () => JSON.parse(screen.getByTestId('characters').textContent!) as CharacterParams[];
const selectCharacter = (name: string | RegExp) => {
  const button = screen.getAllByRole('button', { name }).find(node => node.hasAttribute('aria-pressed'));
  if (!button) throw new Error(`missing character switch ${String(name)}`);
  fireEvent.click(button);
};
const openPanel = async () => {
  fireEvent.click(screen.getByRole('button', { name: '粘贴反推' }));
  return screen.findByRole('dialog', { name: '识别图片 Tag' });
};
const waitReady = async (dialog: HTMLElement) => {
  await waitFor(() => expect((within(dialog).getByTitle(/也可在此按 Ctrl\+V/) as HTMLButtonElement).disabled).toBe(false));
};

describe('角色就地粘贴反推', () => {
  it('打开共用识别页面，粘贴图片后勾选结果追加到当前角色，角色卡不残留参考图', async () => {
    render(<Harness />);
    selectCharacter(/角色 2/);
    const dialog = await openPanel();
    await waitReady(dialog);
    const image = new File(['synthetic'], 'clipboard.png', { type: 'image/png' });
    fireEvent.paste(dialog, { clipboardData: { files: [image], items: [] } });
    await waitFor(() => expect(imageTaggerService.tagFile).toHaveBeenCalledWith(image, expect.objectContaining({ model: model.id })));
    const append = await within(dialog).findByRole('button', { name: '追加 2 个 Tag 到此角色' });
    fireEvent.click(append);
    expect(rows()).toEqual([initial[0], { ...initial[1], prompt: 'red hair, looking at viewer, sitting' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('反推参考图')).toBeNull();
    expect(screen.queryByAltText('待识别图片')).toBeNull();
  });

  it('取消勾选只追加选中的 Tag，其他角色保持不变', async () => {
    render(<Harness />);
    const dialog = await openPanel();
    await waitReady(dialog);
    const image = new File(['synthetic'], 'clipboard.png', { type: 'image/png' });
    fireEvent.paste(dialog, { clipboardData: { files: [image], items: [] } });
    await within(dialog).findByRole('button', { name: /sitting/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /sitting/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '追加 1 个 Tag 到此角色' }));
    expect(rows()[0]).toEqual({ ...initial[0], prompt: 'blue hair, looking at viewer' });
    expect(rows()[1]).toEqual(initial[1]);
  });

  it('未下载当前模型时页面提醒先下载，取图入口禁用', async () => {
    const missing = { ...model, downloaded: false, receivedBytes: 0, stage: 'missing' as const };
    vi.mocked(imageTaggerService.getStatus).mockResolvedValue({ model: model.id, downloaded: false, models: [missing], busy: false, downloadingModel: null });
    render(<Harness />);
    const dialog = await openPanel();
    expect(await within(dialog).findByText('当前反推模型尚未下载，先在下方下载模型才能识别图片。')).toBeTruthy();
    await waitFor(() => expect((within(dialog).getByTitle(/也可在此按 Ctrl\+V/) as HTMLButtonElement).disabled).toBe(true));
    expect(within(dialog).getByRole('button', { name: /下载/ })).toBeTruthy();
  });

  it('识别页面里能直接下载与删除模型', async () => {
    const other = { ...model, id: 'second-model', label: 'WD EVA02-Large V3', downloaded: false, receivedBytes: 0, stage: 'missing' as const };
    vi.mocked(imageTaggerService.getStatus).mockResolvedValue({ model: model.id, downloaded: true, models: [model, other], busy: false, downloadingModel: null });
    render(<Harness />);
    const dialog = await openPanel();
    const download = await within(dialog).findByRole('button', { name: '下载' });
    fireEvent.click(download);
    await waitFor(() => expect(imageTaggerService.downloadModel).toHaveBeenCalledWith('second-model'));
    const remove = within(dialog).getByRole('button', { name: '删除 WD ViT V3' });
    fireEvent.click(remove);
    const confirm = await screen.findByRole('alertdialog', { name: /删除 WD ViT V3/ });
    fireEvent.click(within(confirm).getByRole('button', { name: '删除模型' }));
    await waitFor(() => expect(imageTaggerService.deleteModel).toHaveBeenCalledWith('SmilingWolf/wd-vit-tagger-v3'));
  });

  it('只读时反推入口禁用', async () => {
    render(<Harness canEdit={false} />);
    expect((screen.getByRole('button', { name: '粘贴反推' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('切换模式后旧面板关闭，不追加到新模式', async () => {
    const { rerender } = render(<Harness />);
    const dialog = await openPanel();
    rerender(<Harness scope="outpaint" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rows()).toEqual(initial);
  });

  it('独立渲染也能在无槽位时显示按钮', () => {
    render(<CharacterTaggerReference canEdit onAppend={vi.fn()} />);
    expect(screen.getByRole('button', { name: '粘贴反推' })).toBeTruthy();
  });
});
