import { afterEach, describe, expect, it, vi } from 'vitest';
import * as tagDictionary from '../../services/tagDictionary';
import {
  detectCharacterTagName,
  formatCharacterTagDisplayName,
  resolveCharacterAutoRenamePatch,
  resolveManualCharacterNamePatch,
} from '../../services/characterAutoName';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('角色提示词自动识别改名', () => {
  it('将词库角色 Tag 规范为去括号英文名', () => {
    expect(formatCharacterTagDisplayName('2b_(nier:automata)')).toBe('2b');
    expect(formatCharacterTagDisplayName('rem_(re:zero)')).toBe('rem');
    expect(formatCharacterTagDisplayName('hatsune_miku')).toBe('hatsune miku');
    expect(formatCharacterTagDisplayName('saber_(fate)_(cosplay)')).toBe('saber');
  });

  it('从词库识别首个角色词（category === 4），忽略画师与普通词，异常时返回 undefined', async () => {
    vi.spyOn(tagDictionary, 'lookupTagCatalogEntries').mockResolvedValue(new Map([
      ['wlop', { name: 'wlop', chinese: '王凌', category: 1, categoryLabel: '画师', postCount: 1000, isNovelAI: true }],
      ['2b (nier:automata)', { name: '2b_(nier:automata)', chinese: '2B', category: 4, categoryLabel: '角色', postCount: 50000, isNovelAI: true }],
      ['9s (nier:automata)', { name: '9s_(nier:automata)', chinese: '9S', category: 4, categoryLabel: '角色', postCount: 20000, isNovelAI: true }],
    ]));

    expect(await detectCharacterTagName('1girl, wlop, 2b (nier:automata), 9s (nier:automata), blindfold')).toBe('2b');
    expect(await detectCharacterTagName('1girl, wlop, white hair')).toBeNull();
    expect(await detectCharacterTagName('   ')).toBeNull();

    vi.spyOn(tagDictionary, 'lookupTagCatalogEntries').mockRejectedValue(new Error('offline'));
    expect(await detectCharacterTagName('2b (nier:automata)')).toBeUndefined();
  });

  it('默认名与自动识别名随换词自动更新、删词退回默认名；手动改名锁定不被覆盖', () => {
    const initial = [
      { id: 'c1', name: '角色 1', prompt: '2b (nier:automata)', x: 0.5, y: 0.5 },
      { id: 'c2', name: '角色 2', prompt: '', x: 0.5, y: 0.5 },
    ];
    // 1. 默认名命中角色词 -> 自动更名
    expect(resolveCharacterAutoRenamePatch(initial, 'c1', '2b')).toEqual({ name: '2b', autoNamed: true });

    // 2. 自动识别名换词 -> 跟随更新
    const autoNamed = [
      { ...initial[0], name: '2b', autoNamed: true },
      initial[1],
    ];
    expect(resolveCharacterAutoRenamePatch(autoNamed, 'c1', 'rem')).toEqual({ name: 'rem', autoNamed: true });

    // 3. 自动识别名删掉角色词 -> 退回未占用的默认编号「角色 1」
    expect(resolveCharacterAutoRenamePatch(autoNamed, 'c1', null)).toEqual({ name: '角色 1', autoNamed: false });

    // 4. 手动改名 -> 锁定不覆盖
    const manualPatch = resolveManualCharacterNamePatch(autoNamed, 'c1', '我的老婆');
    expect(manualPatch).toEqual({ name: '我的老婆', autoNamed: false });
    const manuallyLocked = [{ ...autoNamed[0], ...manualPatch }, initial[1]];
    expect(resolveCharacterAutoRenamePatch(manuallyLocked, 'c1', 'rem')).toBeNull();
    expect(resolveCharacterAutoRenamePatch(manuallyLocked, 'c1', null)).toBeNull();

    // 5. 手动清空名称 -> 恢复默认编号，重新允许自动识别
    const clearedPatch = resolveManualCharacterNamePatch(manuallyLocked, 'c1', '   ');
    expect(clearedPatch).toEqual({ name: '角色 1', autoNamed: false });
    expect(resolveCharacterAutoRenamePatch([{ ...manuallyLocked[0], ...clearedPatch }, initial[1]], 'c1', 'rem'))
      .toEqual({ name: 'rem', autoNamed: true });
  });
});
