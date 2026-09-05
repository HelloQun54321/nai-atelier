import { describe, expect, it } from 'vitest';
import { parsePromptTags, transformPromptWeight } from './tagTranslations';

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
      { id: '0:blue eyes', displayTag: 'blue eyes', lookupTag: 'blue eyes' },
      { id: '1:red hair', displayTag: 'red hair', lookupTag: 'red hair' },
      { id: '2:green eyes', displayTag: 'green eyes', lookupTag: 'green eyes' },
    ]);
  });

  it('保留 Tag 在原文中的位置和权重组信息', () => {
    const tags = parsePromptTags('1.4::anime style, fine lineart::, blue eyes');
    expect(tags[0]).toMatchObject({ displayTag: 'anime style', lookupTag: 'anime style', groupWeight: '1.4', groupKind: 'numeric' });
    expect(tags[1]).toMatchObject({ lookupTag: 'fine lineart', groupId: tags[0].groupId });
    expect(tags[2].groupId).toBeUndefined();
  });

  it('分隔符空格之后的权重组仍能被识别', () => {
    const tags = parsePromptTags('1.35::anime illustration, professional illustration::, 1.2::slightly fashionable cg::, 0.85::stylized digital human::, year_2026, 1.4::anime style::, {ink wash style}, 1.5::fine lineart, intricate linework::');
    expect(tags[0]).toMatchObject({ groupKind: 'numeric', groupWeight: '1.35' });
    expect(tags[2]).toMatchObject({ displayTag: 'slightly fashionable cg', groupKind: 'numeric', groupWeight: '1.2' });
    expect(tags[3]).toMatchObject({ displayTag: 'stylized digital human', groupKind: 'numeric', groupWeight: '0.85' });
    expect(tags[4].groupKind).toBeUndefined();
    expect(tags[5]).toMatchObject({ displayTag: 'anime style', groupKind: 'numeric', groupWeight: '1.4' });
    expect(tags[6]).toMatchObject({ displayTag: 'ink wash style', groupKind: 'brace', groupLevel: 1 });
    expect(tags[7]).toMatchObject({ displayTag: 'fine lineart', groupKind: 'numeric', groupWeight: '1.5' });
    expect(tags[8]).toMatchObject({ lookupTag: 'intricate linework', groupKind: 'numeric', groupWeight: '1.5', groupId: tags[7].groupId });
  });

  it('按最简原则调整括号权重', () => {
    expect(transformPromptWeight('{{tag}}', { id: '1', displayTag: 'tag', lookupTag: 'tag', groupKind: 'brace', groupLevel: 2 }, 'down')).toBe('{tag}');
    expect(transformPromptWeight('{tag}', { id: '1', displayTag: 'tag', lookupTag: 'tag', groupKind: 'brace', groupLevel: 1 }, 'down')).toBe('[tag]');
    expect(transformPromptWeight('[tag]', { id: '1', displayTag: 'tag', lookupTag: 'tag', groupKind: 'bracket', groupLevel: 1 }, 'up')).toBe('tag');
    expect(transformPromptWeight('tag', { id: '1', displayTag: 'tag', lookupTag: 'tag' }, 'up')).toBe('{tag}');
  });
});
