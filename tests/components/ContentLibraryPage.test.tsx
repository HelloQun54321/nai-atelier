// @vitest-environment jsdom
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentLibraryPage, type ContentLibrarySection } from '../../components/ContentLibraryPage';

afterEach(() => cleanup());

const Tools = ({ slot, label }: { slot: HTMLElement | null; label: string }) => {
  const [value, setValue] = useState('');
  return <div data-testid={label}>{slot && createPortal(<><button>筛选</button><input aria-label={label} value={value} onChange={event => setValue(event.target.value)} /></>, slot)}</div>;
};
const Harness = ({ active = true, onCapture }: { active?: boolean; onCapture?: (text: string, name: string, category: string) => Promise<void> }) => {
  const [section, setSection] = useState<ContentLibrarySection>('items');
  const [rollOpen, setRollOpen] = useState(false);
  return <ContentLibraryPage section={section} onSectionChange={setSection} active={active} rollOpen={rollOpen} onRollOpenChange={setRollOpen} onCapture={onCapture}
    items={slot => <Tools slot={slot} label="条目搜索" />}
    roll={slot => <Tools slot={slot} label="搭配草稿" />}
    saved={slot => <Tools slot={slot} label="组合搜索" />} originals={slot => <Tools slot={slot} label="原文搜索" />} />;
};

it('粘贴收录两库均可达，后台隐藏且返回保留原文，不干扰原列表搜索与焦点', () => {
  const save = vi.fn(async () => {}); const view = render(<Harness onCapture={save} />);
  const trigger = screen.getByRole('button', { name: '粘贴收录' }); trigger.focus(); fireEvent.click(trigger);
  const text = screen.getByRole('textbox', { name: '提示词原文' });
  expect(document.activeElement).toBe(text);
  fireEvent.change(text, { target: { value: 'snow' } });
  view.rerender(<Harness active={false} onCapture={save} />); expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Harness onCapture={save} />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('snow');
  fireEvent.keyDown(window, { key: 'Escape' }); expect(document.activeElement).toBe(trigger);
  fireEvent.click(screen.getByRole('tab', { name: '组合' }));
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('snow');
  expect(save).not.toHaveBeenCalled();
});

it('三类资源，筛选、搜索、Roll 操作顺序一致，切库保留草稿', () => {
  render(<Harness />);
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.queryByTestId('组合搜索')).toBeNull();
  expect(screen.queryByTestId('搭配草稿')).toBeNull();
  const toolbar = screen.getByRole('banner');
  expect(Array.from(toolbar.querySelectorAll('button,input')).map(node => node.textContent || node.getAttribute('aria-label')))
    .toEqual(['片段', '组合', '原文', '筛选', '条目搜索', '随机搭配']);
  fireEvent.change(screen.getByRole('textbox', { name: '条目搜索' }), { target: { value: 'night' } });
  const items = screen.getByTestId('条目搜索');
  fireEvent.keyDown(screen.getByRole('tab', { name: '片段' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: '组合' }).id);
  expect(screen.queryByRole('textbox', { name: '条目搜索' })).toBeNull();
  expect(screen.getByRole('textbox', { name: '组合搜索' }).closest('header')).toBe(toolbar);
  fireEvent.keyDown(screen.getByRole('tab', { name: '组合' }), { key: 'Home' });
  expect(screen.getByTestId('条目搜索')).toBe(items);
  expect((screen.getByRole('textbox', { name: '条目搜索' }) as HTMLInputElement).value).toBe('night');
});

it('Roll 按需打开独立面板，关闭与重新打开保留搭配和原库，焦点回到触发按钮', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: '组合' }));
  const trigger = screen.getByRole('button', { name: '随机搭配' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '随机搭配' });
  expect(screen.getByRole('tab', { name: '组合' }).getAttribute('aria-selected')).toBe('true');
  const input = within(dialog).getByRole('textbox', { name: '搭配草稿' });
  fireEvent.change(input, { target: { value: '月下漫步' } });
  expect(within(dialog).getByRole('button', { name: '关闭搭配面板' })).toBe(document.activeElement);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(screen.getByRole('textbox', { name: '搭配草稿' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe('月下漫步');
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  expect(screen.getByRole('tab', { name: '组合' }).getAttribute('aria-selected')).toBe('true');
});

it('页面进入后台后隐藏 portal 面板，重新激活保留草稿；Tab 不移出弹窗', () => {
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '随机搭配' }));
  const input = screen.getByRole('textbox', { name: '搭配草稿' }); input.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭搭配面板' }));
  view.rerender(<Harness active={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Harness />);
  expect(screen.getByRole('textbox', { name: '搭配草稿' })).toBe(input);
});
