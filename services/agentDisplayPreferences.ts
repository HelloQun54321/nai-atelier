export interface AgentDisplayPreferences { thinkingExpanded: boolean; toolsExpanded: boolean }
const key = 'nai_agent_display';
const normalize = (value: Partial<AgentDisplayPreferences> | null): AgentDisplayPreferences => ({ thinkingExpanded: value?.thinkingExpanded === true, toolsExpanded: value?.toolsExpanded === true });
export const getAgentDisplayPreferences = (): AgentDisplayPreferences => {
  try { return normalize(JSON.parse(localStorage.getItem(key) || '{}')); } catch { return normalize(null); }
};
export const setAgentDisplayPreferences = (value: Partial<AgentDisplayPreferences>) => {
  const next = normalize({ ...getAgentDisplayPreferences(), ...value });
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 存储禁用时仍更新当前界面。 */ }
  window.dispatchEvent(new CustomEvent('nai-agent-display-changed', { detail: next }));
  return next;
};
