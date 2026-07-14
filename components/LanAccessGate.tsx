import React, { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';

interface LanAccessGateProps {
  children: ReactNode;
}

type GateState = 'checking' | 'locked' | 'open' | 'error';

export const LanAccessGate: React.FC<LanAccessGateProps> = ({ children }) => {
  const [state, setState] = useState<GateState>('checking');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkAccess = async () => {
    try {
      const response = await fetch('/api/lan/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法确认局域网访问状态');
      const result = await response.json() as { authorized?: boolean };
      setState(result.authorized ? 'open' : 'locked');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '电脑端服务暂时不可用');
      setState('error');
    }
  };

  useEffect(() => {
    void checkAccess();
    const requireAccess = () => {
      setPin('');
      setMessage('访问已失效，请重新输入密码');
      setState('locked');
    };
    window.addEventListener('nai-lan-access-required', requireAccess);
    return () => window.removeEventListener('nai-lan-access-required', requireAccess);
  }, []);

  useEffect(() => {
    if (state === 'locked') window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [state]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin) || submitting) {
      setMessage('请输入完整的四位数字密码');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/lan/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; attemptsRemaining?: number };
      if (!response.ok) {
        const suffix = typeof result.attemptsRemaining === 'number' && result.attemptsRemaining > 0
          ? `，还可尝试 ${result.attemptsRemaining} 次`
          : '';
        throw new Error(`${result.error || '验证失败'}${suffix}`);
      }
      setPin('');
      setState('open');
    } catch (error) {
      setPin('');
      setMessage(error instanceof Error ? error.message : '验证失败');
      window.setTimeout(() => inputRef.current?.focus(), 80);
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'open') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3 text-sm"><span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />正在连接电脑端…</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 p-5 text-white">
        <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="text-3xl">⚠️</div>
          <h1 className="mt-3 text-xl font-bold">无法连接电脑端</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{message}</p>
          <button onClick={() => { setState('checking'); void checkAccess(); }} className="mt-6 min-h-12 w-full rounded-xl bg-indigo-600 px-4 font-bold hover:bg-indigo-500">重新连接</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(circle_at_top,#312e81_0%,#0f172a_42%,#020617_100%)] p-5 text-white">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl backdrop-blur md:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-black shadow-lg">N</div>
          <div>
            <h1 className="text-xl font-bold">局域网访问</h1>
            <p className="mt-0.5 text-xs text-slate-400">NaiPromptManager · 电脑端数据</p>
          </div>
        </div>

        <p className="mt-7 text-sm leading-6 text-slate-300">请输入电脑启动窗口中显示的四位密码。验证后，这台设备将在30天内保持授权。</p>

        <label className="mt-6 block text-xs font-medium text-slate-400" htmlFor="lan-access-pin">四位数字密码</label>
        <input
          ref={inputRef}
          id="lan-access-pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={pin}
          onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
          className="mt-2 h-16 w-full rounded-2xl border border-slate-700 bg-slate-950 px-5 text-center font-mono text-3xl tracking-[0.8em] text-white outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20"
          aria-describedby={message ? 'lan-access-message' : undefined}
        />

        <div id="lan-access-message" className={`min-h-8 pt-2 text-center text-sm ${message ? 'text-rose-400' : 'text-slate-500'}`}>
          {message || '电脑本机访问不需要输入密码'}
        </div>

        <button type="submit" disabled={submitting || pin.length !== 4} className="mt-2 min-h-14 w-full rounded-2xl bg-indigo-600 px-5 text-base font-bold shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
          {submitting ? '正在验证…' : '进入项目'}
        </button>
        <p className="mt-5 text-center text-[11px] leading-5 text-slate-500">连续输错5次会暂停1分钟。请勿将电脑端口映射到公网。</p>
      </form>
    </div>
  );
};
