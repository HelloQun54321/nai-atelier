// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getArtistString, setArtistString, ARTIST_STRING_ID } from '../../services/artistString';
import { compilePrompt } from '../../services/promptUtils';
import { createLabWorkspaceSession, saveLabWorkspaceSession, loadLabWorkspaceSession, LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';

describe('独立画师串', () => {
  it.each([false, true])('跨重启保留画师串并尊重文字记忆设置（开启=%s）', enabled => {
    const fallback = createLabWorkspaceSession('original', '', '', LAB_DEFAULT_PARAMS, {});
    const session = structuredClone(fallback);
    session.textToImage.artistString = 'artist:remembered';
    const memory = { parameters: true, globalPrompt: enabled, negativePrompt: true, characterPrompt: true, characterNegativePrompt: true };
    saveLabWorkspaceSession('artist-restart', session, true, memory);
    sessionStorage.removeItem('nai-lab-workspace-v1:artist-restart');
    expect(loadLabWorkspaceSession('artist-restart', fallback, true, memory).textToImage.artistString).toBe(enabled ? 'artist:remembered' : undefined);
    localStorage.removeItem('nai-lab-workspace-v1:artist-restart');
  });
  it('前置于全局内容，编辑、清空及重复保存不损失其他模块', () => {
    const existing = [{ id: 'other', name: 'other', content: 'soft light', isActive: true, position: 'pre' as const }];
    const modules = setArtistString(setArtistString(existing, 'artist:a'), 'artist:b');
    expect(modules.filter(m => m.id === ARTIST_STRING_ID)).toHaveLength(1);
    expect(compilePrompt({ basePrompt: '2girls', modules }, 'garden')).toBe('artist:b, 2girls, soft light, garden');
    expect(getArtistString(modules)).toBe('artist:b');
    expect(setArtistString(modules, '')).toEqual(existing);
    expect(compilePrompt({ basePrompt: '2girls', modules: setArtistString(modules, '') })).toBe('2girls, soft light');
  });

  it('草稿保留画师串及显式清空，旧草稿不拆分全局内容', () => {
    const fallback = createLabWorkspaceSession('artist:legacy, 1girl', '', '', LAB_DEFAULT_PARAMS, {});
    expect(loadLabWorkspaceSession('artist-test', fallback).textToImage.basePrompt).toBe('artist:legacy, 1girl');
    const session = structuredClone(fallback);
    session.textToImage.artistString = 'artist:a';
    saveLabWorkspaceSession('artist-test', session);
    expect(loadLabWorkspaceSession('artist-test', fallback).textToImage.artistString).toBe('artist:a');
    session.textToImage.artistString = '';
    saveLabWorkspaceSession('artist-test', session);
    expect(loadLabWorkspaceSession('artist-test', fallback).textToImage.artistString).toBe('');
    sessionStorage.removeItem('nai-lab-workspace-v1:artist-test');
  });
});
