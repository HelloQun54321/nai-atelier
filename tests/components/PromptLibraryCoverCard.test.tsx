// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryCard } from '../../components/PromptLibraryCard';
import type { PromptChain } from '../../types';

vi.mock('../../components/SmartImage', () => ({
  SmartImage: (props: React.ImgHTMLAttributes<HTMLImageElement> & { containerClassName?: string; thumbnailVariant?: string }) => {
    const { containerClassName, thumbnailVariant: _variant, ...image } = props;
    return <div className={containerClassName}><img {...image} /></div>;
  },
  ImageActivityContext: React.createContext(true),
}));
vi.mock('../../components/ImageShareActions', () => ({
  IMAGE_CARD_ACTION_CLASS: 'image-action',
  ImageShareActions: () => <button data-card-action>收藏</button>,
}));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));

afterEach(cleanup);

const chain = {
  id: 'fragment', name: '柔光', type: 'preset', basePrompt: 'soft light',
  previewImage: '/synthetic/cover.png', tags: [], params: {},
} as unknown as PromptChain;

it('有封面时生成按钮叠循环标，无正文时禁用', () => {
  const onGenerate = vi.fn();
  render(<PromptLibraryCard chain={chain} onOpen={vi.fn()} notify={vi.fn()}
    onGenerateCover={onGenerate} onManageCoverGeneration={vi.fn()} />);
  expect(screen.getByRole('button', { name: '重新生成封面' })).toBeTruthy();
  cleanup();
  render(<PromptLibraryCard chain={{ ...chain, previewImage: undefined }} onOpen={vi.fn()} notify={vi.fn()}
    coverDisabled onGenerateCover={onGenerate} onManageCoverGeneration={vi.fn()} />);
  expect((screen.getByRole('button', { name: '生成封面' }) as HTMLButtonElement).disabled).toBe(true);
});
