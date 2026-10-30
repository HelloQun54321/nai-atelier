// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceBackgroundEditor } from '../../components/AppearanceBackgroundEditor';
import { normalizeThemeBackground, prepareThemeBackground } from '../../services/themeBackground';

vi.mock('../../services/themeBackground', async original => ({ ...await original<typeof import('../../services/themeBackground')>(), prepareThemeBackground: vi.fn() }));
const background = normalizeThemeBackground({ image: 'data:image/png;base64,AAAA' })!;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('工作区背景设置', () => {
  it('上传后提交背景，读取失败保留当前图片，存储失败显示错误', async () => {
    const onChange = vi.fn(() => true);
    render(<AppearanceBackgroundEditor onChange={onChange} />);
    const file = new File(['image'], 'test.png', { type: 'image/png' });
    vi.mocked(prepareThemeBackground).mockResolvedValueOnce(background);
    fireEvent.change(screen.getByLabelText('选择背景图片'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(background));
    onChange.mockReturnValue(false);
    vi.mocked(prepareThemeBackground).mockResolvedValueOnce(background);
    fireEvent.change(screen.getByLabelText('选择背景图片'), { target: { files: [file] } });
    await screen.findByText('外观存储空间不足，请缩小背景或减少已保存的主题');
    vi.mocked(prepareThemeBackground).mockRejectedValueOnce(Error('无法读取背景图片，请检查文件'));
    fireEvent.change(screen.getByLabelText('选择背景图片'), { target: { files: [file] } });
    await screen.findByText('无法读取背景图片，请检查文件');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('显示方式、强度、图案大小和恢复默认分别写回', () => {
    const onChange = vi.fn(() => true);
    const view = render(<AppearanceBackgroundEditor background={{ ...background, fit: 'tile' }} onChange={onChange} />);
    const preview = view.container.querySelector<HTMLElement>('.theme-background-preview')!;
    expect(preview.style.backgroundImage).toContain(background.image);
    expect(preview.parentElement?.style.filter).toBe('');
    fireEvent.change(screen.getByLabelText('背景显示方式'), { target: { value: 'contain' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...background, fit: 'contain' });
    fireEvent.change(screen.getByLabelText('背景显示强度'), { target: { value: '40' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...background, fit: 'tile', opacity: .4 });
    fireEvent.change(screen.getByLabelText('图案大小'), { target: { value: '256' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...background, fit: 'tile', tileSize: 256 });
    fireEvent.click(screen.getByText('移除背景图片'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
  it('设置预览用完整显示看清原图，铺满只影响工作区实际背景', () => {
    const view = render(<AppearanceBackgroundEditor background={{ ...background, fit: 'cover' }} onChange={() => true} />);
    const frame = view.container.querySelector('.theme-background-preview')!.parentElement!;
    expect(frame.className).toContain('aspect-video');
    expect(frame.className).toContain('max-h-56');
    expect(view.container.querySelector<HTMLElement>('.theme-background-preview')!.style.backgroundSize).toBe('auto, contain');
    view.rerender(<AppearanceBackgroundEditor background={{ ...background, fit: 'tile', tileSize: 64 }} onChange={() => true} />);
    expect(view.container.querySelector<HTMLElement>('.theme-background-preview')!.style.backgroundSize).toBe('auto, 64px auto');
  });
  it('关闭设置后迟到的解码不能覆盖后来选用的主题', async () => {
    let resolve!: (value: typeof background) => void;
    vi.mocked(prepareThemeBackground).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const onChange = vi.fn(() => true);
    const view = render(<AppearanceBackgroundEditor onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('选择背景图片'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    view.unmount(); resolve(background); await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('切换背景明暗版本取消旧图片处理，保留展开状态并显示恢复默认入口', async () => {
    let resolve!: (value: typeof background) => void;
    vi.mocked(prepareThemeBackground).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const onChange = vi.fn(() => true), onModeChange = vi.fn(), onReset = vi.fn();
    const view = render(<AppearanceBackgroundEditor mode="light" onModeChange={onModeChange} onReset={onReset} onChange={onChange} />);
    view.container.querySelector('details')!.open = true;
    fireEvent.change(screen.getByLabelText('选择背景图片'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('tab', { name: '深色背景' })); expect(onModeChange).toHaveBeenCalledWith('dark');
    view.rerender(<AppearanceBackgroundEditor mode="dark" onModeChange={onModeChange} onReset={onReset} onChange={onChange} />);
    resolve(background); await Promise.resolve(); expect(onChange).not.toHaveBeenCalled();
    expect(view.container.querySelector('details')!.open).toBe(true);
    fireEvent.click(screen.getByText('恢复默认背景')); expect(onReset).toHaveBeenCalledTimes(1);
  });
});
