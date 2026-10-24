// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptTagLibraryInfo } from '../../components/PromptTagLibraryInfo';
import { ImageActivityContext } from '../../components/SmartImage';

const mocks = vi.hoisted(() => ({ data: vi.fn(), catalog: vi.fn(), supplement: vi.fn(), cover: vi.fn(), remove: vi.fn(), manage: vi.fn(), actions: vi.fn(), history: vi.fn(), index: vi.fn(), generated: [] as any[] }));
vi.mock('../../services/artistSampleGallery', async original => {
  const actual = await original<typeof import('../../services/artistSampleGallery')>();
  return { indexArtistSampleGallery: (...args: Parameters<typeof actual.indexArtistSampleGallery>) => { mocks.index(...args); return actual.indexArtistSampleGallery(...args); } };
});
vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (open: boolean, close: () => void) => { mocks.history(open); return close; } }));
vi.mock('../../components/DanbooruCover', () => ({ DanbooruCover: (props: any) => <div data-testid="character" data-tag={props.tag} data-kind={props.kind} /> }));
vi.mock('../../components/ArtistSampleCover', () => ({ ArtistSampleCover: (props: any) => { mocks.cover(props); return <><button onClick={() => props.onPackChange('v5')}>switch</button><button disabled={props.pending} onClick={props.onSupplement}>generate</button><span data-testid="own">{props.ownSamples.map((item: any) => item.id).join(',')}</span></>; } }));
vi.mock('../../components/useArtistSampleActions', () => ({
  useArtistSampleActions: (props: any) => { mocks.actions(props); return { requestingTarget: '', supplementSample: mocks.supplement, removeSample: mocks.remove, manageGeneration: mocks.manage, settingsDialog: <div data-testid="settings" /> }; },
  ArtistSampleGenerationStatus: () => <div data-testid="generation-status" />,
}));
vi.mock('../../services/artistSampleDrafts', () => ({ getArtistSampleData: mocks.data }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleDictionary: async () => [{ name: 'alpha artist', chinese: '', postCount: 2 }], getArtistSampleStatus: async () => ({ packs: [{ id: 'v45', phase: 'ready', revision: 'one' }, { id: 'v5', phase: 'ready', revision: 'two', model: 'nai-diffusion-5-full' }] }), getArtistSampleCatalog: mocks.catalog }));
vi.mock('../../services/artistSampleGeneration', () => ({ subscribeArtistSampleGeneration: () => () => {}, artistSampleGenerationRevision: () => 0, getArtistSampleGeneration: () => undefined, getGeneratedArtistSamples: () => mocks.generated, artistSampleGenerationBusy: () => false }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => [{ sourceType: 'artist', sourceId: 'alpha_artist', archived: false }], ensureCollection: async () => {}, subscribeCollection: () => () => {} }));
vi.mock('../../services/styleRollApi', () => ({ ROLL_BLOCKLIST_CHANGED: 'block-changed', loadRollBlocklist: async () => ['alpha_artist'], saveRollBlocklist: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.generated = [];
  mocks.data.mockResolvedValue({ templates: {}, samples: [{ id: 'own-one', tag: 'alpha_artist', pack: 'v45', createdAt: 1, params: { model: 'nai-diffusion-4-5-full' } }] });
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack === 'v45' ? 'one' : 'two', tags: ['alpha_artist'], ...(pack === 'v5' ? { model: 'nai-diffusion-5-full' } : {}) }));
});
afterEach(cleanup);

it('角色资料复用目录封面、保留真实名称，并且不读取画师数据', async () => {
  const close = vi.fn(); render(<PromptTagLibraryInfo target={{ kind: 'character', name: 'test_(series)', chinese: '角色甲', postCount: 23 }} onClose={close} />);
  expect((await screen.findByTestId('character')).dataset).toMatchObject({ kind: 'character', tag: 'test_(series)' });
  expect(screen.getByRole('heading').textContent).toBe('test_(series)'); expect(screen.getByText('角色甲')).toBeTruthy();
  expect(mocks.data).not.toHaveBeenCalled(); expect(mocks.supplement).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
});

it('画师复用真实动作、版本与自建样张，打开和切版均不自动生成', async () => {
  render(<PromptTagLibraryInfo target={{ kind: 'artist', name: 'alpha artist' }} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId('own').textContent).toBe('own-one'));
  const props = mocks.cover.mock.lastCall![0];
  expect(props).toMatchObject({ hasPackSample: true, packTag: 'alpha_artist', preferred: true, blocked: true, onDelete: mocks.remove });
  expect(screen.getByTestId('settings')).toBeTruthy(); expect(screen.getByTestId('generation-status')).toBeTruthy();
  expect(screen.getByTestId('generation-status').parentElement?.classList.contains('press-reveal-surface')).toBe(true);
  expect(mocks.supplement).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('switch'));
  await waitFor(() => expect(mocks.catalog).toHaveBeenLastCalledWith('v5'));
  await waitFor(() => expect(screen.getByText('generate').hasAttribute('disabled')).toBe(false));
  expect(screen.getByTestId('own').textContent).toBe(''); expect(mocks.supplement).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('generate')); expect(mocks.supplement).toHaveBeenCalledWith('alpha artist', 'v5');
});

it('嵌套窗口存在时 Escape 和外层点击不关闭资料窗口', async () => {
  const close = vi.fn(); render(<PromptTagLibraryInfo target={{ kind: 'character', name: 'alpha' }} onClose={close} />);
  const dialog = await screen.findByRole('dialog');
  const nested = document.createElement('div'); nested.setAttribute('aria-modal', 'true'); nested.style.zIndex = '1800'; document.body.append(nested);
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.mouseDown(dialog); expect(close).not.toHaveBeenCalled();
  nested.remove(); fireEvent.mouseDown(dialog); expect(close).toHaveBeenCalledOnce();
});

it('真实Portal挂载后移入焦点、Tab圈禁，Escape消费事件并归还触发器', async () => {
  const Parent = () => {
    const [open, setOpen] = React.useState(false);
    return <><button onClick={() => setOpen(true)}>info</button>{open && <PromptTagLibraryInfo target={{ kind: 'character', name: 'alpha' }} onClose={() => setOpen(false)} />}</>;
  };
  render(<Parent />);
  const trigger = screen.getByText('info'); trigger.focus(); fireEvent.click(trigger);
  const close = await screen.findByRole('button', { name: '关闭' });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(close);
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(window, escape);
  expect(escape.defaultPrevented).toBe(true); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it('保活页面隐藏时释放键盘和历史，恢复时保留资料窗和样张版本', async () => {
  const close = vi.fn(), target = { kind: 'artist' as const, name: 'alpha artist' };
  const view = render(<ImageActivityContext.Provider value={false}><PromptTagLibraryInfo target={target} onClose={close} /></ImageActivityContext.Provider>);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.history.mock.lastCall![0]).toBe(false); expect(mocks.data).not.toHaveBeenCalled();
  view.rerender(<ImageActivityContext.Provider value={true}><PromptTagLibraryInfo target={target} onClose={close} /></ImageActivityContext.Provider>);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(screen.getByText('switch'));
  await waitFor(() => expect(mocks.cover.mock.lastCall![0]).toMatchObject({ pack: 'v5', revision: 'two', pending: false }));
  view.rerender(<ImageActivityContext.Provider value={false}><PromptTagLibraryInfo target={target} onClose={close} /></ImageActivityContext.Provider>);
  expect(screen.queryByRole('dialog')).toBeNull(); fireEvent.keyDown(window, { key: 'Escape' }); expect(close).not.toHaveBeenCalled();
  expect(dialog.hidden).toBe(true); expect(dialog.className).toBe('hidden'); expect(mocks.history.mock.lastCall![0]).toBe(false);
  expect(mocks.actions.mock.lastCall![0].active).toBe(false);
  mocks.data.mockImplementationOnce(() => new Promise(() => {}));
  view.rerender(<ImageActivityContext.Provider value={true}><PromptTagLibraryInfo target={target} onClose={close} /></ImageActivityContext.Provider>);
  expect(await screen.findByRole('dialog')).toBe(dialog); expect(mocks.cover.mock.lastCall![0].pack).toBe('v5');
  expect(mocks.cover.mock.lastCall![0]).toMatchObject({ revision: 'two', hasPackSample: true, pending: true });
  expect(mocks.history.mock.lastCall![0]).toBe(true); expect(mocks.actions.mock.lastCall![0].active).toBe(true);
});

it('样张操作沿用已保存的免费步数限制偏好，显式属性仍可覆盖', async () => {
  localStorage.setItem('nai_appearance_preferences', JSON.stringify({ enforceFreeStepLimit: false }));
  const target = { kind: 'artist' as const, name: 'alpha artist' };
  const view = render(<PromptTagLibraryInfo target={target} onClose={vi.fn()} />);
  await waitFor(() => expect(mocks.actions).toHaveBeenCalledWith(expect.objectContaining({ enforceFreeStepLimit: false, active: true })));
  view.rerender(<PromptTagLibraryInfo target={target} onClose={vi.fn()} enforceFreeStepLimit />);
  expect(mocks.actions.mock.lastCall![0].enforceFreeStepLimit).toBe(true);
});

it('未知作品计数不展示MAX_SAFE_INTEGER占位值', async () => {
  render(<PromptTagLibraryInfo target={{ kind: 'character', name: 'alpha', postCount: Number.MAX_SAFE_INTEGER }} onClose={vi.fn()} />);
  await screen.findByRole('dialog'); expect(screen.queryByTitle('Danbooru 关联作品数')).toBeNull();
});

it('通知等普通重渲染不重新遍历画师目录，自建样张变化仍刷新索引', async () => {
  const target = { kind: 'artist' as const, name: 'alpha artist' }, onClose = vi.fn();
  const view = render(<PromptTagLibraryInfo target={target} onClose={onClose} notify={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId('own').textContent).toBe('own-one'));
  await waitFor(() => expect(mocks.cover.mock.lastCall![0].pending).toBe(false));
  const count = mocks.index.mock.calls.length;
  view.rerender(<PromptTagLibraryInfo target={target} onClose={onClose} notify={vi.fn()} />);
  expect(mocks.index).toHaveBeenCalledTimes(count);
  mocks.generated = [{ id: 'own-new', tag: 'alpha_artist', pack: 'v45', createdAt: 2, params: { model: 'nai-diffusion-4-5-full' } }];
  view.rerender(<PromptTagLibraryInfo target={target} onClose={onClose} notify={vi.fn()} />);
  expect(mocks.index).toHaveBeenCalledTimes(count + 1);
  expect(screen.getByTestId('own').textContent).toBe('own-new,own-one');
});
