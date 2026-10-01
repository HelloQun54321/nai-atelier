// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorCharacters } from './ChainEditorCharacters';
import { CharacterTaggerReference } from './CharacterTaggerReference';
import { imageTaggerService, ImageTaggerResult } from '../../services/imageTaggerService';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../services/appearancePreferences';
import type { CharacterParams, NAIParams } from '../../types';

vi.mock('../../services/imageTaggerService', () => ({ imageTaggerService: { tagFile: vi.fn(), getStatus: vi.fn(async () => ({ models: [] })) } }));
vi.mock('../TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: ({ value, onValueChange, ...props }: { value: string; onValueChange: (value: string) => void; tagAssistEnabled: boolean }) => {
  const { tagAssistEnabled: _assist, ...attributes } = props;
  return <textarea {...attributes} value={value} onChange={event => onValueChange(event.target.value)} />;
} }));

const image = new File(['synthetic'], 'clipboard.png', { type: 'image/png' });
const result: ImageTaggerResult = { model: 'selected-model', threshold: 0.53, characterThreshold: 0.85, rating: null,
  tags: [{ name: 'looking_at_viewer', category: 'general', confidence: 0.9 }, { name: 'sitting', category: 'general', confidence: 0.8 }], general: [], character: [] };
const initial: CharacterParams[] = [{ id: 'a', prompt: 'blue hair', negativePrompt: 'hat', x: 0.2, y: 0.4 }, { id: 'b', prompt: 'red hair', negativePrompt: 'glasses', x: 0.8, y: 0.6 }];
const read = vi.fn();
const originalUrl = URL;
beforeEach(() => {
  vi.mocked(imageTaggerService.tagFile).mockResolvedValue(result);
  read.mockResolvedValue([{ types: ['image/png'], getType: async () => image }]);
  vi.stubGlobal('navigator', { clipboard: { read } });
  vi.stubGlobal('URL', class extends originalUrl { static createObjectURL = vi.fn(() => 'blob:reference'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const Harness = ({ scope = 'text-to-image' }: { scope?: string }) => {
  const [characters, setCharacters] = useState(initial);
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: true, ucPreset: 4, characters } as NAIParams;
  return <><ChainEditorCharacters params={params} setParams={next => setCharacters(next.characters || [])} characters={characters}
    canEdit tagAssistEnabled={false} characterPresetSources={{}} markPresetSectionModified={vi.fn()} markChange={vi.fn()}
    addCharacter={vi.fn()} updateCharacter={(index, patch) => setCharacters(current => current.map((character, i) => i === index ? { ...character, ...patch } : character))}
    removeCharacter={index => setCharacters(current => current.filter((_, i) => i !== index))}
    activeLabLayout={DEFAULT_LAB_PAGE_LAYOUTS['text-to-image']} mobileEditorTab="character" scopeKey={scope} />
    <output data-testid="characters">{JSON.stringify(characters)}</output></>;
};
const rows = () => JSON.parse(screen.getByTestId('characters').textContent!) as CharacterParams[];
const deferred = () => { let resolve!: (value: ImageTaggerResult) => void; const promise = new Promise<ImageTaggerResult>(done => { resolve = done; }); return { promise, resolve }; };

describe('角色就地粘贴反推', () => {
  it('反推期间调整角色顺序，参考图和迟到结果仍跟随原角色 ID', async () => {
    const job = deferred(); vi.mocked(imageTaggerService.tagFile).mockReturnValueOnce(job.promise);
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: '粘贴反推' })[1]);
    await waitFor(() => expect(imageTaggerService.tagFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '上移角色 2' }));
    expect(rows().map(character => character.id)).toEqual(['b', 'a']);
    await act(async () => job.resolve(result));
    expect(rows()).toEqual([{ ...initial[1], prompt: 'red hair, looking at viewer, sitting' }, initial[0]]);
    expect(screen.getByAltText('反推参考图')).toBeTruthy();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('一次点击直接追加到对应角色，保留其他角色、负面词和坐标，沿用模型默认阈值', async () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: '粘贴反推' })[1]);
    await waitFor(() => expect(rows()[1].prompt).toBe('red hair, looking at viewer, sitting'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(imageTaggerService.tagFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'image/png' }));
    expect(rows()[0]).toEqual(initial[0]);
    expect(rows()[1]).toEqual({ ...initial[1], prompt: 'red hair, looking at viewer, sitting' });
    expect(screen.getByText('已追加 2 个 Tag').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('识别期间编辑词并删除前一个角色，结果使用最新内容和角色位置', async () => {
    const job = deferred(); vi.mocked(imageTaggerService.tagFile).mockReturnValueOnce(job.promise);
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: '粘贴反推' })[1]);
    await waitFor(() => expect(imageTaggerService.tagFile).toHaveBeenCalled());
    fireEvent.change(screen.getAllByPlaceholderText('角色提示词')[1], { target: { value: 'new clothes' } });
    fireEvent.click(screen.getAllByRole('button', { name: '移除角色提示词' })[0]);
    await act(async () => job.resolve(result));
    expect(rows()).toEqual([{ ...initial[1], prompt: 'new clothes, looking at viewer, sitting' }]);
  });

  it('目标角色删除后丢弃迟到结果，不会追加到补位角色', async () => {
    const job = deferred(); vi.mocked(imageTaggerService.tagFile).mockReturnValueOnce(job.promise);
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: '粘贴反推' })[0]);
    await waitFor(() => expect(imageTaggerService.tagFile).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: '移除角色提示词' })[0]);
    await act(async () => job.resolve(result));
    expect(rows()).toEqual([initial[1]]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference');
  });

  it('切换模式即使角色 ID 相同，也清掉临时图并拒绝旧模式结果', async () => {
    const job = deferred(); vi.mocked(imageTaggerService.tagFile).mockReturnValueOnce(job.promise);
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: '粘贴反推' })[0]);
    await waitFor(() => expect(imageTaggerService.tagFile).toHaveBeenCalled());
    rerender(<Harness scope="outpaint" />);
    await act(async () => job.resolve(result));
    expect(rows()).toEqual(initial);
    expect(screen.queryByAltText('反推参考图')).toBeNull();
  });

  it('缩略图可放大并独立返回，移除图片保留已追加提示词', async () => {
    const underlyingEscape = vi.fn(); window.addEventListener('keydown', underlyingEscape);
    try {
      render(<Harness />);
      fireEvent.click(screen.getAllByRole('button', { name: '粘贴反推' })[0]);
      await waitFor(() => expect(rows()[0].prompt).toContain('sitting'));
      expect(screen.getByAltText('反推参考图').getAttribute('data-safe-mode-ignore')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '放大反推参考图' }));
      expect(screen.getByRole('dialog', { name: '反推参考图' })).toBeTruthy();
      expect(screen.getByAltText('反推参考图大图').getAttribute('data-safe-mode-ignore')).toBe('true');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(underlyingEscape).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '放大反推参考图' }));
      fireEvent.click(screen.getByRole('button', { name: '返回角色编辑' }));
      const saved = rows();
      fireEvent.click(screen.getByRole('button', { name: '移除反推参考图' }));
      expect(rows()).toEqual(saved);
      expect(screen.queryByAltText('反推参考图')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference');
    } finally { window.removeEventListener('keydown', underlyingEscape); }
  });

  it('按钮上的键盘粘贴不会冒泡成编辑底图导入，普通文字保持原行为', async () => {
    const pasteBase = vi.fn(), append = vi.fn();
    render(<div onPaste={pasteBase}><CharacterTaggerReference canEdit onAppend={append} /></div>);
    const button = screen.getByRole('button', { name: '粘贴反推' });
    fireEvent.paste(button, { clipboardData: { files: [image] } });
    await waitFor(() => expect(append).toHaveBeenCalledWith('looking at viewer, sitting'));
    expect(pasteBase).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    fireEvent.paste(button, { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/plain' }] } });
    expect(pasteBase).toHaveBeenCalledOnce();
  });

  it('无图片与读取权限失败不调用识别，提示对应角色入口', async () => {
    read.mockResolvedValueOnce([{ types: ['text/plain'] }]);
    render(<CharacterTaggerReference canEdit onAppend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '粘贴反推' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不能作为反推参考'));
    read.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    fireEvent.click(screen.getByRole('button', { name: '粘贴反推' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('在「粘贴反推」按钮上按 Ctrl+V'));
    expect(imageTaggerService.tagFile).not.toHaveBeenCalled();
  });

  it('模型错误显示真实原因，不追加也不自动重试', async () => {
    vi.mocked(imageTaggerService.tagFile).mockRejectedValueOnce(new Error('模型下载失败：连接超时'));
    const append = vi.fn(); render(<CharacterTaggerReference canEdit onAppend={append} />);
    fireEvent.click(screen.getByRole('button', { name: '粘贴反推' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('模型下载失败：连接超时'));
    expect(append).not.toHaveBeenCalled(); expect(imageTaggerService.tagFile).toHaveBeenCalledOnce();
    expect(screen.getByAltText('反推参考图')).toBeTruthy();
  });

  it('读取期间重复点击与编辑禁用后返回的结果不会提交', async () => {
    const job = deferred(); vi.mocked(imageTaggerService.tagFile).mockReturnValueOnce(job.promise);
    const append = vi.fn(); const { rerender } = render(<CharacterTaggerReference canEdit onAppend={append} />);
    fireEvent.click(screen.getByRole('button', { name: '粘贴反推' }));
    fireEvent.click(screen.getByRole('button', { name: '反推中…' }));
    await waitFor(() => expect(imageTaggerService.tagFile).toHaveBeenCalledOnce());
    rerender(<CharacterTaggerReference canEdit={false} onAppend={append} />);
    await act(async () => job.resolve(result));
    expect(append).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('未写入角色提示词');
    expect((screen.getByRole('button', { name: '粘贴反推' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
