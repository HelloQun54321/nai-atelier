import React, { useCallback, useEffect, useRef, useState } from 'react';
import { collectTouchActions, TouchActionBar, TouchActionSheet, useCoarsePointer, useMobileLayout } from './TouchActionMenu';

export const PRESS_REVEAL_DELAY = 450;
const REVEAL_EVENT = 'nai-card-actions-reveal';
const ACTION_TARGET = '[data-card-action], input, textarea, select, a';
const SURFACE_TARGET = '.press-reveal-surface';

function isTouchMenuTarget(target: EventTarget | null) {
  return target instanceof globalThis.Element && Boolean(target.closest('[data-touch-action-menu]'));
}

type Props = React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'article' | 'section';
  pressDisabled?: boolean;
  pressResetKey?: React.Key;
  elementRef?: React.Ref<HTMLElement>;
  /** sheet：列表卡片长按出底部操作条。bar：详情和大图在手机上直接用这一层的底栏。 */
  touchActions?: 'sheet' | 'bar';
  touchBarClassName?: string;
};

/** 触屏长按打开底部操作条；详情和大图改由本层底栏承载。点按、滚动和键盘保持各自语义。 */
export const PressRevealSurface: React.FC<Props> = ({
  as: Element = 'div', pressDisabled = false, pressResetKey, elementRef, touchActions = 'sheet', touchBarClassName = '', children, className = '',
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
  const [node, setNode] = useState<HTMLElement | null>(null);
  const coarse = useCoarsePointer();
  const mobileLayout = useMobileLayout();
  const contextReveal = useRef(false);
  const barOnPhone = touchActions === 'bar' && coarse;
  const clearContextReveal = useCallback(() => {
    if (!contextReveal.current) return;
    contextReveal.current = false;
    setInput('');
  }, []);
  const attachRef = useCallback((element: HTMLElement | null) => {
    rootRef.current = element;
    setNode(element);
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
      clearTimer(); startRef.current = null; setArmed(false); setRevealed(false); clearContextReveal();
    };
    const outside = (event: PointerEvent) => {
      if (isTouchMenuTarget(event.target)) return;
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
  }, [armed, revealed, clearContextReveal]);

  useEffect(() => () => clearTimer(), []);
  useEffect(() => { if (!revealed) clearContextReveal(); }, [revealed, clearContextReveal]);

  // 复用预览翻到新图、或进入批量挑选时，清除上一对象的长按状态。
  useEffect(() => {
    clearTimer(); startRef.current = null; consumedRef.current = false; setArmed(false); setRevealed(false); clearContextReveal();
  }, [pressDisabled, pressResetKey, clearContextReveal]);

  const endPointer = () => { clearTimer(); startRef.current = null; setArmed(false); };
  return <Element {...props} ref={attachRef}
    className={`press-reveal-surface group ${className}`}
    data-press-revealed={revealed && !pressDisabled && !contextReveal.current ? 'true' : undefined}
    data-press-lift={revealed && !pressDisabled && (input === 'touch' || input === 'pen') ? 'true' : undefined}
    data-press-input={input || undefined}
    data-mobile-ui={mobileLayout ? 'true' : undefined}
    data-touch-actions={touchActions === 'bar' ? 'bar' : undefined}
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
      if (barOnPhone) return;
      if ((event.target as Element).closest(SURFACE_TARGET) !== rootRef.current) return;
      if (event.defaultPrevented || pressDisabled || !['touch', 'pen'].includes(event.pointerType)
        || event.button !== 0
        || (event.target as Element).closest(ACTION_TARGET)) return;
      startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      setArmed(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const actions = rootRef.current ? collectTouchActions(rootRef.current, 'sheet') : [];
        setArmed(false);
        if (!actions.length) return;
        consumedRef.current = true;
        try { navigator.vibrate?.(12); } catch { /* 无震动能力时静默 */ }
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
      const target = event.target as globalThis.Element;
      const editable = target.closest('input, textarea, select, a, [contenteditable="true"]');
      if ((input === 'touch' || input === 'pen') && !editable) event.preventDefault();
      // 电脑上把窗口收成手机界面时，鼠标右键走同一条长按操作条。宽屏右键仍留给系统菜单。
      if (mobileLayout && event.button === 2 && input !== 'touch' && input !== 'pen' && !pressDisabled && !barOnPhone && !editable
        && target.closest(SURFACE_TARGET) === rootRef.current) {
        const actions = rootRef.current ? collectTouchActions(rootRef.current, 'sheet') : [];
        if (actions.length) {
          event.preventDefault();
          event.stopPropagation();
          contextReveal.current = true;
          setInput('touch');
          document.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: rootRef.current }));
          setRevealed(true);
        }
      }
      onContextMenu?.(event);
    }}
  >
    {children}
    {touchActions === 'bar' && <TouchActionBar root={node} className={touchBarClassName} />}
    {revealed && !pressDisabled && (input === 'touch' || input === 'pen') && <TouchActionSheet root={node} onDismiss={() => setRevealed(false)} />}
  </Element>;
};
