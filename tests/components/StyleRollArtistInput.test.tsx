// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StyleRollArtistInput } from '../../components/roll/StyleRollArtistInput';

vi.mock('../../services/tagDictionary', () => ({ searchArtistDictionary: async () => [{ name: 'alpha', chinese: '合成画师' }] }));
afterEach(cleanup);
const Fixture = ({ limit = 3, blocked = [] }: { limit?: number; blocked?: string[] }) => {
  const [tags, setTags] = useState<string[]>([]);
  return <><StyleRollArtistInput label="固定画师 Tag（可选）" value={tags} onChange={setTags} limit={limit} blocked={blocked} /><output>{JSON.stringify(tags)}</output></>;
};
const add = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '添加到固定画师 Tag（可选）' }));
};
it('粘贴加权 Tag 只取名字，去重并能逐位解除固定', () => {
  render(<Fixture />); add('1.2::artist:alpha ::, beta\nALPHA');
  expect(screen.getByRole('status').textContent).toBe('["alpha","beta"]');
  fireEvent.click(screen.getByRole('button', { name: '从固定画师 Tag（可选）移除 beta' }));
  expect(screen.getByRole('status').textContent).toBe('["alpha"]');
});
it('超过总人数或命中屏蔽时保留输入并不改已固定项', () => {
  render(<Fixture limit={2} blocked={['blocked']} />); add('alpha'); add('beta, gamma');
  expect(screen.getByRole('alert').textContent).toContain('最多可添加 2 位');
  expect(screen.getByRole('status').textContent).toBe('["alpha"]');
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'beta, gamma');
  add('blocked'); expect(screen.getByRole('alert').textContent).toContain('已被屏蔽或排除');
  expect(screen.getByRole('status').textContent).toBe('["alpha"]');
});
it('词库搜索结果直接添加，不打开选择弹层', async () => {
  render(<Fixture />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'alph' } });
  fireEvent.click(await screen.findByRole('button', { name: 'alpha · 合成画师' }));
  expect(screen.getByRole('status').textContent).toBe('["alpha"]');
  expect(screen.queryByRole('dialog')).toBeNull();
});
