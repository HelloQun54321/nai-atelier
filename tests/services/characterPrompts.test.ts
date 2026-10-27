import { describe, expect, it } from 'vitest';
import { CHARACTER_SECTION_KEYS, clampCharacterCoordinate, compileCharacterContent, getActiveCharacters, hasCharacterSections, moveCharacter, normalizeCharacterCoordinate, withGenerationCharacters } from '../../services/characterPrompts';

describe('角色请求与定位规则', () => {
  it('旧版使用官方五等分中心，边界进入后一格；V5 保留自由值', () => {
    expect([0, 0.199, 0.2, 0.4, 0.599, 0.6, 0.8, 1].map(value => normalizeCharacterCoordinate(value, false)))
      .toEqual([0.1, 0.1, 0.3, 0.5, 0.5, 0.7, 0.9, 0.9]);
    expect(normalizeCharacterCoordinate(0.237, true)).toBe(0.237);
    expect([-5, 2, NaN, Infinity, undefined, null].map(clampCharacterCoordinate)).toEqual([0, 1, 0.5, 0.5, 0.5, 0.5]);
  });

  it('过滤空正向词与停用项，正负词、顺序及原始草稿一起保留', () => {
    const characters = [
      { id: 'first', prompt: 'a', negativePrompt: 'negative a', x: 0.2, y: NaN },
      { id: 'paused', prompt: 'b', negativePrompt: 'negative b', x: 0.5, y: 0.5, enabled: false },
      { id: 'empty', prompt: '  \n ', negativePrompt: 'negative only', x: 0.5, y: 0.5 },
      { id: 'last', prompt: 'c', negativePrompt: 'negative c', x: 1, y: -2, enabled: true },
    ];
    const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters };
    const snapshot = structuredClone(params);
    expect(getActiveCharacters(characters).map(character => character.id)).toEqual(['first', 'last']);
    expect(withGenerationCharacters(params, false)).toMatchObject({ useCoords: false, characters: [
      { id: 'first', negativePrompt: 'negative a', x: 0.3, y: 0.5 },
      { id: 'last', negativePrompt: 'negative c', x: 0.9, y: 0.1 },
    ] });
    expect(params).toEqual(snapshot);
    expect(withGenerationCharacters({ ...params, useCoords: true }, true).useCoords).toBe(true);
  });

  it('排序搬动整条角色记录，含停用、负面词与坐标，不复制或改变原数组', () => {
    const characters = [
      { id: 'a', prompt: 'a', negativePrompt: 'na', x: 0.3, y: 0.5, enabled: false },
      { id: 'b', prompt: 'b', negativePrompt: 'nb', x: 0.7, y: 0.5 },
    ];
    expect(moveCharacter(characters, 1, -1)).toEqual([characters[1], characters[0]]);
    expect(characters.map(character => character.id)).toEqual(['a', 'b']);
    expect(moveCharacter(characters, 0, -1)).toBe(characters);
    expect(moveCharacter(characters, 1, 1)).toBe(characters);
  });
});

describe('角色分栏编译（本机角色分类模型）', () => {
  it('任意动态目录角色参与请求，保留权重、重复词、手写补充与对应负面', () => {
    const character = { id: 'dynamic', prompt: 'manual, blue eyes', x: 0.5, y: 0.5,
      sections: { 'directory:custom': '1.2::blue eyes, smile::, blue eyes', 'directory:empty': '' },
      sectionNegatives: { 'directory:custom': 'red eyes', 'directory:empty': 'stale' },
      sectionMeta: { 'directory:custom': { directoryName: '自定义' } } };
    expect(getActiveCharacters([character])).toEqual([character]);
    const compiled = compileCharacterContent(character);
    expect(compiled.prompt).toBe('1.2::blue eyes, smile::, blue eyes, manual, blue eyes');
    expect(compiled.negativePrompt).toBe('red eyes');
    expect(character.prompt).toBe('manual, blue eyes');
  });
  const sectioned = {
    id: 'sectioned', prompt: 'manual_extra', x: 0.5, y: 0.5,
    sections: { appearance: 'blonde_hair, blue_eyes', wardrobe: 'white_dress', pose: '', expression: 'smile' },
    sectionNegatives: { wardrobe: 'coat', appearance: '' },
  };

  it('只有分栏内容、正文为空的角色同样参与实际请求', () => {
    const characters = [{ id: 'only-sections', prompt: '', x: 0.5, y: 0.5, sections: { appearance: 'blonde_hair' } }];
    expect(hasCharacterSections(characters[0])).toBe(true);
    expect(getActiveCharacters(characters).map(item => item.id)).toEqual(['only-sections']);
    const request = withGenerationCharacters({ width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters }, true);
    expect(request.characters?.[0]).toMatchObject({ prompt: '', sections: { appearance: 'blonde_hair' } });
    expect(compileCharacterContent(request.characters![0]).prompt).toBe('blonde_hair');
  });

  it('正文按「四栏固定顺序 + 手动补充」编译，负面按「分栏内容负面 + 角色负面」编译', () => {
    const compiled = compileCharacterContent({ ...sectioned, negativePrompt: 'bad_hands' });
    expect(compiled.prompt).toBe('blonde_hair, blue_eyes, white_dress, smile, manual_extra');
    expect(compiled.negativePrompt).toBe('coat, bad_hands');
    expect(CHARACTER_SECTION_KEYS).toEqual(['appearance', 'wardrobe', 'pose', 'expression']);
  });

  it('旧资料（没有分栏）原样返回，行为与之前完全一致', () => {
    const legacy = { id: 'legacy', prompt: 'plain_body', negativePrompt: 'neg', x: 0.5, y: 0.5 };
    expect(compileCharacterContent(legacy)).toBe(legacy);
    expect(hasCharacterSections(legacy)).toBe(false);
    expect(getActiveCharacters([legacy]).map(item => item.id)).toEqual(['legacy']);
  });

  it('停用的分栏角色仍然被过滤掉', () => {
    const paused = { ...sectioned, id: 'paused', enabled: false };
    expect(getActiveCharacters([paused])).toHaveLength(0);
  });

  it('加权分组不拆散去重，空栏不带出残留负面，历史快照保留手写正文', () => {
    const character = { ...sectioned, sections: { appearance: '1.3::blue hair, blue eyes::', wardrobe: '' },
      prompt: 'blue eyes, smile', sectionNegatives: { wardrobe: 'stale coat', appearance: 'red hair' } };
    const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [character] };
    const history = withGenerationCharacters(params, true);
    expect(history.characters?.[0].prompt).toBe('blue eyes, smile');
    const compiled = compileCharacterContent(history.characters![0]);
    expect(compiled.prompt).toBe('1.3::blue hair, blue eyes::, blue eyes, smile');
    expect(compiled.negativePrompt).toBe('red hair');
    const edited = { ...history.characters![0], sections: { appearance: 'green hair' } };
    expect(compileCharacterContent(edited).prompt).toBe('green hair, blue eyes, smile');
    expect(params.characters[0]).toEqual(character);
  });
});

describe('旧格式分类负面（params._characterSectionsNegatives）', () => {
  it('旧存储格式的负面会进入编译，且新字段优先', () => {
    const character = {
      id: 'c9', prompt: '', x: 0.5, y: 0.5,
      sections: { appearance: 'silver_hair', wardrobe: 'blue_dress' },
      sectionNegatives: { wardrobe: 'new_coat' },
    };
    const legacy = { 'c9::appearance': 'old_hair_negative', 'c9::wardrobe': 'old_coat' };
    const compiled = compileCharacterContent(character, legacy);
    expect(compiled.negativePrompt).toBe('old_hair_negative, new_coat');
    /* 旧格式里的 wardrobe 被新字段覆盖，不会同时出现 */
    expect(compiled.negativePrompt).not.toContain('old_coat');
  });

  it('没有旧格式时行为不变', () => {
    const character = { id: 'c1', prompt: 'body', x: 0.5, y: 0.5, sections: { appearance: 'a' }, sectionNegatives: {} };
    expect(compileCharacterContent(character, null).negativePrompt).toBeUndefined();
  });

  it('替换后的新分栏没有负面时，不复活旧格式负面；未替换栏仍兼容读取', () => {
    const character = { id: 'c1', prompt: '', x: 0.5, y: 0.5,
      sections: { wardrobe: 'new dress', appearance: 'hair' }, sectionMeta: { wardrobe: { source: 'roll' } } };
    expect(compileCharacterContent(character, { 'c1::wardrobe': 'old coat', 'c1::appearance': 'old hair' }).negativePrompt).toBe('old hair');
  });
});

describe('旧格式负面值为对象时不被拼成 [object Object]', () => {
  it('取 text 字段；没有 text 时退回 note', () => {
    const character = { id: 'c1', prompt: '', x: 0.5, y: 0.5, sections: { wardrobe: 'dress' } };
    expect(compileCharacterContent(character, { 'c1::wardrobe': { text: 'coat_negative', note: '旧备注' } }).negativePrompt)
      .toBe('coat_negative');
    expect(compileCharacterContent(character, { 'c1::wardrobe': { note: '只有备注' } }).negativePrompt)
      .toBe('只有备注');
    expect(compileCharacterContent(character, { 'c1::wardrobe': { text: 'x' } }).negativePrompt)
      .not.toContain('[object Object]');
  });
});
