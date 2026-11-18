import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../services/i18n';

const COARSE_QUERY = '(hover: none), (pointer: coarse)';
const REVEAL_SELECTOR = '.hover-reveal-md, .hover-reveal-lg, .hover-reveal-touch';
const STATUS_SELECTOR = '[data-artist-sample-status], [data-prompt-library-cover-status]';

/** 手机主指针是触摸时为真。带触控的电脑仍以鼠标为主，继续用悬停。 */
export function useCoarsePointer() {
  return useSyncExternalStore(subscribeCoarse, coarseNow, () => false);
}

function subscribeCoarse(onChange: () => void) {
  const media = window.matchMedia?.(COARSE_QUERY);
  if (!media || typeof media.addEventListener !== 'function') return () => {};
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function coarseNow() {
  return Boolean(window.matchMedia?.(COARSE_QUERY)?.matches);
}

function actionLabel(button: HTMLButtonElement) {
  return (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
}

function isPersistentFavorite(button: HTMLButtonElement) {
  return button.getAttribute('data-image-favorite') === 'true' && button.getAttribute('aria-pressed') === 'true';
}

function isRevealAction(button: HTMLButtonElement) {
  if (button.closest('.hover-reveal-info') || button.closest(STATUS_SELECTOR) || button.closest('[data-touch-action-menu]')) return false;
  if (['hover-reveal-md', 'hover-reveal-lg', 'hover-reveal-touch'].some(name => button.classList.contains(name))) return true;
  return Boolean(button.closest(REVEAL_SELECTOR));
}

/** 收集封面上按需显露的操作。详情底栏额外纳入返回等常驻圆钮，已收藏的爱心留在图上。 */
export function collectTouchActions(root: HTMLElement, mode: 'sheet' | 'bar') {
  const seen = new Set<HTMLButtonElement>();
  const list: HTMLButtonElement[] = [];
  root.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    if (seen.has(button) || button.disabled || isPersistentFavorite(button) || !actionLabel(button)) return;
    const revealed = isRevealAction(button);
    const barChrome = mode === 'bar' && button.classList.contains('nai-float-btn') && !button.closest(STATUS_SELECTOR) && !button.closest('[data-touch-action-menu]');
    if (!revealed && !barChrome) return;
    seen.add(button);
    list.push(button);
  });
  if (list.every(button => button.getBoundingClientRect().width === 0)) return list;
  return list.sort((a, b) => {
    const left = a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    if (Math.abs(left) > 28) return -left;
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  });
}

function useTouchActions(root: HTMLElement | null, mode: 'sheet' | 'bar') {
  const [items, setItems] = useState<HTMLButtonElement[]>([]);
  const signature = useRef('');
  useLayoutEffect(() => {
    if (!root) return;
    const update = () => {
      const next = collectTouchActions(root, mode);
      const nextSignature = next.map(button => `${actionLabel(button)}|${button.disabled}|${button.getAttribute('aria-pressed')}`).join('\n');
      if (nextSignature === signature.current) return;
      signature.current = nextSignature;
      setItems(next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-label', 'aria-pressed', 'disabled', 'title', 'data-image-favorite'] });
    return () => observer.disconnect();
  }, [root, mode]);
  return items;
}

function ActionIcon({ source }: { source: HTMLButtonElement }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const icon = source.querySelector('svg');
    ref.current?.replaceChildren(icon ? icon.cloneNode(true) : '');
  });
  return <span ref={ref} aria-hidden="true" className="touch-action-icon" />;
}

function ActionRow({ items, onActivate }: { items: HTMLButtonElement[]; onActivate?: () => void }) {
  if (!items.length) return null;
  return <div role="menu" aria-label={t('作品操作')} className="touch-action-row" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    {items.map((button, index) => <button
      key={`${actionLabel(button)}:${index}`}
      type="button"
      role="menuitem"
      aria-pressed={button.getAttribute('aria-pressed') === 'true' ? true : undefined}
      className="touch-action-item"
      onClick={event => {
        event.stopPropagation();
        event.preventDefault();
        button.click();
        onActivate?.();
      }}
    >
      <ActionIcon source={button} />
      <span>{actionLabel(button)}</span>
    </button>)}
  </div>;
}

/** 长按后贴在屏幕底部、底栏导航之上的一行操作。 */
export const TouchActionSheet: React.FC<{ root: HTMLElement | null; onDismiss: () => void }> = ({ root, onDismiss }) => {
  const items = useTouchActions(root, 'sheet');
  if (!items.length || typeof document === 'undefined') return null;
  return createPortal(
    <div data-touch-action-menu className="touch-action-sheet"><ActionRow items={items} onActivate={onDismiss} /></div>,
    document.body,
  );
};

/** 详情和大图自己的底栏：手机上一直在，不靠长按。 */
export const TouchActionBar: React.FC<{ root: HTMLElement | null; className?: string }> = ({ root, className = '' }) => {
  const coarse = useCoarsePointer();
  const items = useTouchActions(coarse ? root : null, 'bar');
  if (!coarse || !items.length) return null;
  return <div data-touch-action-menu className={`touch-action-bar ${className}`.trim()}><ActionRow items={items} /></div>;
};
