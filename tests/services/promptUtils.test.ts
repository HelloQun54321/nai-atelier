import { describe, it, expect } from 'vitest';
import { getEditableGlobalNegative, getGlobalPromptSectionKeys, compilePrompt, getEditableGlobalPrompt, mergePromptFields, NAI_QUALITY_TAGS, NAI_UC_PRESETS } from '../../services/promptUtils';

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

describe('mergePromptFields', () => {
  it('按原顺序合并风格与主体，并清理边界逗号', () => {
    expect(mergePromptFields('masterpiece, ', ' 1girl, blue eyes,')).toBe('masterpiece, 1girl, blue eyes');
  });

  it('任一输入为空时不产生多余分隔符', () => {
    expect(mergePromptFields('', '1girl')).toBe('1girl');
    expect(mergePromptFields('masterpiece', '')).toBe('masterpiece');
  });

  it('单字段实时编辑保留末尾逗号、空格和换行', () => {
    expect(getEditableGlobalPrompt('masterpiece, ', '')).toBe('masterpiece, ');
    expect(getEditableGlobalPrompt('masterpiece, ', '   ')).toBe('masterpiece, ');
    expect(getEditableGlobalPrompt('masterpiece,\n', '')).toBe('masterpiece,\n');
  });

  it('首次关闭拆分时仍会合并已有画风与主体字段', () => {
    expect(getEditableGlobalPrompt('masterpiece, ', ' 1girl,')).toBe('masterpiece, 1girl');
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

it('呈现形式在既有分类后编译，整段正负合并保留原画风与权重', async () => {
  const { mergePromptSections } = await import('../../services/labWorkspace');
  const sections = { scene: 'garden', extra: 'keep extra', 'purpose:camera': 'close up', presentation: '{comic panel, split screen}', sectionNegatives: { presentation: 'single panel' } };
  expect(getGlobalPromptSectionKeys(sections).at(-1)).toBe('presentation');
  const subject = mergePromptSections(sections);
  expect(subject).toBe('garden, keep extra, close up, {comic panel, split screen}');
  expect(getEditableGlobalPrompt('1.2::artist:name::', subject)).toBe('1.2::artist:name::, ' + subject);
  expect(getEditableGlobalNegative('bad anatomy', sections)).toBe('bad anatomy, single panel');
  expect(compilePrompt({ basePrompt: 'style', modules: [] }, subject)).toContain('{comic panel, split screen}');
});
