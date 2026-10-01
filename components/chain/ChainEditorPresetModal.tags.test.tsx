// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { ChainEditorPresetModal, type ChainEditorPresetModalProps } from './ChainEditorPresetModal';

afterEach(cleanup);
const chain = (id: string, tags: string[]): PromptChain => ({
  id, userId: 'synthetic', type: 'style', name: id, description: '', tags, basePrompt: '', negativePrompt: '', modules: [],
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: true, ucPreset: 4 }, createdAt: 1, updatedAt: 1,
});

it('工作台引用预设沿用用户标签筛选，不重新显示来源、类型与待实测', () => {
  const initiateImport = vi.fn();
  const options: ChainEditorPresetModalProps = {
    showImportPreset: true, importCandidate: null, setImportCandidate: vi.fn(), quickImportMode: true, setQuickImportMode: vi.fn(),
    importTab: 'style', setImportTab: vi.fn(), setShowImportPreset: vi.fn(), allChains: [chain('星空预设', ['NAI', 'aitag', '待实测', '星空']), chain('其他预设', ['__character_catalog__', '其他'])],
    importModalSearch: '', setImportModalSearch: vi.fn(), importModalSelectedTags: new Set(), setImportModalSelectedTags: vi.fn(), favorites: new Set(), initiateImport,
    importOptions: { importBasePrompt: true, importSubject: false, importNegative: true, importModules: true, appendModules: false, importCharacters: true, appendCharacters: false, importSettings: true, importSeed: false },
    setImportOptions: vi.fn(), selectedImportModuleIds: new Set(), setSelectedImportModuleIds: vi.fn(), confirmImport: vi.fn(),
  };
  const Harness = () => {
    const [tags, setTags] = React.useState<Set<string>>(new Set());
    return <ChainEditorPresetModal {...options} importModalSelectedTags={tags} setImportModalSelectedTags={setTags} />;
  };
  render(<Harness />);
  for (const tag of ['NAI', 'aitag', '待实测', '__character_catalog__']) expect(screen.queryByRole('button', { name: tag })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '星空' }));
  expect(screen.queryByText('其他预设')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /星空预设/ }));
  expect(initiateImport).toHaveBeenCalledExactlyOnceWith(options.allChains[0]);
});
