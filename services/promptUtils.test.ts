import { describe, it, expect } from 'vitest';
import { compilePrompt, NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';

const mod = (content: string, position: 'pre' | 'post', isActive = true) =>
  ({ content, position, isActive, id: content, name: content } as any);

describe('compilePrompt', () => {
  it('固定顺序：基础 → 前置模块 → 主体 → 后置模块', () => {
    const chain = {
      basePrompt: 'base style',
      modules: [mod('post-mod', 'post'), mod('pre-mod', 'pre')],
    };
    expect(compilePrompt(chain, 'subject')).toBe('base style, pre-mod, subject, post-mod');
  });

  it('position 缺省的模块按后置处理', () => {
    const chain = {
      basePrompt: 'base',
      modules: [{ content: 'legacy', isActive: true } as any],
    };
    expect(compilePrompt(chain, 's')).toBe('base, s, legacy');
  });

  it('activeModulesOnly=true 时只包含激活模块', () => {
    const chain = {
      basePrompt: 'b',
      modules: [mod('on', 'pre', true), mod('off', 'pre', false)],
    };
    expect(compilePrompt(chain, '')).toBe('b, on');
  });

  it('activeModulesOnly=false 时包含全部模块', () => {
    const chain = {
      basePrompt: 'b',
      modules: [mod('on', 'pre', true), mod('off', 'pre', false)],
    };
    expect(compilePrompt(chain, '', false)).toBe('b, on, off');
  });

  it('空白片段被跳过，不产生连续逗号', () => {
    const chain = {
      basePrompt: '  ',
      modules: [mod('  ', 'post'), mod('real', 'post')],
    };
    expect(compilePrompt(chain, '   ')).toBe('real');
  });
});

describe('NAI 常量', () => {
  it('质量 tag 与 UC 预设不为空且以逗号结尾（供直接拼接）', () => {
    expect(NAI_QUALITY_TAGS.startsWith(', ')).toBe(true);
    for (const [id, preset] of Object.entries(NAI_UC_PRESETS)) {
      expect(preset.trim().length).toBeGreaterThan(50);
      expect(preset.endsWith(', ')).toBe(true);
    }
  });
});
