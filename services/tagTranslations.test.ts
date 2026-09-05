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

  it('翻译查询会剥离常见权重语法，但保留原始展示文本', () => {
    expect(parsePromptTags('(blue eyes:1.2), {red hair}, 1.1::green eyes::')).toMatchObject([
      { id: '0:blue eyes', displayTag: '(blue eyes:1.2)', lookupTag: 'blue eyes' },
      { id: '1:red hair', displayTag: '{red hair}', lookupTag: 'red hair' },
      { id: '2:green eyes', displayTag: 'green eyes', lookupTag: 'green eyes' },
    ]);
  });

  it('保留 Tag 在原文中的位置和权重组信息', () => {
    const tags = parsePromptTags('1.4::anime style, fine lineart::, blue eyes');
    expect(tags[0]).toMatchObject({ displayTag: 'anime style', lookupTag: 'anime style', groupWeight: '1.4', groupKind: 'numeric' });
    expect(tags[1]).toMatchObject({ lookupTag: 'fine lineart', groupId: tags[0].groupId });
    expect(tags[2].groupId).toBeUndefined();
  });
});
