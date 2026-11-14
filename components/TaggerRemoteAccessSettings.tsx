import React, { useEffect, useState } from 'react';
import { InlineSpinner } from './DesignSystem';
import { t, useLanguage } from '../services/i18n';

interface Policy { enabled: boolean; origins: string[] }
const endpoint = '/api/lan/tagger-remote-access';

const readResponse = async (response: Response, fallback: string): Promise<Policy> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(typeof payload?.error === 'string' ? payload.error : fallback), { code: payload?.code });
  if (!payload || typeof payload.enabled !== 'boolean' || !Array.isArray(payload.origins) || !payload.origins.every((origin: unknown) => typeof origin === 'string')) throw new Error(fallback);
  return payload as Policy;
};

/** 只管理反推接口的来源兼容，不改变登录或其他本机权限。 */
export function TaggerRemoteAccessSettings() {
  useLanguage();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [origins, setOrigins] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true); setLoadError(false); setError(''); setMessage('');
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const payload = await readResponse(response, '无法读取来源配置');
        if (active) { setPolicy(payload); setOrigins(payload.origins.join('\n')); setMessage(''); }
      } catch (error) { if (active) { setLoadError(true); setError(error instanceof Error ? error.message : '无法读取来源配置'); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [retry]);
  const save = async () => {
    if (!policy || busy || loading || loadError) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: policy.enabled, origins: origins.split('\n').map(value => value.trim()).filter(Boolean) }) });
      const payload = await readResponse(response, '保存来源配置失败');
      setPolicy(payload); setOrigins(payload.origins.join('\n')); setMessage('来源配置已保存，立即生效');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'TAGGER_REMOTE_ACCESS_READ_FAILED') setLoadError(true);
      setError(error instanceof Error ? error.message : '保存来源配置失败');
    }
    finally { setBusy(false); }
  };
  return <section className="min-w-0 border-b border-gray-200 pb-5 dark:border-gray-700" aria-labelledby="tagger-remote-title">
    <h4 id="tagger-remote-title" className="font-semibold text-gray-900 dark:text-white">{t('反推 HTTPS 入口')}</h4>
    <p id="tagger-remote-help" className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('仅兼容反推接口的来源校验，不代替登录或代理认证。首次配置方法见下方。')}</p>
    <details className="mt-2 min-w-0 text-xs leading-5 text-gray-500 dark:text-gray-400">
      <summary className="mobile-touch cursor-pointer py-2 font-semibold text-indigo-600 dark:text-indigo-300">{t('首次配置方法（本机页面 / 命令行）')}</summary>
      <div className="space-y-2 pt-1">
        <p className="font-semibold">{t('通过页面配置')}</p>
        <p>{t('在运行工坊的设备打开 http://127.0.0.1:3000，进入「全局设置 → 数据与维护 → 反推 HTTPS 入口」，开启并保存正式来源。远程部署可在自己的电脑执行下列 SSH 转发，再打开 http://127.0.0.1:13000。')}</p>
        <pre className="min-w-0 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-3 font-mono dark:bg-gray-800"><code>ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:13000:127.0.0.1:3000 user@server</code></pre>
        <p>{t('将 user@server 替换为 SSH 登录地址；3000 为服务器网关端口，13000 为本机转发端口，请按实际情况调整。')}</p>
        <p className="pt-1 font-semibold">{t('通过命令行配置')}</p>
        <p>{t('在运行工坊的服务器上执行；远程部署请先 SSH 登录。容器部署须在能通过 127.0.0.1 访问网关的容器或主机环境执行。示例使用默认网关端口 3000，请按实际端口同时调整请求地址与 Origin。')}</p>
        <p>{t('保存前先查看配置。将 https://atelier.example.com 替换为正式来源，不含页面路径；非默认端口需写明。保存会替换整个允许列表，需保留的来源必须一起填写。')}</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>{t('查看当前配置')}<pre className="mt-1 min-w-0 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-3 font-mono dark:bg-gray-800"><code>{`curl --noproxy '*' -sS -i 'http://127.0.0.1:3000/api/lan/tagger-remote-access'`}</code></pre></li>
          <li>{t('保存允许的来源')}<pre className="mt-1 min-w-0 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-3 font-mono dark:bg-gray-800"><code>{`curl --noproxy '*' -sS -i -X PUT 'http://127.0.0.1:3000/api/lan/tagger-remote-access' -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' --data-raw '{"enabled":true,"origins":["https://atelier.example.com"]}'`}</code></pre></li>
        </ol>
        <p>{t('返回 HTTP 200 后回到 HTTPS 页面重试，无需重启。若返回 HTTP 503，请先排查配置读取错误，不要删除或覆盖原配置。')}</p>
        <p>{t('反代须保留原始 Host，并设置独立认证、隔离源站直连；此设置不提供公网认证。')}</p>
      </div>
    </details>
    {loading && <InlineSpinner label={t('正在读取配置…')} className="mt-2 text-xs" />}
    {!loading && loadError && <button type="button" data-appearance="control" data-tone="neutral" onClick={() => setRetry(value => value + 1)} className="mobile-touch mt-2 text-xs font-semibold text-indigo-600 underline dark:text-indigo-300">{t('重新读取')}</button>}
    <label className="mt-3 flex min-h-10 items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" checked={policy?.enabled ?? false} disabled={!policy || busy || loading || loadError} onChange={event => { setPolicy(current => current && { ...current, enabled: event.target.checked }); setMessage(''); }} />
      {t('允许指定来源管理反推模型')}
    </label>
    <label htmlFor="tagger-remote-origins" className="mt-2 block text-xs font-semibold text-gray-700 dark:text-gray-200">{t('允许的来源（每行一个，最多 32 条）')}</label>
    <textarea id="tagger-remote-origins" value={origins} disabled={!policy || busy || loading || loadError} onChange={event => { setOrigins(event.target.value); setMessage(''); }} rows={3} placeholder="https://atelier.example.com" aria-describedby="tagger-remote-help tagger-remote-format tagger-remote-error" aria-invalid={!!error} className="mt-2 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
    <p id="tagger-remote-format" className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('填写协议、主机和端口，不含路径或通配符。反代需保留 Host；关闭后保留列表。')}</p>
    {error && <p id="tagger-remote-error" role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{t(error)}</p>}
    {message && <p role="status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{t(message)}</p>}
    <button type="button" disabled={!policy || busy || loading || loadError} onClick={() => void save()} data-appearance="control" data-tone="save" className="mobile-touch mt-3 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-500">{busy ? t('保存中…') : t('保存来源配置')}</button>
  </section>;
}
