import { describe, expect, it } from 'vitest';
import { parsePromptTags } from './tagTranslations';

describe('parsePromptTags', () => {
  it('英文与中文逗号都作为 Tag 分隔符', () => {
    expect(parsePromptTags('masterpiece，1girl, blue eyes').map(item => item.lookupTag)).toEqual([
      'masterpiece',
      '1girl',
      'blue eyes',
    ]);
  });
});
