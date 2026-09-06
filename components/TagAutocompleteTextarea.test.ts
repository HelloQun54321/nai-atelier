// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTagDictionaryCache } from '../services/tagDictionary';
import { findCompletionTarget, TagAutocompleteTextarea } from './TagAutocompleteTextarea';

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

    const weightInput = screen.getByPlaceholderText('权重');
    fireEvent.change(weightInput, { target: { value: '1.25' } });
    fireEvent.keyDown(weightInput, { key: 'Enter', code: 'Enter' });

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('1.25::masterpiece, 1girl::');
  });

  it('多选 Tag 点击花括号或方括号类型时各自独立包裹', async () => {
    render(React.createElement(Harness, { initial: 'masterpiece, 1girl', showTranslations: true }));
    const tagButtons = await screen.findAllByRole('button', { name: /masterpiece|1girl/ });

    fireEvent.click(tagButtons[0]);
    fireEvent.click(tagButtons[1]);

    const braceTypeBtn = screen.getByRole('button', { name: '{ }' });
    fireEvent.click(braceTypeBtn);

    const addWeightBtn = screen.getByRole('button', { name: '添加权重' });
    fireEvent.click(addWeightBtn);

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('{masterpiece}, {1girl}');
  });
});
