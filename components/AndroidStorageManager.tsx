import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { Download, Upload, Database, Smartphone } from 'lucide-react';
import { native } from '../mobile/native';
import { useConfirmDialog } from './ConfirmDialog';
import { StorageLocationManager } from './StorageLocationManager';
import { clearMobileThumbnailCache, getMobileCacheStats, setMobileCacheLimitMb, refreshMobileCacheMetadata } from '../services/mobileImageCache';
import {
  SETTINGS_BTN_DANGER,
  SETTINGS_BTN_NEUTRAL,
  SETTINGS_BTN_PRIMARY,
  SETTINGS_INPUT_CLASS,
  SETTINGS_SEGMENT_CLASS,
  SETTINGS_SEGMENT_OFF,
  SETTINGS_SEGMENT_ON,
  SETTINGS_SUBPANEL_CLASS,
  SettingsCard,
} from './SettingsUI';

export function AndroidStorageManager({ notify }: { notify: (message: string, type?: 'success' | 'error') => void }) {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [backup, setBackup] = useState<{ id:string; bytes:number; files:number; createdAt:number } | null>(null);
  const [cache,setCache]=useState(getMobileCacheStats);
  useEffect(()=>{const refresh=()=>setCache(getMobileCacheStats());void refreshMobileCacheMetadata().then(setCache);window.addEventListener('nai-mobile-cache-changed',refresh);return()=>window.removeEventListener('nai-mobile-cache-changed',refresh);},[]);
  const perform = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try { await work(); } catch (error) { if (error instanceof Error && (error.name === 'AbortError' || error.message === '已取消保存')) return; notify(error instanceof Error ? error.message : '手机存储操作失败', 'error'); }
    finally { setBusy(''); }
  };
  return <div className="space-y-4">
    <SettingsCard><StorageLocationManager notify={notify} /></SettingsCard>
    <SettingsCard title={t("手机数据")} headingLevel={4} icon={<Database />} description={t("卸载应用将清空本机资料，换机前请导出备份")}>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("备份密码")}<input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder={t("至少 8 位，恢复时需要同一密码")} className={`${SETTINGS_INPUT_CLASS} mt-1 font-normal`} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy)||password.length<8} onClick={()=>void perform('正在备份…',async()=>{
          const preferences=Object.fromEntries(Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).filter(Boolean).map(key=>[key,localStorage.getItem(key)]));
          const result=await native.backup({action:'export',password,preferences});
          await native.saveFile({path:result.path,mime:'application/octet-stream',filename:`NAI-Atelier-${new Date().toISOString().slice(0,10)}.naiatelier`,removeAfterSave:true});
          notify('手机完整备份已导出');
        })} data-appearance="control" data-tone="primary" className={SETTINGS_BTN_PRIMARY}><Download className="h-3.5 w-3.5" />{t("导出完整备份")}</button>
        <button type="button" disabled={Boolean(busy)||password.length<8} onClick={()=>void perform('正在验证备份…',async()=>{
          setBackup(await native.backup({action:'inspect',password}) as typeof backup);
        })} data-appearance="control" data-tone="neutral" className={SETTINGS_BTN_NEUTRAL}><Upload className="h-3.5 w-3.5" />{t("选择备份")}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("加密备份原图、资料、设置与 Key（不含缓存资源）")}</p>
      {busy&&<p role="status" className="mt-3 text-xs text-indigo-500">{busy}</p>}
      {backup&&<div className={`${SETTINGS_SUBPANEL_CLASS} mt-3 text-xs`}>
        <p>{t("{0} · {1} 个文件 · {2} MB", [new Date(backup.createdAt).toLocaleString(getLanguage()), backup.files, (backup.bytes/1048576).toFixed(1)])}</p>
        <button type="button" disabled={Boolean(busy)} data-appearance="control" data-tone="danger" className={`${SETTINGS_BTN_DANGER} mt-2`} onClick={()=>void perform('正在恢复…',async()=>{
          if(!await confirmAction({rememberKey:'android.restore',rememberScope:backup.id,title:'恢复手机工坊？',message:'将使用已验证的备份替换当前手机的资料、原图、设置与凭据。建议先导出当前工坊的备份。',confirmLabel:'恢复备份',tone:'danger'}))return;
          const result=await native.backup({action:'restore',id:backup.id});
          localStorage.clear();for(const [key,value]of Object.entries(result.preferences))if(typeof value==='string')localStorage.setItem(key,value);
          sessionStorage.clear();location.reload();
        })}>{t("恢复这份备份")}</button>
      </div>}
    </SettingsCard>
    <SettingsCard title={t("缩略图缓存")} headingLevel={4} icon={<Smartphone />} description={t("{0} 张 · {1} MB / {2} MB，清理不影响原图。", [cache.count, (cache.bytes/1048576).toFixed(1), cache.limitMb])}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="appearance-segmented grid flex-1 grid-cols-4 gap-2">
          {[0,25,50,100].map(limit=><button key={limit} type="button" data-appearance="control" data-tone="neutral" aria-pressed={cache.limitMb===limit} onClick={()=>{setMobileCacheLimitMb(limit);setCache(getMobileCacheStats());}} className={`${SETTINGS_SEGMENT_CLASS} ${cache.limitMb===limit?SETTINGS_SEGMENT_ON:SETTINGS_SEGMENT_OFF}`}>{limit?`${limit} MB`:t("关闭")}</button>)}
        </div>
        <button type="button" data-appearance="control" data-tone="danger" className={SETTINGS_BTN_DANGER} onClick={()=>void perform('正在清理缓存…',async()=>{await clearMobileThumbnailCache();notify('缩略图缓存已清理');})}>{t("清理缓存")}</button>
      </div>
    </SettingsCard>
  </div>;
}
