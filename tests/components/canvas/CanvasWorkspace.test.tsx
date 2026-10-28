// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasWorkspace } from '../../../components/canvas/CanvasWorkspace';
import { deleteCanvasProject, listCanvasProjects, loadCanvasProject, saveCanvasProject } from '../../../services/canvasStore';
import { renderProject } from '../../../services/canvasEngine';
import { IMPORT_SESSION_KEY } from '../../../services/metadataService';
import type { CanvasProject } from '../../../services/canvasTypes';

vi.mock('../../../services/canvasStore', () => ({ listCanvasProjects: vi.fn(), loadCanvasProject: vi.fn(), saveCanvasProject: vi.fn(), deleteCanvasProject: vi.fn(), exportCanvasProject: vi.fn(), importCanvasProject: vi.fn() }));
vi.mock('../../../services/canvasEngine', () => ({ renderProject: vi.fn(async () => document.createElement('canvas')), applyBrush: vi.fn(), copyCanvasSelection: vi.fn(), createImageLayer: vi.fn(), cropCanvasProject: vi.fn(), cropImageLayer: vi.fn(), hitCanvasLayer: vi.fn(), layerToProject: vi.fn(), projectToLayer: vi.fn() }));
vi.mock('../../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const project: CanvasProject = { version: 1, id: 'saved', name: '已存作品', width: 800, height: 600, background: { kind: 'color', color: '#ffffff' }, layers: [], updatedAt: 1 };
const mount = (confirmClose: () => Promise<boolean> = async () => false) => render(<CanvasWorkspace active notify={vi.fn()} onSendToLab={vi.fn()} confirmClose={confirmClose} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveCanvasProject).mockResolvedValue();
  vi.mocked(deleteCanvasProject).mockResolvedValue();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
});
afterEach(() => { cleanup(); sessionStorage.removeItem(IMPORT_SESSION_KEY); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('画布合成图送往实验室', () => {
  it.each([
    ['图生图', 'image-to-image'],
    ['局部重绘', 'inpaint'],
    ['扩图', 'outpaint'],
  ] as const)('选择%s后先准备合成底图，再投递目标模式并导航，不发送生图请求', async (label, mode) => {
    vi.mocked(listCanvasProjects).mockResolvedValue([{ id: project.id, name: project.name, updatedAt: project.updatedAt }]);
    vi.mocked(loadCanvasProject).mockResolvedValue(project);
    const png = new Blob(['synthetic composite'], { type: 'image/png' });
    const objectUrl = 'blob:canvas-composite';
    const createObjectURL = vi.fn(() => objectUrl);
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; });
    const fetchRequest = vi.fn(async () => { throw new Error('此操作不应发送网络请求'); });
    vi.stubGlobal('fetch', fetchRequest);
    let completeImage!: BlobCallback;
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { completeImage = callback; });
    let receivedOnNavigate: unknown;
    const navigate = vi.fn(() => { receivedOnNavigate = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!); });
    const notify = vi.fn();
    render(<CanvasWorkspace active notify={notify} onSendToLab={navigate} confirmClose={async () => false} />);

    await screen.findByRole('button', { name: '送往实验室' });
    await act(async () => { screen.getByRole('button', { name: '送往实验室' }).click(); });
    await act(async () => { screen.getByRole('button', { name: label }).click(); });
    await waitFor(() => expect(encode).toHaveBeenCalled());
    expect(renderProject).toHaveBeenCalledWith(project);
    expect(encode.mock.calls[0][1]).toBe('image/png');
    expect(sessionStorage.getItem(IMPORT_SESSION_KEY)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    // 只模拟像素编码；投递 sessionStorage 和导航顺序使用组件的真实行为。
    await act(async () => { completeImage(png); });
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(png);
    expect(navigate).toHaveBeenCalledOnce();
    const expected = { mode: 'base-image', origin: 'canvas', imageEditOperation: mode, baseImageUrl: objectUrl };
    expect(receivedOnNavigate).toEqual(expected);
    expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toEqual(expected);
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('画布工程读取和切换', () => {
  it('列表与工程读取均完成前不开放编辑', async () => {
    const listing = deferred<{ id: string; name: string; updatedAt: number }[]>();
    const loading = deferred<CanvasProject>();
    vi.mocked(listCanvasProjects).mockReturnValue(listing.promise);
    vi.mocked(loadCanvasProject).mockReturnValue(loading.promise);
    mount();
    expect(screen.getByRole('status').textContent).toContain('正在读取');
    expect(screen.queryByRole('button', { name: '新建工程' })).toBeNull();
    await act(async () => listing.resolve([{ id: project.id, name: project.name, updatedAt: project.updatedAt }]));
    expect(loadCanvasProject).toHaveBeenCalledWith('saved');
    expect(screen.queryByRole('button', { name: '新建工程' })).toBeNull();
    expect(saveCanvasProject).not.toHaveBeenCalled();
    await act(async () => loading.resolve(project));
    expect(screen.getByLabelText('工程名称')).toHaveProperty('value', '已存作品');
    expect(screen.getByRole('button', { name: '新建工程' })).toBeTruthy();
  });

  it('读取失败不自动保存，重试成功才允许编辑', async () => {
    vi.mocked(listCanvasProjects).mockRejectedValueOnce(new Error('服务不可用')).mockResolvedValueOnce([]);
    mount();
    await screen.findByText(/服务不可用/);
    expect(screen.queryByRole('button', { name: '新建工程' })).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(saveCanvasProject).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: '重试' }).click(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '新建工程' })).toBeTruthy());
    expect(listCanvasProjects).toHaveBeenCalledTimes(2);
  });

  it('切换保存期间禁用工程控件，重复点击不开始第二次更改', async () => {
    vi.mocked(listCanvasProjects).mockResolvedValue([]);
    const saving = deferred<void>();
    vi.mocked(saveCanvasProject).mockReturnValueOnce(saving.promise);
    mount();
    const newButton = await screen.findByRole('button', { name: '新建工程' });
    await act(async () => { newButton.click(); });
    await act(async () => { screen.getByRole('button', { name: '新建' }).click(); });
    await waitFor(() => expect(saveCanvasProject).toHaveBeenCalledTimes(1));
    const fieldset = newButton.closest('fieldset')!;
    expect(fieldset.disabled).toBe(true);
    expect((fieldset.querySelector('input[aria-label="工程名称"]') as HTMLElement).matches(':disabled')).toBe(true);
    await act(async () => { newButton.click(); screen.getByRole('button', { name: '打开画布' }).click(); });
    expect(saveCanvasProject).toHaveBeenCalledTimes(1);
    await act(async () => saving.resolve());
    await waitFor(() => expect(fieldset.disabled).toBe(false));
  });

  it('取消关闭不删除；确认后等待保存队列、关闭当前工程并切换，旧自动保存不会复活工程', async () => {
    const other = { ...project, id: 'other', name: '另一作品' };
    const projects = [project, other].map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    vi.mocked(listCanvasProjects).mockResolvedValue(projects);
    vi.mocked(loadCanvasProject).mockImplementation(async id => id === project.id ? project : other);
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { container } = mount(confirm);
    const open = await screen.findByRole('button', { name: '打开画布' });
    await act(async () => { open.click(); });
    const close = await screen.findByRole('button', { name: '关闭画布 已存作品' });
    await act(async () => { close.click(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteCanvasProject).not.toHaveBeenCalled();

    const saving = deferred<void>();
    vi.mocked(saveCanvasProject).mockReturnValueOnce(saving.promise);
    await waitFor(() => expect(saveCanvasProject).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await act(async () => { close.click(); });
    await waitFor(() => expect(loadCanvasProject).toHaveBeenCalledWith('other'));
    expect(deleteCanvasProject).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    await waitFor(() => expect(deleteCanvasProject).toHaveBeenCalledExactlyOnceWith('saved'));
    await waitFor(() => expect((container.querySelector('input[aria-label="工程名称"]') as HTMLInputElement).value).toBe('另一作品'));
    const oldCount = vi.mocked(saveCanvasProject).mock.calls.filter(([snapshot]) => snapshot.id === 'saved').length;
    await waitFor(() => expect(vi.mocked(saveCanvasProject).mock.calls.some(([snapshot]) => snapshot.id === 'other')).toBe(true), { timeout: 2000 });
    expect(vi.mocked(saveCanvasProject).mock.calls.filter(([snapshot]) => snapshot.id === 'saved')).toHaveLength(oldCount);
  });
});
