// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CharacterReferenceManager } from '../../components/CharacterReferenceManager';

const rules = vi.hoisted(() => ({ characterReferenceCost: 7 }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: rules }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsCharacterReferences: true }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));
afterEach(cleanup);
it('参考图所有费用提示跟随动态单价', () => {
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
    characterReferences: { enabled: true, slots: [{ assetId: 'ref', type: 'character' as const, strength: 1, fidelity: 1 }] } };
  const props = { params, setParams: vi.fn(), markChange: vi.fn(), notify: vi.fn() };
  const view = render(<CharacterReferenceManager {...props} />);
  expect(screen.getByText('本次生成额外消耗 1 × 7 = 7 Anlas')).toBeTruthy();
  rules.characterReferenceCost = 9;
  view.rerender(<CharacterReferenceManager {...props} />);
  expect(screen.getByText('本次生成额外消耗 1 × 9 = 9 Anlas')).toBeTruthy();
});
