import { useEffect, useRef } from 'react';
import { promptAgentService, type PromptAgentConfig } from '../services/promptAgent';

/** 服务重启后只更新配置状态，不重新加载会话或打断正在编辑的内容。 */
export const useAgentRuntimeRecheck = (receive: (config: PromptAgentConfig) => void, enabled: boolean, outOfDate: boolean) => {
  const callback = useRef(receive);
  useEffect(() => { callback.current = receive; }, [receive]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, pending = false;
    const check = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const config = await promptAgentService.getConfig();
        if (!disposed) {
          callback.current(config);
          window.dispatchEvent(new Event('nai-agent-permissions-changed'));
        }
      } catch { /* 重启中的短暂断连保留上次状态，下一次继续核验。 */ }
      finally { pending = false; }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    const timer = outOfDate ? window.setInterval(check, 10_000) : undefined;
    return () => {
      disposed = true; window.clearInterval(timer);
      window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, outOfDate]);
};
