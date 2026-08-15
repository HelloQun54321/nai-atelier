import { useEffect, useRef } from 'react';

// 异步加载竞态守卫：begin() 取得本次加载序号，isCurrent(seq) 判断响应是否仍然有效。
// 有效 = 期间没有发起更新的加载，且组件尚未卸载。用于丢弃迟到的旧响应，
// 防止慢请求覆盖新结果、以及卸载后继续写状态。
export const useStaleGuard = () => {
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  return {
    begin: () => ++seqRef.current,
    isCurrent: (seq: number) => mountedRef.current && seqRef.current === seq,
  };
};
