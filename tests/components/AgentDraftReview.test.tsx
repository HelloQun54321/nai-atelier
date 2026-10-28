// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentDraftReview } from '../../components/AgentDraftReview';
import type { PromptAgentDraft } from '../../types';

vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, onClose: () => void) => onClose }));
afterEach(cleanup);
const current = { basePrompt: 'style', subjectPrompt: 'white shirt', negativePrompt: 'blur', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler', _promptSections: { 'purpose:clothing': 'white shirt' }, characters: [{ id: 'c', prompt: 'girl', x: 0.2, y: 0.3 }] } } as PromptAgentDraft;

it('分类内容与合并正文一起选择，取消分类不会留下不一致的正文', () => {
  const proposed = structuredClone(current); proposed.subjectPrompt = 'black jacket'; proposed.params._promptSections!['purpose:clothing'] = 'black jacket'; proposed.negativePrompt = 'other negative';
  const apply = vi.fn();
  render(<AgentDraftReview current={current} proposed={proposed} onApply={apply} onClose={() => {}} />);
  expect(screen.getByText('服饰与配件')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '参数与角色' }));
  expect((screen.getByRole('checkbox', { name: '主体提示词' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '应用选中修改' }));
  expect(apply).toHaveBeenCalledWith({ ...current, negativePrompt: 'other negative' });
});

it('只改角色坐标时仍可审阅原有参数差异，不显示空的提示词修改', () => {
  const proposed = structuredClone(current); proposed.params.characters![0].x = 0.8;
  render(<AgentDraftReview current={current} proposed={proposed} onApply={() => {}} onClose={() => {}} />);
  expect(screen.getByText('参数差异')).toBeTruthy();
  expect(screen.queryByText('提示词来源已更新')).toBeNull();
  expect(document.body.textContent).toContain('0.8');
});
