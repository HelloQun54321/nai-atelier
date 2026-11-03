import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTagQuery, type TagSuggestion } from '../../services/tagDictionary';

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('../../services/tagDictionary', async importOriginal => ({ ...await importOriginal<typeof import('../../services/tagDictionary')>(), lookupTagDictionaryEntries: mocks.lookup }));

import { addPromptArtistPrefix, classifyPromptTidySegment, DEFAULT_PROMPT_TIDY_SETTINGS, normalizePromptTidySettings, repairPromptTidySegment, resolvePromptTidyMethod, splitPromptTidySegments, tidyPrompt, type PromptTidySettings } from '../../services/promptTidy';

const artist = (name: string): TagSuggestion => ({ name, chinese: name, category: 1, postCount: 1 } as TagSuggestion);
const dictionary = new Map([['chen bin', artist('chen_bin')], ['rella', artist('rella')]]);
const settings = (patch: Partial<PromptTidySettings> = {}): PromptTidySettings => ({ ...DEFAULT_PROMPT_TIDY_SETTINGS, ...patch });
/** 直接读仓库内置的 Tag 词库分片，按真实分类识别。 */
const shards = new Map<string, unknown[][]>();
const manifest = JSON.parse(readFileSync('public/tag-data/manifest.json', 'utf8')) as { shards: Record<string, string> };
const realLookup = async (tags: string[]) => new Map([...new Set(tags.map(normalizeTagQuery))].flatMap(tag => {
  const file = manifest.shards[tag.slice(0, 2).padEnd(2, ' ')];
  if (!file) return [];
  if (!shards.has(file)) shards.set(file, JSON.parse(readFileSync(`public/tag-data/shards/${file}`, 'utf8')));
  const entry = shards.get(file)!.find(item => normalizeTagQuery(String(item[0])) === tag);
  return entry ? [[tag, { name: String(entry[0]), chinese: String(entry[1]), category: Number(entry[2]), postCount: Number(entry[3]) } as TagSuggestion] as const] : [];
}));
/** 用户实测的乱写画风串：错配括号、多余冒号、中文逗号、拼错的质量词。 */
const MESSY = ', year 2025,,year 2026, wuthering waves official art style, ::[[healthyman]], ,  [modare],, , [hintobento],[cutesexyrobutts]  ,[[onineko][,[[ruurdo],,doumu_(316783160,[,haku89 ],[matanonki],omone_hokoma_agm, [rhasta], [kkuem], [ushikani_kassen,],[dishwasher1910],,[chen bin,] [i，zumi tsubasu],::absurdres, highres, best quality, masterpiece, very aesthetic, masterpice,[thin  lineart],refined illustration:,high chiaroscuro，,silky skin,solo focus,，,day,sunset,orange lighting,flower_field';
const PROMPT = '1::artist:ashima_(roro046)::,0.5::chen_bin::, rella,\n\nmasterpiece, best quality, astonishing elements,\n<scene>\nbakery, warm sunlight\n</scene>\n1girl, solo, cowboy shot, very aesthetic, masterpiece, no text';

beforeEach(() => { mocks.lookup.mockReset().mockResolvedValue(dictionary); });

describe('提示词整理切段', () => {
  it('按顶层逗号与换行切段，权重组与括号内的逗号保持原样', () => {
    expect(splitPromptTidySegments('1.2::a, b::, (c, d)\ne，f')).toEqual(['1.2::a, b::', '(c, d)', 'e', 'f']);
    expect(splitPromptTidySegments(PROMPT).slice(0, 7)).toEqual(['1::artist:ashima_(roro046)::', '0.5::chen_bin::', 'rella', 'masterpiece', 'best quality', 'astonishing elements', '<scene>']);
  });

  it('未闭合的括号或权重按逗号逐个切开，一处笔误不会把后面整段并成一块', () => {
    expect(splitPromptTidySegments('(broken, tag\nartist:a, b\n1.1::open, c\nd')).toEqual(['(broken', 'tag', 'artist:a', 'b', '1.1::open', 'c', 'd']);
    expect(splitPromptTidySegments('{a, b}, [[x][, y, z')).toEqual(['{a, b}', '[[x]]', 'y', 'z']);
    // 笔误切开的一截补齐括号，降权不丢
    expect(splitPromptTidySegments('[[x][, [ushikani_kassen,],[,haku89 ],[chen bin,] [i，zumi tsubasu]')).toEqual(['[[x]]', '[ushikani_kassen]', '[haku89]', '[chen bin]', '[i]', '[zumi tsubasu]']);
    // 配好对的括号整组保留，两组之间没写逗号时拆开
    expect(splitPromptTidySegments('[ushikani_kassen,],[,haku89 ],[chen bin,] [i，zumi tsubasu]')).toEqual(['[ushikani_kassen,]', '[,haku89 ]', '[chen bin,]', '[i，zumi tsubasu]']);
    const segments = splitPromptTidySegments(MESSY);
    expect(segments).toContain('flower_field');
    expect(segments).toContain('[matanonki]');
    expect(segments.every(segment => !/[,，]/.test(segment))).toBe(true);
  });

  it('输出去掉配不上对的强调括号、段首段尾多余冒号和连续空格，权重与名字里的圆括号保留', () => {
    expect(repairPromptTidySegment('[[onineko][')).toBe('[onineko]');
    expect(repairPromptTidySegment('haku89 ]')).toBe('haku89');
    expect(repairPromptTidySegment('::[[healthyman]]')).toBe('[[healthyman]]');
    expect(repairPromptTidySegment('refined illustration:')).toBe('refined illustration');
    expect(repairPromptTidySegment('[thin  lineart]')).toBe('[thin lineart]');
    expect(repairPromptTidySegment('{a]')).toBe('a');
    expect(repairPromptTidySegment('1.2::a, b::')).toBe('1.2::a, b::');
    expect(repairPromptTidySegment('doumu_(316783160')).toBe('doumu_(316783160');
    expect(repairPromptTidySegment('] [')).toBe('');
    expect(repairPromptTidySegment('[ushikani_kassen,]')).toBe('[ushikani_kassen]');
    expect(repairPromptTidySegment('[,haku89 ]')).toBe('[haku89]');
  });

  it('画师、画风与内容分开识别，混入内容的权重组整段算内容', () => {
    expect(classifyPromptTidySegment('1::artist:ashima_(roro046)::', new Map())).toBe('artist');
    expect(classifyPromptTidySegment('{chen_bin}', dictionary)).toBe('artist');
    expect(classifyPromptTidySegment('1.2::masterpiece, rella::', dictionary)).toBe('style');
    expect(classifyPromptTidySegment('1.2::rella, 1girl::', dictionary)).toBe('content');
    expect(classifyPromptTidySegment('<scene>', dictionary)).toBe('content');
  });

  it('只给词库认得的裸画师名补 artist:，括号、权重和名字自带的括号保持不变', () => {
    expect(addPromptArtistPrefix('0.5::chen_bin::', dictionary)).toBe('0.5::artist:chen_bin::');
    expect(addPromptArtistPrefix('{rella}', dictionary)).toBe('{artist:rella}');
    expect(addPromptArtistPrefix('1.1::rella， chen_bin ::', dictionary)).toBe('1.1::artist:rella， artist:chen_bin ::');
    expect(addPromptArtistPrefix('artist:rella', dictionary)).toBe('artist:rella');
    expect(addPromptArtistPrefix('ashima_(roro046)', dictionary)).toBe('ashima_(roro046)');
  });
});

describe('提示词整理规则', () => {
  it('乱写的画风串按真实词库提取：画师与画风、质量词保留，场景、时间与光照去掉', async () => {
    mocks.lookup.mockImplementation(realLookup);
    const style = await tidyPrompt(MESSY, settings());
    expect(style.text).toBe('year 2025, year 2026, wuthering waves official art style, [[healthyman]], [modare], [hintobento], [cutesexyrobutts], [[onineko]], [haku89], [matanonki], omone_hokoma_agm, [rhasta], [kkuem], [ushikani_kassen], [dishwasher1910], [chen bin], absurdres, highres, best quality, masterpiece, very aesthetic, masterpice, [thin lineart], refined illustration, high chiaroscuro');
    for (const dropped of ['flower_field', 'sunset', 'orange lighting', 'solo focus', 'silky skin']) expect(style.text).not.toContain(dropped);
    expect((await tidyPrompt(MESSY, settings({ keep: 'all' }))).text).toBe('year 2025, year 2026, wuthering waves official art style, [[healthyman]], [modare], [hintobento], [cutesexyrobutts], [[onineko]], [[ruurdo]], doumu_(316783160, [haku89], [matanonki], omone_hokoma_agm, [rhasta], [kkuem], [ushikani_kassen], [dishwasher1910], [chen bin], [i], [zumi tsubasu], absurdres, highres, best quality, masterpiece, very aesthetic, masterpice, [thin lineart], refined illustration, high chiaroscuro, silky skin, solo focus, day, sunset, orange lighting, flower_field');
    expect((await tidyPrompt(MESSY, settings({ keep: 'artists', artistPrefix: true }))).text).toBe('[[artist:healthyman]], [artist:modare], [artist:hintobento], [artist:cutesexyrobutts], [[artist:onineko]], [artist:haku89], [artist:matanonki], artist:omone_hokoma_agm, [artist:rhasta], [artist:kkuem], [artist:ushikani_kassen], [artist:dishwasher1910], [artist:chen bin]');
  });

  it('AI 拿到逐段切开的片段，可以单独去掉 flower_field', async () => {
    const service = { tidyPrompt: vi.fn(async ({ chunks }: { chunks: string[] }) => ({ keep: chunks.map(chunk => !['flower_field', 'day', 'sunset'].includes(chunk)) })) };
    const result = await tidyPrompt(MESSY, settings({ method: 'ai' }), service as never);
    expect(service.tidyPrompt.mock.calls[0][0].chunks).toContain('flower_field');
    expect(result.text).not.toContain('flower_field');
    expect(result.text).toContain('[[onineko]]');
  });

  it('规则提取画风串：保留画师、质量词与画风词，去掉内容并去重', async () => {
    const service = { tidyPrompt: vi.fn() };
    const result = await tidyPrompt(PROMPT, settings(), service);
    expect(result).toEqual({ text: '1::artist:ashima_(roro046)::, 0.5::chen_bin::, rella, masterpiece, best quality, very aesthetic, no text', kept: 7, removed: 9, rewritten: false });
    expect(service.tidyPrompt).not.toHaveBeenCalled();
  });

  it('只留画师、去掉画风与只整理格式各按所选保留，补前缀与去重可关闭', async () => {
    expect((await tidyPrompt(PROMPT, settings({ keep: 'artists', method: 'ai', artistPrefix: true }), { tidyPrompt: vi.fn() })).text).toBe('1::artist:ashima_(roro046)::, 0.5::artist:chen_bin::, artist:rella');
    expect((await tidyPrompt(PROMPT, settings({ keep: 'content' }))).text).toBe('astonishing elements, <scene>, bakery, warm sunlight, </scene>, 1girl, solo, cowboy shot');
    expect((await tidyPrompt('a, b, a', settings({ keep: 'all', dedupe: false }))).text).toBe('a, b, a');
    expect((await tidyPrompt('a,\nb, A', settings({ keep: 'all' }))).text).toBe('a, b');
  });

  it('词库读取失败时退回 artist: 与内置画风词判断', async () => {
    mocks.lookup.mockRejectedValue(new Error('offline'));
    expect((await tidyPrompt('artist:x, chen_bin, masterpiece, 1girl', settings())).text).toBe('artist:x, masterpiece');
  });

  it('设置读取兜底：未知值回到默认，自定义要求只能走 AI、画师与格式只走规则', () => {
    expect(normalizePromptTidySettings({ method: 'x', keep: 'y', dedupe: 0, instruction: 'z'.repeat(600) })).toEqual({ ...DEFAULT_PROMPT_TIDY_SETTINGS, dedupe: true, instruction: 'z'.repeat(500) });
    expect(normalizePromptTidySettings({ dedupe: false }).dedupe).toBe(false);
    expect(resolvePromptTidyMethod(settings({ keep: 'custom' }))).toBe('ai');
    expect(resolvePromptTidyMethod(settings({ keep: 'all', method: 'ai' }))).toBe('rules');
    expect(resolvePromptTidyMethod(settings({ keep: 'content', method: 'ai' }))).toBe('ai');
  });
});

describe('提示词整理 AI', () => {
  it('AI 只回每段去留，原文按原样拼回，内置选项带上画风配方说明', async () => {
    const service = { tidyPrompt: vi.fn().mockResolvedValue({ keep: [true, false, true, true] }) };
    const result = await tidyPrompt('artist:a, 1girl, astonishing elements, artist:a', settings({ method: 'ai' }), service);
    expect(service.tidyPrompt).toHaveBeenCalledWith({ instruction: expect.stringContaining('质量词'), chunks: ['artist:a', '1girl', 'astonishing elements', 'artist:a'] });
    expect(result).toEqual({ text: 'artist:a, astonishing elements', kept: 2, removed: 2, rewritten: false });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('自定义要求原样交给模型；允许改写时采用模型正文且不再去重补前缀', async () => {
    const select = { tidyPrompt: vi.fn().mockResolvedValue({ keep: [false, true] }) };
    expect((await tidyPrompt('a, b', settings({ keep: 'custom', instruction: ' 只留 b ' }), select)).text).toBe('b');
    expect(select.tidyPrompt).toHaveBeenCalledWith({ instruction: '只留 b', chunks: ['a', 'b'] });
    const rewrite = { tidyPrompt: vi.fn().mockResolvedValue({ prompt: ' 1.0::a::,\n1.0::b:: ' }) };
    expect(await tidyPrompt(' a, b ', settings({ keep: 'custom', instruction: '统一权重', rewrite: true, artistPrefix: true }), rewrite)).toEqual({ text: '1.0::a::,\n1.0::b::', kept: 0, removed: 0, rewritten: true });
    expect(rewrite.tidyPrompt).toHaveBeenCalledWith({ instruction: '统一权重', rewrite: true, prompt: 'a, b' });
  });

  it('缺要求、空提示词或模型结果对不上时报错，不产出半截结果', async () => {
    const service = { tidyPrompt: vi.fn().mockResolvedValue({ keep: [true] }) };
    await expect(tidyPrompt('a, b', settings({ keep: 'custom', instruction: ' ' }), service)).rejects.toThrow('请先写好整理要求');
    await expect(tidyPrompt(' ,\n ', settings(), service)).rejects.toThrow('没有可整理的提示词');
    await expect(tidyPrompt('a, b', settings({ method: 'ai' }), service)).rejects.toThrow('助手返回的整理结果不完整');
    await expect(tidyPrompt('a', settings({ keep: 'custom', instruction: 'x', rewrite: true }), { tidyPrompt: vi.fn().mockResolvedValue({ prompt: ' ' }) })).rejects.toThrow('助手返回的整理结果无效');
  });
});
