import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** 脱离工作区隔离层，同时保留应用根节点的安全模式样式与事件。 */
export const ImagePreviewPortal: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTarget(document.querySelector<HTMLElement>('.agent-stage') || document.body);
  }, []);
  return target ? createPortal(children, target) : null;
};
