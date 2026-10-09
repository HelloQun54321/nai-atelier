// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolbarSearch } from '../../components/DesignSystem';

afterEach(cleanup);

it('普通资源页搜索保留原样式及输入、键盘与原生属性', () => {
  const onChange = vi.fn(), onKeyDown = vi.fn();
  render(<ToolbarSearch aria-label="资源搜索" placeholder="关键词" defaultValue="原词" onChange={onChange} onKeyDown={onKeyDown} className="pr-9" containerClassName="md:max-w-none!" />);
  const input = screen.getByRole('searchbox', { name: '资源搜索' }) as HTMLInputElement;
  expect(input.parentElement?.tagName).toBe('LABEL');
  expect(input.classList.contains('pl-9')).toBe(true); expect(input.classList.contains('pr-9')).toBe(true);
  expect(input.getAttribute('autocomplete')).toBe('off'); expect(input.getAttribute('data-lpignore')).toBe('true');
  fireEvent.change(input, { target: { value: '新词' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(input.value).toBe('新词'); expect(onChange).toHaveBeenCalledOnce(); expect(onKeyDown).toHaveBeenCalledOnce();
});

it('增删框内标签不重建搜索输入，保留文字、选区和焦点', () => {
  const Harness = () => {
    const [tag, setTag] = useState(false), [query, setQuery] = useState('关键词');
    return <><button onClick={() => setTag(value => !value)}>切换标签</button><ToolbarSearch type="text" aria-label="搜索" value={query} onChange={event => setQuery(event.target.value)}>
      {tag && <button onClick={() => setTag(false)}>取消标签</button>}
    </ToolbarSearch></>;
  };
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: '搜索' }) as HTMLInputElement;
  const field = input.parentElement;
  expect(field?.tagName).toBe('DIV');
  input.focus(); input.setSelectionRange(1, 2);
  fireEvent.click(screen.getByRole('button', { name: '切换标签' }));
  expect(screen.getByRole('textbox')).toBe(input); expect(input.parentElement).toBe(field);
  expect(screen.getByRole('button', { name: '取消标签' }).parentElement).toBe(field);
  fireEvent.click(screen.getByRole('button', { name: '取消标签' }));
  expect(screen.getByRole('textbox')).toBe(input); expect(input.parentElement).toBe(field);
  expect(document.activeElement).toBe(input); expect(input.value).toBe('关键词');
  expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(2);
});
