import { describe, expect, it } from 'vitest';
import { buildLabDirtyFingerprint } from '../../services/labDirtyState';
import { enterSectionedPrompt } from '../../services/labSections';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';

describe('buildLabDirtyFingerprint 实验室变更指纹', () => {
  it('相同内容但字段顺序不同，指纹保持一致', () => {
    const a = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: 'bad quality',
      params: { width: 832, height: 1216, steps: 28, sampler: 'k_euler_ancestral' },
      modules: [],
      activeModules: {},
    });
    const b = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: 'bad quality',
      params: { sampler: 'k_euler_ancestral', steps: 28, height: 1216, width: 832 },
      modules: [],
      activeModules: {},
    });
    expect(a).toBe(b);
  });

  it('开启或关闭提示词细分（空内容、仅画风、含 subject 投影进 extra）不产生虚假差异', () => {
    const plainEmpty = buildLabDirtyFingerprint({
      basePrompt: '',
      subjectPrompt: '',
      negativePrompt: '',
      params: LAB_DEFAULT_PARAMS,
    });
    const sectionedEmpty = enterSectionedPrompt('', '', '', undefined);
    expect(buildLabDirtyFingerprint({
      basePrompt: sectionedEmpty.base,
      subjectPrompt: sectionedEmpty.subject,
      negativePrompt: sectionedEmpty.negative,
      params: { ...LAB_DEFAULT_PARAMS, _promptSections: sectionedEmpty.sections },
    })).toBe(plainEmpty);

    const plainWithSubject = buildLabDirtyFingerprint({
      basePrompt: 'artist:foo',
      subjectPrompt: '1girl, smile',
      negativePrompt: 'lowres',
      params: LAB_DEFAULT_PARAMS,
    });
    const sectionedWithSubject = enterSectionedPrompt('artist:foo', '1girl, smile', 'lowres', undefined);
    expect(buildLabDirtyFingerprint({
      basePrompt: sectionedWithSubject.base,
      subjectPrompt: sectionedWithSubject.subject,
      negativePrompt: sectionedWithSubject.negative,
      params: { ...LAB_DEFAULT_PARAMS, _promptSections: sectionedWithSubject.sections },
    })).toBe(plainWithSubject);
  });

  it('调整空白细分栏位布局不影响指纹', () => {
    const before = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: LAB_DEFAULT_PARAMS,
    });
    const after = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: {
        ...LAB_DEFAULT_PARAMS,
        _labSectionLayout: { zones: [{ id: 'zone:custom', label: '自定义' }], facets: [{ id: 'custom:1', zoneId: 'zone:custom', label: '补充栏' }], characterFacets: [] },
      },
    });
    expect(after).toBe(before);
  });

  it('增删空白默认角色槽（含不同随机 ID）指纹相同；写入角色内容才变化、清空即恢复', () => {
    const base = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'uuid-1', prompt: '', x: 0.5, y: 0.5 }] },
    });
    const addedBlank = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: {
        ...LAB_DEFAULT_PARAMS,
        characters: [
          { id: 'uuid-2', name: '角色 1', prompt: '', x: 0.5, y: 0.5 },
          { id: 'uuid-3', name: '角色 2', prompt: '', x: 0.5, y: 0.5 },
        ],
      },
    });
    expect(addedBlank).toBe(base);

    const customNamedBlank = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: {
        ...LAB_DEFAULT_PARAMS,
        characters: [{ id: 'uuid-2', name: 'Saber', prompt: '', x: 0.5, y: 0.5 }],
      },
    });
    expect(customNamedBlank).not.toBe(base);

    const edited = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'uuid-2', prompt: '1girl', x: 0.5, y: 0.5 }] },
    });
    expect(edited).not.toBe(base);

    const cleared = buildLabDirtyFingerprint({
      basePrompt: 'masterpiece',
      subjectPrompt: '',
      negativePrompt: '',
      params: { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'uuid-2', prompt: '', x: 0.5, y: 0.5 }] },
    });
    expect(cleared).toBe(base);
  });

  it('修改参数后再改回原值、或开关空参考槽均与基线一致', () => {
    const baseline = buildLabDirtyFingerprint({
      basePrompt: '1girl',
      subjectPrompt: '',
      negativePrompt: '',
      params: { ...LAB_DEFAULT_PARAMS, steps: 28 },
    });
    const changed = buildLabDirtyFingerprint({
      basePrompt: '1girl',
      subjectPrompt: '',
      negativePrompt: '',
      params: { ...LAB_DEFAULT_PARAMS, steps: 29 },
    });
    expect(changed).not.toBe(baseline);

    const reverted = buildLabDirtyFingerprint({
      basePrompt: '1girl',
      subjectPrompt: '',
      negativePrompt: '',
      params: {
        ...LAB_DEFAULT_PARAMS,
        steps: 28,
        vibes: { enabled: true, normalizeStrengths: true, slots: [] },
        characterReferences: { enabled: true, slots: [] },
      },
    });
    expect(reverted).toBe(baseline);
  });
});
