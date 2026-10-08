import { t, useLanguage } from '../services/i18n';
import React, { useState } from 'react';
import { Check, Download, LoaderCircle, Pause, Trash2 } from 'lucide-react';
import { imageTaggerService } from '../services/imageTaggerService';
import { useConfirmDialog } from './ConfirmDialog';
import { formatTaggerBytes, IMAGE_TAGGER_CHANGED, taggerProgressText, useImageTaggerStatus } from './useImageTaggerStatus';

export const ImageTaggerModelManager: React.FC<{ notify: (message: string, type?: 'success' | 'error') => void }> = ({ notify }) => {
  useLanguage();
  const { status, error } = useImageTaggerStatus(true);
  const confirmAction = useConfirmDialog();
  const [operating, setOperating] = useState(false);
  const act = async (action: () => Promise<void>, message?: string) => {
    if (operating) return;
    setOperating(true);
    try { await action(); window.dispatchEvent(new Event(IMAGE_TAGGER_CHANGED)); if (message) notify(message, 'success'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '模型操作失败', 'error'); }
    finally { setOperating(false); }
  };
  const button = 'mobile-touch flex flex-none items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';
  return <div>
    <h4 className="font-semibold text-gray-900 dark:text-white">{t("图片反推模型")}</h4>
    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("本地识别 · 0 Anlas")}</p>
    {error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{t(error)}</p>}
    {!status && !error && <p className="mt-3 text-xs text-gray-400">{t("正在检查模型…")}</p>}
    <div className="mt-3 space-y-2">{status?.models.map(model => {
      const selected = status.model === model.id;
      const downloading = status.downloadingModel === model.id;
      return <div key={model.id} className={`rounded-xl border bg-gray-50/70 p-3 dark:bg-gray-800/40 ${selected ? 'border-indigo-300 dark:border-indigo-500/40' : 'border-gray-200 dark:border-gray-700/80'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">{t(model.label)}{selected && <span className="text-micro font-normal text-indigo-600 dark:text-indigo-300">{t("当前使用")}</span>}</div><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t(model.description)} · {formatTaggerBytes(model.totalBytes)}</p></div>
          <div className="flex flex-wrap gap-2">
            {!model.downloaded && <button type="button" className={button} disabled={operating || Boolean(status.downloadingModel && !downloading)} onClick={() => void act(() => downloading ? imageTaggerService.pauseDownload() : imageTaggerService.downloadModel(model.id))}>{downloading ? <Pause className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}{downloading ? t("暂停") : model.receivedBytes ? t("继续下载") : t("下载")}</button>}
            <button type="button" className={button} aria-pressed={selected} disabled={selected || operating || status.busy} onClick={() => void act(() => imageTaggerService.selectModel(model.id), `已选择 ${model.label}`)}>{selected && <Check className="h-3.5 w-3.5" />}{selected ? t("使用中") : t("使用")}</button>
            {(model.downloaded || model.receivedBytes > 0 || downloading || model.stage === 'error') && <button type="button" className={`${button} hover:text-red-600 dark:hover:text-red-400`} aria-label={t("删除 {0}", [model.label])} disabled={operating || status.busy} title={status.busy ? t("模型正在使用，请完成后再删除") : t("删除本地模型文件和未完成的下载")} onClick={async () => {
              if (!await confirmAction({ title: `删除 ${model.label}？`, message: `${downloading ? '将先停止下载，再删除' : '将删除'}这个模型的本地文件及未完成的下载。原图和已保存的反推结果保留，再次使用此模型时会重新下载。`, confirmLabel: '删除模型', tone: 'danger' })) return;
              await act(() => imageTaggerService.deleteModel(model.id), `已删除 ${model.label}`);
            }}><Trash2 className="h-3.5 w-3.5" />{t("删除")}</button>}
          </div>
        </div>
        <div className={`mt-2 flex items-center gap-1.5 text-xs ${model.stage === 'error' ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`} role="status">{downloading && <LoaderCircle className="h-3 w-3 animate-spin" />}<span className="min-w-0 truncate" title={taggerProgressText(model)}>{taggerProgressText(model)}</span></div>
        {(downloading || model.stage === 'paused') && <progress aria-label={t("{0} 下载进度", [model.label])} max={model.totalBytes} value={model.receivedBytes} className="mt-2 h-1.5 w-full accent-indigo-600" />}
      </div>;
    })}</div>
  </div>;
};
