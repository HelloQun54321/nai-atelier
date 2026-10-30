// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTagDictionaryCache } from '../../services/tagDictionary';
import * as tagDictionary from '../../services/tagDictionary';
import { findCompletionTarget, TagAutocompleteTextarea } from '../../components/TagAutocompleteTextarea';
import * as tagTranslations from '../../services/tagTranslations';
import type { PromptTagLibraryTarget } from '../../components/PromptTagLibraryInfo';

vi.mock('../../components/PromptTagLibraryInfo', () => ({ PromptTagLibraryInfo: ({ target, onClose }: { target: PromptTagLibraryTarget; onClose: () => void }) => React.createElement('div', { role: 'dialog', 'aria-label': 'Tag资料' },
  React.createElement('span', null, `${target.kind}:${target.name}:${target.chinese || ''}`), React.createElement('button', { onClick: onClose }, '关闭资料')) }));

const manifest = {
  generatedAt: 'test',
  shards: { ma: 'ma.json' },
  chineseShards: {},
  popular: {},
};

const responseFor = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
}) as Response;

const Harness: React.FC<{ initial?: string; tagAssistEnabled?: boolean; showTranslations?: boolean }> = ({ initial = '', tagAssistEnabled = true, showTranslations = false }) => {
  const [value, setValue] = useState(initial);
  return React.createElement(TagAutocompleteTextarea, {
    value,
    onValueChange: setValue,
    tagAssistEnabled,
    showTranslations,
    'aria-label': 'Prompt',
  });
};

const openSuggestions = async (textarea: HTMLTextAreaElement, value: string, caret = value.length) => {
  fireEvent.change(textarea, { target: { value } });
  textarea.setSelectionRange(caret, caret);
  fireEvent.click(textarea);
  return (await screen.findAllByRole('option'))[0];
};

const openTagInput = () => {
  fireEvent.click(screen.getByRole('button', { name: '在末尾插入提示词' }));
  const input = screen.getByRole('combobox', { name: '添加提示词' }) as HTMLTextAreaElement;
  act(() => input.focus());
  return input;
};

describe('提示词单元目录信息', () => {
  beforeEach(() => {
    resetTagDictionaryCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('manifest.json')) return responseFor({ ...manifest, shards: { sa: 'sa.json', ha: 'ha.json' } });
      if (url.includes('/shards/sa.json')) return responseFor([['sample_artist', '', 1, 25, 0], ['sample_artist_extra', '普通词', 0, 5, 0]]);
      if (url.includes('/shards/ha.json')) return responseFor([['hakurei_reimu', '博丽灵梦', 4, 51, 0]]);
      return responseFor([]);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('无中文画师与角色精确匹配，普通或未知前缀不显示，信息弹窗只在点击后挂载', async () => {
    render(React.createElement(Harness, { initial: 'artist:Sample_Artist, hakurei_reimu, sample_artist_extra, sample', showTranslations: true }));
    expect(screen.queryByRole('dialog', { name: 'Tag资料' })).toBeNull();
    const artist = await screen.findByRole('button', { name: '查看画师资料：Sample_Artist' });
    expect(screen.getByRole('button', { name: '查看角色资料：hakurei_reimu' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /查看.*资料：/ })).toHaveLength(2);
    expect(artist.closest('button button')).toBeNull();
    const unit = artist.closest('[role="button"]')!;
    expect(unit.getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(artist, { pointerType: 'touch' }); fireEvent.touchStart(artist); fireEvent.click(artist);
    fireEvent.doubleClick(artist);
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
    await screen.findByText('artist:sample_artist:');
    expect(unit.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('artist:Sample_Artist, hakurei_reimu, sample_artist_extra, sample');
    fireEvent.click(screen.getByRole('button', { name: '关闭资料' }));
    fireEvent.click(screen.getByRole('button', { name: '查看角色资料：hakurei_reimu' }));
    await screen.findByText('character:hakurei_reimu:博丽灵梦');
  });

  it('权重组内信息点击与键盘不选中或改写，原整组键盘选择及删除仍可用', async () => {
    const initial = '1.2::artist:sample_artist, hakurei_reimu::';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const info = await screen.findByRole('button', { name: '查看画师资料：sample_artist' });
    const group = info.closest('[role="button"]')!;
    expect(group.contains(screen.getByRole('button', { name: '查看角色资料：hakurei_reimu' }))).toBe(true);
    fireEvent.keyDown(info, { key: 'Enter' }); fireEvent.click(info);
    await screen.findByRole('dialog', { name: 'Tag资料' });
    expect(group.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '关闭资料' }));
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(group.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(group, { key: ' ' });
    expect(group.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    const deleteInfo = screen.getByRole('button', { name: '查看角色资料：hakurei_reimu' });
    fireEvent.click(deleteInfo);
    await screen.findByRole('dialog', { name: 'Tag资料' });
    expect((screen.getByRole('button', { name: '删除 0 个 Tag' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭资料' }));
    fireEvent.click(deleteInfo.closest('[role="button"]')!);
    fireEvent.click(screen.getByRole('button', { name: '删除 1 个 Tag' }));
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('1.2::artist:sample_artist::');
  });

  it('带信息按钮的选中权重组复制仍只输出完整原文，按钮空格及快捷键不改变选择', async () => {
    const original = '1.2::artist:sample_artist, hakurei_reimu::, ordinary';
    render(React.createElement(Harness, { initial: original, showTranslations: true }));
    const info = await screen.findByRole('button', { name: '查看画师资料：sample_artist' });
    const group = info.closest('[role="button"]')!;
    fireEvent.click(group);
    const clipboard = { setData: vi.fn() };
    fireEvent.copy(screen.getByLabelText('提示词中文翻译'), { clipboardData: clipboard });
    expect(clipboard.setData).toHaveBeenCalledExactlyOnceWith('text/plain', '1.2::artist:sample_artist, hakurei_reimu::');
    fireEvent.keyDown(info, { key: ' ' });
    fireEvent.keyDown(info, { key: 'Enter' });
    fireEvent.keyDown(info, { key: 'a', ctrlKey: true });
    expect(group.getAttribute('aria-pressed')).toBe('true');
    const ordinary = screen.getByRole('button', { name: /^ordinary\s/ });
    expect(ordinary.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe(original);
  });

  it('旧值识别迟到不会覆盖当前值的目录入口', async () => {
    let release!: (value: Map<string, tagDictionary.TagSuggestion>) => void;
    const pending = new Promise<Map<string, tagDictionary.TagSuggestion>>(resolve => { release = resolve; });
    const lookup = vi.spyOn(tagDictionary, 'lookupTagCatalogEntries').mockReturnValueOnce(pending).mockResolvedValueOnce(new Map([
      ['hakurei reimu', { name: 'hakurei_reimu', chinese: '博丽灵梦', category: 4, categoryLabel: '角色', postCount: 51, isNovelAI: false }],
    ]));
    try {
      render(React.createElement(Harness, { initial: 'sample_artist', showTranslations: true }));
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByRole('combobox', { name: 'Prompt' }), { target: { value: 'hakurei_reimu' } });
      await screen.findByRole('button', { name: '查看角色资料：hakurei_reimu' });
      await act(async () => { release(new Map([['sample artist', { name: 'sample_artist', chinese: '', category: 1, categoryLabel: '画师', postCount: 25, isNovelAI: false }]])); });
      expect(screen.getByRole('button', { name: '查看角色资料：hakurei_reimu' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /查看画师资料/ })).toBeNull();
    } finally { lookup.mockRestore(); }
  });
});

describe('TagAutocompleteTextarea 输入优先交互', () => {
  it('候选内部滚动与重复视口事件不新增提交，输入框实际移动和尺寸变化立即定位', async () => {
    let top = 100, left = 40, width = 360;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      top, left, width, right: left + width, bottom: top + 80, height: 80, x: left, y: top, toJSON() {},
    }));
    const commits = vi.fn();
    render(React.createElement(React.Profiler, { id: 'completion', onRender: commits }, React.createElement(Harness)));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    await openSuggestions(textarea, 'ma');
    const popup = screen.getByRole('listbox');
    await waitFor(() => expect(popup.style.top).toBe('184px'));
    const stableCommits = commits.mock.calls.length;
    for (let index = 0; index < 10; index++) { fireEvent.scroll(popup); fireEvent.resize(window); }
    expect(commits).toHaveBeenCalledTimes(stableCommits);
    top = 130; left = 60;
    fireEvent.scroll(textarea.parentElement!);
    expect(popup.style.top).toBe('214px');
    expect(popup.style.left).toBe('60px');
    width = 420;
    fireEvent.resize(window);
    expect(popup.style.width).toBe('420px');
    top = window.innerHeight - 100;
    fireEvent.scroll(textarea.parentElement!);
    expect(popup.style.top).toBe('');
    expect(popup.style.bottom).toBe('104px');
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(textarea.value).toContain('masterpiece');
    expect(screen.queryByRole('listbox')).toBeNull();
    vi.restoreAllMocks();
  });
  it('空 Tag 辅助区收紧，填入和清空恢复对应高度且保留手动调整', async () => {
    render(React.createElement(Harness, { showTranslations: true }));
    const list = () => screen.getByLabelText('提示词中文翻译').firstElementChild as HTMLElement;
    expect(list().classList.contains('h-10')).toBe(true);
    // 触屏通过框外把手调高，内容区仍可自然滚动；鼠标继续使用原生角标。
    expect(list().classList.contains('resize-y')).toBe(false);
    expect(list().classList.contains('pointer-fine:resize-y')).toBe(true);
    expect(list().classList.contains('overscroll-contain')).toBe(false);
    expect(list().classList.contains('pointer-fine:overscroll-contain')).toBe(true);
    expect(list().classList.contains('overflow-y-auto')).toBe(true);
    const handle = screen.getByRole('button', { name: '调整翻译区高度' });
    expect(list().contains(handle)).toBe(false);
    list().style.height = '40px';
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(list().style.height).toBe('72px');
    list().style.height = '';
    fireEvent.change(screen.getByRole('combobox', { name: 'Prompt' }), { target: { value: 'masterpiece' } });
    await waitFor(() => expect(list().classList.contains('h-36')).toBe(true));
    list().style.height = '240px';
    fireEvent.change(screen.getByRole('combobox', { name: 'Prompt' }), { target: { value: '' } });
    await waitFor(() => expect(list().classList.contains('h-10')).toBe(true));
    expect(list().style.height).toBe('240px');
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
  });
  it('原文与翻译区的高度各自调整，内容编辑不会覆盖人工高度', () => {
    render(React.createElement(Harness, { showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const list = screen.getByLabelText('提示词中文翻译').firstElementChild as HTMLElement;
    expect(textarea.classList.contains('resize-y')).toBe(true);
    textarea.style.height = '96px'; list.style.height = '144px';
    fireEvent.keyDown(screen.getByRole('button', { name: '调整输入框高度' }), { key: 'ArrowDown' });
    expect(textarea.style.height).toBe('128px'); expect(list.style.height).toBe('144px');
    fireEvent.keyDown(screen.getByRole('button', { name: '调整翻译区高度' }), { key: 'ArrowUp' });
    expect(textarea.style.height).toBe('128px'); expect(list.style.height).toBe('112px');
    fireEvent.change(textarea, { target: { value: 'unknown tag' } });
    expect(textarea.style.height).toBe('128px'); expect(list.style.height).toBe('112px');
  });
  it('手指在对照框内滑动不会选中 Tag，滚动层保留自己的滚动且不拦截手势', async () => {
    render(React.createElement(Harness, { initial: 'masterpiece, masterpiece lighting', showTranslations: true }));
    const list = screen.getByLabelText('提示词中文翻译').firstElementChild as HTMLElement;
    const chips = await within(list).findAllByText(/杰作/);
    const chip = chips.find(node => node.closest('[aria-pressed]'))!.closest('[aria-pressed]') as HTMLElement;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    const startNotPrevented = fireEvent.touchStart(chip, { touches: [{ clientX: 40, clientY: 60 }] });
    const moveNotPrevented = fireEvent.touchMove(chip, { touches: [{ clientX: 40, clientY: 20 }] });
    fireEvent.touchEnd(chip, { touches: [] });
    expect(startNotPrevented).toBe(true);
    expect(moveNotPrevented).toBe(true);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('masterpiece, masterpiece lighting');
  });
  it('Agent 填写后保留焦点，读取 body 中真实候选并点击完成补全', async () => {
    render(React.createElement('main', { 'data-agent-view': 'playground' }, React.createElement(Harness)));
    const page = readAgentPage({ query: 'Prompt' }); let operation!: ReturnType<typeof operateAgentPage>;
    act(() => { operation = operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[0].id, value: 'ma', commit: false }); });
    await screen.findAllByRole('option'); await operation;
    const popup = readAgentPage({ query: 'masterpiece' }); expect(popup.foreground).toBe('listbox');
    act(() => { operation = operateAgentPage({ action: 'click', snapshotId: popup.snapshotId, controlId: popup.controls[0].id }); }); await operation;
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toContain('masterpiece'); expect(screen.queryByRole('listbox')).toBeNull();
  });
  beforeEach(() => {
    resetTagDictionaryCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('manifest.json')) return responseFor(manifest);
      if (url.includes('/shards/ma.json')) {
        return responseFor([
          ['masterpiece', '杰作', 0, 1000000, 1],
          ['masterpiece lighting', '杰作光照', 0, 500000, 0],
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('保留用户刚输入的末尾逗号和空格', () => {
    render(React.createElement(Harness, { initial: 'masterpiece' }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'masterpiece, ' } });
    expect(textarea.value).toBe('masterpiece, ');
  });

  it.each(['masterpiece', '1.2::masterpiece, alpha::'])('助手可双击普通词或权重组成员原位编辑，标记不暴露拖动：%s', async initial => {
    render(React.createElement('main', { 'data-agent-view': 'playground' }, React.createElement(Harness, { initial, showTranslations: true })));
    await within(screen.getByLabelText('提示词中文翻译')).findByText('杰作');
    const page = readAgentPage();
    const control = page.controls.find(item => item.actions.includes('double_click') && item.label.includes('masterpiece'))!;
    expect(control).toBeTruthy(); expect(control.actions).not.toContain('drag');
    await act(async () => { await operateAgentPage({ action: 'double_click', controlId: control.id, snapshotId: page.snapshotId }); });
    const input = screen.getByRole('combobox', { name: '修改提示词' }) as HTMLTextAreaElement;
    expect(input.value).toBe('masterpiece');
    fireEvent.change(input, { target: { value: 'replacement' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe(initial.replace('masterpiece', 'replacement'));
  });

  it('双击译文修改同一份原文，改词立即去掉旧译文并按新词匹配，文本框修改也同步', async () => {
    render(React.createElement(Harness, { initial: 'masterpiece', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.doubleClick(await within(zone).findByText('杰作'));
    const input = screen.getByRole('combobox', { name: '修改提示词' }) as HTMLTextAreaElement;
    expect(input.value).toBe('masterpiece');
    fireEvent.change(input, { target: { value: 'masterpiece lighting' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe('masterpiece lighting');
    expect(within(zone).queryByText('杰作')).toBeNull();
    expect(within(zone).getByText('待翻译')).toBeTruthy();
    await within(zone).findByText('杰作光照');
    fireEvent.change(textarea, { target: { value: 'unknown replacement' } });
    expect(within(zone).getByText('unknown replacement')).toBeTruthy();
    expect(within(zone).queryByText('杰作光照')).toBeNull();
    expect(within(zone).getByText('待翻译')).toBeTruthy();
    fireEvent.doubleClick(within(zone).getByText('unknown replacement'));
    fireEvent.change(screen.getByRole('combobox', { name: '修改提示词' }), { target: { value: 'masterpiece' } });
    fireEvent.blur(screen.getByRole('combobox', { name: '修改提示词' }));
    expect(textarea.value).toBe('masterpiece');
    await within(zone).findByText('杰作');
  });

  it.each([
    ['alpha, alpha, tail', 'alpha, '],
    ['alpha, 2::alpha, beta::, tail', 'alpha, 2::'],
  ])('编辑 %s 时只高亮当前重复词，草稿变化仍定位原位置，取消后清除', (initial, prefix) => {
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.doubleClick(within(zone).getAllByText('alpha')[1]);
    const input = screen.getByRole('combobox', { name: '修改提示词' });
    const checkHighlight = () => {
      const marks = document.querySelectorAll('[data-prompt-highlight]');
      expect(marks).toHaveLength(1);
      expect(marks[0].textContent).toBe('alpha');
      expect(marks[0].previousSibling?.textContent).toBe(prefix);
      expect(zone.querySelector('[role="button"][aria-pressed="true"]')).toBeNull();
    };
    checkHighlight();
    fireEvent.change(input, { target: { value: 'much longer replacement' } });
    checkHighlight();
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe(initial);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.querySelector('[data-prompt-highlight]')).toBeNull();
  });

  it.each(['masterpiece', '2::masterpiece, alpha::'])('编辑 %s 的草稿未保存也显示当前词译文，未知词立即待翻译且不调模型', async initial => {
    const translate = vi.spyOn(tagTranslations, 'translateMissingPromptTags');
    try {
      render(React.createElement(Harness, { initial, showTranslations: true }));
      const zone = screen.getByLabelText('提示词中文翻译');
      fireEvent.doubleClick(await within(zone).findByText('杰作'));
      const input = screen.getByRole('combobox', { name: '修改提示词' });
      fireEvent.change(input, { target: { value: 'masterpiece lighting' } });
      expect(within(zone).queryByText('杰作')).toBeNull();
      await within(zone).findByText('杰作光照');
      const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
      expect(textarea.value).toBe(initial);
      fireEvent.change(input, { target: { value: 'unknown draft' } });
      expect(within(zone).queryByText('杰作光照')).toBeNull();
      expect(within(zone).getAllByText('待翻译').length).toBeGreaterThan(0);
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(textarea.value).toBe(initial);
      await within(zone).findByText('杰作');
      expect(translate).not.toHaveBeenCalled();
    } finally { translate.mockRestore(); }
  });

  it('空白插入的草稿也即时显示已有译文，不提前写入原文', async () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const input = openTagInput();
    fireEvent.change(input, { target: { value: 'masterpiece lighting' } });
    await within(screen.getByLabelText('提示词中文翻译')).findByText('杰作光照');
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('alpha');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe('alpha, masterpiece lighting');
  });

  it('旧草稿的译文迟到不覆盖当前草稿，也不改变原文', async () => {
    let release!: (items: tagTranslations.PromptTagTranslation[]) => void;
    const pending = new Promise<tagTranslations.PromptTagTranslation[]>(resolve => { release = resolve; });
    let oldTokens: tagTranslations.PromptTagTranslation[] = [];
    const lookup = vi.spyOn(tagTranslations, 'resolvePromptTranslations').mockImplementation(async tokens => {
      if (tokens.some(token => token.lookupTag === 'old draft')) {
        oldTokens = tokens.map(token => ({ ...token, chinese: '旧草稿译文', source: 'dictionary' as const }));
        return pending;
      }
      return tokens.map(token => ({ ...token, chinese: token.lookupTag === 'new draft' ? '新草稿译文' : undefined, source: token.lookupTag === 'new draft' ? 'dictionary' as const : 'missing' as const }));
    });
    try {
      render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
      const zone = screen.getByLabelText('提示词中文翻译');
      fireEvent.doubleClick(within(zone).getByText('alpha'));
      const input = screen.getByRole('combobox', { name: '修改提示词' });
      fireEvent.change(input, { target: { value: 'old draft' } });
      await waitFor(() => expect(oldTokens).toHaveLength(1));
      fireEvent.change(input, { target: { value: 'new draft' } });
      await within(zone).findByText('新草稿译文');
      await act(async () => { release(oldTokens); });
      expect(within(zone).queryByText('旧草稿译文')).toBeNull();
      expect(within(zone).getByText('新草稿译文')).toBeTruthy();
      expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('alpha');
    } finally { lookup.mockRestore(); }
  });

  it.each([
    ['alpha, alpha', 1, 'alpha, gamma', 'alpha'],
    ['1.2::alpha, alpha::, tail', 1, '1.2::alpha, gamma::, tail', 'alpha'],
    ['{{alpha, beta}}, tail', 0, '{{gamma, beta}}, tail', 'alpha'],
    ['2::{{alpha}}, [beta]::，\ntail', 0, '2::{{gamma}}, [beta]::，\ntail', 'alpha'],
    ['artist:alpha, beta', 0, 'artist:gamma, beta', 'alpha'],
    ['artist:art, beta', 0, 'artist:gamma, beta', 'art'],
    ['1.2::[artist:art], beta::', 0, '1.2::[artist:gamma], beta::', 'art'],
    ['(artist:art:1.2), beta', 0, '(artist:gamma:1.2), beta', 'art'],
  ] as const)('双击 %s 中第 %s 个同名词，只替换该词并保留权重和格式，可撤销重做', (initial, occurrence, expected, tag) => {
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.doubleClick(within(zone).getAllByText(tag)[occurrence]);
    const input = screen.getByRole('combobox', { name: '修改提示词' }) as HTMLTextAreaElement;
    expect(input.value).toBe(tag);
    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe(expected);
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(textarea.value).toBe(initial);
    fireEvent.keyDown(zone, { key: 'y', ctrlKey: true });
    expect(textarea.value).toBe(expected);
  });

  it('修改 Tag 复用补全与输入法保护，候选确认后失焦提交，Esc 取消后续修改', async () => {
    render(React.createElement(Harness, { initial: '2::alpha, beta::', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.doubleClick(within(zone).getByText('alpha'));
    const input = screen.getByRole('combobox', { name: '修改提示词' }) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: 'ma' } });
    const option = (await screen.findAllByRole('option'))[0];
    fireEvent.blur(input, { relatedTarget: option });
    expect(textarea.value).toBe('2::alpha, beta::');
    fireEvent.click(option);
    expect(input.value).toBe('masterpiece');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(textarea.value).toBe('2::alpha, beta::');
    fireEvent.compositionEnd(input);
    fireEvent.blur(input);
    expect(textarea.value).toBe('2::masterpiece, beta::');
    fireEvent.doubleClick(within(zone).getByText('beta'));
    const nextInput = screen.getByRole('combobox', { name: '修改提示词' });
    fireEvent.change(nextInput, { target: { value: 'cancelled' } });
    fireEvent.keyDown(nextInput, { key: 'Escape' });
    expect(textarea.value).toBe('2::masterpiece, beta::');
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
  });

  it('修改 Tag 后点击相邻空白先保存修改，再以空草稿插入，不把改词误追加', async () => {
    render(React.createElement(Harness, { initial: 'alpha, beta', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.doubleClick(within(zone).getByText('alpha'));
    const input = screen.getByRole('combobox', { name: '修改提示词' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: 'longer replacement' } });
    const marker = screen.getByRole('button', { name: '插入提示词：位置 2' });
    expect(fireEvent.mouseDown(marker)).toBe(true);
    act(() => marker.focus());
    expect(textarea.value).toBe('longer replacement, beta');
    fireEvent.click(marker);
    const insertion = screen.getByRole('combobox', { name: '插入提示词' }) as HTMLTextAreaElement;
    expect(insertion.value).toBe('');
    fireEvent.change(insertion, { target: { value: 'gamma' } });
    fireEvent.keyDown(insertion, { key: 'Enter' });
    expect(textarea.value).toBe('longer replacement, gamma, beta');
  });

  it.each(['alpha, beta', '2::alpha, beta::'])('长词与多行草稿可完整修改并保存，保留 %s 的其余内容', initial => {
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const zone = screen.getByLabelText('提示词中文翻译');
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.doubleClick(within(zone).getByText('alpha'));
    const input = screen.getByRole('combobox', { name: '修改提示词' }) as HTMLTextAreaElement;
    expect(input.tagName).toBe('TEXTAREA');
    const draft = 'a_long_tag_with_many_details_'.repeat(8) + '\nanother complete tag';
    fireEvent.change(input, { target: { value: draft } });
    fireEvent.doubleClick(input);
    expect(input.value).toBe(draft);
    expect(textarea.value).toBe(initial);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe(initial.replace('alpha', draft));
    expect(within(zone).getByText('another complete tag')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(textarea.value).toBe(initial);
  });

  it('空白插入同样保留完整多行草稿，失焦写回原文', () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const input = openTagInput();
    const draft = 'long inserted tag with all details\nsecond inserted tag';
    fireEvent.change(input, { target: { value: draft } });
    expect(input.value).toBe(draft);
    fireEvent.blur(input);
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe(`alpha, ${draft}`);
  });

  it.each([{ readOnly: true }, { disabled: true }])('只读或锁定时双击不能修改，编辑中锁定也不能提交草稿：%j', locked => {
    const onValueChange = vi.fn();
    const props = { value: 'alpha', onValueChange, 'aria-label': 'Prompt' };
    const view = render(React.createElement(TagAutocompleteTextarea, { ...props, ...locked }));
    fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('alpha'));
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
    view.rerender(React.createElement(TagAutocompleteTextarea, props));
    fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('alpha'));
    const input = screen.getByRole('combobox', { name: '修改提示词' });
    fireEvent.change(input, { target: { value: 'draft' } });
    view.rerender(React.createElement(TagAutocompleteTextarea, { ...props, ...locked }));
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
    fireEvent.blur(input);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('外部换内容取消旧修改草稿，删除模式下双击不打开修改框', () => {
    const onValueChange = vi.fn();
    const view = render(React.createElement(TagAutocompleteTextarea, { value: 'alpha', onValueChange, 'aria-label': 'Prompt' }));
    fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('alpha'));
    const input = screen.getByRole('combobox', { name: '修改提示词' });
    fireEvent.change(input, { target: { value: 'old draft' } });
    view.rerender(React.createElement(TagAutocompleteTextarea, { value: 'beta', onValueChange, 'aria-label': 'Prompt' }));
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('beta'));
    expect(screen.queryByRole('combobox', { name: '修改提示词' })).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('换词后旧译文请求迟到仍显示当前词的待翻译，且不自动请求模型翻译', async () => {
    let release!: (items: tagTranslations.PromptTagTranslation[]) => void;
    const pending = new Promise<tagTranslations.PromptTagTranslation[]>(resolve => { release = resolve; });
    const lookup = vi.spyOn(tagTranslations, 'resolvePromptTranslations').mockReturnValueOnce(pending)
      .mockImplementation(async tokens => tokens.map(token => ({ ...token, source: 'missing' as const })));
    const translate = vi.spyOn(tagTranslations, 'translateMissingPromptTags');
    try {
      render(React.createElement(Harness, { initial: 'masterpiece', showTranslations: true }));
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
      const oldTokens = lookup.mock.calls[0][0];
      fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('masterpiece'));
      const input = screen.getByRole('combobox', { name: '修改提示词' });
      fireEvent.change(input, { target: { value: 'unknown replacement' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await act(async () => { release(oldTokens.map(token => ({ ...token, chinese: '旧杰作译文', source: 'dictionary' as const }))); });
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
      const zone = screen.getByLabelText('提示词中文翻译');
      expect(within(zone).queryByText('旧杰作译文')).toBeNull();
      expect(within(zone).getByText('unknown replacement')).toBeTruthy();
      expect(within(zone).getByText('待翻译')).toBeTruthy();
      expect(translate).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); translate.mockRestore(); }
  });

  it('默认清空操作放在框外，原位撤销恢复输入焦点并保留重做历史', () => {
    render(React.createElement(Harness, { initial: 'alpha, beta', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;

    const clear = screen.getByRole('button', { name: '清空当前提示词' });
    expect(clear.parentElement!.nextElementSibling).toBe(textarea.parentElement);
    expect(clear.classList.contains('absolute')).toBe(false);
    expect(clear.classList.contains('mobile-touch')).toBe(true);
    expect(textarea.className).not.toMatch(/pr-14|md:pr-9/);
    fireEvent.click(clear);
    expect(textarea.value).toBe('');
    expect(document.activeElement).toBe(textarea);
    expect(screen.getByRole('button', { name: '撤销清空' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '撤销清空' }));
    expect(textarea.value).toBe('alpha, beta');
    expect(document.activeElement).toBe(textarea);
    fireEvent.keyDown(textarea, { key: 'y', ctrlKey: true });
    expect(textarea.value).toBe('');
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true });
    expect(textarea.value).toBe('alpha, beta');
  });

  it('外部操作槽首次挂载和切换均获得清空按钮，撤销与快捷键归还对应输入焦点', () => {
    const WithSlot = () => {
      const first = React.useRef<HTMLSpanElement>(null), second = React.useRef<HTMLSpanElement>(null);
      const [value, setValue] = useState('slot prompt');
      const [alternate, setAlternate] = useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement('div', { role: 'group', 'aria-label': '操作甲' }, React.createElement('span', { ref: first })),
        React.createElement('div', { role: 'group', 'aria-label': '操作乙' }, React.createElement('span', { ref: second })),
        React.createElement('button', { onClick: () => setAlternate(current => !current) }, '切换操作槽'),
        React.createElement(TagAutocompleteTextarea, { value, onValueChange: setValue, clearActionSlotRef: alternate ? second : first, tagAssistEnabled: false, 'aria-label': '槽位输入' }));
    };
    render(React.createElement(WithSlot));
    const textarea = screen.getByRole('textbox', { name: '槽位输入' }) as HTMLTextAreaElement;
    const first = screen.getByRole('group', { name: '操作甲' }), second = screen.getByRole('group', { name: '操作乙' });
    const clear = within(first).getByRole('button', { name: '清空当前提示词' });
    expect(textarea.parentElement!.contains(clear)).toBe(false);
    fireEvent.click(clear); expect(textarea.value).toBe(''); expect(document.activeElement).toBe(textarea);
    fireEvent.click(screen.getByRole('button', { name: '切换操作槽' }));
    expect(within(first).queryByRole('button')).toBeNull();
    fireEvent.click(within(second).getByRole('button', { name: '撤销清空' }));
    expect(textarea.value).toBe('slot prompt'); expect(document.activeElement).toBe(textarea);
    fireEvent.keyDown(textarea, { key: 'y', ctrlKey: true }); expect(textarea.value).toBe('');
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true }); expect(textarea.value).toBe('slot prompt');
  });

  it('关闭 Tag 辅助后仍可用 Ctrl/Cmd+Z 撤销清空并用重做快捷键恢复清空', () => {
    render(React.createElement(Harness, { initial: 'alpha', tagAssistEnabled: false, showTranslations: true }));
    const textarea = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole('button', { name: '清空当前提示词' }));
    expect(textarea.value).toBe('');
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe('alpha');
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true, shiftKey: true });
    expect(textarea.value).toBe('');
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true });
    expect(textarea.value).toBe('alpha');
  });

  it('清空退出 Tag 删除模式、清除选择与候选，之后撤销恢复未选中的原文', async () => {
    render(React.createElement(Harness, { initial: 'alpha, beta', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /^alpha\s/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));

    fireEvent.click(screen.getByRole('button', { name: '清空当前提示词' }));
    expect(textarea.value).toBe('');
    expect(screen.queryByRole('button', { name: /删除 \d+ 个 Tag/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销清空' }));
    expect(textarea.value).toBe('alpha, beta');
    expect(screen.getByRole('button', { name: /^alpha\s/ }).getAttribute('aria-pressed')).toBe('false');

    await openSuggestions(textarea, 'mas');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清空当前提示词' }));
    expect(textarea.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it.each([
    { value: '', props: {} },
    { value: 'alpha', props: { disabled: true } },
    { value: 'alpha', props: { readOnly: true } },
  ])('空值、disabled 或 readOnly 时清空按钮常驻但禁用：%j', ({ value, props }) => {
    render(React.createElement(TagAutocompleteTextarea, { value, onValueChange: vi.fn(), ...props }));
    expect((screen.getByRole('button', { name: '清空当前提示词' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('外部替换内容会丢弃旧清空历史，新清空只能撤销回替换后的值', () => {
    const ExternalHarness = () => {
      const [value, setValue] = useState('alpha');
      return React.createElement(React.Fragment, null,
        React.createElement(TagAutocompleteTextarea, { value, onValueChange: setValue, tagAssistEnabled: false, showTranslations: false, 'aria-label': 'Prompt' }),
        React.createElement('button', { type: 'button', onClick: () => setValue('external') }, '外部替换'));
    };
    render(React.createElement(ExternalHarness));
    const textarea = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '清空当前提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '外部替换' }));
    expect(textarea.value).toBe('external');
    expect(screen.queryByRole('button', { name: '撤销清空' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清空当前提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销清空' }));
    expect(textarea.value).toBe('external');
  });

  it('关闭 Tag 辅助后保留普通文本输入且不查询词典', async () => {
    render(React.createElement(Harness, { tagAssistEnabled: false, showTranslations: true }));
    const textarea = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: '一个女孩坐在窗边，夕阳照进房间' } });
    fireEvent.click(textarea);

    await new Promise(resolve => window.setTimeout(resolve, 120));
    expect(textarea.value).toBe('一个女孩坐在窗边，夕阳照进房间');
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByLabelText('提示词中文翻译')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('查询等待期间关闭 Tag 辅助会取消候选请求', async () => {
    const ToggleHarness = () => {
      const [enabled, setEnabled] = useState(true);
      return React.createElement(React.Fragment, null,
        React.createElement(Harness, { tagAssistEnabled: enabled }),
        React.createElement('button', { type: 'button', onClick: () => setEnabled(false) }, '关闭辅助'));
    };
    render(React.createElement(ToggleHarness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'mas' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭辅助' }));

    await new Promise(resolve => window.setTimeout(resolve, 120));
    expect(screen.queryByRole('option')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('候选出现时普通 Enter 和 Tab 不接管原生输入', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    expect(fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(textarea, { key: 'Tab', code: 'Tab' })).toBe(true);
    expect(textarea.value).toBe('mas');
  });

  it('即使已用方向键浏览候选，Tab 仍保留焦点切换语义', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(fireEvent.keyDown(textarea, { key: 'Tab', code: 'Tab' })).toBe(true);
    expect(textarea.value).toBe('mas');
  });

  it('方向键明确选中候选后才允许 Enter 补全', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })).toBe(false);
    await waitFor(() => expect(textarea.value).toBe('masterpiece'));
  });

  it('中文输入法组合期间不会拦截确认键', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', isComposing: true })).toBe(true);
    expect(textarea.value).toBe('mas');

    fireEvent.compositionStart(textarea);
    expect(fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', isComposing: true })).toBe(true);
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('输入法开始组合时取消尚未执行的补全查询', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'mas' } });
    fireEvent.compositionStart(textarea);

    await new Promise(resolve => window.setTimeout(resolve, 120));
    expect(screen.queryByRole('option')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('输入法开始组合后忽略已经发出但迟到的旧候选', async () => {
    let resolveShard!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('manifest.json')) return responseFor(manifest);
      if (url.includes('/shards/ma.json')) return new Promise<Response>(resolve => { resolveShard = resolve; });
      throw new Error(`Unexpected request: ${url}`);
    }));
    resetTagDictionaryCache();
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'mas' } });

    await waitFor(() => expect(resolveShard).toBeTypeOf('function'));
    fireEvent.compositionStart(textarea);
    resolveShard(responseFor([['masterpiece', '杰作', 0, 1000000, 1]]));

    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('输入逗号后保留分隔符并立即关闭上一项候选', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    fireEvent.change(textarea, { target: { value: 'mas, ' } });
    expect(textarea.value).toBe('mas, ');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('单击候选即可完成补全', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const option = await openSuggestions(textarea, 'mas');

    fireEvent.click(option);
    await waitFor(() => expect(textarea.value).toBe('masterpiece'));
  });

  it('在 Tag 中间补全时替换整个当前 Tag 而不是残留后缀', async () => {
    render(React.createElement(Harness, { initial: 'masteroldpiece, 1girl' }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    textarea.setSelectionRange(3, 3);
    fireEvent.click(textarea);
    const option = (await screen.findAllByRole('option'))[0];

    fireEvent.click(option);
    await waitFor(() => expect(textarea.value).toBe('masterpiece, 1girl'));
  });

  it('Tag 输入复用候选与方向键，补全保留权重包装，确认后才追加且可以撤销', async () => {
    render(React.createElement(Harness, { initial: '1girl', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const input = openTagInput();
    fireEvent.change(input, { target: { value: '1.2::masteroldpiece::, next' } });
    input.setSelectionRange(8, 8);
    fireEvent.click(input);
    await screen.findAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('1.2::masterpiece::, next');
    expect(textarea.value).toBe('1girl');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe('1girl, 1.2::masterpiece::, next');
    expect(screen.queryByRole('combobox', { name: '添加提示词' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(textarea.value).toBe('1girl');
  });

  it.each([
    ['alpha, beta', 1, 'gamma, alpha, beta'],
    ['alpha, beta', 2, 'alpha, gamma, beta'],
    ['2::alpha, beta::, delta', 2, '2::alpha, gamma, beta::, delta'],
    ['{{alpha, beta}}, delta', 2, '{{alpha, gamma, beta}}, delta'],
    ['alpha, 2::beta, delta::', 2, 'alpha, gamma, 2::beta, delta::'],
    ['alpha，\nbeta|delta', 2, 'alpha，\ngamma, beta|delta'],
  ] as const)('在 %s 的位置 %s 就地插入，保留其他原文和权重，支持撤销', async (initial, position, expected) => {
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const marker = screen.getByRole('button', { name: `插入提示词：位置 ${position}` });
    fireEvent.click(marker);
    const input = screen.getByRole('combobox', { name: '插入提示词' }) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.click(input);
    expect(screen.getByLabelText('提示词中文翻译').querySelector('[role="button"][aria-pressed="true"]')).toBeNull();
    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe(expected);
    expect(screen.queryByRole('combobox', { name: '插入提示词' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(textarea.value).toBe(initial);
    expect(screen.getByRole('button', { name: '在末尾插入提示词' })).toBeTruthy();
  });

  it('插入位置复用词库补全、输入法保护和失焦提交，之后仍可移回末尾', async () => {
    render(React.createElement(Harness, { initial: 'alpha, beta', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '插入提示词：位置 2' }));
    let input = screen.getByRole('combobox', { name: '插入提示词' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'ma' } });
    await screen.findAllByRole('option');
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(input.value).toBe('masterpiece');
    expect(textarea.value).toBe('alpha, beta');
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(textarea.value).toBe('alpha, beta');
    fireEvent.compositionEnd(input);
    fireEvent.blur(input);
    expect(textarea.value).toBe('alpha, masterpiece, beta');
    fireEvent.click(screen.getByRole('button', { name: '在末尾插入提示词' }));
    input = screen.getByRole('combobox', { name: '添加提示词' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'delta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe('alpha, masterpiece, beta, delta');
  });

  it.each([1, 2])('位置 %s 默认只留空白，空输入失焦后收回，不保留加号、占位文字或大输入框', position => {
    render(React.createElement(Harness, { initial: '2::alpha, beta::, gamma', showTranslations: true }));
    const zone = screen.getByLabelText('提示词中文翻译');
    const marker = screen.getByRole('button', { name: `插入提示词：位置 ${position}` });
    expect(marker.textContent).toBe(''); expect(marker.querySelector('svg')).toBeNull(); expect(marker.getAttribute('title')).toBeNull();
    expect(within(zone).queryByRole('combobox')).toBeNull();
    fireEvent.click(marker);
    const input = within(zone).getByRole('combobox') as HTMLTextAreaElement;
    expect(input.getAttribute('placeholder')).toBeNull(); expect(input.classList.contains('flex-1')).toBe(false);
    fireEvent.blur(input);
    expect(within(zone).queryByRole('combobox')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('2::alpha, beta::, gamma');
  });

  it('取消插入或空回车会收起输入框，再点空白仍能输入，末尾也不常驻输入框', () => {
    render(React.createElement(Harness, { initial: 'alpha, beta', showTranslations: true }));
    const zone = screen.getByLabelText('提示词中文翻译');
    let input = openTagInput();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(zone).queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '插入提示词：位置 2' }));
    input = within(zone).getByRole('combobox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'cancelled' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(zone).queryByRole('combobox')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('alpha, beta');
    input = openTagInput();
    expect(input.value).toBe('');
  });

  it('译文按位置高亮对应原文，重复词、多选、整组与删除选择互不误定位', () => {
    const initial = 'alpha, beta, alpha, 2::gamma, delta::';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const highlights = () => [...document.querySelectorAll('[data-prompt-highlight]')].map(node => node.textContent);
    const alphas = screen.getAllByRole('button', { name: /^alpha\s/ });
    fireEvent.click(alphas[1]);
    expect(highlights()).toEqual(['alpha']);
    const text = document.querySelector('[data-prompt-highlight-layer]')!.firstElementChild!;
    expect(text.firstChild?.textContent).toBe('alpha, beta, ');
    expect(textarea.style.webkitTextFillColor).toBe('transparent');
    expect(document.querySelector('[data-prompt-highlight]')!.className).toContain('text-[var(--nai-accent)]');
    fireEvent.click(screen.getByRole('button', { name: /^beta\s/ }));
    expect(highlights()).toEqual(['beta', 'alpha']);
    fireEvent.click(screen.getByRole('button', { name: /gamma.*delta/ }));
    expect(highlights()).toEqual(['beta', 'alpha', '2::gamma, delta::']);
    expect(textarea.value).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.click(screen.getByRole('button', { name: /^gamma\s/ }));
    expect(highlights()).toEqual(['gamma']);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(highlights()).toEqual([]);
    expect(textarea.style.webkitTextFillColor).toBe('');
    fireEvent.click(screen.getAllByRole('button', { name: /^alpha\s/ })[0]);
    fireEvent.change(textarea, { target: { value: 'new prompt' } });
    expect(highlights()).toEqual([]);
  });

  it('外部换内容清除旧插入位置与草稿，锁定后不保留可写入入口', () => {
    const onValueChange = vi.fn();
    const view = render(React.createElement(TagAutocompleteTextarea, { value: 'alpha, beta', onValueChange, 'aria-label': 'Prompt' }));
    fireEvent.click(screen.getByRole('button', { name: '插入提示词：位置 2' }));
    fireEvent.change(screen.getByRole('combobox', { name: '插入提示词' }), { target: { value: 'draft' } });
    view.rerender(React.createElement(TagAutocompleteTextarea, { value: 'new, words', onValueChange, 'aria-label': 'Prompt' }));
    expect(screen.queryByRole('combobox', { name: '插入提示词' })).toBeNull();
    expect(openTagInput().value).toBe('');
    expect(onValueChange).not.toHaveBeenCalled();
    view.rerender(React.createElement(TagAutocompleteTextarea, { value: 'new, words', onValueChange, disabled: true, 'aria-label': 'Prompt' }));
    expect(screen.queryByRole('combobox', { name: '添加提示词' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^插入提示词：位置/ })).toHaveLength(0);
  });

  it('原文高亮跟随输入框滚动、实际内容宽度与样式变化，另一输入框不受影响', async () => {
    render(React.createElement(React.Fragment, null,
      React.createElement(Harness, { initial: 'alpha, beta', showTranslations: true }),
      React.createElement(Harness, { initial: 'other', showTranslations: true })));
    const textarea = screen.getAllByRole('combobox', { name: 'Prompt' })[0] as HTMLTextAreaElement;
    Object.defineProperties(textarea, { clientWidth: { configurable: true, value: 280 }, clientHeight: { configurable: true, value: 96 } });
    Object.assign(textarea.style, { paddingLeft: '12px', borderWidth: '2px', fontSize: '16px', lineHeight: '24px', letterSpacing: '1px', color: 'rgb(30, 40, 50)' });
    fireEvent.click(screen.getByRole('button', { name: /^beta\s/ }));
    const layer = document.querySelector('[data-prompt-highlight-layer]') as HTMLElement;
    const text = layer.firstElementChild as HTMLElement;
    expect(layer.style.width).toBe('280px'); expect(layer.style.height).toBe('96px');
    expect(layer.style.left).toBe('2px'); expect(text.style.paddingLeft).toBe('12px');
    expect(text.style.fontSize).toBe('16px'); expect(text.style.lineHeight).toBe('24px'); expect(text.style.letterSpacing).toBe('1px');
    textarea.scrollTop = 48; textarea.scrollLeft = 6; fireEvent.scroll(textarea);
    expect(text.style.transform).toBe('translate(-6px, -48px)');
    textarea.style.color = 'rgb(200, 210, 220)'; fireEvent.resize(window);
    expect(layer.style.color).toBe('rgb(200, 210, 220)');
    expect((screen.getAllByRole('combobox', { name: 'Prompt' })[1] as HTMLTextAreaElement).style.webkitTextFillColor).toBe('');
    expect(screen.queryAllByRole('combobox', { name: '插入提示词' })).toHaveLength(0);
  });

  it('鼠标或焦点进入候选时不提前追加半截词，选中候选后仍可继续输入', async () => {
    render(React.createElement(Harness, { showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const input = openTagInput();
    fireEvent.change(input, { target: { value: '{mas}' } });
    input.setSelectionRange(4, 4); fireEvent.click(input);
    const option = (await screen.findAllByRole('option'))[0];
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.blur(input, { relatedTarget: option });
    expect(textarea.value).toBe('');
    fireEvent.click(option);
    expect(input.value).toBe('{masterpiece}');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(input, { target: { value: '{masterpiece}, next' } });
    fireEvent.blur(input);
    expect(textarea.value).toBe('{masterpiece}, next');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('焦点从输入框进入候选时保留草稿，真正离开候选区后提交并收起', async () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const input = openTagInput();
    fireEvent.change(input, { target: { value: 'mas' } });
    const option = (await screen.findAllByRole('option'))[0];
    act(() => option.focus());
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('alpha');
    expect(screen.getByRole('combobox', { name: '添加提示词' })).toBe(input);
    act(() => textarea.focus());
    expect(textarea.value).toBe('alpha, mas');
    expect(within(screen.getByLabelText('提示词中文翻译')).queryByRole('combobox')).toBeNull();
  });

  it('输入法组合期间失焦不提前提交，组合结束后写入并收起', () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const input = openTagInput();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '新词' } });
    act(() => input.blur());
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('alpha');
    fireEvent.compositionEnd(input);
    expect(textarea.value).toBe('alpha, 新词');
    expect(within(screen.getByLabelText('提示词中文翻译')).queryByRole('combobox')).toBeNull();
  });

  it('候选跟随当前输入框，切换输入与滚动后重新定位，并只关联当前字段', async () => {
    render(React.createElement(Harness, { showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 150, left: 32, width: 600 } as DOMRect);
    await openSuggestions(textarea, 'mas');
    expect(screen.getByRole('listbox').style.top).toBe('154px');
    const input = openTagInput();
    const tagRect = vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 340, left: 900, width: 160 } as DOMRect);
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'mas' } });
    await screen.findAllByRole('option');
    expect(screen.getByRole('listbox').style.top).toBe('344px');
    expect(screen.getByRole('listbox').style.left).toBe(`${window.innerWidth - 280 - 8}px`);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(textarea.getAttribute('aria-expanded')).toBe('false');
    expect(textarea.hasAttribute('aria-controls')).toBe(false);
    tagRect.mockReturnValue({ top: 320, bottom: 360, left: 900, width: 160 } as DOMRect);
    fireEvent.scroll(screen.getByLabelText('提示词中文翻译'));
    expect(screen.getByRole('listbox').style.top).toBe('364px');
    fireEvent.focus(textarea);
    await screen.findAllByRole('option');
    expect(screen.getByRole('listbox').style.top).toBe('154px');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(textarea.getAttribute('aria-expanded')).toBe('true');
  });

  it('Tag 输入法确认不提交，组合期间取消查询，结束后可补全，Escape 只关闭候选', async () => {
    render(React.createElement(Harness, { showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const input = openTagInput();
    vi.mocked(fetch).mockClear();
    fireEvent.change(input, { target: { value: 'mas' } });
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    await new Promise(resolve => window.setTimeout(resolve, 120));
    expect(fetch).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');
    fireEvent.compositionEnd(input);
    await screen.findAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('mas');
    expect(textarea.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe('mas');
  });

  it('拖动改变编辑区尺寸后候选重新定位，Tag 输入和固定工具栏各自保留状态', async () => {
    let resized!: ResizeObserverCallback;
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    render(React.createElement(Harness, { showTranslations: true }));
    const input = openTagInput();
    const list = input.parentElement!;
    const rect = vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, left: 20, width: 500 } as DOMRect);
    fireEvent.change(input, { target: { value: 'mas' } });
    await screen.findAllByRole('option');
    expect(observe).toHaveBeenCalledWith(list);
    expect(screen.getByRole('listbox').style.top).toBe('144px');
    list.style.height = '280px';
    rect.mockReturnValue({ top: 200, bottom: 240, left: 20, width: 500 } as DOMRect);
    act(() => resized([], {} as ResizeObserver));
    expect(screen.getByRole('listbox').style.top).toBe('244px');
    fireEvent.change(input, { target: { value: 'mas, next' } });
    expect(list.style.height).toBe('280px');
    expect(input.value).toBe('mas, next');
    expect(list.contains(screen.getByRole('button', { name: '撤销' }))).toBe(false);
    cleanup();
    expect(disconnect).toHaveBeenCalled();
  });

  it.each(['focus', 'disabled', 'tagAssistEnabled', 'showTranslations'] as const)('Tag 查询迟到时不能覆盖切换后的输入或重新打开候选：%s', async change => {
    let resolveShard!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('manifest.json')) return responseFor(manifest);
      if (url.includes('/shards/ma.json')) return new Promise<Response>(resolve => { resolveShard = resolve; });
      throw new Error(`Unexpected request: ${url}`);
    }));
    resetTagDictionaryCache();
    const onValueChange = vi.fn();
    const props = { value: '', onValueChange, showTranslations: true, 'aria-label': 'Prompt' };
    const view = render(React.createElement(TagAutocompleteTextarea, props));
    const input = openTagInput();
    fireEvent.change(input, { target: { value: 'mas' } });
    await waitFor(() => expect(resolveShard).toBeTypeOf('function'));
    if (change === 'focus') fireEvent.focus(screen.getByRole('combobox', { name: 'Prompt' }));
    else view.rerender(React.createElement(TagAutocompleteTextarea, { ...props, [change]: change === 'disabled' }));
    await act(async () => { resolveShard(responseFor([['masterpiece', '杰作', 0, 1000000, 1]])); });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('TagAutocompleteTextarea 连续输入与键盘视口回归', () => {
  const suggestion = (name: string): tagDictionary.TagSuggestion => ({ name, chinese: name, category: 0, categoryLabel: 'Tag', postCount: 10, isNovelAI: false });
  const tickSearch = () => act(async () => { await vi.advanceTimersByTimeAsync(80); });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => responseFor(manifest)));
    vi.spyOn(tagDictionary, 'lookupTagCatalogEntries').mockResolvedValue(new Map());
    vi.spyOn(tagTranslations, 'resolvePromptTranslations').mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['Prompt', '添加提示词'])('%s 连续输入在防抖与异步等待期间保留候选，迟到结果不覆盖，空结果关闭', async label => {
    let resolveOlder!: (items: tagDictionary.TagSuggestion[]) => void;
    let resolveLatest!: (items: tagDictionary.TagSuggestion[]) => void;
    const search = vi.spyOn(tagDictionary, 'searchTagDictionary')
      .mockResolvedValueOnce([suggestion('old_one'), suggestion('old_two')])
      .mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveLatest = resolve; }))
      .mockResolvedValueOnce([]);
    render(React.createElement(Harness, { showTranslations: label !== 'Prompt' }));
    // 上游改为点击插入位置后才出现「添加提示词」输入框。
    const input = (label === '添加提示词' ? openTagInput() : screen.getByRole('combobox', { name: label })) as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'ma' } });
    expect(screen.getByText('正在加载 Tag…')).toBeTruthy();
    await tickSearch();
    const popup = screen.getByRole('listbox');
    const oldOptions = screen.getAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'mas' } });
    expect(screen.getAllByRole('option')).toEqual(oldOptions);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(screen.queryByText('正在加载 Tag…')).toBeNull();
    await tickSearch();
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('option')).toEqual(oldOptions);
    fireEvent.change(input, { target: { value: 'mast' } });
    await tickSearch();
    await act(async () => { resolveOlder([suggestion('stale')]); });
    expect(screen.getAllByRole('option')).toEqual(oldOptions);
    expect(screen.getByRole('listbox')).toBe(popup);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('mast');
    await act(async () => { resolveLatest([suggestion('latest')]); });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['latestlatestTag10']);
    fireEvent.change(input, { target: { value: 'missing' } });
    await tickSearch();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it.each(['Prompt', '添加提示词'])('%s 的 Safari 229 确认键在 compositionend 后既不补全也不追加', async label => {
    vi.spyOn(tagDictionary, 'searchTagDictionary').mockResolvedValue([suggestion('masterpiece')]);
    render(React.createElement(Harness, { showTranslations: true }));
    // 上游改为点击插入位置后才出现「添加提示词」输入框。
    const input = (label === '添加提示词' ? openTagInput() : screen.getByRole('combobox', { name: label })) as HTMLInputElement;
    const prompt = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'ma' } });
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: false })).toBe(true);
    expect(input.value).toBe('ma');
    expect(prompt.value).toBe(label === 'Prompt' ? 'ma' : '');
    await tickSearch();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: false })).toBe(true);
    expect(input.value).toBe('ma');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(input.value).toBe('masterpiece');
  });

  it.each([375, 1024])('上弹候选以布局视口定位，键盘缩小视觉视口时保持锚点：%ipx', async width => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', 800);
    const viewport = Object.assign(new EventTarget(), { height: 450, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    vi.spyOn(tagDictionary, 'searchTagDictionary').mockResolvedValue([suggestion('masterpiece')]);
    render(React.createElement(Harness));
    const input = screen.getByRole('combobox', { name: 'Prompt' });
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 350, bottom: 400, left: 20, width: 280 } as DOMRect);
    fireEvent.change(input, { target: { value: 'ma' } });
    await tickSearch();
    const popup = screen.getByRole('listbox');
    expect(popup.style.position).toBe('fixed');
    expect(popup.style.top).toBe('');
    expect(popup.style.bottom).toBe('454px');
    viewport.height = 500;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    expect(popup.style.bottom).toBe('454px');
  });

  it.each([false, true])('权重工具行统一桌面高度并保留手机触控规则（暗色 %s）', dark => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
      const toolbar = screen.getByRole('button', { name: '撤销' }).parentElement!;
      const assertControls = () => {
        // 高度拖动把手是共用调整控件，不属于这一排操作按钮。
        for (const button of within(toolbar).getAllByRole('button').filter(button => !/高度$/.test(button.getAttribute('aria-label') || ''))) {
          expect(button.classList.contains('mobile-touch')).toBe(true);
          expect(button.classList.contains('h-8') || button.classList.contains('h-full')).toBe(true);
        }
      };
      assertControls();
      fireEvent.click(screen.getByRole('button', { name: '数值' }));
      expect(screen.getByRole('textbox', { name: '数值权重' }).classList.contains('h-full')).toBe(true);
      assertControls();
      fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
      assertControls();
    } finally { document.documentElement.classList.remove('dark'); }
  });
});

describe('findCompletionTarget', () => {
  it('识别中文逗号后的新 Tag', () => {
    expect(findCompletionTarget('masterpiece，1g', 14)).toMatchObject({
      query: '1g',
      replaceStart: 12,
      replaceEnd: 14,
    });
  });

  it('光标位于 Tag 中间时覆盖到下一个分隔符', () => {
    expect(findCompletionTarget('masteroldpiece, 1girl', 3)).toMatchObject({
      query: 'mas',
      replaceStart: 0,
      replaceEnd: 14,
    });
  });

  it('补全花括号和权重组中的 Tag 时保留闭合符号', () => {
    expect(findCompletionTarget('{masteroldpiece}, next', 4)).toMatchObject({
      query: 'mas',
      replaceStart: 1,
      replaceEnd: 15,
    });
    expect(findCompletionTarget('1.2::masteroldpiece::, next', 7)).toMatchObject({
      query: 'ma',
      replaceStart: 5,
      replaceEnd: 19,
    });
  });
});

describe('TagAutocompleteTextarea 多选 Tag 权重操作', () => {
  it('说明与完整对照被撤回图标替代，翻译失败原因仍可读取且不改原文或选择', async () => {
    const longTag = 'very_long_synthetic_tag_'.repeat(5), failure = '合成模型未配置：详细的错误原因'.repeat(8);
    const resolve = vi.spyOn(tagTranslations, 'resolvePromptTranslations').mockImplementation(async tokens => tokens.map(token => ({ ...token, source: 'missing' as const })));
    const translate = vi.spyOn(tagTranslations, 'translateMissingPromptTags').mockRejectedValue(new Error(failure));
    try {
      render(React.createElement(Harness, { initial: longTag, showTranslations: true }));
      const tag = await screen.findByRole('button', { name: new RegExp(longTag) }); fireEvent.click(tag);
      expect(screen.queryByRole('button', { name: 'Tag 权重说明' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Tag 完整对照' })).toBeNull();
      const undo = screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement;
      expect(undo.textContent).toBe(''); expect(undo.disabled).toBe(true);
      expect(translate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '翻译缺失项 1' }));
      const error = await screen.findByRole('button', { name: '翻译失败详情' });
      expect(error.classList.contains('mobile-touch')).toBe(true);
      expect(error.classList.contains('h-8')).toBe(true);
      fireEvent.click(error);
      expect(screen.getByRole('dialog', { name: '翻译失败详情' }).textContent).toContain(failure);
      expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe(longTag); expect(tag.getAttribute('aria-pressed')).toBe('true');
    } finally { resolve.mockRestore(); translate.mockRestore(); }
  });
  beforeEach(() => {
    resetTagDictionaryCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('manifest.json')) return responseFor(manifest);
      if (url.includes('/shards/ma.json')) {
        return responseFor([
          ['masterpiece', '杰作', 0, 1000000, 1],
        ]);
      }
      return responseFor([]);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('多选 Tag 点击数值类型添加权重时连结为单个数值组', async () => {
    render(React.createElement(Harness, { initial: 'masterpiece, 1girl', showTranslations: true }));
    const tagButtons = await screen.findAllByRole('button', { name: /masterpiece|1girl/ });
    expect(tagButtons.length).toBeGreaterThanOrEqual(2);

    // 点击多选两个 Tag
    fireEvent.click(tagButtons[0]);
    fireEvent.click(tagButtons[1]);

    // 选中“数值”类型并点击“添加权重”
    const numericTypeBtn = screen.getByRole('button', { name: '数值' });
    fireEvent.click(numericTypeBtn);

    const addWeightBtn = screen.getByRole('button', { name: '添加权重' });
    fireEvent.click(addWeightBtn);

    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('1.1::masterpiece, 1girl::');
  });

  it('多选 Tag 在数值框回车确认时连结为带指定权重的单组', async () => {
    render(React.createElement(Harness, { initial: 'masterpiece, 1girl', showTranslations: true }));
    const tagButtons = await screen.findAllByRole('button', { name: /masterpiece|1girl/ });

    fireEvent.click(tagButtons[0]);
    fireEvent.click(tagButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: '数值' }));
    const weightInput = screen.getByPlaceholderText('权重');
    fireEvent.change(weightInput, { target: { value: '1.25' } });
    fireEvent.keyDown(weightInput, { key: 'Enter', code: 'Enter' });

    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('1.25::masterpiece, 1girl::');
  });

  it('多选 Tag 添加括号权重时各自独立包裹', async () => {
    render(React.createElement(Harness, { initial: 'masterpiece, 1girl', showTranslations: true }));
    const tagButtons = await screen.findAllByRole('button', { name: /masterpiece|1girl/ });

    fireEvent.click(tagButtons[0]);
    fireEvent.click(tagButtons[1]);

    const braceTypeBtn = screen.getByRole('button', { name: '括号' });
    fireEvent.click(braceTypeBtn);

    const addWeightBtn = screen.getByRole('button', { name: '添加权重' });
    fireEvent.click(addWeightBtn);

    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('{masterpiece}, {1girl}');
  });

  it('权重类型是互斥的括号与数值，切换不改原文，确认后才转换', () => {
    render(React.createElement(Harness, { initial: '{{alpha}}', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    const types = screen.getByRole('group', { name: '权重类型' });
    const brackets = within(types).getByRole('button', { name: '括号' });
    const numeric = within(types).getByRole('button', { name: '数值' });
    expect(within(types).getAllByRole('button')).toHaveLength(2);
    expect(brackets.getAttribute('aria-pressed')).toBe('true');
    expect(numeric.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('权重倍率').textContent).toBe('1.1025');
    expect(screen.queryByRole('textbox', { name: '数值权重' })).toBeNull();
    fireEvent.click(numeric);
    expect(brackets.getAttribute('aria-pressed')).toBe('false');
    expect(numeric.getAttribute('aria-pressed')).toBe('true');
    expect(textarea.value).toBe('{{alpha}}');
    fireEvent.click(screen.getByRole('button', { name: '添加权重' }));
    expect(textarea.value).toBe('1.1025::alpha::');
    expect((screen.getByRole('textbox', { name: '数值权重' }) as HTMLInputElement).value).toBe('1.1025');
    fireEvent.click(brackets);
    expect(textarea.value).toBe('1.1025::alpha::');
    fireEvent.click(screen.getByRole('button', { name: '添加权重' }));
    expect(textarea.value).toBe('{alpha}');
  });

  it('括号倍率按官方 1.05 换算，加减经过一倍且不影响未选词', () => {
    render(React.createElement(Harness, { initial: '{{alpha}}, beta', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    for (const [prompt, multiplier] of [['{alpha}, beta', '1.05'], ['alpha, beta', '1'], ['[alpha], beta', '0.952381'], ['[[alpha]], beta', '0.907029']]) {
      fireEvent.click(screen.getByRole('button', { name: '−' }));
      expect(textarea.value).toBe(prompt);
      expect(screen.getByLabelText('权重倍率').textContent).toBe(multiplier);
      expect(screen.queryByRole('textbox', { name: '数值权重' })).toBeNull();
    }
    for (const prompt of ['[alpha], beta', 'alpha, beta', '{alpha}, beta', '{{alpha}}, beta']) {
      fireEvent.click(screen.getByRole('button', { name: '+' }));
      expect(textarea.value).toBe(prompt);
    }
  });

  it('不同括号层数的多选显示不同权重，加减各走一步并保留组内词', () => {
    render(React.createElement(Harness, { initial: '{{alpha, beta}}, [gamma], delta', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /gamma/ }));
    expect(screen.getByLabelText('权重倍率').textContent).toBe('不同权重');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(textarea.value).toBe('{{{alpha, beta}}}, gamma, delta');
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('{{alpha, beta}}, [gamma], delta');
  });

  it.each([
    ['{alpha,beta}, gamma', '−', ['alpha,beta, gamma', '[alpha,beta], gamma', '[[alpha,beta]], gamma'], '+'],
    ['[alpha，beta], gamma', '+', ['alpha，beta, gamma', '{alpha，beta}, gamma', '{{alpha，beta}}, gamma'], '−'],
  ] as Array<[string, string, string[], string]>)('括号组连续经过无权重后仍整组包裹，反向恢复：%s', (initial, direction, stages, reverse) => {
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    for (const expected of stages) {
      fireEvent.click(screen.getByRole('button', { name: direction }));
      expect(textarea.value).toBe(expected);
      const group = screen.getByRole('button', { name: /alpha/ });
      expect(group.textContent).toContain('beta');
      expect(group.getAttribute('aria-pressed')).toBe('true');
    }
    for (const expected of [...stages.slice(0, -1)].reverse().concat(initial)) {
      fireEvent.click(screen.getByRole('button', { name: reverse }));
      expect(textarea.value).toBe(expected);
    }
  });

  it('多个括号组独立经过无权重，前面长度变化不误定位后面的组或未选词', () => {
    const initial = '{alpha, beta}, delta, [[gamma, epsilon]], {zeta, theta}';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    for (const tag of ['alpha', 'gamma', 'zeta']) fireEvent.click(screen.getByRole('button', { name: new RegExp(tag) }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('alpha, beta, delta, [[[gamma, epsilon]]], zeta, theta');
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('[alpha, beta], delta, [[[[gamma, epsilon]]]], [zeta, theta]');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(textarea.value).toBe(initial);
  });

  it('取消无权重组的选择后释放临时分组，重新选散词不会误合并', () => {
    render(React.createElement(Harness, { initial: '{alpha, beta}', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('alpha, beta');
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    expect((screen.getByRole('button', { name: '−' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('[alpha], [beta]');
  });

  it('直接编辑原文清除临时分组与选择，不把旧范围用于新词', () => {
    render(React.createElement(Harness, { initial: '{alpha, beta}', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    fireEvent.change(textarea, { target: { value: 'alpha, beta, gamma' } });
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('alpha, [beta], gamma');
  });

  it('撤销重做只恢复原文，不把旧临时组带进新的选择', () => {
    render(React.createElement(Harness, { initial: '{alpha, beta}', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(textarea.value).toBe('{alpha, beta}');
    fireEvent.keyDown(zone, { key: 'y', ctrlKey: true });
    expect(textarea.value).toBe('alpha, beta');
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('[alpha], [beta]');
  });

  it('外层经过无权重时保留内部子组的结构，继续加减调整整段', () => {
    const initial = '{[alpha, beta], gamma}';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('[alpha, beta], gamma');
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('[[alpha, beta], gamma]');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(textarea.value).toBe(initial);
  });

  it('移除整组权重后继续加减仍作用于原组，进入删除模式可逐词删除', () => {
    render(React.createElement(Harness, { initial: '{{alpha, beta}}, gamma', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '移除权重' }));
    expect(textarea.value).toBe('alpha, beta, gamma');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(textarea.value).toBe('{alpha, beta}, gamma');
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除 1 个 Tag' }));
    expect(textarea.value).toBe('alpha, gamma');
  });

  it('已有数值权重自动显示数值类型，混合倍率分别增减且支持 Shift 微调', () => {
    render(React.createElement(Harness, { initial: '1.20::alpha::, 0.8::beta::, gamma', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    expect(screen.getByRole('button', { name: '数值' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('textbox', { name: '数值权重' }) as HTMLInputElement).value).toBe('1.2');
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    expect((screen.getByRole('textbox', { name: '数值权重' }) as HTMLInputElement).placeholder).toBe('不同权重');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(textarea.value).toBe('1.3::alpha::, 0.9::beta::, gamma');
    fireEvent.click(screen.getByRole('button', { name: '−' }), { shiftKey: true });
    expect(textarea.value).toBe('1.29::alpha::, 0.89::beta::, gamma');
  });

  it('括号与数值混选分别调整，无权重词按选定的数值类型从一倍增减', () => {
    render(React.createElement(Harness, { initial: '{alpha}, 1.2::beta::, gamma', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    expect(screen.getByLabelText('权重倍率').textContent).toBe('不同权重');
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('alpha, 1.1::beta::, gamma');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: /gamma/ }));
    fireEvent.click(screen.getByRole('button', { name: '数值' }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('{alpha}, 1.2::beta::, 0.9::gamma::');
  });

  it('先选数值类型再选普通词时保留类型，零选项禁用且普通词可从一倍精调', () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '数值' }));
    expect((screen.getByRole('button', { name: '+' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '添加权重' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    expect(screen.getByRole('button', { name: '数值' }).getAttribute('aria-pressed')).toBe('true');
    expect(textarea.value).toBe('alpha');
    fireEvent.click(screen.getByRole('button', { name: '+' }), { shiftKey: true });
    expect(textarea.value).toBe('1.01::alpha::');
  });

  it.each([
    ['{alpha}, 1.05::beta::', '1.05'],
    ['{{{alpha}}}, 1.157625::beta::', '1.157625'],
    ['[[alpha]], 0.907029478458::beta::', '0.907029'],
    ['alpha, 1::beta::', '1'],
  ])('不同写法的同倍率多选不显示不同权重：%s', (initial, multiplier) => {
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    expect(screen.getByLabelText('权重倍率').textContent).toBe(multiplier);
    fireEvent.click(screen.getByRole('button', { name: '数值' }));
    const input = screen.getByRole('textbox', { name: '数值权重' }) as HTMLInputElement;
    expect(input.value).toBe(multiplier);
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe(initial);
  });

  it('显示倍率相同但实际不同的多选仍显示不同权重，不以显示精度比较', () => {
    render(React.createElement(Harness, { initial: '{{alpha}}, 1.10250001::beta::', showTranslations: true }));
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    expect(screen.getByLabelText('权重倍率').textContent).toBe('不同权重');
  });

  it('仅显示或失焦不改原文，明确转换弱化括号时使用完整倍率而非显示值', () => {
    const initial = '[[alpha]]';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    expect(screen.getByLabelText('权重倍率').textContent).toBe('0.907029');
    fireEvent.click(screen.getByRole('button', { name: '数值' }));
    const input = screen.getByRole('textbox', { name: '数值权重' }) as HTMLInputElement;
    fireEvent.focus(input); fireEvent.blur(input);
    expect(textarea.value).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: '添加权重' }));
    expect(textarea.value).toBe('0.907029478458::alpha::');
    fireEvent.focus(input); fireEvent.blur(input);
    expect(textarea.value).toBe('0.907029478458::alpha::');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(textarea.value).toBe(initial);
  });

  it('已有高精度数值只显示取舍，未编辑不会在失焦或回车时改写', () => {
    const initial = '1.123456789::alpha::';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    const input = screen.getByRole('textbox', { name: '数值权重' }) as HTMLInputElement;
    expect(input.value).toBe('1.123457');
    fireEvent.focus(input); fireEvent.blur(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(textarea.value).toBe(initial);
    fireEvent.change(input, { target: { value: '1.25' } }); fireEvent.blur(input);
    expect(textarea.value).toBe('1.25::alpha::');
  });

  it('删除模式隐藏权重，组内逐词多选标红，确认前不改原文，删除后支持撤回和重做', () => {
    const initial = '2::alpha, beta::, gamma, alpha';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.click(within(zone).getByRole('button', { name: /^2::/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    expect(zone.textContent).not.toContain('2::');
    expect(screen.queryByRole('button', { name: '添加权重' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移除权重' })).toBeNull();
    expect((screen.getByRole('button', { name: '删除 0 个 Tag' }) as HTMLButtonElement).disabled).toBe(true);
    const beta = within(zone).getByRole('button', { name: /^beta\s/ });
    fireEvent.click(beta); fireEvent.click(within(zone).getByRole('button', { name: /^gamma\s/ }));
    fireEvent.click(within(zone).getAllByRole('button', { name: /^alpha\s/ })[1]);
    expect(beta.getAttribute('aria-pressed')).toBe('true');
    expect(beta.classList.contains('bg-red-50')).toBe(true);
    expect(beta.className).not.toContain('bg-[color-mix');
    expect(textarea.value).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: '删除 3 个 Tag' }));
    expect(textarea.value).toBe('2::alpha::');
    expect(screen.getByRole('button', { name: '删除模式' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' })); expect(textarea.value).toBe(initial);
    fireEvent.keyDown(zone, { key: 'y', ctrlKey: true }); expect(textarea.value).toBe('2::alpha::');
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true }); expect(textarea.value).toBe(initial);
    fireEvent.keyDown(zone, { key: 'z', ctrlKey: true, shiftKey: true }); expect(textarea.value).toBe('2::alpha::');
  });

  it('删除标记可以取消和多选，取消或 Esc 不改原文，Ctrl+A 只选当前输入框的 Tag', () => {
    render(React.createElement(Harness, { initial: '{{alpha, beta}}, gamma', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    const zone = screen.getByLabelText('提示词中文翻译');
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    const alpha = within(zone).getByRole('button', { name: /^alpha\s/ });
    fireEvent.click(alpha); fireEvent.click(alpha);
    expect(alpha.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(zone, { key: 'a', ctrlKey: true });
    expect(screen.getByRole('button', { name: '删除 3 个 Tag' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(textarea.value).toBe('{{alpha, beta}}, gamma');
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.click(within(zone).getByRole('button', { name: /^beta\s/ }));
    expect(fireEvent.keyDown(zone, { key: 'Escape' })).toBe(false);
    expect(textarea.value).toBe('{{alpha, beta}}, gamma');
    expect(screen.getByRole('button', { name: '删除模式' })).toBeTruthy();
  });

  it('选中词的复制与剪切保留权重原文，粘贴可追加，输入字段内不接管原生剪贴板操作', () => {
    const initial = '2::alpha, beta::, gamma';
    render(React.createElement(Harness, { initial, showTranslations: true }));
    const zone = screen.getByLabelText('提示词中文翻译');
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.click(within(zone).getByRole('button', { name: /^beta\s/ }));
    fireEvent.click(within(zone).getByRole('button', { name: /^gamma\s/ }));
    const setData = vi.fn();
    expect(fireEvent.copy(zone, { clipboardData: { setData } })).toBe(false);
    expect(setData).toHaveBeenLastCalledWith('text/plain', '2::beta::, gamma');
    expect(textarea.value).toBe(initial);
    expect(fireEvent.cut(zone, { clipboardData: { setData } })).toBe(false);
    expect(textarea.value).toBe('2::alpha::');
    fireEvent.keyDown(zone, { key: 'z', ctrlKey: true }); expect(textarea.value).toBe(initial);
    expect(fireEvent.paste(zone, { clipboardData: { getData: () => '[delta, epsilon]' } })).toBe(false);
    expect(textarea.value).toBe(`${initial}, [delta, epsilon]`);
    const input = openTagInput();
    expect(fireEvent.copy(input, { clipboardData: { setData } })).toBe(true);
    expect(fireEvent.cut(input, { clipboardData: { setData } })).toBe(true);
    expect(fireEvent.paste(input, { clipboardData: { getData: () => 'zeta' } })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
  });

  it('空提示词点击空白后输入，回车或失焦后收起，输入法确认不提交，删除全部后保留空白入口', () => {
    render(React.createElement(Harness, { showTranslations: true }));
    let input = openTagInput();
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'alpha, beta' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(textarea.value).toBe('');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(textarea.value).toBe('alpha, beta'); expect(screen.queryByRole('combobox', { name: '添加提示词' })).toBeNull();
    input = openTagInput();
    fireEvent.change(input, { target: { value: '2::gamma, delta::' } }); fireEvent.blur(input);
    expect(textarea.value).toBe('alpha, beta, 2::gamma, delta::');
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.keyDown(screen.getByLabelText('提示词中文翻译'), { key: 'a', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '删除 4 个 Tag' }));
    expect(textarea.value).toBe('');
    expect(screen.getByRole('button', { name: '在末尾插入提示词' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' })); expect(textarea.value).toBe('alpha, beta, 2::gamma, delta::');
  });

  it('撤回同时覆盖权重调整与连续文字输入，新修改清除重做，外部切换内容清除旧编辑记录', () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /^alpha\s/ }));
    fireEvent.click(screen.getByRole('button', { name: '括号' })); fireEvent.click(screen.getByRole('button', { name: '添加权重' }));
    expect(textarea.value).toBe('{alpha}');
    fireEvent.click(screen.getByRole('button', { name: '撤销' })); expect(textarea.value).toBe('alpha');
    fireEvent.change(textarea, { target: { value: 'alpha, b' } });
    fireEvent.change(textarea, { target: { value: 'alpha, beta' } });
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true }); expect(textarea.value).toBe('alpha');
    fireEvent.keyDown(textarea, { key: 'y', ctrlKey: true }); expect(textarea.value).toBe('alpha, beta');
    cleanup();
    const onValueChange = vi.fn();
    const view = render(React.createElement(TagAutocompleteTextarea, { value: 'alpha', onValueChange, 'aria-label': 'Prompt' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Prompt' }), { target: { value: 'beta' } });
    view.rerender(React.createElement(TagAutocompleteTextarea, { value: 'gamma', onValueChange, 'aria-label': 'Prompt' }));
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([{ disabled: true }, { readOnly: true }])('只读或执行锁定的编辑器不能从翻译区删词、加词或调整权重：%j', locked => {
    const onValueChange = vi.fn();
    render(React.createElement(TagAutocompleteTextarea, { value: 'alpha', onValueChange, ...locked }));
    expect(screen.queryByRole('combobox', { name: '添加提示词' })).toBeNull();
    expect((screen.getByRole('button', { name: '删除模式' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^alpha\s/ }));
    fireEvent.click(screen.getByRole('button', { name: '括号' }));
    fireEvent.click(screen.getByRole('button', { name: '添加权重' }));
    fireEvent.paste(screen.getByLabelText('提示词中文翻译'), { clipboardData: { getData: () => 'beta' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
