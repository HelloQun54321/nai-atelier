// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PromptPurposePicker } from '../../components/PromptPurposePicker';
import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES } from '../../services/promptPurposes.mjs';
import { openPurposeGroup } from '../support/promptPurposeGroups';

it('用途选择的五组顺序一致，收起保留选择，所有 16 个用途都可进入', () => {
  const change = vi.fn();
  render(<PromptPurposePicker value={['clothing']} onChange={change} />);
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(PROMPT_PURPOSE_GROUPS.map(group => group.label));
  for (const group of PROMPT_PURPOSE_GROUPS) {
    openPurposeGroup(group.label);
    const section = screen.getByRole('button', { name: group.label }).closest('section')!;
    for (const id of group.purposes) expect(within(section).getByRole('button', { name: PROMPT_PURPOSES.find(item => item.id === id)!.label })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: '动作与姿态' }));
  expect(change).toHaveBeenLastCalledWith(['clothing', 'pose']);
  fireEvent.click(screen.getByRole('button', { name: '主体与外观' }));
  openPurposeGroup('主体与外观');
  expect(screen.getByRole('button', { name: '服饰与配件' }).getAttribute('aria-pressed')).toBe('true');
});
