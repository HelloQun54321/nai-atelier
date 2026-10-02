import { useCallback, useEffect, useRef, useState } from 'react';

/** 同一帧内图片尺寸合并更新，避免每张图加载都重排整个目录。 */
export const useImageRatios = () => {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const pending = useRef<Record<string, number>>({});
  const frame = useRef<number | null>(null);
  const update = useCallback((key: string, width: number, height: number) => {
    const ratio = width / height;
    if (!(width > 0 && height > 0 && Number.isFinite(ratio))) return;
    pending.current[key] = ratio;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const batch = pending.current; pending.current = {};
      setRatios(previous => Object.entries(batch).some(([key, value]) => previous[key] !== value) ? { ...previous, ...batch } : previous);
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return [ratios, update] as const;
};
