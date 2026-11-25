import { Buffer } from 'buffer';
import { selectPreciseReferenceBucket, selectPreciseReferenceCanvas } from 'mobile:gateway';

export async function prepareMobileReference(_key: string, bytes: Uint8Array, mode: 'resize' | 'bucket' | 'raw' = 'resize') {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    if (mode === 'bucket') {
      const bucket = selectPreciseReferenceBucket(bitmap.width, bitmap.height);
      canvas.width = bucket.width;
      canvas.height = bucket.height;
      ctx.drawImage(bitmap, -bucket.left, -bucket.top, bucket.resizeWidth, bucket.resizeHeight);
    } else if (mode === 'raw') {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
    } else {
      const { width, height } = selectPreciseReferenceCanvas(bitmap.width, bitmap.height);
      canvas.width = width; canvas.height = height;
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,width,height);
      const scale = Math.min(width / bitmap.width, height / bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
      ctx.drawImage(bitmap, (width-w)/2, (height-h)/2, w, h);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('精准参考转换失败')), 'image/png'));
    return Buffer.from(await blob.arrayBuffer()).toString('base64');
  } finally { bitmap.close(); }
}
export async function thumbnailResponse(response:Response,variant:string):Promise<Response>{
  if(!response.ok||variant==='original')return response;
  if(!/^thumb-(160|240|320|480|640|960)$/.test(variant))return new Response('不支持的缩略图尺寸',{status:400});
  const bitmap=await createImageBitmap(await response.blob());
  try{
    const scale=Math.min(1,Number(variant.slice(6))/bitmap.width),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('手机缩略图生成失败')),'image/webp',0.8));
    return new Response(blob,{headers:{'Content-Type':blob.type}});
  }finally{bitmap.close();}
}
