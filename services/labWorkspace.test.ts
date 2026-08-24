// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLabWorkspaceSession, getLabWorkspaceAssetId, loadLabWorkspaceSession, saveLabWorkspaceSession } from './labWorkspace';

const params = {
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
};

describe('lab workspace session', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps four independent mode drafts and restores the active mode', () => {
    const fallback = createLabWorkspaceSession('style prompt', 'red bottle', 'bad hands', params, { module: true });
    const session = {
      ...fallback,
      activeMode: 'inpaint' as const,
      edits: {
        ...fallback.edits,
        'image-to-image': { ...fallback.edits['image-to-image'], prompt: 'style only', strength: 0.42, baseImageRef: 'asset-image' },
        inpaint: { ...fallback.edits.inpaint, prompt: 'blue bottle', maskRef: 'asset-mask', focused: true },
        outpaint: { ...fallback.edits.outpaint, expansion: { top: 64, right: 128, bottom: 0, left: 64 } },
      },
    };

    saveLabWorkspaceSession('chain-a', session);
    const restored = loadLabWorkspaceSession('chain-a', fallback);

    expect(restored.activeMode).toBe('inpaint');
    expect(restored.edits['image-to-image'].prompt).toBe('style only');
    expect(restored.edits['image-to-image'].strength).toBe(0.42);
    expect(restored.edits.inpaint.prompt).toBe('blue bottle');
    expect(restored.edits.inpaint.maskRef).toBe('asset-mask');
    expect(restored.edits.inpaint.focused).toBe(true);
    expect(restored.edits.outpaint.expansion).toEqual({ top: 64, right: 128, bottom: 0, left: 64 });
  });

  it('isolates drafts by chain or playground session key', () => {
    const fallback = createLabWorkspaceSession('style', '', '', params, {});
    saveLabWorkspaceSession('chain-a', { ...fallback, textToImage: { ...fallback.textToImage, basePrompt: 'chain a' } });
    saveLabWorkspaceSession('playground', { ...fallback, textToImage: { ...fallback.textToImage, basePrompt: 'playground' } });

    expect(loadLabWorkspaceSession('chain-a', fallback).textToImage.basePrompt).toBe('chain a');
    expect(loadLabWorkspaceSession('playground', fallback).textToImage.basePrompt).toBe('playground');
    expect(loadLabWorkspaceSession('chain-b', fallback).textToImage.basePrompt).toBe('style');
  });

  it('uses stable role-specific asset ids so repeated mask saves overwrite one blob', () => {
    expect(getLabWorkspaceAssetId('chain-a', 'inpaint', 'mask')).toBe(getLabWorkspaceAssetId('chain-a', 'inpaint', 'mask'));
    expect(getLabWorkspaceAssetId('chain-a', 'inpaint', 'mask')).not.toBe(getLabWorkspaceAssetId('chain-a', 'inpaint', 'base'));
    expect(getLabWorkspaceAssetId('chain-a', 'inpaint', 'mask')).not.toBe(getLabWorkspaceAssetId('chain-b', 'inpaint', 'mask'));
  });
});
