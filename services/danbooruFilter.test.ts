import { describe, it, expect } from 'vitest';
import { buildDanbooruFilterQuery } from './danbooruService';

describe('buildDanbooruFilterQuery', () => {
  it('defaults to order:rank when query and sort are empty', () => {
    expect(buildDanbooruFilterQuery()).toBe('order:rank');
    expect(buildDanbooruFilterQuery({ query: '' })).toBe('order:rank');
  });

  it('keeps raw query when provided', () => {
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku' })).toBe('hatsune_miku');
  });

  it('combines sort options correctly', () => {
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku', sort: 'score' })).toBe('hatsune_miku order:score');
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku', sort: 'favcount' })).toBe('hatsune_miku order:favcount');
    expect(buildDanbooruFilterQuery({ query: 'hatsune_miku', sort: 'latest' })).toBe('hatsune_miku order:id_desc');
  });

  it('combines rating, ratio, and subject filters', () => {
    expect(buildDanbooruFilterQuery({
      query: 'frieren',
      sort: 'score',
      rating: 's',
      ratio: 'portrait',
      subject: 'solo',
    })).toBe('frieren order:score rating:s ratio:<0.8 solo');
  });
});

