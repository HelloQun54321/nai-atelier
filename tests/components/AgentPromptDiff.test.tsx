// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPromptChangeCard, AgentPromptDiff } from '../../components/AgentPromptDiff';
import type { AgentPromptChange } from '../../services/agentPromptChanges.mjs';

afterEach(cleanup);
const change: AgentPromptChange = { id: 'run', target: { chainId: 'lab', mode: 'text-to-image' }, status: 'applied', changes: [{ path: ['basePrompt'], before: '1.2::artist::, blue sky', after: '1.4::artist::, blue sky' }] };

it('仅变化字符红绿高亮，长上下文按需展开，正文权重保持原样', () => {
  const prefix = 'unchanged context '.repeat(20);
  const { container } = render(<AgentPromptDiff changes={[{ path: ['basePrompt'], before: prefix + '1.2::artist::', after: prefix + '1.4::artist::' }]} />);
  expect([...container.querySelectorAll('del, ins')].map(node => node.textContent)).toEqual(['2', '4']);
  expect(screen.getByLabelText('删除').textContent).toBe('−');
  expect(screen.getByLabelText('新增').textContent).toBe('+');
  expect(container.textContent).not.toContain(prefix);
  expect(container.textContent).toContain('…');
  fireEvent.click(screen.getByRole('button', { name: '展开完整上下文', expanded: false }));
  expect(container.textContent).toContain(prefix);
  expect([...container.querySelectorAll('del, ins')].map(node => node.textContent)).toEqual(['2', '4']);
  fireEvent.click(screen.getByRole('button', { name: '只看改动', expanded: true }));
  expect(container.textContent).not.toContain(prefix);
});

it('短上下文也省略，各处修改前后相邻，展开后共同文字仅出现一次且不标色', () => {
  const { container } = render(<AgentPromptDiff changes={[{ path: ['basePrompt'], before: 'prefix old middle removed suffix', after: 'prefix new middle added suffix' }]} />);
  const marks = () => [...container.querySelectorAll('del, ins')].map(node => node.textContent);
  expect(marks()).toEqual(['old', 'new', 'removed', 'added']);
  for (const word of ['prefix', 'middle', 'suffix']) expect(container.textContent).not.toContain(word);
  expect(screen.getAllByRole('button', { name: '展开完整上下文' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '展开完整上下文' }));
  expect(screen.getAllByText('middle', { exact: true })).toHaveLength(1);
  expect(marks()).toEqual(['old', 'new', 'removed', 'added']);
  fireEvent.click(screen.getByRole('button', { name: '只看改动' }));
  expect(container.textContent).not.toContain('middle');
});

it('全局、角色与固定用途共用一个展开按钮，长文未变行不进入红绿改动', () => {
  const unchanged = '1.9::same scenery and camera::\n'.repeat(80);
  const { container } = render(<AgentPromptDiff changes={[
    { path: ['basePrompt'], before: 'old\n' + unchanged + 'old', after: 'new\n' + unchanged + 'new' },
    { path: ['params', 'characters', 'id:alice', 'prompt'], ownerName: 'Alice', before: 'near a tree', after: 'near a doorway' },
    { path: ['params', '_promptSections', 'purpose:clothing'], before: 'wearing white shirt', after: 'wearing black jacket' },
  ]} />);
  expect(screen.getByText('角色 Alice › 正面提示词')).toBeTruthy();
  expect(container.textContent).not.toContain('same scenery');
  expect(container.textContent).not.toContain('near a');
  expect(container.textContent).not.toContain('wearing');
  const marked = [...container.querySelectorAll('del, ins')].map(node => node.textContent).join('');
  expect(marked).not.toContain('same scenery');
  expect(screen.getAllByRole('button', { name: '展开完整上下文' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '展开完整上下文' }));
  expect(container.textContent).toContain(unchanged);
  expect(container.textContent).toContain('near a');
  expect(container.textContent).toContain('wearing');
});

it('连续角色 Tag 改动合并为一组前后列表，逗号不制造省略号或逐项配对', () => {
  const before = 'fukuga_kurumi, fx_senshi_kurumi-chan, pink_hair, hairclip, pink_eyes, white_dress';
  const after = '2b (nier:automata), nier (series), white_hair, blindfold, black_blindfold, mole under mouth';
  const { container } = render(<AgentPromptDiff changes={[{ path: ['params', 'characters', 'id:2b', 'prompt'], ownerName: '2B', before, after }]} />);
  expect(screen.getAllByLabelText('删除')).toHaveLength(1);
  expect(screen.getAllByLabelText('新增')).toHaveLength(1);
  expect(screen.getByLabelText('删除').parentElement?.textContent).toBe('−' + before);
  expect(screen.getByLabelText('新增').parentElement?.textContent).toBe('+' + after);
  expect(container.textContent).not.toContain('…');
  expect(screen.queryByRole('button')).toBeNull();
  expect(container.querySelector('mark')).toBeNull();
});

it('多词 Tag、换行与权重格式连接成一组，增删数量不同时也不逐词配对', () => {
  const before = '1.2::white shirt::,\n1.9::red hat::,\n1.8::hair clip::';
  const after = '1.4::black jacket::,\n1.9::blue cape::';
  const { container } = render(<AgentPromptDiff changes={[{ path: ['negativePrompt'], before, after }]} />);
  expect(screen.getAllByLabelText('删除')).toHaveLength(1);
  expect(screen.getAllByLabelText('新增')).toHaveLength(1);
  expect(screen.getByLabelText('删除').parentElement?.textContent).toBe('−' + before);
  expect(screen.getByLabelText('新增').parentElement?.textContent).toBe('+' + after);
  expect(container.textContent).not.toContain('…');
  expect([...container.querySelectorAll('del, ins')].map(node => node.textContent).join('')).not.toContain('1.9::');
});

it.each([
  ['pink hair, pink eyes, white dress', 'white hair, blue eyes, black dress'],
  ['1.2::white shirt::, 1.9::red hat::', '1.4::black shirt::, 1.9::blue hat::'],
  ['1.2::old item, shared inner::,\nold ending', '1.4::new item, shared inner::,\nnew ending'],
])('变更 Tag 内共用的词原位显示，不拆出额外省略块：%s', (before, after) => {
  const { container } = render(<AgentPromptDiff changes={[{ path: ['basePrompt'], before, after }]} />);
  expect(screen.getAllByLabelText('删除')).toHaveLength(1);
  expect(screen.getAllByLabelText('新增')).toHaveLength(1);
  expect(screen.getByLabelText('删除').parentElement?.textContent).toBe('−' + before);
  expect(screen.getByLabelText('新增').parentElement?.textContent).toBe('+' + after);
  expect(container.textContent).not.toContain('…');
  expect([...container.querySelectorAll('del, ins')].map(node => node.textContent).join('')).not.toMatch(/hair|eyes|dress|shirt|hat|shared|inner|item/);
});

it('实际未变 Tag 仍分隔两处改动，默认省略、展开后中性显示一次', () => {
  const { container } = render(<AgentPromptDiff changes={[{ path: ['basePrompt'], before: 'pink_hair, unchanged_pose, white_dress', after: 'white_hair, unchanged_pose, black_outfit' }]} />);
  expect(screen.getAllByLabelText('删除')).toHaveLength(2);
  expect(screen.getAllByLabelText('新增')).toHaveLength(2);
  expect(container.textContent).toContain('…');
  expect(container.textContent).not.toContain('unchanged_pose');
  fireEvent.click(screen.getByRole('button', { name: '展开完整上下文' }));
  const context = screen.getByText(', unchanged_pose,');
  expect(context.closest('del, ins')).toBeNull();
  expect(context.className).toContain('text-gray-500');
  expect(screen.getAllByText(', unchanged_pose,')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '只看改动' }));
  expect(container.textContent).not.toContain('unchanged_pose');
});

it.each([['', 'new prompt'], ['old prompt', '']])('纯新增或删除没有未变内容时不提供展开按钮', (before, after) => {
  const { container } = render(<AgentPromptDiff changes={[{ path: ['negativePrompt'], before, after }]} />);
  expect(container.textContent).toContain(before || after);
  expect(container.textContent).not.toContain('…');
  expect(screen.queryByRole('button')).toBeNull();
});

it('不同消息卡片独立展开，查看上下文不会改变撤回重做状态', () => {
  const onAction = vi.fn(async () => {});
  const other = { ...change, id: 'other', changes: [{ path: ['basePrompt'], before: 'second context old', after: 'second context new' }] };
  const { container } = render(<><AgentPromptChangeCard change={change} disabled={false} onAction={onAction} /><AgentPromptChangeCard change={other} disabled={false} onAction={onAction} /></>);
  const buttons = screen.getAllByRole('button', { name: '展开完整上下文' });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  expect(container.textContent).toContain('artist');
  expect(container.textContent).not.toContain('second context');
  expect(screen.getAllByRole('button', { name: '只看改动' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: '展开完整上下文' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: '撤回本次提示词修改' }).every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.getAllByRole('button', { name: '重做本次提示词修改' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(onAction).not.toHaveBeenCalled();
});

it('已应用与已撤回状态分别启用撤回和重做，工作中禁用操作', async () => {
  const onAction = vi.fn(async () => {});
  const view = render(<AgentPromptChangeCard change={change} disabled={false} onAction={onAction} />);
  expect((screen.getByRole('button', { name: '重做本次提示词修改' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '撤回本次提示词修改' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith('undo'));
  view.rerender(<AgentPromptChangeCard change={{ ...change, status: 'undone' }} disabled={false} onAction={onAction} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '重做本次提示词修改' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '重做本次提示词修改' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith('redo'));
  view.rerender(<AgentPromptChangeCard change={change} disabled onAction={onAction} />);
  expect((screen.getByRole('button', { name: '撤回本次提示词修改' }) as HTMLButtonElement).disabled).toBe(true);
});

it('拒绝覆盖手改时原位报错，保存回执重试不再次撤回', async () => {
  const onAction = vi.fn(async () => { throw new Error('相关提示词已被修改，未覆盖当前内容'); });
  const view = render(<AgentPromptChangeCard change={change} disabled={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: '撤回本次提示词修改' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '相关提示词已被修改，未覆盖当前内容');
  view.rerender(<AgentPromptChangeCard change={{ ...change, savePending: true }} disabled={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: '重试保存记录' }));
  await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('save'));
});

it('整块旧分类撤销信息展示正文与负面，隐藏来源元信息', () => {
  const { container } = render(<AgentPromptDiff changes={[{ path: ['params', '_promptSections'], before: {
    'purpose:place': 'old city', presentation: 'polaroid frame', sectionNegatives: { 'purpose:place': 'old forest' }, sectionMeta: { 'purpose:place': { source: 'library', entryId: 'private-source' } },
  } }]} />);
  const removed = [...container.querySelectorAll('del')].map(node => node.textContent).join(' ');
  expect(removed).toContain('old city'); expect(removed).toContain('polaroid frame'); expect(removed).toContain('old forest');
  expect(container.textContent).not.toContain('private-source'); expect(container.textContent).not.toContain('library');
});

it('整块角色旧分栏仍展示原正负正文', () => {
  const { container } = render(<AgentPromptDiff changes={[
    { path: ['params', 'characters', 'id:alice', 'sections'], before: { appearance: 'blue eyes', 'directory:test': 'white dress' } },
    { path: ['params', 'characters', 'id:alice', 'sectionNegatives'], before: { appearance: 'red eyes' } },
  ]} />);
  const removed = [...container.querySelectorAll('del')].map(node => node.textContent).join(' ');
  expect(removed).toContain('blue eyes'); expect(removed).toContain('white dress'); expect(removed).toContain('red eyes');
});
