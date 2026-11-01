// 指针倾斜：鼠标在卡片上时按相对位置产生带惯性的 3D 偏转，命中侧下沉、对侧翘起。
// 偏转角由弹簧-阻尼积分逼近目标，因此卡片追得慢半拍并会过冲回落，形成“有重量”的手感。
// 整页共用一条 rAF 循环，同一时刻只驱动一张卡片，静止后立即停止。

const CARD_SELECTOR = '.gallery-image-card, .media-card';
const PERSPECTIVE = '900px';
const STIFFNESS = .16;   // 弹簧刚度：越小越沉
const DAMPING = .74;     // 阻尼：越大回落越慢
const REST = .015;       // 静止阈值，低于此值直接释放
const MAX_SHIFT = 2;     // 随鼠标平移的上限（px），强化“被吸住”的重量感
const DEFAULT_TILT = 7;  // 默认最大偏转角，可用 CSS 变量 --nai-pointer-tilt 覆盖

interface Pair { x: number; y: number }
const zero = (): Pair => ({ x: 0, y: 0 });

export const initPointerTilt = () => {
  const root = document.documentElement;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 关闭动效、关闭本项或系统要求减少动效时都不介入指针。
  const active = () => root.dataset.motion === 'full'
    && root.dataset.galleryPointerTilt !== 'false'
    && !motionQuery.matches;

  let card: HTMLElement | null = null;
  let box: DOMRect | null = null;
  let pointer: Pair | null = null;
  let max = DEFAULT_TILT;
  let target = zero();
  let current = zero();
  let velocity = zero();
  let frame = 0;
  // 快速划过时上一张卡片还在淡出，集中登记以便重新悬停时复用。
  const fading = new Set<HTMLElement>();

  const release = () => {
    cancelAnimationFrame(frame); frame = 0;
    if (card) { card.style.removeProperty('transform'); delete card.dataset.pointerTilt; }
    card = null; box = null; pointer = null;
    target = zero(); current = zero(); velocity = zero();
  };

  const paint = () => {
    if (!card) return;
    const shiftX = (current.y / max) * MAX_SHIFT;
    const shiftY = (-current.x / max) * MAX_SHIFT;
    card.style.transform = `perspective(${PERSPECTIVE}) translate3d(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px, 0) rotateX(${current.x.toFixed(2)}deg) rotateY(${current.y.toFixed(2)}deg)`;
  };

  const step = () => {
    frame = 0;
    if (!card) return;
    if (!card.isConnected) { release(); return; }
    // 半隐式欧拉：先按刚度逼近期望角，再按阻尼衰减速度。
    velocity = {
      x: (velocity.x + (target.x - current.x) * STIFFNESS) * DAMPING,
      y: (velocity.y + (target.y - current.y) * STIFFNESS) * DAMPING,
    };
    current = { x: current.x + velocity.x, y: current.y + velocity.y };
    paint();
    const resting = !pointer
      && Math.abs(current.x) < REST && Math.abs(current.y) < REST
      && Math.abs(velocity.x) < REST && Math.abs(velocity.y) < REST;
    if (resting) { release(); return; }
    frame = requestAnimationFrame(step);
  };

  const schedule = () => { if (!frame && card) frame = requestAnimationFrame(step); };

  // 换卡时让上一张平滑回正，避免快速划过整排卡片时逐张闪跳。
  const fadeOut = (element: HTMLElement) => {
    if (fading.has(element)) return;
    fading.add(element);
    element.style.transition = 'transform 180ms ease-out';
    element.style.removeProperty('transform');
    window.setTimeout(() => {
      element.style.removeProperty('transition');
      delete element.dataset.pointerTilt;
      fading.delete(element);
    }, 200);
  };

  const adopt = (next: HTMLElement) => {
    if (card && card !== next) fadeOut(card);
    if (fading.delete(next)) next.style.removeProperty('transition');
    card = next;
    next.dataset.pointerTilt = 'true';
    box = next.getBoundingClientRect();
    const configured = parseFloat(getComputedStyle(root).getPropertyValue('--nai-pointer-tilt'));
    max = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 18) : DEFAULT_TILT;
    current = zero(); velocity = zero();
  };

  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !active()) { if (card) release(); return; }
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>(CARD_SELECTOR) : null;
    if (!element) {
      if (pointer) { pointer = null; target = zero(); box = null; schedule(); }
      return;
    }
    if (element !== card) adopt(element);
    // 悬停期间卡片尺寸不变，矩形只缓存一次，避免每帧读取布局。
    if (!box || !box.width || !box.height) box = element.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const nx = (event.clientX - box.left) / box.width * 2 - 1;
    const ny = (event.clientY - box.top) / box.height * 2 - 1;
    pointer = { x: nx, y: ny };
    // 命中侧下沉：鼠标在右 → rotateY 为正使右侧远离；鼠标在下 → rotateX 为负使底部远离。
    target = { x: -ny * max, y: nx * max };
    schedule();
  };

  // 滚动和缩放时卡片位置已经改变，立即回正并等待下一次悬停。
  const reset = () => { box = null; pointer = null; target = zero(); if (card) schedule(); };
  const leave = () => { if (!card) return; pointer = null; target = zero(); box = null; schedule(); };
  const visibility = () => { if (document.hidden) release(); };
  const motion = () => { if (!active()) release(); };

  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', release, true);
  // pointerleave 不冒泡，挂在根元素上只用于指针甩出窗口时兜底回正。
  document.documentElement.addEventListener('pointerleave', leave);
  document.addEventListener('scroll', reset, true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', release);
  window.addEventListener('resize', reset);
  motionQuery.addEventListener('change', motion);

  return () => {
    release();
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerdown', release, true);
    document.documentElement.removeEventListener('pointerleave', leave);
    document.removeEventListener('scroll', reset, true);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('blur', release);
    window.removeEventListener('resize', reset);
    motionQuery.removeEventListener('change', motion);
  };
};
