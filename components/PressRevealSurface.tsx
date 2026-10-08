import React, { useCallback, useEffect, useRef, useState } from 'react';

export const PRESS_REVEAL_DELAY = 450;
const REVEAL_EVENT = 'nai-card-actions-reveal';
const ACTION_TARGET = '[data-card-action], input, textarea, select, a';

type Props = React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'article' | 'section';
  pressDisabled?: boolean;
  pressResetKey?: React.Key;
  elementRef?: React.Ref<HTMLElement>;
};

/** 触屏长按只显露原位操作；正常点按、滚动和键盘操作保持各自语义。 */
export const PressRevealSurface: React.FC<Props> = ({
  as: Element = 'div', pressDisabled = false, pressResetKey, elementRef, children, className = '',
  onPointerDownCapture, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave,
  onPointerEnter, onClickCapture, onContextMenu, ...props
}) => {
  const rootRef = useRef<HTMLElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const consumedRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [input, setInput] = useState('');
  const attachRef = useCallback((element: HTMLElement | null) => {
    rootRef.current = element;
    if (typeof elementRef === 'function') elementRef(element);
    else if (elementRef) elementRef.current = element;
  }, [elementRef]);
  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    if (!armed && !revealed) return;
    const dismiss = () => {
      if (startRef.current) consumedRef.current = true;
      clearTimer(); startRef.current = null; setArmed(false); setRevealed(false);
    };
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    };
    const revealOther = (event: Event) => {
      if ((event as CustomEvent).detail !== rootRef.current) dismiss();
    };
    // 滚动也要取消尚未达到阈值的长按，避免浏览中途浮出控件。
    window.addEventListener('scroll', dismiss, true);
    document.addEventListener(REVEAL_EVENT, revealOther);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      document.removeEventListener(REVEAL_EVENT, revealOther);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', dismiss);
    };
  }, [armed, revealed]);

  useEffect(() => () => clearTimer(), []);

  // 复用预览翻到新图、或进入批量挑选时，清除上一对象的长按状态。
  useEffect(() => {
    clearTimer(); startRef.current = null; consumedRef.current = false; setArmed(false); setRevealed(false);
  }, [pressDisabled, pressResetKey]);

  const endPointer = () => { clearTimer(); startRef.current = null; setArmed(false); };
  return <Element {...props} ref={attachRef}
    className={`press-reveal-surface group ${className}`}
    data-press-revealed={revealed && !pressDisabled ? 'true' : undefined}
    data-press-input={input || undefined}
    onPointerEnter={event => {
      if (event.pointerType) setInput(event.pointerType);
      onPointerEnter?.(event);
    }}
    onPointerDownCapture={event => {
      endPointer();
      consumedRef.current = false;
      if (event.pointerType) setInput(event.pointerType);
      onPointerDownCapture?.(event);
      if (event.isPrimary === false) { setRevealed(false); return; }
      if (event.defaultPrevented || pressDisabled || !['touch', 'pen'].includes(event.pointerType)
        || event.button !== 0
        || (event.target as Element).closest(ACTION_TARGET)) return;
      startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      setArmed(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        consumedRef.current = true;
        setArmed(false);
        document.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: rootRef.current }));
        setRevealed(true);
      }, PRESS_REVEAL_DELAY);
    }}
    onPointerMove={event => {
      const start = startRef.current;
      if (start && event.pointerId === start.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        consumedRef.current = true;
        endPointer(); setRevealed(false);
      }
      onPointerMove?.(event);
    }}
    onPointerUp={event => { endPointer(); onPointerUp?.(event); }}
    onPointerCancel={event => { endPointer(); setRevealed(false); onPointerCancel?.(event); }}
    onPointerLeave={event => { endPointer(); onPointerLeave?.(event); }}
    onClickCapture={event => {
      if (consumedRef.current && event.detail !== 0 && !(event.target as Element).closest('[data-card-action]')) {
        consumedRef.current = false;
        event.preventDefault(); event.stopPropagation();
        return;
      }
      onClickCapture?.(event);
    }}
    onContextMenu={event => {
      if ((input === 'touch' || input === 'pen') && !(event.target as Element).closest('input, textarea, select, a')) event.preventDefault();
      onContextMenu?.(event);
    }}
  >{children}</Element>;
};
