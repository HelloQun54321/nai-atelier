// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ConfirmDialogOptions } from '../../components/ConfirmDialog';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecycleBinPanel, formatHistoryBinReasons } from '../../components/RecycleBinPanel';
import { HistoryImageViewer } from '../../components/HistoryImageViewer';
import { downloadFile } from '../../services/fileDownload';
import { localHistory, type LocalHistoryOperationResult, type LocalHistoryRecycleBinItem } from '../../services/localHistory';

const { confirmAction, listeners } = vi.hoisted(() => ({ confirmAction: vi.fn<(options: ConfirmDialogOptions) => Promise<boolean>>(async () => false), listeners: new Set<(event: { type: string }) => void>() }));
vi.mock('../../services/fileDownload', () => ({ downloadFile: vi.fn(async () => ({ saved: true, cancelled: false })) }));
vi.mock('../../services/exportLocation', () => ({ beginExportTarget: () => ({}) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getRecycleBinPage: vi.fn(), getRecycleBinItem: vi.fn(), restoreFromRecycleBin: vi.fn(), purgeRecycleBin: vi.fn(), getBrowserMigrationRecoveryMask: vi.fn(), getRecycleBinEditMask: vi.fn(), subscribe: (listener: (event: { type: string }) => void) => { listeners.add(listener); return () => listeners.delete(listener); } } }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ src, alt, className }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} className={className} />, OriginalImage: ({ src, alt, className, onLoad, onError, style }: React.ImgHTMLAttributes<HTMLImageElement>) => <img src={src} alt={alt} className={className} onLoad={onLoad} onError={onError} style={style} /> }));
vi.mock('../../components/ParamsViewer', () => ({ ParamsViewer: (props: { prompt: string; negativePrompt: string; params: unknown; edit: unknown }) => <div data-testid="full-params">{JSON.stringify(props)}</div> }));
vi.mock('../../services/collectionFavorites', () => ({ collectionTargetActive: () => false, subscribeCollection: () => () => {}, collectionRevision: () => 0, ensureCollection: vi.fn(async () => []), toggleCollectionTarget: vi.fn() }));

const makeItem = (id: number): LocalHistoryRecycleBinItem => ({ id: `bin-${id}`, version: `v${id}`, imageUrl: `/api/local-history/recycle-bin/bin-${id}/image`, prompt: `full prompt ${id}`, negativePrompt: `negative ${id}`, params: { width: 832, height: 1216, seed: id, steps: 28, scale: 5, sampler: 'k_euler' }, createdAt: id, movedAt: 100 + id, basePrompt: 'base', subjectPrompt: 'subject', modules: [] });
const items = [makeItem(1), makeItem(2)];
const receipt = (completedIds: string[], operation: 'restore' | 'purge' = 'restore', skipped: { id: string; reasons: string[] }[] = []): LocalHistoryOperationResult => ({ operation, requestedCount: completedIds.length + skipped.length, completedCount: completedIds.length, completedIds, skippedCount: skipped.length, skipped, failedCount: 0, failed: [], warnings: [], movedCount: 0, restoredCount: operation === 'restore' ? completedIds.length : 0, purgedCount: operation === 'purge' ? completedIds.length : 0, success: !skipped.length, ok: !skipped.length, outcome: skipped.length ? 'partial' : 'success', partial: Boolean(skipped.length), deletedCount: completedIds.length });
beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
    vi.mocked(localHistory.getBrowserMigrationRecoveryMask).mockResolvedValue(new Blob(['synthetic mask'], { type: 'image/png' }));
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 767px)' && window.innerWidth < 768, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.mocked(localHistory.getRecycleBinPage).mockResolvedValue({ items, count: items.length });
    vi.mocked(localHistory.getRecycleBinItem).mockImplementation(async id => items.find(item => item.id === id) || null);
    vi.mocked(localHistory.restoreFromRecycleBin).mockResolvedValue(receipt(['bin-1']));
    vi.mocked(localHistory.purgeRecycleBin).mockResolvedValue(receipt(['bin-1'], 'purge'));
    confirmAction.mockResolvedValue(false);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = async () => { const notify = vi.fn(); const view = render(<RecycleBinPanel onBack={vi.fn()} notify={notify} />); await screen.findByRole('checkbox', { name: '选择回收站图片 bin-1' }); return { ...view, notify }; };

it('原图详情完整传递 prompt/negative/params/edit，列表和详情均无收藏写入口', async () => {
    await setup();
    expect(localHistory.getRecycleBinPage).toHaveBeenCalledWith(0, 60);
    expect(screen.queryByRole('button', { name: '收藏' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看回收站图片 bin-1' }));
    const dialog = await screen.findByRole('dialog', { name: '历史图片查看器' });
    expect(within(dialog).queryByRole('button', { name: '收藏' })).toBeNull();
    expect(within(dialog).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(items[0].imageUrl);
    expect(screen.getByTestId('full-params').textContent).toContain('full prompt 1');
    expect(screen.getByTestId('full-params').textContent).toContain('negative 1');
    expect(within(dialog).getByText('结构化提示词')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '恢复' })).toBeTruthy();
});

it('批量恢复仅移出completedIds，冲突条目保留选择与数量并携带冻结版本', async () => {
    vi.mocked(localHistory.restoreFromRecycleBin).mockResolvedValue(receipt(['bin-1'], 'restore', [{ id: 'bin-2', reasons: ['id_conflict'] }]));
    const { notify } = await setup();
    expect(screen.queryByRole('button', { name: '全选已加载' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const menu = screen.getByRole('dialog', { name: '更多操作' });
    fireEvent.click(within(menu).getByRole('button', { name: '全选已加载' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复选中' }));
    await waitFor(() => expect(localHistory.restoreFromRecycleBin).toHaveBeenCalledWith(['bin-1', 'bin-2'], { 'bin-1': 'v1', 'bin-2': 'v2' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '选择回收站图片 bin-1' })).toBeNull());
    expect((screen.getByRole('checkbox', { name: '选择回收站图片 bin-2' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('status', { name: '已选 1 张' })).toBeTruthy();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('已保留两份资料'), 'error');
});

it('purge每次独立不可逆确认且取消零写入，确认等待期间不替换冻结版本', async () => {
    await setup();
    fireEvent.click(screen.getAllByRole('button', { name: '永久删除' })[0]);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
    expect(confirmAction.mock.calls[0][0]).not.toHaveProperty('rememberKey');
    expect(localHistory.purgeRecycleBin).not.toHaveBeenCalled();
    let confirm!: (value: boolean) => void;
    confirmAction.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    fireEvent.click(screen.getAllByRole('button', { name: '永久删除' })[0]);
    act(() => listeners.forEach(listener => listener({ type: 'move' })));
    await act(async () => confirm(true));
    expect(localHistory.purgeRecycleBin).toHaveBeenCalledWith(['bin-1'], { 'bin-1': 'v1' });
});

it('分页连续追加，详情下一张越过首批末尾且操作后定位邻图', async () => {
    const many = Array.from({ length: 61 }, (_, index) => makeItem(index + 1));
    vi.mocked(localHistory.getRecycleBinPage).mockImplementation(async page => ({ items: many.slice(page * 60, (page + 1) * 60), count: 61 }));
    vi.mocked(localHistory.getRecycleBinItem).mockImplementation(async id => many.find(item => item.id === id) || null);
    const { container } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '查看回收站图片 bin-60' }));
    const dialog = await screen.findByRole('dialog', { name: '历史图片查看器' });
    fireEvent.click(within(dialog).getByRole('button', { name: '下一张图片' }));
    await waitFor(() => expect(localHistory.getRecycleBinItem).toHaveBeenLastCalledWith('bin-61'));
    expect(container.querySelectorAll('[data-recycle-bin-id]')).toHaveLength(61);
    vi.mocked(localHistory.restoreFromRecycleBin).mockResolvedValue(receipt(['bin-61']));
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(within(dialog).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(many[59].imageUrl));
});

it('桌面显式刷新不打断当前选择，更新版本后允许重试', async () => {
    vi.stubGlobal('innerWidth', 1280);
    await setup(); fireEvent.click(screen.getByRole('checkbox', { name: '选择回收站图片 bin-1' }));
    expect(screen.getByLabelText('已加载 2 / 共 2')).toBeTruthy();
    act(() => listeners.forEach(listener => listener({ type: 'restore' })));
    expect(screen.getByText('回收站已变化，可刷新后重试；当前浏览与选择仍保留')).toBeTruthy();
    vi.mocked(localHistory.getRecycleBinPage).mockResolvedValue({ items: [{ ...items[0], version: 'v-new' }, items[1]], count: 2 });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '恢复选中' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '恢复选中' }));
    await waitFor(() => expect(localHistory.restoreFromRecycleBin).toHaveBeenCalledWith(['bin-1'], { 'bin-1': 'v-new' }));
});

it('无法读取不伪装空回收站，重试可恢复；未知版本阻止破坏性写入', async () => {
    vi.mocked(localHistory.getRecycleBinPage).mockRejectedValueOnce(new Error('synthetic read failure'));
    render(<RecycleBinPanel onBack={vi.fn()} notify={vi.fn()} />);
    await screen.findByRole('alert'); expect(screen.queryByText('回收站为空')).toBeNull();
    vi.mocked(localHistory.getRecycleBinPage).mockResolvedValue({ items: [{ ...items[0], version: '' }], count: 1 });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(await screen.findByRole('button', { name: '永久删除' }));
    expect(confirmAction).not.toHaveBeenCalled(); expect(localHistory.purgeRecycleBin).not.toHaveBeenCalled();
});

it('HistoryImageViewer新增hideFavorite/deleteLabel向后兼容且不留下通用收藏绕过', () => {
    const props = { item: items[0], index: 0, total: 1, navigating: false, favoritePending: false, detailsOpen: true, onDetailsChange: vi.fn(), onNavigate: vi.fn(), onClose: vi.fn(), onFavorite: vi.fn(async () => {}), onDelete: vi.fn(), filename: 'test.png', notify: vi.fn(), children: null };
    const view = render(<HistoryImageViewer {...props} />);
    expect(screen.getByRole('button', { name: '收藏' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除这张历史图片' })).toBeTruthy();
    view.rerender(<HistoryImageViewer {...props} hideFavorite deleteLabel="永久删除" />);
    expect(screen.queryByRole('button', { name: '收藏' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '永久删除' })); expect(props.onDelete).toHaveBeenCalledOnce();
    expect(formatHistoryBinReasons(['reference_check_failed'])).toBe('无法确认引用关系，已保留原记录');
});

it('浏览器active与bin残留均只读浏览原图、完整参数与蒙版导出，重试不写入分叉', async () => {
    const active = { ...items[0], id: 'archive-active', imageUrl: 'data:image/png;base64,c3ludGhldGlj', edit: { operation: 'inpaint' as const, maskAvailable: true } };
    const bin = { ...items[1], id: 'archive-bin' };
    const retry = vi.fn(async () => {});
    render(<RecycleBinPanel onBack={vi.fn()} notify={vi.fn()} archive={{ error: 'migration failed', active: [active], bin: [bin] }} onRetryMigration={retry} />);
    await screen.findByRole('button', { name: '查看回收站图片 archive-active' });
    expect(screen.getByRole('button', { name: '查看回收站图片 archive-bin' })).toBeTruthy();
    expect(localHistory.getRecycleBinPage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '恢复选中' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看回收站图片 archive-active' }));
    const dialog = await screen.findByRole('dialog', { name: '历史图片查看器' });
    expect(within(dialog).queryByRole('button', { name: '永久删除' })).toBeNull(); expect(within(dialog).queryByRole('button', { name: '收藏' })).toBeNull();
    expect(within(dialog).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(active.imageUrl);
    fireEvent.click(within(dialog).getByRole('button', { name: '导出原蒙版' }));
    await waitFor(() => expect(localHistory.getBrowserMigrationRecoveryMask).toHaveBeenCalledWith('archive-active', false));
    expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), 'NAI-archive-active-mask.png', expect.anything());
    fireEvent.click(within(dialog).getByRole('button', { name: '返回历史列表' }));
    fireEvent.click(screen.getByRole('button', { name: '重试迁移' })); await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(localHistory.restoreFromRecycleBin).not.toHaveBeenCalled(); expect(localHistory.purgeRecycleBin).not.toHaveBeenCalled();
});

it('同ID的active/bin迁移冲突档案不互相覆盖，邻图与原蒙版来源保持独立', async () => {
    const active = { ...items[0], id: 'same-id', imageUrl: '/active-original.png', edit: { operation: 'inpaint' as const, maskAvailable: true } };
    const bin = { ...items[1], id: 'same-id', imageUrl: '/bin-original.png', edit: { operation: 'inpaint' as const, maskAvailable: true } };
    render(<RecycleBinPanel onBack={vi.fn()} notify={vi.fn()} archive={{ error: 'conflict', active: [active], bin: [bin] }} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '查看回收站图片 same-id' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: '查看回收站图片 same-id' })[0]);
    const viewer = await screen.findByRole('dialog', { name: '历史图片查看器' });
    expect(within(viewer).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(active.imageUrl);
    fireEvent.click(within(viewer).getByRole('button', { name: '下一张图片' }));
    await waitFor(() => expect(within(viewer).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(bin.imageUrl));
    expect(within(viewer).getByText('2 / 2')).toBeTruthy();
    fireEvent.click(within(viewer).getByRole('button', { name: '导出原蒙版' }));
    await waitFor(() => expect(localHistory.getBrowserMigrationRecoveryMask).toHaveBeenCalledWith('same-id', true));
    fireEvent.click(within(viewer).getByRole('button', { name: '上一张图片' }));
    await waitFor(() => expect(within(viewer).getByRole('img', { name: '历史生成图片预览' }).getAttribute('src')).toBe(active.imageUrl));
});

it('formatHistoryBinReasons 对封面引用展示具体条目类别与名称，非封面回落通用配方文案', () => {
    expect(formatHistoryBinReasons(['chain'])).toBe('创作配方仍在引用');
    expect(formatHistoryBinReasons(['chain'], [{ id: 'p1', name: '银发飘扬', type: 'appearance' }]))
        .toBe('已被用作封面（提示词库「银发飘扬」）');
    expect(formatHistoryBinReasons(['chain'], [
        { id: 'p1', name: '银发飘扬', type: 'appearance' },
        { id: 's1', name: '厚涂水彩', type: 'style' },
        { id: 'c1', name: '爱丽丝', type: 'character' },
        { id: 'p2', name: '夜景灯光', type: 'scene' },
    ])).toBe('已被用作封面（提示词库「银发飘扬」、风格串「厚涂水彩」、角色「爱丽丝」 等 4 项）');
});
