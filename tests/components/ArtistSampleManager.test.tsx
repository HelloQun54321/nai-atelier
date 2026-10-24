// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleManager } from '../../components/ArtistSampleManager';
import type { ArtistSampleStatus } from '../../services/artistSamples';

const mocks = vi.hoisted(() => ({ status: vi.fn(), control: vi.fn(), broadcast: vi.fn() }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, controlArtistSamplePack: mocks.control, broadcastArtistSamplesChanged: mocks.broadcast }));
vi.mock('../../services/platform', () => ({ isAndroidApp: () => false }));

const makeStatus = (patch: Partial<ArtistSampleStatus> = {}): ArtistSampleStatus => ({
  available: true, canManage: true,
  packs: [
    { id: 'v45', label: 'V4.5', filename: 'artist_thumbnail_nai', path: 'D:\\samples\\v45.json', phase: 'ready', progress: 100, processedBytes: 2_000_000, totalBytes: 2_000_000, count: 31000, revision: 'a', download: { stage: 'missing', receivedBytes: 0, totalBytes: 0 } },
    { id: 'v5', model: 'nai-diffusion-5-full', label: 'V5 Full', filename: 'V5 Full（7个图包）', path: '', phase: 'unconfigured', progress: 0, processedBytes: 0, totalBytes: 0, count: 0, revision: '', download: { stage: 'missing', receivedBytes: 0, totalBytes: 0 } },
  ], ...patch,
});

const FILES = [
  ['NAID5F-10000-Q', 1_373_203_772], ['NAID5F-20000-Q', 2_633_376_969],
  ['NAID5F-29000-E', 1_760_716_984], ['NAID5F-33000-Q', 4_622_809_235],
  ['NAID5F-44000-Q', 1_586_883_239], ['NAID5F-55000-Q', 3_194_676_902],
  ['NAID5-STYLISH-8000', 1_335_470_826],
] as const;
const makeFilesStatus = (): ArtistSampleStatus => {
  const value = makeStatus();
  value.packs[1] = { ...value.packs[1], phase: 'ready', managed: true, count: 12345, revision: 'partial-one',
    download: { stage: 'missing', receivedBytes: FILES[0][1], totalBytes: 16_507_137_927 },
    files: FILES.map(([filename, size], index) => ({ filename, size, active: index === 0,
      count: index === 0 ? 10000 : undefined, download: { stage: index === 0 ? 'ready' : 'missing', receivedBytes: index === 0 ? size : 0, totalBytes: size } })),
  };
  return value;
};
const openFiles = () => {
  const summary = screen.getByText('分别下载图包（7）');
  fireEvent.click(summary);
  // jsdom 不会执行 summary 的原生展开行为。
  summary.closest('details')!.open = true;
};
const fileRegion = (index: number) => within(screen.getByRole('region', { name: FILES[index][0] }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue(makeStatus());
  mocks.control.mockResolvedValue({ status: makeStatus() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([undefined, 'nai-diffusion-5-curated'])('旧V5来源%s不会显示Full可用或禁用新Full下载', async model => {
  const legacy = makeStatus(); legacy.packs[1] = { ...legacy.packs[1], model, phase: 'ready', filename: 'NAID5-33000-55000-Curated', managed: true, count: 22000, revision: 'legacy', download: { stage: 'missing', receivedBytes: 0, totalBytes: 16_507_137_927 } };
  mocks.status.mockResolvedValue(legacy); render(<ArtistSampleManager />);
  expect(await screen.findByText('当前图包未确认为 V5 Full，原文件已保留')).toBeTruthy(); expect(screen.getByText('NovelAI V5 Full')).toBeTruthy();
  expect(screen.queryByText('可用 · 22000 个画师 Tag')).toBeNull(); expect(screen.queryByRole('button', { name: '已下载' })).toBeNull();
  const download = screen.getByRole('button', { name: '下载图包 · 约 16.51 GB' }); expect((download as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(download); await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('download', 'v5'));
});

it('V5 Full 下载大小优先使用后台注册来源的总字节数', async () => {
  const next = makeStatus(); next.packs[1].download = { stage: 'missing', receivedBytes: 0, totalBytes: 4_000_000_000 };
  mocks.status.mockResolvedValue(next); render(<ArtistSampleManager />);
  expect(await screen.findByRole('button', { name: '下载图包 · 约 4.00 GB' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  expect(screen.getByText(/V5 Full（7个图包）/)).toBeTruthy();
});

it('七包Full的备用大小来自精确总字节，分组信息不误用单成员文件名', async () => {
  const ready = makeStatus(); ready.packs[1] = { ...ready.packs[1], phase: 'ready', path: 'D:\\samples\\NAID5F-55000-Q', managed: true };
  mocks.status.mockResolvedValue(ready); render(<ArtistSampleManager />);
  expect(await screen.findByRole('button', { name: '下载图包 · 约 16.51 GB' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  const info = screen.getByText(/V5 Full（7个图包）/);
  expect(info.textContent).toContain('Hugging Face · 约 16.51 GB'); expect(info.getAttribute('title')).toBe('D:\\samples\\NAID5F-55000-Q');
});

it('关联旧Curated仍ready时完成Full下载，来源切换也广播刷新Full目录', async () => {
  vi.useFakeTimers();
  const downloading = makeStatus(); downloading.packs[1] = { ...downloading.packs[1], model: 'nai-diffusion-5-curated', phase: 'ready', managed: true, revision: 'curated', download: { stage: 'downloading', receivedBytes: 500, totalBytes: 1000 } };
  const full = makeStatus(); full.packs[1] = { ...full.packs[1], phase: 'ready', managed: true, revision: 'full', count: 54880, download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 } };
  mocks.status.mockResolvedValueOnce(downloading).mockResolvedValue(full); render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('可用 · 54880 个画师 Tag')).toBeTruthy(); expect(mocks.broadcast).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: '已下载' }) as HTMLButtonElement).disabled).toBe(true);
});

it('直接下载V5调用后台而不是文件选择器；显示进度并支持暂停和继续', async () => {
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 410 * 1024 * 1024, totalBytes: 1000 * 1024 * 1024 },
  }] });
  const paused = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'paused', receivedBytes: 410 * 1024 * 1024, totalBytes: 1000 * 1024 * 1024 },
  }] });
  mocks.control.mockResolvedValueOnce({ status: downloading }).mockResolvedValueOnce({ status: paused }).mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  expect(await screen.findByText('可用 · 31000 个画师 Tag')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('download', 'v5'));
  expect(await screen.findByText(/已接收 410.0 MB \/ 1000.0 MB · 41%/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '暂停下载' }));
  await screen.findByRole('button', { name: '继续下载' });
  expect(mocks.control).toHaveBeenLastCalledWith('pause', 'v5');
  fireEvent.click(screen.getByRole('button', { name: '继续下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5'));
  expect(mocks.control).not.toHaveBeenCalledWith('pick', 'v5');
});

it('文件对话框取消不制造失败状态，也不会启动索引', async () => {
  mocks.control.mockResolvedValue({ cancelled: true, status: makeStatus() });
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 31000 个画师 Tag');
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  fireEvent.click(screen.getByRole('button', { name: '使用本地文件' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('pick', 'v5'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('未下载')).toBeTruthy();
});

it('索引失败就地显示原因，仍可重新索引或解除关联；解除关联只调用服务', async () => {
  mocks.status.mockResolvedValue(makeStatus({ packs: [
    { ...makeStatus().packs[0], phase: 'error', error: 'JSON 无法解析' }, makeStatus().packs[1],
  ] }));
  mocks.control.mockRejectedValueOnce(new Error('重新索引失败'));
  render(<ArtistSampleManager />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '重新建立索引' }));
  expect(await screen.findByText('重新索引失败')).toBeTruthy();
  expect((screen.getAllByRole('button', { name: '图包管理' })[0] as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '解除关联（不删文件）' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('remove', 'v45'));
});


it('下载失败说明原因并可重试', async () => {
  const failed = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'error', receivedBytes: 0, totalBytes: 1024, error: '下载校验失败' },
  }] });
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 0, totalBytes: 1024 },
  }] });
  mocks.control.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({ status: failed }).mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 31000 个画师 Tag');
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  expect(await screen.findByText('网络中断')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  expect(await screen.findByText('下载校验失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5'));
  expect(screen.getByRole('progressbar', { name: '图包下载进度' })).toBeTruthy();
});

it('校验期间仍可暂停，点击只调用后台pause', async () => {
  const verifying = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'verifying', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  mocks.status.mockResolvedValue(verifying);
  mocks.control.mockResolvedValue({ status: verifying });
  render(<ArtistSampleManager />);
  expect((await screen.findAllByText('正在校验图包…')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '暂停下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('pause', 'v5'));
  expect(mocks.control).not.toHaveBeenCalledWith('download', 'v5');
  expect(mocks.control).not.toHaveBeenCalledWith('pick', 'v5');
});

it('托管包索引失败时允许重试后台关联并恢复已下载状态', async () => {
  const brokenManaged = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], phase: 'error', error: '托管图包索引失败', managed: true,
    download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  const recovered = makeStatus({ packs: [makeStatus().packs[0], {
    ...brokenManaged.packs[1], phase: 'ready', error: undefined, progress: 100, count: 22000, revision: 'fixed',
  }] });
  mocks.status.mockResolvedValue(brokenManaged);
  mocks.control.mockResolvedValueOnce({ status: recovered });
  render(<ArtistSampleManager />);
  expect(await screen.findByText('托管图包索引失败')).toBeTruthy();
  const retry = screen.getAllByRole('button', { name: '重试下载' })[0];
  expect((retry as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('download', 'v5'));
  expect(await screen.findByRole('button', { name: '已下载' })).toBeTruthy();
});

it('后台下载完成后索引就绪，轮询期间发一次图库更新事件', async () => {
  vi.useFakeTimers();
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 500, totalBytes: 1000 },
  }] });
  const ready = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], phase: 'ready', progress: 100, count: 22000, revision: 'new', managed: true,
    download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  mocks.status.mockResolvedValueOnce(makeStatus()).mockResolvedValueOnce(ready);
  mocks.control.mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('可用 · 22000 个画师 Tag')).toBeTruthy();
  expect(mocks.broadcast).toHaveBeenCalledOnce();
});

it('状态轮询暂时失败会显示手动重试并继续按间隔读取，恢复后清除错误', async () => {
  vi.useFakeTimers();
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 500, totalBytes: 1000 },
  }] });
  const ready = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], phase: 'ready', progress: 100, count: 22000, revision: 'new', managed: true,
    download: { stage: 'ready', receivedBytes: 1000, totalBytes: 1000 },
  }] });
  mocks.status.mockResolvedValueOnce(makeStatus()).mockRejectedValueOnce(new Error('暂时无法读取状态')).mockResolvedValueOnce(ready);
  mocks.control.mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('暂时无法读取状态')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试读取状态' })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByText('暂时无法读取状态')).toBeNull();
  expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(mocks.broadcast).toHaveBeenCalledOnce();
});

it('卸载时中止在途下载状态轮询', async () => {
  vi.useFakeTimers();
  let pollSignal: AbortSignal | undefined;
  const downloading = makeStatus({ packs: [makeStatus().packs[0], {
    ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 5, totalBytes: 100 },
  }] });
  mocks.status.mockResolvedValueOnce(makeStatus()).mockImplementationOnce(signal => {
    pollSignal = signal;
    return new Promise(() => {});
  });
  mocks.control.mockResolvedValueOnce({ status: downloading });
  const view = render(<ArtistSampleManager />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('button', { name: /下载图包/ })[1]);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(pollSignal).toBeDefined();
  view.unmount();
  expect(pollSignal?.aborted).toBe(true);
});

it('设置只保留资源管理，下载时不误报尚未关联，维护按状态禁用', async () => {
  mocks.status.mockResolvedValue(makeStatus({ packs: [{ ...makeStatus().packs[1], download: { stage: 'downloading', receivedBytes: 5, totalBytes: 10 } }] }));
  render(<ArtistSampleManager />);
  await screen.findByText('图包下载中：50%');
  expect(screen.queryByText('样张配置')).toBeNull();
  expect(screen.queryByText('正向提示词')).toBeNull();
  expect(screen.queryAllByText('未下载')).toHaveLength(1);
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  expect((screen.getByRole('button', { name: '使用本地文件' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(true);
});
it('没有关联路径时禁用重新索引与解除关联，另一包下载时不能选择文件或解除关联', async () => {
  const value = makeStatus();
  value.packs[1].download = { stage: 'downloading', receivedBytes: 5, totalBytes: 10 };
  mocks.status.mockResolvedValue(value);
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 31000 个画师 Tag');
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[0]);
  expect((screen.getByRole('button', { name: '使用本地文件' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '解除关联（不删文件）' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(true);
});

it('V5在原行按需展开七个文件，使用实际文件名、体积及已接入计数', async () => {
  mocks.status.mockResolvedValue(makeFilesStatus());
  render(<ArtistSampleManager />);
  await screen.findByText('可用 · 12345 个画师 Tag');
  expect(screen.getByRole('button', { name: '全部下载 · 约 16.51 GB' })).toBeTruthy();
  expect(screen.getByText('分别下载图包（7）').closest('details')!.open).toBe(false);
  openFiles();
  for (let index = 0; index < FILES.length; index++) expect(fileRegion(index).getByText(FILES[index][0])).toBeTruthy();
  expect(fileRegion(0).getByText('1.37 GB · 已接入 · 10000 个画师 Tag')).toBeTruthy();
  expect((fileRegion(0).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect(fileRegion(6).getByText('1.34 GB · 未下载')).toBeTruthy();
  expect(fileRegion(6).getByRole('button').classList.contains('min-h-11')).toBe(true);
  expect(fileRegion(6).getByText(FILES[6][0]).classList.contains('break-all')).toBe(true);
  expect(screen.getByText('可用 · 31000 个画师 Tag')).toBeTruthy();
  expect(fileRegion(6).queryByRole('button', { name: /解除|删除/ })).toBeNull();
});

it('单片下载、暂停及继续精确传文件名，只有正在运行的片可暂停且保留已有可用来源', async () => {
  const initial = makeFilesStatus(), downloading = makeFilesStatus(), paused = makeFilesStatus();
  downloading.packs[1].files![6].download = { stage: 'downloading', receivedBytes: 100, totalBytes: FILES[6][1] };
  downloading.packs[1].path = 'D:\\samples\\NAID5F-10000-Q';
  paused.packs[1].files![6].download = { ...downloading.packs[1].files![6].download, stage: 'paused' };
  mocks.status.mockResolvedValue(initial);
  mocks.control.mockResolvedValueOnce({ status: downloading }).mockResolvedValueOnce({ status: paused }).mockResolvedValueOnce({ status: downloading });
  render(<ArtistSampleManager />);
  await screen.findByText('分别下载图包（7）'); openFiles();
  fireEvent.click(fileRegion(6).getByRole('button'));
  await waitFor(() => expect(fileRegion(6).getByRole('button').textContent).toBe('暂停下载'));
  expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5', FILES[6][0]);
  expect((fileRegion(1).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getAllByRole('button', { name: /下载图包 · 约/ })[0] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(fileRegion(1).getByRole('button')); expect(mocks.control).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole('button', { name: '图包管理' })[1]);
  expect((screen.getByRole('button', { name: '重新建立索引' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(fileRegion(6).getByRole('button'));
  await waitFor(() => expect(fileRegion(6).getByRole('button').textContent).toBe('继续下载'));
  expect(mocks.control).toHaveBeenLastCalledWith('pause', 'v5', FILES[6][0]);
  fireEvent.click(fileRegion(6).getByRole('button'));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5', FILES[6][0]));
  expect(screen.getByText('可用 · 12345 个画师 Tag')).toBeTruthy();
  expect(fileRegion(0).getByText(/已接入 · 10000/)).toBeTruthy();
});

it('全部下载及整体暂停保留两参数接口，逐片入口不会暂停其他文件', async () => {
  const downloading = makeFilesStatus();
  downloading.packs[1].download!.stage = 'downloading';
  downloading.packs[1].files![1].download.stage = 'verifying';
  mocks.status.mockResolvedValue(makeFilesStatus()); mocks.control.mockResolvedValue({ status: downloading });
  render(<ArtistSampleManager />);
  fireEvent.click(await screen.findByRole('button', { name: '全部下载 · 约 16.51 GB' }));
  await waitFor(() => expect(mocks.control).toHaveBeenCalledWith('download', 'v5'));
  openFiles();
  fireEvent.click(fileRegion(6).getByRole('button')); expect(mocks.control).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '暂停下载' }));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('pause', 'v5'));
  expect(fileRegion(1).getByText(/正在校验图包/)).toBeTruthy();
});

it('单片请求防重复且失败按文件保留，启动其他文件不清除该错误或已有来源', async () => {
  let rejectDownload!: (error: Error) => void;
  mocks.status.mockResolvedValue(makeFilesStatus());
  mocks.control.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject; })).mockResolvedValue({ status: makeFilesStatus() });
  render(<ArtistSampleManager />); await screen.findByText('分别下载图包（7）'); openFiles();
  fireEvent.click(fileRegion(6).getByRole('button'));
  fireEvent.click(fileRegion(6).getByRole('button')); fireEvent.click(fileRegion(1).getByRole('button'));
  expect(mocks.control).toHaveBeenCalledTimes(1);
  await act(async () => rejectDownload(new Error('STYLISH 网络中断')));
  expect(fileRegion(6).getByRole('alert').textContent).toBe('STYLISH 网络中断');
  expect(fileRegion(1).queryByRole('alert')).toBeNull();
  fireEvent.click(fileRegion(1).getByRole('button'));
  await waitFor(() => expect(mocks.control).toHaveBeenLastCalledWith('download', 'v5', FILES[1][0]));
  expect(fileRegion(6).getByRole('alert').textContent).toBe('STYLISH 网络中断');
  expect(screen.getByText('可用 · 12345 个画师 Tag')).toBeTruthy();
});

it('单片独立接入保持ready并改变revision时广播刷新，尚缺其他片可继续全部下载', async () => {
  vi.useFakeTimers();
  const downloading = makeFilesStatus(), ready = makeFilesStatus();
  downloading.packs[1].files![6].download.stage = 'downloading';
  ready.packs[1].files![6] = { ...ready.packs[1].files![6], active: true, count: 7742, download: { stage: 'ready', receivedBytes: FILES[6][1], totalBytes: FILES[6][1] } };
  ready.packs[1].count = 18000; ready.packs[1].revision = 'partial-stylish';
  ready.packs[1].download!.stage = 'ready';
  mocks.status.mockResolvedValueOnce(downloading).mockResolvedValue(ready);
  render(<ArtistSampleManager />); await act(async () => { await Promise.resolve(); }); openFiles();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('可用 · 18000 个画师 Tag')).toBeTruthy();
  expect(fileRegion(6).getByText('1.34 GB · 已接入 · 7742 个画师 Tag')).toBeTruthy();
  expect(mocks.broadcast).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: '全部下载 · 约 16.51 GB' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(mocks.status).toHaveBeenCalledTimes(2);
});

it('七片全部接入禁用下载；远端查看也禁用逐片操作', async () => {
  const allReady = makeFilesStatus();
  allReady.packs[1].files!.forEach(file => { file.active = true; file.download.stage = 'ready'; });
  mocks.status.mockResolvedValue(allReady);
  const view = render(<ArtistSampleManager />);
  expect((await screen.findByRole('button', { name: '已全部接入' }) as HTMLButtonElement).disabled).toBe(true);
  openFiles();
  expect((fileRegion(6).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  mocks.status.mockResolvedValue({ ...makeFilesStatus(), canManage: false });
  render(<ArtistSampleManager />); await screen.findByText('分别下载图包（7）'); openFiles();
  expect((fileRegion(6).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '图包管理' })).toBeNull();
});
