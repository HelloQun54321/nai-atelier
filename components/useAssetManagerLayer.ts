import { useEffect, useRef, useState } from 'react';

/** 资料列表与详情共用一层历史；箭头返回列表，关闭按钮退出整个窗口。 */
export const useAssetManagerLayer = <T,>(key: string) => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<T | null>(null);
  const detailRef = useRef<T | null>(null);
  const activeRef = useRef(false);
  const sessionRef = useRef(0);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => {
    if (!open) { sessionRef.current++; return; }
    if (!activeRef.current) {
      window.history.pushState({ ...window.history.state, [key]: 'list' }, '');
      activeRef.current = true;
    }
    const pop = () => {
      if (window.history.state?.[key] === 'list') {
        detailRef.current = null;
        setDetail(null);
      } else if (window.history.state?.[key] !== 'detail') {
        activeRef.current = false;
        sessionRef.current++;
        setOpen(false);
        setDetail(null);
      }
    };
    window.addEventListener('popstate', pop);
    return () => { sessionRef.current++; window.removeEventListener('popstate', pop); };
  }, [open, key]);
  const showDetail = (asset: T) => {
    if (!detailRef.current) window.history.pushState({ ...window.history.state, [key]: 'detail' }, '');
    detailRef.current = asset;
    setDetail(asset);
  };
  const backToList = () => {
    if (window.history.state?.[key] === 'detail') window.history.back();
    else { detailRef.current = null; setDetail(null); }
  };
  const closeManager = () => {
    const depth = window.history.state?.[key] === 'detail' ? 2 : 1;
    sessionRef.current++;
    detailRef.current = null;
    setDetail(null);
    setOpen(false);
    if (activeRef.current) { activeRef.current = false; window.history.go(-depth); }
  };
  return { open, setOpen, detail, setDetail, showDetail, backToList, closeManager, sessionRef };
};
