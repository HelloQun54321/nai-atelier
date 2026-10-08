// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NAIParams, PromptChain } from '../../types';
import { VibeManager } from '../../components/VibeManager';
import { CharacterReferenceManager } from '../../components/CharacterReferenceManager';
import { ImageTaggerPanel } from '../../components/ImageTaggerPanel';
import { HistoryImagePicker } from '../../components/HistoryImagePicker';
import { InspirationImagePicker } from '../../components/InspirationImagePicker';
import { ChainEditorForkModal } from '../../components/chain/ChainEditorForkModal';
import { ChainEditorPresetModal, type ChainEditorPresetModalProps } from '../../components/chain/ChainEditorPresetModal';

// 只读合成资料，不接触本地图片、编码或生成接口。
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => false) }));

vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: { vibeEncodingCost: 2, characterReferenceCost: 5 } }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsVibes: true, supportsCharacterReferences: true }) }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 0 }) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ refreshIfStale: vi.fn() }), isNovelaiSubscriptionInactive: () => false }));
vi.mock('../../services/vibeService', () => ({ vibeService: { list: async () => [], listGroups: async () => [] } }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: { list: async () => [] } }));
vi.mock('../../services/imageTaggerService', () => ({ imageTaggerService: { getStatus: async () => ({ downloaded: false }) } }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: async () => ({ items: [], count: 0 }), subscribe: () => () => {} } }));
vi.mock('../../services/dbService', () => ({ db: { getAllInspirations: async () => [], getInspirationBoards: async () => [] } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const params: NAIParams = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' };
const candidate: PromptChain = { id: 'synthetic', userId: 'local', type: 'style', name: '合成预设', description: '', tags: [], basePrompt: '', negativePrompt: '', modules: [], params, createdAt: 1, updatedAt: 1 };
const presetProps: ChainEditorPresetModalProps = {
  showImportPreset: true, importCandidate: null, setImportCandidate: vi.fn(), quickImportMode: false, setQuickImportMode: vi.fn(),
  importTab: 'style', setImportTab: vi.fn(), setShowImportPreset: vi.fn(), allChains: [], importModalSearch: '', setImportModalSearch: vi.fn(),
  importModalSelectedTags: new Set(), setImportModalSelectedTags: vi.fn(), favorites: new Set(), initiateImport: vi.fn(),
  importOptions: { importBasePrompt: true, importSubject: false, importNegative: true, importModules: true, appendModules: false, importCharacters: true, appendCharacters: false, importSettings: true, importSeed: false },
  setImportOptions: vi.fn(), selectedImportModuleIds: new Set(), setSelectedImportModuleIds: vi.fn(), confirmImport: vi.fn(),
};
const actions = { setParams: vi.fn(), markChange: vi.fn(), notify: vi.fn() };
const cases: Array<[string, () => React.ReactElement, string?]> = [
  ['Vibe 管理', () => <VibeManager params={params} {...actions} apiKey="" />, '管理'],
  ['图生图 Vibe 管理', () => <VibeManager params={params} {...actions} apiKey="" operation="image-to-image" />, '管理'],
  ['角色参考', () => <CharacterReferenceManager params={params} {...actions} />, '角色参考'],
  ['引用预设', () => <ChainEditorPresetModal {...presetProps} />],
  ['预设导入确认', () => <ChainEditorPresetModal {...presetProps} importCandidate={candidate} />],
  ['保存到库', () => <ChainEditorForkModal showForkModal setShowForkModal={vi.fn()} confirmFork={vi.fn()} isUploading={false} currentPreviewCover={{ source: null, needsUpload: false }} />],
  ['自由实验室反推', () => <ImageTaggerPanel open onClose={vi.fn()} onInsert={vi.fn()} notify={vi.fn()} />],
  ['预设工作台反推', () => <ImageTaggerPanel contextual open onClose={vi.fn()} onInsert={vi.fn()} notify={vi.fn()} />],
  ['历史图片选择器', () => <HistoryImagePicker open onClose={vi.fn()} onSelect={vi.fn()} />],
  ['灵感图片选择器', () => <InspirationImagePicker open onClose={vi.fn()} onSelect={vi.fn()} />],
];

it.each(cases)('%s 的全屏遮罩脱离工作区并覆盖导航层', async (_name, component, opener) => {
  for (const [width, classes] of [[1280, 'agent-stage'], [390, 'agent-stage safe-mode safe-mode-hide-titles dark']] as const) {
    vi.stubGlobal('innerWidth', width);
    const capture = vi.fn();
    const view = render(<div className={classes} onClickCapture={capture}>
      <aside className="relative z-40">侧边栏</aside>
      <main className="relative isolate overflow-hidden">{component()}</main>
      <nav className="fixed z-50">底部导航</nav><button className="fixed z-[950]">Agent</button>
    </div>);
    if (opener) fireEvent.click(screen.getByRole('button', { name: new RegExp(opener) }));
    const overlay = (await screen.findByRole('dialog')).closest<HTMLElement>('.fixed')!;
    expect(overlay.parentElement).toBe(view.container.firstElementChild);
    expect(overlay.closest('main')).toBeNull();
    expect(overlay.classList.contains('inset-0')).toBe(true);
    expect(overlay.classList.contains('backdrop-blur-sm')).toBe(true);
    const z = Number(/z-\[(\d+)\]/.exec(overlay.className)?.[1]);
    expect(z).toBeGreaterThan(950);
    expect(overlay.closest('.safe-mode') !== null).toBe(width === 390);
    capture.mockClear();
    fireEvent.click(overlay.querySelector('h2, h3, header')!);
    expect(capture).toHaveBeenCalledOnce();
    view.unmount();
    expect(screen.queryByRole('dialog')).toBeNull();
  }
});
