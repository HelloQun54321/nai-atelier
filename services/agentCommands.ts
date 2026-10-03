import { useEffect, useRef } from 'react';
/** 页面实际能力登记；只执行当前可见工作区注册的函数，不接受脚本。 */
export interface AgentCommand {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly?: boolean;
  scope: () => HTMLElement | null;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => unknown | Promise<unknown>;
}
const commands = new Map<symbol, AgentCommand>();
export const registerAgentCommand = (command: AgentCommand) => {
  const id = Symbol(command.name); commands.set(id, command);
  window.dispatchEvent(new Event('nai-agent-capabilities-changed'));
  return () => { commands.delete(id); window.dispatchEvent(new Event('nai-agent-capabilities-changed')); };
};
const active = (command: AgentCommand, app: HTMLElement | null | undefined, foreground?: HTMLElement | null) => {
  const scope = command.scope();
  if (!scope || !app?.contains(scope)) return false;
  const sameCanvas = scope.dataset.agentCommandScope && foreground?.dataset.agentCommandScope === scope.dataset.agentCommandScope;
  if (foreground && !scope.contains(foreground) && !foreground.contains(scope) && !sameCanvas) return false;
  for (let node: HTMLElement | null = scope; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || node.matches('[data-agent-private],[data-agent-surface]')) return false;
  }
  return true;
};
export const getAgentCommands = (app: HTMLElement | null | undefined, foreground?: HTMLElement | null) => [...commands.values()].filter(command => active(command, app, foreground)).map(({ name, label, description, parameters, readOnly }) => ({ name, label, description, parameters, readOnly: Boolean(readOnly) }));
export const executeAgentCommand = async (app: HTMLElement | null | undefined, name: string, args: Record<string, unknown>, readOnly: boolean, signal?: AbortSignal, foreground?: HTMLElement | null) => {
  const command = [...commands.values()].find(item => item.name === name && active(item, app, foreground));
  if (!command) throw new Error('当前工作区没有这个操作，请重新读取实际能力');
  if (readOnly && !command.readOnly) throw new Error('当前为只读权限，不能编辑工作区');
  signal?.throwIfAborted();
  return command.execute(args, signal);
};
export const useAgentCommand = (command: AgentCommand) => {
  const latest = useRef(command); latest.current = command;
  useEffect(() => registerAgentCommand({ ...latest.current, scope: () => latest.current.scope(), execute: (args, signal) => latest.current.execute(args, signal) }), [command.name]);
};
