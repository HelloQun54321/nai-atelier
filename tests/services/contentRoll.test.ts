import { describe, expect, it } from 'vitest';
import {
  ALGO,
  CONTENT_FORMAT,
  CONTENT_VERSION,
  FACET_AUTO,
  FACET_NONE,
  constraintsOf,
  contentFromPresetSnapshot,
  contentOfChain,
  contentRead,
  contentScopeOf,
  contentSnapshotOf,
  isContentRecord,
  metaOf,
} from '../../services/contentRoll';

/** 造一条「词库条目」：只需要本模块真正读取的字段。 */
const entry = (facetObj: Record<string, unknown> | null | undefined, extra: Record<string, unknown> = {}) => ({
  id: 'a-1', name: '金发少女', type: 'appearance',
  basePrompt: 'blonde_hair, blue_eyes', negativePrompt: 'bald',
  tags: ['基线'], description: '一句话生成', previewImage: '/api/assets/covers/x.png', updatedAt: 1700000000000,
  params: { width: 832, _wardrobe: { bilingual: 'blonde_hair（金发）, blue_eyes（蓝瞳）', facets: facetObj } },
  ...extra,
});

/** 造一次抽取结果（本模块只读 picks / checks / seed 证据）。 */
const record = (overrides: Record<string, unknown> = {}) => ({
  seed: 'r-abc', seeds: { appearance: 'r-abc#appearance' }, checks: { appearance: true, wardrobe: true, pose: false, expression: true, scene: true, camera: false },
  locks: { wardrobe: 'w-1' },
  picks: {
    appearance: { kind: 'appearance', id: 'a-1', filled: true, name: '金发少女', text: 'blonde_hair, blue_eyes', negative: 'bald', constraintNotes: '', meta: { source: 'library', entryId: 'a-1', entryName: '金发少女' } },
    wardrobe: { kind: 'wardrobe', id: 'w-1', filled: true, name: '白裙', text: 'white_dress', negative: '', constraintNotes: '明确没有：配饰（条目声明的缺席约束）', meta: null },
    pose: { kind: 'pose', id: '', filled: false, name: '', text: '', negative: '', constraintNotes: '' },
    expression: { kind: 'expression', id: 'e-1', filled: true, name: '微笑', text: 'smile', negative: '', constraintNotes: '' },
    scene: { kind: 'scene', id: 's-1', filled: true, name: '雨夜', text: 'rain, night', negative: 'indoor', constraintNotes: '', meta: null },
    camera: { kind: 'camera', id: '', filled: false, name: '', text: '', negative: '', constraintNotes: '' },
  },
  ...overrides,
});

describe('四态约束派生', () => {
  it('明确没有 / 自动搭配 / 明确定值 / 未知键分别归类，并给出备注与 needsReview', () => {
    const summary = constraintsOf(entry({ accessory: FACET_NONE, light: FACET_AUTO, hair: 'blonde', eye_tone: 'mixed', mystery_key: 'x' }));
    expect(summary.absent.map(item => item.key)).toEqual(['accessory']);
    expect(summary.auto.map(item => item.key)).toEqual(['light']);
    /* 未知键的取值也会被记录（原文保留），但同时进 unknown 并置 needsReview —— 保留 ≠ 已确认 */
    expect(summary.values.map(item => item.key).sort()).toEqual(['eye_tone', 'hair', 'mystery_key']);
    expect(summary.values.find(item => item.key === 'mystery_key')?.known).toBe(false);
    expect(summary.unknown).toEqual(['mystery_key']);
    expect(summary.needsReview).toBe(true);
    expect(summary.notes).toContain('明确没有：配饰');
    expect(summary.notes).toContain('自动搭配：光源');
    expect(summary.notes).toContain('结构待确认：mystery_key');
  });

  it('旧结构 {value:"…"} 仍能取值，但标记为 legacyShape；原文副本原样保留', () => {
    const facets = { material: { value: 'silk' }, hair: [FACET_AUTO, 'blonde'] };
    const summary = constraintsOf(entry(facets));
    const material = summary.values.find(item => item.key === 'material');
    expect(material?.value).toBe('silk');
    expect(material?.legacyShape).toBe(true);
    expect(summary.auto.map(item => item.key)).toEqual(['hair']);
    expect(summary.values.some(item => item.key === 'hair' && item.value === 'blonde')).toBe(true);
    /* 原文照抄：不被派生过程改写 */
    expect(summary.facets).toEqual({ material: { value: 'silk' }, hair: [FACET_AUTO, 'blonde'] });
  });

  it('没有 facets 的旧条目按空处理，不猜、不抛错、needsReview 为假', () => {
    const summary = constraintsOf(entry(null));
    expect(summary.absent).toHaveLength(0);
    expect(summary.auto).toHaveLength(0);
    expect(summary.values).toHaveLength(0);
    expect(summary.unknown).toHaveLength(0);
    expect(summary.needsReview).toBe(false);
    expect(summary.notes).toBe('');
    expect(constraintsOf(null).needsReview).toBe(false);
  });

  it('词库元数据双格式：优先 _wardrobe，缺失时回落到 _promptLibrary', () => {
    const local = { params: { _wardrobe: { bilingual: 'blonde_hair（金发）', facets: { hair: 'blonde' } } } };
    const source = { params: { _promptLibrary: { bilingual: 'blue_eyes（蓝瞳）', facets: { eyes: 'blue' } } } };
    const both = { params: { _wardrobe: { bilingual: '金发优先' }, _promptLibrary: { bilingual: '不应被读到' } } };
    expect(metaOf(local)['bilingual']).toBe('blonde_hair（金发）');
    expect(metaOf(source)['bilingual']).toBe('blue_eyes（蓝瞳）');
    expect(metaOf(both)['bilingual']).toBe('金发优先');
    expect(constraintsOf(source).values.map(item => item.key)).toEqual(['eyes']);
  });

  it('只读：派生过程不改写入参', () => {
    const facets = { hair: ['blonde'], accessory: FACET_NONE };
    const chain = entry(facets);
    const before = JSON.stringify(chain);
    constraintsOf(chain);
    expect(JSON.stringify(chain)).toBe(before);
    expect(metaOf(chain)['bilingual']).toContain('金发');
  });
});

describe('纯内容快照：白名单构造', () => {
  it('只取六类内容与内容自身约束，不含画师串 / 风格负面 / 生图参数 / 模块', () => {
    const snapshot = contentSnapshotOf(record(), '2026-10-20T00:00:00.000Z')!;
    expect(snapshot.format).toBe(CONTENT_FORMAT);
    expect(snapshot.version).toBe(CONTENT_VERSION);
    expect(snapshot.savedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(snapshot.algo).toBe(ALGO);
    const text = JSON.stringify(snapshot);
    for (const banned of ['"basePrompt"', '"negativePrompt"', '"params"', '"style"', '"modules"', '"width"', '"sampler"', '"steps"']) {
      expect(text).not.toContain(banned);
    }
    /* Roll 证据保留（组合随机码不是生图 seed） */
    expect(snapshot.roll.seed).toBe('r-abc');
  });

  it('按分类记账：角色内容进 roles[0]，全局内容进 global，未参与/空栏不写入', () => {
    const snapshot = contentSnapshotOf(record(), 'T')!;
    const role = snapshot.roles[0];
    expect(Object.keys(role.sections).sort()).toEqual(['appearance', 'expression', 'wardrobe']);
    expect(role.provided.pose).toBe(false);
    expect(role.negatives.appearance.text).toBe('bald');
    expect(role.negatives.wardrobe.note).toContain('明确没有：配饰');
    expect(role.meta.appearance.entryId).toBe('a-1');
    expect(Object.keys(snapshot.global).sort()).toEqual(['camera', 'scene']);
    expect(snapshot.global.scene.provided).toBe(true);
    expect(snapshot.global.camera.provided).toBe(false);
  });

  it('没有任何可保存内容时返回 null（阻止创建空记录）', () => {
    expect(contentSnapshotOf({ picks: {}, checks: {} }, 'T')).toBeNull();
    expect(contentSnapshotOf(null, 'T')).toBeNull();
  });
});

describe('纯内容快照：白名单读取', () => {
  const snapshot = contentSnapshotOf(record(), 'T')!;

  it('格式不对的记录拒绝按纯内容载入', () => {
    expect(contentRead(null).ok).toBe(false);
    expect(contentRead({ format: 'other' }).reason).toBe('not_content');
    expect(contentRead({ format: CONTENT_FORMAT, version: 1, roles: [], global: { scene: { provided: false }, camera: { provided: false } } }).reason).toBe('no_content');
  });

  it('多带的画师串 / 参数 / 未知分类都不进入载入结果', () => {
    const dirty: Record<string, any> = JSON.parse(JSON.stringify(snapshot));
    dirty.basePrompt = 'DIRTY_ARTIST';
    dirty.negativePrompt = 'DIRTY_NEG';
    dirty.params = { steps: 99 };
    dirty.roles[0].sections.camera = 'DIRTY_CAMERA';
    dirty.global.camera = { provided: true, text: 'DIRTY_CAMERA' };
    const read = contentRead(dirty);
    expect(read.ok).toBe(true);
    const text = JSON.stringify(read);
    expect(text).not.toContain('DIRTY_ARTIST');
    expect(text).not.toContain('DIRTY_NEG');
    expect(text).not.toContain('"steps":99');
    expect(read.roles[0].sections.camera).toBeUndefined();
    /* 角色只认四类、全局只认两类 */
    expect(Object.keys(read.global).sort()).toEqual(['camera', 'scene']);
  });

  it('结构版本不同时给出提示，但仍按已知字段读取', () => {
    const read = contentRead({ ...snapshot, version: 9 });
    expect(read.ok).toBe(true);
    expect(read.warnings.join('')).toContain('结构版本');
  });

  it('卡片范围摘要只列实际提供的分类', () => {
    const scope = contentScopeOf(contentRead(snapshot));
    expect(scope.roleKinds.sort()).toEqual(['appearance', 'expression', 'wardrobe']);
    expect(scope.globalKinds).toEqual(['scene']);
    expect(scope.label).toContain('角色：形象');
    expect(scope.label).toContain('全局：场景');
    expect(scope.label).not.toContain('镜头');
  });

  it('isContentRecord 只认纯内容记录，完整搭配与普通条目都不算', () => {
    expect(isContentRecord({ params: { _rollContentSnapshot: snapshot } })).toBe(true);
    expect(isContentRecord({ params: { _presetSnapshot: { version: 1 } } })).toBe(false);
    expect(isContentRecord({ params: {} })).toBe(false);
    expect(isContentRecord(null)).toBe(false);
    expect(contentOfChain({ params: { _presetSnapshot: {} } }).ok).toBe(false);
  });
});

describe('从完整搭配人工提取', () => {
  it('只取六类内容与内容负面，画师串 / 风格负面 / 参数都不带过来', () => {
    const full = {
      basePrompt: 'STYLE_ONLY', negativePrompt: 'STYLE_NEG',
      params: {
        width: 640, steps: 31,
        _promptSections: { scene: 'legacy_scene' },
        characters: [{ id: 'c1', name: 'A', sections: { appearance: 'app_only', wardrobe: 'app_wd' } }],
        _characterSectionsNegatives: { 'c1::appearance': { text: 'app_neg', note: '' } },
      },
    };
    const extracted = contentFromPresetSnapshot(full, 'T');
    expect(extracted).not.toBeNull();
    const text = JSON.stringify({ ...extracted, extracted: undefined });
    expect(text).toContain('app_only');
    expect(text).toContain('app_wd');
    expect(text).toContain('app_neg');
    expect(text).toContain('legacy_scene');
    expect(text).not.toContain('STYLE_ONLY');
    expect(text).not.toContain('STYLE_NEG');
    expect(text).not.toContain('"steps"');
    /* 提取出来的记录仍然能被纯内容载入器读回 */
    expect(contentRead(extracted).ok).toBe(true);
  });

  it('没有可提取内容时返回 null', () => {
    expect(contentFromPresetSnapshot({ params: { width: 832 } }, 'T')).toBeNull();
    expect(contentFromPresetSnapshot(null, 'T')).toBeNull();
  });
});


describe('动态组合快照', () => {
  it('任意目录内容、负面及来源独立保存，旧版本仍读取且不带生图配置', () => {
    const row = { kind: 'directory:eye', directoryId: 'eye', directoryName: '眼睛', directoryPath: ['人物', '眼睛'], scope: 'character', filled: true, text: 'blue eyes', negative: 'closed eyes', constraintNotes: '保留说明', meta: { entryId: 'eye-1', directoryName: '眼睛' } };
    const input = { picks: { 'directory:eye': row } };
    const snapshot = contentSnapshotOf(input, 'now')!;
    row.text = 'changed';
    const read = contentRead(snapshot);
    expect(read.items).toEqual([expect.objectContaining({ unitId: 'directory:eye', directoryId: 'eye', directoryName: '眼睛', directoryPath: ['人物', '眼睛'], scope: 'character', text: 'blue eyes', negative: 'closed eyes', constraintNotes: '保留说明' })]);
    expect(read.anyRole).toBe(true);
    expect(snapshot).not.toHaveProperty('params');
    expect(contentRead({ ...contentSnapshotOf(record(), 'old'), version: 1 }).ok).toBe(true);
    expect(contentRead({ format: CONTENT_FORMAT, version: 2, items: [{ unitId: 'bad', text: 'ignored' }] }).ok).toBe(false);
  });
});
