// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTagDictionaryCache } from '../../services/tagDictionary';
import { findCompletionTarget, TagAutocompleteTextarea } from '../../components/TagAutocompleteTextarea';
import * as tagTranslations from '../../services/tagTranslations';

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

describe('TagAutocompleteTextarea 输入优先交互', () => {
  it('Agent 填写后保留焦点，读取 body 中真实候选并点击完成补全', async () => {
    render(React.createElement('main', { 'data-agent-view': 'playground' }, React.createElement(Harness)));
    const page = readAgentPage({ query: 'Prompt' }); let operation!: ReturnType<typeof operateAgentPage>;
    act(() => { operation = operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[0].id, value: 'ma', commit: false }); });
    await screen.findAllByRole('option'); await operation;
    const popup = readAgentPage({ query: 'masterpiece' }); expect(popup.foreground).toBe('listbox');
    act(() => { operation = operateAgentPage({ action: 'click', snapshotId: popup.snapshotId, controlId: popup.controls[0].id }); }); await operation;
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toContain('masterpiece'); expect(screen.queryByRole('listbox')).toBeNull();
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'masterpiece, ' } });
    expect(textarea.value).toBe('masterpiece, ');
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'mas' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭辅助' }));

    await new Promise(resolve => window.setTimeout(resolve, 120));
    expect(screen.queryByRole('option')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('候选出现时普通 Enter 和 Tab 不接管原生输入', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    expect(fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(textarea, { key: 'Tab', code: 'Tab' })).toBe(true);
    expect(textarea.value).toBe('mas');
  });

  it('即使已用方向键浏览候选，Tab 仍保留焦点切换语义', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(fireEvent.keyDown(textarea, { key: 'Tab', code: 'Tab' })).toBe(true);
    expect(textarea.value).toBe('mas');
  });

  it('方向键明确选中候选后才允许 Enter 补全', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })).toBe(false);
    await waitFor(() => expect(textarea.value).toBe('masterpiece'));
  });

  it('中文输入法组合期间不会拦截确认键', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'mas' } });

    await waitFor(() => expect(resolveShard).toBeTypeOf('function'));
    fireEvent.compositionStart(textarea);
    resolveShard(responseFor([['masterpiece', '杰作', 0, 1000000, 1]]));

    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('输入逗号后保留分隔符并立即关闭上一项候选', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await openSuggestions(textarea, 'mas');

    fireEvent.change(textarea, { target: { value: 'mas, ' } });
    expect(textarea.value).toBe('mas, ');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('单击候选即可完成补全', async () => {
    render(React.createElement(Harness));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    const option = await openSuggestions(textarea, 'mas');

    fireEvent.click(option);
    await waitFor(() => expect(textarea.value).toBe('masterpiece'));
  });

  it('在 Tag 中间补全时替换整个当前 Tag 而不是残留后缀', async () => {
    render(React.createElement(Harness, { initial: 'masteroldpiece, 1girl' }));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    textarea.setSelectionRange(3, 3);
    fireEvent.click(textarea);
    const option = (await screen.findAllByRole('option'))[0];

    fireEvent.click(option);
    await waitFor(() => expect(textarea.value).toBe('masterpiece, 1girl'));
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
      const error = await screen.findByRole('button', { name: '翻译失败详情' }); fireEvent.click(error);
      expect(screen.getByRole('dialog', { name: '翻译失败详情' }).textContent).toContain(failure);
      expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe(longTag); expect(tag.getAttribute('aria-pressed')).toBe('true');
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

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('{masterpiece}, {1girl}');
  });

  it('权重类型是互斥的括号与数值，切换不改原文，确认后才转换', () => {
    render(React.createElement(Harness, { initial: '{{alpha}}', showTranslations: true }));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    fireEvent.change(textarea, { target: { value: 'alpha, beta, gamma' } });
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(textarea.value).toBe('alpha, [beta], gamma');
  });

  it('撤销重做只恢复原文，不把旧临时组带进新的选择', () => {
    render(React.createElement(Harness, { initial: '{alpha, beta}', showTranslations: true }));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const input = screen.getByRole('textbox', { name: '添加提示词' });
    expect(fireEvent.copy(input, { clipboardData: { setData } })).toBe(true);
    expect(fireEvent.cut(input, { clipboardData: { setData } })).toBe(true);
    expect(fireEvent.paste(input, { clipboardData: { getData: () => 'zeta' } })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
  });

  it('空提示词也可在翻译区直接输入，回车或失焦追加，输入法确认不提交，删除全部后输入入口仍在', () => {
    render(React.createElement(Harness, { showTranslations: true }));
    const input = screen.getByRole('textbox', { name: '添加提示词' }) as HTMLInputElement;
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'alpha, beta' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(textarea.value).toBe('');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(textarea.value).toBe('alpha, beta'); expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '2::gamma, delta::' } }); fireEvent.blur(input);
    expect(textarea.value).toBe('alpha, beta, 2::gamma, delta::');
    fireEvent.click(screen.getByRole('button', { name: '删除模式' }));
    fireEvent.keyDown(screen.getByLabelText('提示词中文翻译'), { key: 'a', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '删除 4 个 Tag' }));
    expect(textarea.value).toBe('');
    expect(screen.getByRole('textbox', { name: '添加提示词' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' })); expect(textarea.value).toBe('alpha, beta, 2::gamma, delta::');
  });

  it('撤回同时覆盖权重调整与连续文字输入，新修改清除重做，外部切换内容清除旧编辑记录', () => {
    render(React.createElement(Harness, { initial: 'alpha', showTranslations: true }));
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
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
    const view = render(React.createElement(TagAutocompleteTextarea, { value: 'alpha', onValueChange }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'beta' } });
    view.rerender(React.createElement(TagAutocompleteTextarea, { value: 'gamma', onValueChange }));
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([{ disabled: true }, { readOnly: true }])('只读或执行锁定的编辑器不能从翻译区删词、加词或调整权重：%j', locked => {
    const onValueChange = vi.fn();
    render(React.createElement(TagAutocompleteTextarea, { value: 'alpha', onValueChange, ...locked }));
    expect(screen.queryByRole('textbox', { name: '添加提示词' })).toBeNull();
    expect((screen.getByRole('button', { name: '删除模式' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^alpha\s/ }));
    fireEvent.click(screen.getByRole('button', { name: '括号' }));
    fireEvent.click(screen.getByRole('button', { name: '添加权重' }));
    fireEvent.paste(screen.getByLabelText('提示词中文翻译'), { clipboardData: { getData: () => 'beta' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
