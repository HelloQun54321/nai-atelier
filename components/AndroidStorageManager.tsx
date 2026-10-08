import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { Download, Upload, Database, ExternalLink } from 'lucide-react';
import { native } from '../mobile/native';
import { useConfirmDialog } from './ConfirmDialog';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';
import {clearMobileThumbnailCache,getMobileCacheStats,setMobileCacheLimitMb,refreshMobileCacheMetadata} from '../services/mobileImageCache';

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
    try { await work(); } catch (error) { notify(error instanceof Error ? error.message : '手机存储操作失败', 'error'); }
    finally { setBusy(''); }
  };
  return <div className="space-y-5">
    <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
      <h4 className="flex items-center gap-2 font-semibold"><Database className="h-4 w-4 text-indigo-500" />{t("手机数据")}</h4>
      <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("资料、历史和原图保存在本机。卸载应用会删除这些资料，卸载或换机前请导出备份。")}</p>
      <label className="mt-3 block text-xs text-gray-600 dark:text-gray-300">{t("备份密码")}<input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder={t("至少 8 位，恢复时需要同一密码")} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-600" /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy)||password.length<8} onClick={()=>void perform('正在备份…',async()=>{
          const preferences=Object.fromEntries(Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).filter(Boolean).map(key=>[key,localStorage.getItem(key)]));
          const result=await native.backup({action:'export',password,preferences});
          await native.saveFile({path:result.path,mime:'application/octet-stream',filename:`NAI-Atelier-${new Date().toISOString().slice(0,10)}.naiatelier`,removeAfterSave:true});
          notify('手机完整备份已导出');
        })} className="mobile-touch flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Download className="h-4 w-4" />{t("导出完整备份")}</button>
        <button type="button" disabled={Boolean(busy)||password.length<8} onClick={()=>void perform('正在验证备份…',async()=>{
          setBackup(await native.backup({action:'inspect',password}) as typeof backup);
        })} className="mobile-touch flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600"><Upload className="h-4 w-4" />{t("选择备份")}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("备份包含原图、资料、设置、Key 与助手会话，使用密码加密；不包含可重新下载的词库、缩略图和反推模型。")}</p>
      {busy&&<p role="status" className="mt-3 text-xs text-indigo-500">{busy}</p>}
      {backup&&<div className="mt-3 rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-800">
        <p>{t("{0} · {1} 个文件 · {2} MB", [new Date(backup.createdAt).toLocaleString(getLanguage()), backup.files, (backup.bytes/1048576).toFixed(1)])}</p>
        <button type="button" disabled={Boolean(busy)} className="mobile-touch mt-2 rounded-lg bg-red-600 px-3 py-2 text-white disabled:opacity-50" onClick={()=>void perform('正在恢复…',async()=>{
          if(!await confirmAction({title:'恢复手机工坊？',message:'将使用已验证的备份替换当前手机的资料、原图、设置与凭据。建议先导出当前工坊的备份。',confirmLabel:'恢复备份',tone:'danger'}))return;
          const result=await native.backup({action:'restore',id:backup.id});
          localStorage.clear();for(const [key,value]of Object.entries(result.preferences))if(typeof value==='string')localStorage.setItem(key,value);
          sessionStorage.clear();location.reload();
        })}>{t("恢复这份备份")}</button>
      </div>}
    </div>
    <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><h4 className="font-semibold">{t("缩略图缓存")}</h4><p className="mt-2 text-xs text-gray-500">{t("{0} 张 · {1} MB / {2} MB，清理不影响原图。", [cache.count, (cache.bytes/1048576).toFixed(1), cache.limitMb])}</p><div className="mt-3 flex flex-wrap gap-2">{[0,25,50,100].map(limit=><button key={limit} type="button" onClick={()=>{setMobileCacheLimitMb(limit);setCache(getMobileCacheStats());}} className={`mobile-touch rounded-lg border px-3 py-2 text-xs ${cache.limitMb===limit?'border-indigo-500 text-indigo-500':'border-gray-300 dark:border-gray-600'}`}>{limit?`${limit} MB`:t("关闭")}</button>)}<button type="button" className="mobile-touch px-3 py-2 text-xs text-red-500" onClick={()=>void perform('正在清理缓存…',async()=>{await clearMobileThumbnailCache();notify('缩略图缓存已清理');})}>{t("清理缓存")}</button></div></div>
    <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-5 dark:border-gray-700"><h4 className="font-semibold">{t("Tag 补全词库")}</h4><TagDictionaryUpdater notify={notify} /></div>
    <div className="flex items-center justify-between gap-3"><div><h4 className="font-semibold">NAI Atelier</h4><p className="mt-1 text-xs text-gray-500">Android · v{__APP_VERSION__}</p></div><a href="https://github.com/HelloQun54321/nai-atelier" target="_blank" rel="noreferrer" className="mobile-touch flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white"><ExternalLink className="h-4 w-4" />GitHub</a></div>
  </div>;
}
