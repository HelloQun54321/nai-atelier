// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LibraryDialog, PromptLibraryChooser, PromptLibraryContext, PromptLibraryRequestEnabledContext, PromptLibraryWorkspace } from '../../components/PromptLibraryAccess';
import { ImageActivityProvider } from '../../components/SmartImage';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { PromptChain } from '../../types';

afterEach(cleanup);
it('在取用弹窗标题栏下沿显示当前可选条目数', async () => {
  const entry = { id: 'entry', type: 'appearance', name: '银发', basePrompt: 'silver hair', params: {}, tags: [] } as unknown as PromptChain;
  render(<PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn() }}>
    <PromptLibraryChooser value="" onText={vi.fn()} onClose={vi.fn()} />
  </PromptLibraryContext.Provider>);
  const caption = await screen.findByText('共 1 条');
  expect(caption.getAttribute('data-toolbar-count-caption')).toBe('true');
  expect(caption.closest('header')).not.toBeNull();
});

it('切换到其他页面时隐藏取用弹窗并释放 Escape，回来保留草稿', () => {
  const close = vi.fn();
  const view = (active: boolean) => <ImageActivityProvider active={active}><LibraryDialog title="取用提示词" onClose={close}><input aria-label="草稿" defaultValue="选择中的内容" /></LibraryDialog></ImageActivityProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByRole('dialog')).toBeTruthy();
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '修改中的内容' } });
  rerender(view(false));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  rerender(view(true));
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('修改中的内容');
});
it('从库页取用原文写入当前实验室，保留原文与生成参数，隐藏工作区不消费请求', async () => {
  const entry = { id: 'raw', ...prepareCollectedPrompt('  {{snow}}\r\nnight  ', '雪夜') } as PromptChain;
  const changed = vi.fn(), hidden = vi.fn();
  function Harness() {
    const [request, setRequest] = useState<PromptChain | null>(entry);
    const state = { params: { ...LAB_DEFAULT_PARAMS, seed: 37 }, base: 'artist', subject: '', negative: 'lowres', classified: false };
    return <PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn(), requestedEntry: request, clearRequest: () => setRequest(null) }}>
      <PromptLibraryRequestEnabledContext.Provider value={false}><PromptLibraryWorkspace state={state} onChange={hidden}><span>隐藏</span></PromptLibraryWorkspace></PromptLibraryRequestEnabledContext.Provider>
      <PromptLibraryRequestEnabledContext.Provider value><PromptLibraryWorkspace state={state} onChange={changed}><span>当前</span></PromptLibraryWorkspace></PromptLibraryRequestEnabledContext.Provider>
    </PromptLibraryContext.Provider>;
  }
  render(<Harness />);
  await screen.findByRole('dialog', { name: '取用提示词' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '取用' }));
  expect(changed).toHaveBeenCalledOnce(); expect(changed.mock.calls[0][0].base).toBe('artist,   {{snow}}\r\nnight  ');
  expect(changed.mock.calls[0][0].params.seed).toBe(37); expect(hidden).not.toHaveBeenCalled();
});

it('角色入口取用组合仅写指定角色，包含负面与可撤销快照', async () => {
  const entry = { id: 'combo', ...createCombinationData('白裙', { wardrobe: { kind: 'wardrobe', text: 'white dress', negative: 'red dress', filled: true }, scene: { kind: 'scene', text: 'rain', filled: true } }) } as PromptChain;
  const changed = vi.fn();
  const before = { params: { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'one', prompt: 'one', x: 0.2, y: 0.5 }, { id: 'two', prompt: 'two', x: 0.8, y: 0.5 }] }, base: 'artist', subject: 'sunny', negative: '', classified: true };
  function Harness() { const [state, setState] = useState(before); return <PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn() }}><PromptLibraryWorkspace state={state} onChange={next => { changed(next); setState(next as typeof before); }}><PromptLibraryChooser initialEntry={entry} value="two" field={{ roleId: 'two' }} onText={vi.fn()} onClose={vi.fn()} /></PromptLibraryWorkspace></PromptLibraryContext.Provider>; }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '取用' }));
  expect(changed.mock.calls[0][0].params.characters[0]).toEqual(before.params.characters[0]);
  expect(changed.mock.calls[0][0].params.characters[1].sections.wardrobe).toBe('white dress');
  expect(changed.mock.calls[0][0].params.characters[1].sectionNegatives.wardrobe).toBe('red dress');
  expect(changed.mock.calls[0][0].subject).toBe('sunny');
  fireEvent.click(screen.getByRole('button', { name: '撤销上次填入' }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(before));
});
