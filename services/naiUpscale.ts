import { parseErrorResponse } from './api';
import { readActiveNaiKey } from './naiKeyStorage';
import { hashNaiApiKey } from './anlasBudget';
import { beginExportTarget, saveExportBlob, type ExportReceipt } from './exportLocation';

/** 官方独立放大器线性放大 2×（像素面积 4×）；倍率由接口固定，不能调。 */
export const NAI_UPSCALE_FACTOR = 2;

/**
 * 官方按源图面积分档扣费，源图面积硬上限 3,145,728 像素（3 × 1,048,576），
 * 超限直接 400 且不扣费。实测（Opus，2026-11-05，20 个采样点）：
 * 1,048,576→1、1,049,600→2、1,745,041→2、1,747,684→3、2,446,096→3、
 * 2,447,660→4、3,145,302→4，边界为 1,048,576 / 1,747,627 / 2,446,678。
 * 即「108 万像素以内 1 点，之后把 1M~3M 均分三段、每多 699,051 像素加 1 点」，最多 4 点。
 */
export const UPSCALE_BASE_AREA = 1_048_576;
export const UPSCALE_MAX_AREA = 3_145_728;
const UPSCALE_STEP_AREA = (UPSCALE_MAX_AREA - UPSCALE_BASE_AREA) / 3;

export const upscaleCost = (width: number, height: number) => {
  const area = Math.max(1, Math.round(width * height));
  return area <= UPSCALE_BASE_AREA ? 1 : 2 + Math.floor((area - UPSCALE_BASE_AREA) / UPSCALE_STEP_AREA);
};

/** 官方拒绝超过硬上限的源图；提前判断可以省掉一次必然失败的请求。 */
export const upscaleSupported = (width?: number, height?: number) => {
  if (!width || !height) return true;
  return width * height <= UPSCALE_MAX_AREA;
};

export interface UpscaleResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

const fileNameOf = (historyId: string, createdAt?: number) => {
  const stamp = createdAt ? new Date(createdAt) : new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const suffix = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  return `upscaled_${historyId.slice(0, 8)}_${suffix}_2x.png`;
};

const imageSize = async (blob: Blob) => {
  if (typeof createImageBitmap !== 'function') return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch { return { width: 0, height: 0 }; }
};

/**
 * 调用官方 `/ai/upscale` 把一张历史图线性放大 2 倍（像素面积 4×）。
 * 只接受 V5 系列模型（网关已固定），源图可以是任何模型生成的成品。
 */
export const upscaleHistoryImage = async (historyId: string, { createdAt, apiKey }: { createdAt?: number; apiKey?: string } = {}): Promise<UpscaleResult> => {
  const key = (apiKey || readActiveNaiKey()).trim();
  if (!key) throw new Error('请先填写 NovelAI API Key');
  const response = await fetch('/api/nai/upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ historyId }),
  });
  if (!response.ok) throw await parseErrorResponse(response);
  const blob = await response.blob();
  if (!blob.size) throw new Error('NovelAI 没有返回放大结果');
  return { blob, filename: fileNameOf(historyId, createdAt), ...(await imageSize(blob)) };
};

/**
 * 放大结果不进历史也不覆盖原图，保存交给项目统一的导出通道：与其它下载一致，
 * 设了导出目录就落到那个目录，没设置才回退到浏览器默认下载位置。
 * `target` 必须在点击当下取好——确认弹窗与网络往返会耗掉目录选择需要的用户手势。
 */
export const downloadUpscaledImage = async (
  result: UpscaleResult,
  target: ReturnType<typeof beginExportTarget> = beginExportTarget(),
): Promise<ExportReceipt> => saveExportBlob(result.blob, result.filename, target);

/** 供确认弹窗使用：按源图面积给出实测公式算出的点数，实际扣费以官方为准。 */
export const upscaleCostHint = (width?: number, height?: number) => {
  if (!width || !height) return '官方按源图面积扣费：108 万像素以内 1 点，之后每多约 70 万像素加 1 点，最多 4 点。';
  if (!upscaleSupported(width, height)) return `源图 ${width}×${height} 超过官方上限 ${UPSCALE_MAX_AREA} 像素，无法放大。`;
  return `预计 ${upscaleCost(width, height)} 点（源图 ${width}×${height}，官方按面积分档）。`;
};

export const upscaleCacheKey = (historyId: string) => `nai-upscale:${historyId}`;

/** 被其它入口复用：确认框里显示当前 Key 指纹，便于判断扣的是哪个账号。 */
export const describeUpscaleAccount = async (apiKey?: string) => {
  const key = (apiKey || readActiveNaiKey()).trim();
  if (!key) return '';
  try { return (await hashNaiApiKey(key)).slice(0, 8); } catch { return ''; }
};
