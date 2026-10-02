import { expect, it } from 'vitest';
import { externalImageAnalysis, externalImageDrafts, readExternalImageTags, type ExternalImageTags } from './externalImageTags';
import type { Inspiration } from '../types';

const reverse: ExternalImageTags = { prompt: 'blue hair', createdAt: 1, result: { model: 'test', threshold: 0.35, characterThreshold: 0.85, rating: null, tags: [{ name: 'blue_hair', category: 'general', confidence: 0.9 }], character: [], general: [] } };
it('原站、反推和页码独立保留，不吞掉既有分析记录，旧资料可读', () => {
  const original = { analysis: { notes: 'keep' } } as unknown as Inspiration;
  const analysis = externalImageAnalysis(['original'], 2, reverse, original);
  expect(analysis).toMatchObject({ notes: 'keep', externalSourceTags: ['original'], externalSourcePage: 2, imageTagger: reverse });
  expect(readExternalImageTags({ ...original, analysis })).toEqual(reverse);
  expect(readExternalImageTags(original)).toBeUndefined();
  expect(readExternalImageTags({ ...original, analysis: { imageTagger: { ...reverse, result: { tags: ['bad'] } } } })).toBeUndefined();
});
it('未保存草稿只留当前会话，缓存条目有上限且作品和页码互不覆盖', () => {
  externalImageDrafts.set('pixiv:100:0', reverse);
  externalImageDrafts.set('pixiv:100:1', { ...reverse, prompt: 'other page' });
  expect(externalImageDrafts.get('pixiv:100:0')?.prompt).toBe('blue hair');
  expect(externalImageDrafts.get('pixiv:100:1')?.prompt).toBe('other page');
  for (let i = 0; i < 100; i++) externalImageDrafts.set(`synthetic:${i}`, reverse);
  expect(externalImageDrafts.get('pixiv:100:0')).toBeUndefined();
  expect(externalImageDrafts.get('synthetic:99')).toEqual(reverse);
});
