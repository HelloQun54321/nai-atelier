import { describe, expect, it } from 'vitest';
import { normalizeTransparentWeight, resolveTransparentWeight, withTransparentPromptTags } from '../../services/transparentBackground.mjs';

describe('透明背景权重', () => {
  it.each([[undefined, 1], [NaN, 1], [Infinity, 1], [0, 0.1], [-2, 0.1], [9, 3], [2.09999999, 2.1]])('归一化 %s 为 %s', (value, expected) => {
    expect(normalizeTransparentWeight(value)).toBe(expected);
  });

  it('旧提示词已有权重时恢复该值，独立参数优先且不读取画面文字', () => {
    expect(resolveTransparentWeight(undefined, '1girl, 2.1::transparent background::')).toBe(2.1);
    expect(resolveTransparentWeight(1.6, '1girl, 2.1::transparent background::')).toBe(1.6);
    expect(resolveTransparentWeight(undefined, '1girl, Text: 2.1::transparent background::')).toBe(1);
  });

  it('调整已有独立标签且去掉重复，保留其他加权标签', () => {
    expect(withTransparentPromptTags('2::blue hair::, 0::transparent background::, transparent background, has alpha', 2.1))
      .toBe('2::blue hair::, 2.1::transparent background::, has alpha');
    expect(withTransparentPromptTags('1girl, 2.1::transparent background::, has alpha', 1))
      .toBe('1girl, transparent background, has alpha');
  });

  it('画面文字保持原样，描述区包含完整透明要求', () => {
    expect(withTransparentPromptTags('1girl, Text: transparent background, has alpha\n\nHello', 2.1))
      .toBe('1girl, 2.1::transparent background::, has alpha\nText: transparent background, has alpha\n\nHello');
    expect(withTransparentPromptTags('Text: Hello', 2.1))
      .toBe('2.1::transparent background::, has alpha\nText: Hello');
  });

  it('普通描述不按独立标签删除，不误切 text:: 加权语法', () => {
    expect(withTransparentPromptTags('a transparent background behind her, text::', 1.8))
      .toBe('a transparent background behind her, text::, 1.8::transparent background::, has alpha');
  });
});
