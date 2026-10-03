// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentChatDisplayOptions, AgentDisclosure, useAgentDisplayPreferences } from './AgentChatPreferences';
import { AgentPermissionSelect } from './AgentPermissionSelect';
import { getAgentDisplayPreferences } from '../services/agentDisplayPreferences';
import { promptAgentService } from '../services/promptAgent';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const Transcript = ({ text = '合成思考' }) => {
  const preferences = useAgentDisplayPreferences();
  return <><AgentChatDisplayOptions /><AgentDisclosure title="思考过程" label="思考过程" defaultExpanded={preferences.thinkingExpanded}>{text}</AgentDisclosure><AgentDisclosure title="工具活动" label="工具活动" defaultExpanded={preferences.toolsExpanded}>合成工具回执</AgentDisclosure></>;
};
it('默认折叠，思考和工具分别设置且保存，修改偏好同步更新已有消息', async () => {
  const view = render(<Transcript />);
  const thinking = () => screen.getByLabelText('思考过程').closest('details')!;
  const tools = () => screen.getByLabelText('工具活动').closest('details')!;
  expect(thinking().open).toBe(false); expect(tools().open).toBe(false);
  fireEvent.click(screen.getByRole('switch', { name: '默认展开思考' }));
  await waitFor(() => expect(thinking().open).toBe(true)); expect(tools().open).toBe(false);
  fireEvent.click(screen.getByRole('switch', { name: '默认展开工具' }));
  await waitFor(() => expect(tools().open).toBe(true));
  expect(getAgentDisplayPreferences()).toEqual({ thinkingExpanded: true, toolsExpanded: true });
  view.unmount(); render(<Transcript />);
  expect(thinking().open).toBe(true); expect(tools().open).toBe(true);
});
it('手动展开不被后续流式内容刷新重置', async () => {
  const view = render(<Transcript />); const details = screen.getByLabelText('思考过程').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  view.rerender(<Transcript text="追加合成思考" />);
  await waitFor(() => expect(details.open).toBe(true)); expect(screen.getByText('追加合成思考')).toBeTruthy();
});
it('损坏的显示偏好退回折叠，保持开关可用', () => {
  localStorage.setItem('nai_agent_display', '{broken');
  expect(getAgentDisplayPreferences()).toEqual({ thinkingExpanded: false, toolsExpanded: false });
});
it('权限读取后切档并保存，保存失败保留旧档位，任务期间禁用选择', async () => {
  vi.spyOn(promptAgentService, 'getConfig').mockResolvedValue({ permissionMode: 'standard' } as Awaited<ReturnType<typeof promptAgentService.getConfig>>);
  const save = vi.spyOn(promptAgentService, 'setPermissionMode').mockRejectedValue(new Error('合成保存失败'));
  const view = render(<AgentPermissionSelect />); const trigger = screen.getByRole('button', { name: 'Agent 权限' }) as HTMLButtonElement;
  await waitFor(() => expect(trigger.disabled).toBe(false));
  fireEvent.click(trigger);
  expect(screen.getByRole('menuitemradio', { name: /^标准/ }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^完全访问/ }));
  expect((await screen.findByRole('alert')).textContent).toBe('合成保存失败'); expect(trigger.textContent).toBe('标准');
  save.mockResolvedValue({ permissionMode: 'read_only' } as Awaited<ReturnType<typeof promptAgentService.getConfig>>);
  vi.mocked(promptAgentService.getConfig).mockResolvedValue({ permissionMode: 'read_only' } as Awaited<ReturnType<typeof promptAgentService.getConfig>>);
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^只读/ })); await waitFor(() => expect(trigger.textContent).toBe('只读'));
  expect(save).toHaveBeenLastCalledWith('read_only'); expect(screen.queryByRole('menu')).toBeNull();
  view.rerender(<AgentPermissionSelect disabled />); expect(trigger.disabled).toBe(true);
});
it('权限菜单支持键盘与外部关闭，选择当前档位不重复写入', async () => {
  vi.spyOn(promptAgentService, 'getConfig').mockResolvedValue({ permissionMode: 'standard' } as Awaited<ReturnType<typeof promptAgentService.getConfig>>);
  const save = vi.spyOn(promptAgentService, 'setPermissionMode'); render(<AgentPermissionSelect />);
  const trigger = screen.getByRole('button', { name: 'Agent 权限' }) as HTMLButtonElement;
  await waitFor(() => expect(trigger.disabled).toBe(false));
  fireEvent.keyDown(trigger, { key: 'ArrowDown' }); const menu = screen.getByRole('menu');
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^标准/ }));
  fireEvent.keyDown(menu, { key: 'ArrowDown' }); expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^完全访问/ }));
  fireEvent.keyDown(menu, { key: 'Home' }); expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^只读/ }));
  fireEvent.keyDown(menu, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitemradio', { name: /^标准/ })); expect(save).not.toHaveBeenCalled();
  fireEvent.click(trigger); fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
});
it('旧后端不冒充标准档，重新聚焦后读取新服务恢复选择', async () => {
  const load = vi.spyOn(promptAgentService, 'getConfig').mockResolvedValue({} as Awaited<ReturnType<typeof promptAgentService.getConfig>>);
  render(<AgentPermissionSelect />); const trigger = screen.getByRole('button', { name: 'Agent 权限' }) as HTMLButtonElement;
  expect((await screen.findByRole('alert')).textContent).toContain('重启'); expect(trigger.disabled).toBe(true); expect(trigger.textContent).toBe('权限未就绪');
  load.mockResolvedValue({ permissionMode: 'full' } as Awaited<ReturnType<typeof promptAgentService.getConfig>>);
  fireEvent(window, new Event('focus')); await waitFor(() => expect(trigger.disabled).toBe(false)); expect(trigger.textContent).toBe('完全访问');
  expect(screen.queryByRole('alert')).toBeNull();
});
