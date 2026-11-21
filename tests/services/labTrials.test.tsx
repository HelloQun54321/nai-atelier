// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_GENERATION_MEMORY_PREFERENCES } from '../../services/appearancePreferences';
import { createLabTrial, isLabTrialId, loadLabTrials, saveLabTrials, useLabTrials } from '../../services/labTrials';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);
it('旧实验室草稿继续使用原 ID，各试画分区不被当作风格串', () => {
  expect(loadLabTrials('owner').trials[0].id).toBe('playground');
  expect(isLabTrialId('playground:test')).toBe(true);
  expect(isLabTrialId('style-test')).toBe(false);
});
it('复制配方使用独立 ID 和深拷贝，不复制封面或共享角色参数', () => {
  const first = createLabTrial('owner'); first.params!.characters = [{ id: 'role', prompt: 'original', x: .5, y: .5 }]; first.previewImage = '/old.png';
  const copy = createLabTrial('owner', 'copy', first); copy.params!.characters![0].prompt = 'changed';
  expect(copy.id).not.toBe(first.id); expect(copy.previewImage).toBeUndefined(); expect(first.params!.characters![0].prompt).toBe('original');
});
it('保存索引隔离所有者和记忆偏好，不把生成参数或图片写入索引', () => {
  const trial = createLabTrial('owner'); trial.modules = [{ id: 'artist', name: 'artist', content: 'artist:test', isActive: true, position: 'pre' }];
  expect(saveLabTrials('owner', { trials: [trial], activeId: trial.id }, false, DEFAULT_GENERATION_MEMORY_PREFERENCES)).toBe(true);
  expect(loadLabTrials('owner').trials[0].modules).toHaveLength(1);
  sessionStorage.clear(); expect(loadLabTrials('owner').trials[0].modules).toHaveLength(0);
  expect(loadLabTrials('other').trials[0].id).toBe('playground');
  expect(localStorage.getItem('nai-lab-trials-v1:owner')).not.toContain('params');
});
it('分区编辑、复制、切换和迟到更新都固定在原分区，不污染当前分区', () => {
  const Harness = () => { const state = useLabTrials('owner', true, DEFAULT_GENERATION_MEMORY_PREFERENCES);
    return <><output>{JSON.stringify(state.trials.map(trial => ({ id: trial.id, prompt: trial.basePrompt })))}</output><span>{state.activeChain.basePrompt}</span>
      <button onClick={() => state.update(state.activeId, { basePrompt: 'style a' })}>edit</button><button onClick={() => state.add(true)}>copy</button>
      <button onClick={() => state.update(state.trials[0].id, { basePrompt: 'late a' })}>late</button><button onClick={() => state.select(state.trials[0].id)}>first</button></>; };
  render(<Harness />); fireEvent.click(screen.getByText('edit')); fireEvent.click(screen.getByText('copy'));
  fireEvent.click(screen.getByText('late')); expect(screen.getByText('style a')).toBeTruthy();
  fireEvent.click(screen.getByText('first')); expect(screen.getByText('late a')).toBeTruthy();
  const trials = JSON.parse(screen.getByRole('status').textContent!); expect(trials.map((trial: any) => trial.prompt)).toEqual(['late a', 'style a']);
});
