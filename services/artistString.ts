import type { PromptModule } from '../types';

// 沿用已有模块保存协议，不迁移或拆分用户原提示词。
export const ARTIST_STRING_ID = 'atelier-artist-string';
export const getArtistString = (modules: PromptModule[]): string =>
  modules.find(module => module.id === ARTIST_STRING_ID)?.content || '';

export const setArtistString = (modules: PromptModule[], content: string): PromptModule[] => {
  const rest = modules.filter(module => module.id !== ARTIST_STRING_ID);
  return content ? [{ id: ARTIST_STRING_ID, name: '画师串', content, isActive: true, position: 'pre' }, ...rest] : rest;
};
