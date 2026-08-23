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

const Harness: React.FC<{ initial?: string }> = ({ initial = '' }) => {
  const [value, setValue] = useState(initial);
  return React.createElement(TagAutocompleteTextarea, {
    value,
    onValueChange: setValue,
    showTranslations: false,
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
