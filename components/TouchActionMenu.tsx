import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../services/i18n';
import { MobileBottomSheet } from './MobileUI';

const COARSE_QUERY = '(hover: none), (pointer: coarse)';
const MOBILE_UI_QUERY = '(max-width: 767px)';
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

/** 与手机顶栏同一宽度：窄于 768px 即为手机界面，不论这下是不是手指。 */
export function useMobileLayout() {
  return useSyncExternalStore(subscribeMobile, mobileNow, () => false);
}

function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia?.(MOBILE_UI_QUERY);
  if (!media || typeof media.addEventListener !== 'function') return () => {};
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function mobileNow() {
  return Boolean(window.matchMedia?.(MOBILE_UI_QUERY)?.matches);
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
  const snapshot = useRef<{ items: HTMLButtonElement[]; signature: string }>({ items: [], signature: '' });
  useLayoutEffect(() => {
    if (!root) return;
    const update = () => {
      const next = collectTouchActions(root, mode);
      const nextSignature = next.map(button => `${actionLabel(button)}|${button.disabled}|${button.getAttribute('aria-pressed')}`).join('\n');
      const previous = snapshot.current;
      // 翻图会以同名的新按钮替换操作，不能让底栏继续点击已脱离文档的旧节点。
      if (nextSignature === previous.signature && next.length === previous.items.length && next.every((button, index) => button === previous.items[index])) return;
      snapshot.current = { items: next, signature: nextSignature };
      setItems(next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-label', 'aria-pressed', 'disabled', 'title', 'data-image-favorite'] });
    return () => observer.disconnect();
  }, [root, mode]);
  return items;
}

function ActionIcon({ source, className = 'touch-action-icon' }: { source: HTMLButtonElement; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const icon = source.querySelector('svg');
    ref.current?.replaceChildren(icon ? icon.cloneNode(true) : '');
  });
  return <span ref={ref} aria-hidden="true" className={className} />;
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
        activateSource(button, button.closest('.press-reveal-surface'));
        onActivate?.();
      }}
    >
      <ActionIcon source={button} />
      <span>{actionLabel(button)}</span>
    </button>)}
  </div>;
}

function actionDanger(button: HTMLButtonElement) {
  return /(?:^|\s)(?:text|bg|border)-red-/.test(button.className);
}

/** 封面按钮在手机布局里是 pointer-events: none。直接 click 时有的浏览器不会把事件送进 React。 */
function activateSource(source: HTMLButtonElement, root: HTMLElement | null) {
  const label = actionLabel(source);
  const live = source.isConnected ? source : Array.from(root?.querySelectorAll('button') || []).find(button => actionLabel(button) === label) || source;
  const restore: HTMLElement[] = [];
  for (let node: HTMLElement | null = live; node && node !== document.body; node = node.parentElement) {
    if (window.getComputedStyle(node).pointerEvents === 'none') {
      restore.push(node);
      node.style.pointerEvents = 'auto';
    }
  }
  live.click();
  restore.forEach(node => { node.style.pointerEvents = ''; });
}

/** 长按后直接用和其他手机面板同一块 MobileBottomSheet，不再另套一层挡点击。 */
export const TouchActionSheet: React.FC<{ root: HTMLElement | null; onDismiss: () => void }> = ({ root, onDismiss }) => {
  const items = useTouchActions(root, 'sheet');
  if (!items.length || typeof document === 'undefined') return null;
  return createPortal(
    <div data-touch-action-menu>
      <MobileBottomSheet open allowWide title={t('作品操作')} onClose={onDismiss}>
        <div className="space-y-1">
          {items.map((button, index) => <button
            key={`${actionLabel(button)}:${index}`}
            type="button"
            onClick={event => { event.stopPropagation(); activateSource(button, root); onDismiss(); }}
            className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors disabled:opacity-40 ${actionDanger(button) ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
          >
            <ActionIcon source={button} className="flex h-5 w-5 flex-none items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]" />
            <span className="min-w-0 flex-1 truncate">{actionLabel(button)}</span>
          </button>)}
        </div>
      </MobileBottomSheet>
    </div>,
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
