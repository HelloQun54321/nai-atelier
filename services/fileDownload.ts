import { isAndroidApp } from './platform';

/** 用户主动导出文件；手机系统选择目录，成功写入后才给出完成回执。 */
export async function downloadFile(blob: Blob, filename: string) {
  if (isAndroidApp()) {
    const { native, writeBlob } = await import('../mobile/native');
    const path = await writeBlob(blob);
    await native.saveFile({ path, filename, mime: blob.type.split(';')[0] || 'application/octet-stream', removeAfterSave:true });
    return;
  }
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);
  try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
