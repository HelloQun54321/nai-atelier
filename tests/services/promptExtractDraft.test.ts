import { describe, expect, it } from 'vitest';
import {
  EXTRACT_DRAFT_STORAGE_KEY,
  EXTRACT_DRAFT_VERSION,
  clearExtractDraft,
  createEmptyExtractDraft,
  hasExtractDraftContent,
  loadExtractDraft,
  normalizeExtractDraft,
  saveExtractDraft,
  type ExtractDraftSnapshot,
} from '../../services/promptExtractDraft';

/** 内存版 Storage：测试只碰隔离数据，不写浏览器真实存储。 */
const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
};

const draftWith = (patch: Partial<ExtractDraftSnapshot> = {}): ExtractDraftSnapshot => ({
  ...createEmptyExtractDraft(),
  text: '1.3::white hair::, white dress',
  sourceLabel: '输入框提示词',
  candidates: [
    {
      id: 1,
      entryId: 'candidate-one',
      kind: 'appearance',
      name: '白发少女',
      prompt: '1.3::white hair::',
      original: '1.3::白色长发::',
      needsTranslation: false,
      needsReview: false,
      reviewNote: '',
      picked: true,
    },
    {
      id: 2,
      entryId: 'candidate-two',
      kind: 'wardrobe',
      name: '白裙',
      prompt: 'white dress',
      original: '白色连衣裙',
      needsTranslation: false,
      needsReview: true,
      reviewNote: '内层还嵌套了数值权重组',
      picked: false,
    },
  ],
  unclassified: 'masterpiece',
  excluded: { negative: 'bad hands', parameters: 'Steps: 28' },
  nextId: 2,
  ...patch,
});

describe('提取草稿的本端持久化', () => {
  it('自定义与未知目录候选保留原文、保存身份、多归属及人工复核状态', () => {
    const storage = memoryStorage();
    const draft = draftWith();
    draft.candidates[0] = { ...draft.candidates[0], kind: 'preset', directoryIds: ['custom-deep', 'unknown-node'],
      needsDirectoryReview: true, directoryReviewNote: '目录不存在', picked: false };
    draft.candidates[1] = { ...draft.candidates[1], directoryIds: [] };
    saveExtractDraft(draft, storage);
    const restored = loadExtractDraft(storage).draft!;
    expect(restored.text).toBe(draft.text);
    expect(restored.candidates).toEqual(draft.candidates);
  });

  it('保存后能原样读回候选、编辑、勾选与待处理标记', () => {
    const storage = memoryStorage();
    expect(saveExtractDraft(draftWith(), storage)).toBe('saved');

    const { draft, issue } = loadExtractDraft(storage);
    expect(issue).toBe('');
    expect(draft?.version).toBe(EXTRACT_DRAFT_VERSION);
    expect(draft?.text).toBe('1.3::white hair::, white dress');
    expect(draft?.sourceLabel).toBe('输入框提示词');
    expect(draft?.candidates.map(item => [item.id, item.kind, item.name, item.picked, item.needsReview])).toEqual([
      [1, 'appearance', '白发少女', true, false],
      [2, 'wardrobe', '白裙', false, true],
    ]);
    expect(draft?.candidates[1].reviewNote).toBe('内层还嵌套了数值权重组');
    expect(draft?.unclassified).toBe('masterpiece');
    expect(draft?.excluded).toEqual({ negative: 'bad hands', parameters: 'Steps: 28' });
    expect(draft?.nextId).toBeGreaterThanOrEqual(2);
  });

  it('空草稿不算有内容：不写入、也不提示已恢复', () => {
    const storage = memoryStorage();
    const empty = createEmptyExtractDraft();
    expect(hasExtractDraftContent(empty)).toBe(false);
    expect(hasExtractDraftContent(null)).toBe(false);
    expect(hasExtractDraftContent(draftWith({ text: ' ', candidates: [], unclassified: '', excluded: { negative: '', parameters: '' } }))).toBe(false);
    expect(hasExtractDraftContent(draftWith())).toBe(true);
    expect(hasExtractDraftContent({ ...empty, text: 'red eyes' })).toBe(true);
  });

  it('没有存过草稿时返回空草稿且不报损坏', () => {
    const storage = memoryStorage();
    expect(loadExtractDraft(storage)).toEqual({ draft: null, issue: '' });
  });

  it('内容损坏或版本不符时如实报 corrupt，而不是静默当成空草稿', () => {
    const broken = memoryStorage();
    broken.setItem(EXTRACT_DRAFT_STORAGE_KEY, '{not json');
    expect(loadExtractDraft(broken)).toEqual({ draft: null, issue: 'corrupt' });

    const stale = memoryStorage();
    stale.setItem(EXTRACT_DRAFT_STORAGE_KEY, JSON.stringify({ ...draftWith(), version: 99 }));
    expect(loadExtractDraft(stale)).toEqual({ draft: null, issue: 'corrupt' });

    expect(normalizeExtractDraft({ version: EXTRACT_DRAFT_VERSION, candidates: 'oops' })?.candidates).toEqual([]);
    expect(normalizeExtractDraft(null)).toBeNull();
  });

  it('读不懂的候选被丢弃，重复 id 重新分配，nextId 不小于最大 id', () => {
    const normalized = normalizeExtractDraft({
      version: EXTRACT_DRAFT_VERSION,
      text: 'x',
      candidates: [
        { id: 3, kind: 'appearance', prompt: 'white hair' },
        { id: 3, kind: 'scene', prompt: 'seaside' },
        { id: 4, kind: 'not-a-kind', prompt: 'dropped' },
        { id: 5, kind: 'pose', prompt: '' },
      ],
    });
    expect(normalized?.candidates.map(item => item.kind)).toEqual(['appearance', 'scene']);
    expect(new Set(normalized?.candidates.map(item => item.id)).size).toBe(2);
    expect(normalized?.nextId).toBeGreaterThanOrEqual(Math.max(...(normalized?.candidates.map(item => item.id) || [0])));
  });

  it('存储不可用与写入失败分别返回 unavailable / failed', () => {
    const throwingRead = memoryStorage();
    throwingRead.getItem = () => { throw new Error('denied'); };
    expect(loadExtractDraft(throwingRead)).toEqual({ draft: null, issue: 'unavailable' });

    const full = memoryStorage();
    full.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(saveExtractDraft(draftWith(), full)).toBe('failed');

    expect(loadExtractDraft(null)).toEqual({ draft: null, issue: 'unavailable' });
    expect(saveExtractDraft(draftWith(), null)).toBe('unavailable');
    expect(clearExtractDraft(null)).toBe('unavailable');
  });

  it('清空后读不到草稿，清理失败时如实返回 failed', () => {
    const storage = memoryStorage();
    saveExtractDraft(draftWith(), storage);
    expect(clearExtractDraft(storage)).toBe('cleared');
    expect(loadExtractDraft(storage)).toEqual({ draft: null, issue: '' });

    const stuck = memoryStorage();
    stuck.removeItem = () => { throw new Error('denied'); };
    expect(clearExtractDraft(stuck)).toBe('failed');
  });

  it('已解析的图片元数据（含角色分栏）能随草稿恢复，原文件不在其中', () => {
    const storage = memoryStorage();
    saveExtractDraft(draftWith({
      image: {
        name: '归档.png',
        state: 'ready',
        note: '',
        stored: {
          globalPrompt: 'classroom, sunset',
          characters: [
            { label: '人物 A', prompt: 'red hair, red eyes', negative: 'bad hands' },
            { label: '人物 B', prompt: 'blue hair', negative: '' },
          ],
          negative: 'bad quality',
        },
      },
    }), storage);
    const restored = loadExtractDraft(storage).draft?.image;
    expect(restored?.name).toBe('归档.png');
    expect(restored?.stored?.characters.map(item => item.label)).toEqual(['人物 A', '人物 B']);
    expect(restored?.stored?.characters[0].negative).toBe('bad hands');
    expect(JSON.stringify(restored)).not.toContain('blob:');
  });
});


it('旧草稿补齐 entryId 立即写回，刷新与失败候选编辑不改变保存身份', () => {
  const storage = memoryStorage();
  const old = draftWith();
  storage.setItem(EXTRACT_DRAFT_STORAGE_KEY, JSON.stringify({ ...old, candidates: old.candidates.map(({ entryId: _entryId, ...item }) => item) }));
  const first = loadExtractDraft(storage).draft!;
  expect(first.candidates.every(item => Boolean(item.entryId))).toBe(true);
  expect(new Set(first.candidates.map(item => item.entryId)).size).toBe(2);
  expect(JSON.parse(storage.getItem(EXTRACT_DRAFT_STORAGE_KEY)!).candidates[0].entryId).toBe(first.candidates[0].entryId);
  const edited = { ...first, candidates: first.candidates.map(item => ({ ...item, name: '改名', prompt: 'new prompt' })) };
  saveExtractDraft(edited, storage);
  expect(loadExtractDraft(storage).draft!.candidates.map(item => item.entryId)).toEqual(first.candidates.map(item => item.entryId));
});
