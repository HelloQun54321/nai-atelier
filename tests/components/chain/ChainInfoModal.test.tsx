// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../../types';
import { ChainInfoModal } from '../../../components/chain/ChainInfoModal';

const chain: PromptChain = {
  id: 'synthetic', userId: 'test', type: 'style', name: '原名称', description: '原描述', tags: ['待实测'],
  basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', modules: [], previewImage: '/synthetic.png',
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 4 }, createdAt: 1, updatedAt: 1,
};
const callbacks = () => ({ onSave: vi.fn(), onClose: vi.fn(), notify: vi.fn() });
afterEach(cleanup);

describe('卡片信息编辑', () => {
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
    render(<ChainInfoModal chain={chain} {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.submit(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(p.onSave).toHaveBeenCalledOnce(); expect(p.onClose).not.toHaveBeenCalled();
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
