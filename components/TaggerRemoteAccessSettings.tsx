import React, { useEffect, useState } from 'react';
import { ChevronDown, Globe, Save } from 'lucide-react';
import { InlineSpinner } from './DesignSystem';
import { t, useLanguage } from '../services/i18n';
import {
  SETTINGS_BTN_INLINE,
  SETTINGS_BTN_NEUTRAL,
  SETTINGS_BTN_PRIMARY,
  SETTINGS_SUBPANEL_CLASS,
  SETTINGS_TEXTAREA_CLASS,
  SettingsCardHeader,
  SettingsDisclosure,
  SettingsSwitchRow,
} from './SettingsUI';

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
  const [expanded, setExpanded] = useState(false);
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
        if (active) {
          setPolicy(payload);
          setOrigins(payload.origins.join('\n'));
          if (payload.enabled) setExpanded(true);
          setMessage('');
        }
      } catch (error) {
        if (active) {
          setLoadError(true);
          setExpanded(true);
          setError(error instanceof Error ? error.message : '无法读取来源配置');
        }
      }
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

  const panelOpen = expanded || loadError;

  return <div className="min-w-0 space-y-3" aria-labelledby="tagger-remote-title">
    <SettingsCardHeader
      title={t('反推 HTTPS 入口')}
      titleId="tagger-remote-title"
      headingLevel={4}
      icon={<Globe />}
      badge={!loading && !loadError ? (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold ${policy?.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'appearance-group bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
          {policy?.enabled ? t('已开启') : t('未开启')}
        </span>
      ) : undefined}
      description={<span id="tagger-remote-help">{t('仅用于反推接口来源校验，不代替登录认证')}</span>}
      action={
        <button
          type="button"
          data-appearance="control"
          data-tone="neutral"
          aria-expanded={panelOpen}
          onClick={() => setExpanded(value => !value)}
          className={SETTINGS_BTN_NEUTRAL}
        >
          <span>{panelOpen ? t('收起') : t('展开配置')}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${panelOpen ? 'rotate-180' : ''}`} />
        </button>
      }
    />

    {loading && !panelOpen && <InlineSpinner label={t('正在读取配置…')} className="text-xs" />}

    {panelOpen && (
      <div className={`${SETTINGS_SUBPANEL_CLASS} space-y-3 p-3.5 text-xs`}>
        {loading && <InlineSpinner label={t('正在读取配置…')} className="text-xs" />}

        <SettingsSwitchRow
          label="允许指定来源管理反推模型"
          checked={policy?.enabled ?? false}
          disabled={!policy || busy || loading || loadError}
          onChange={next => { setPolicy(current => current && { ...current, enabled: next }); setMessage(''); }}
          className="!py-1"
        />

        <div className="border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
          <label htmlFor="tagger-remote-origins" className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
            <Globe className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span>{t('允许的来源（每行一个，最多 32 条）')}</span>
          </label>
          <textarea
            id="tagger-remote-origins"
            value={origins}
            disabled={!policy || busy || loading || loadError}
            onChange={event => { setOrigins(event.target.value); setMessage(''); }}
            rows={2}
            placeholder="https://atelier.example.com"
            aria-describedby="tagger-remote-help tagger-remote-format tagger-remote-error"
            aria-invalid={!!error}
            className={`${SETTINGS_TEXTAREA_CLASS} mt-1.5 resize-none font-mono`}
          />
          <p id="tagger-remote-format" className="mt-1.5 text-meta leading-5 text-gray-500 dark:text-gray-400">
            {t('填写协议、主机与端口（不含路径或通配符）')}
          </p>
        </div>

        {(error || message || (!loading && loadError)) && (
          <div className="flex flex-wrap items-center gap-2">
            {error && <p id="tagger-remote-error" role="alert" className="break-words text-xs text-red-600 dark:text-red-300">{t(error)}</p>}
            {message && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{t(message)}</p>}
            {!loading && loadError && (
              <button
                type="button"
                data-appearance="control"
                data-tone="neutral"
                onClick={() => setRetry(value => value + 1)}
                className={`${SETTINGS_BTN_INLINE} shrink-0 underline`}
              >
                {t('重新读取')}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            disabled={!policy || busy || loading || loadError}
            onClick={() => void save()}
            data-appearance="control"
            data-tone="primary"
            className={SETTINGS_BTN_PRIMARY}
          >
            <Save className="h-3.5 w-3.5" />
            <span>{busy ? t('保存中…') : t('保存来源配置')}</span>
          </button>
        </div>

        <SettingsDisclosure
          summary={t('首次配置方法（本机页面 / 命令行）')}
          className="border-t border-gray-200/70 pt-2.5 text-meta leading-5 text-gray-500 dark:border-gray-700/70 dark:text-gray-400"
          summaryClassName="py-1"
        >
          <div className="mt-2 space-y-2">
            <p className="font-semibold text-gray-700 dark:text-gray-300">{t('本机或 SSH 转发后打开配置页')}</p>
            <pre className="appearance-content min-w-0 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-2.5 font-mono dark:bg-gray-900/70"><code>ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:13000:127.0.0.1:3000 user@server</code></pre>
            <p className="pt-1 font-semibold text-gray-700 dark:text-gray-300">{t('或在服务器命令行设置')}</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>{t('查看当前配置')}<pre className="appearance-content mt-1 min-w-0 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-2.5 font-mono dark:bg-gray-900/70"><code>{`curl --noproxy '*' -sS -i 'http://127.0.0.1:3000/api/lan/tagger-remote-access'`}</code></pre></li>
              <li>{t('保存允许的来源（覆盖原列表）')}<pre className="appearance-content mt-1 min-w-0 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-2.5 font-mono dark:bg-gray-900/70"><code>{`curl --noproxy '*' -sS -i -X PUT 'http://127.0.0.1:3000/api/lan/tagger-remote-access' -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' --data-raw '{"enabled":true,"origins":["https://atelier.example.com"]}'`}</code></pre></li>
            </ol>
            <p>{t('反代须保留原始 Host 并自行配置认证。')}</p>
          </div>
        </SettingsDisclosure>
      </div>
    )}
  </div>;
}
