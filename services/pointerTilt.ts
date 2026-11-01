// 指针倾斜：鼠标在卡片上时按相对位置产生带惯性的 3D 偏转，命中侧下沉、对侧翘起。
// 偏转角由弹簧-阻尼积分逼近目标，因此卡片追得慢半拍并会过冲回落，形成“有重量”的手感。
// 整页共用一条 rAF 循环，同一时刻只驱动一张卡片，静止后立即停止。

const CARD_SELECTOR = '.gallery-image-card, .media-card';
const PERSPECTIVE = '900px';
// 重量感 0-100 线性映射：0 轻快跟手（高刚度、低阻尼），100 沉稳（低刚度、高阻尼）。
const STIFFNESS_LIGHT = .26, STIFFNESS_HEAVY = .10;
const DAMPING_LIGHT = .62, DAMPING_HEAVY = .82;
const DEFAULT_WEIGHT = 50;
const REST = .015;       // 静止阈值，低于此值直接释放
const MAX_SHIFT = 2;     // 随鼠标平移的上限（px），强化“被吸住”的重量感
const DEFAULT_TILT = 7;  // 最大偏转角兜底值，正常由 --nai-pointer-tilt 提供
const MAX_TILT = 18;     // 角度上限，再大就会明显畸变

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
  let stiffness = STIFFNESS_LIGHT - (STIFFNESS_LIGHT - STIFFNESS_HEAVY) / 2;
  let damping = DAMPING_LIGHT + (DAMPING_HEAVY - DAMPING_LIGHT) / 2;
  let target = zero();
  let current = zero();
  let velocity = zero();
  let frame = 0;
  // 快速划过时上一张卡片还在淡出，集中登记以便重新悬停时复用。
  const fading = new Set<HTMLElement>();

  /** 读取用户设置的角度与重量感；角度为 0 表示关闭。 */
  const readTuning = () => {
    const style = getComputedStyle(root);
    const angle = parseFloat(style.getPropertyValue('--nai-pointer-tilt'));
    max = Number.isFinite(angle) ? Math.min(Math.max(angle, 0), MAX_TILT) : DEFAULT_TILT;
    const weight = parseFloat(style.getPropertyValue('--nai-pointer-tilt-weight'));
    const ratio = (Number.isFinite(weight) ? Math.min(Math.max(weight, 0), 100) : DEFAULT_WEIGHT) / 100;
    stiffness = STIFFNESS_LIGHT - (STIFFNESS_LIGHT - STIFFNESS_HEAVY) * ratio;
    damping = DAMPING_LIGHT + (DAMPING_HEAVY - DAMPING_LIGHT) * ratio;
  };

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
    // 半隐式欧拉：先按刚度逼近期望角，再按阻尼衰减速度。刚度和阻尼跟随重量感设置。
    velocity = {
      x: (velocity.x + (target.x - current.x) * stiffness) * damping,
      y: (velocity.y + (target.y - current.y) * stiffness) * damping,
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
    readTuning();
    current = zero(); velocity = zero();
  };

  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !active()) { if (card) release(); return; }
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>(CARD_SELECTOR) : null;
    if (!element) {
      if (pointer) { pointer = null; target = zero(); box = null; schedule(); }
      return;
    }
    if (element !== card) {
      adopt(element);
      // 角度设为 0 时视为关闭，不再接管指针。
      if (max <= 0) { release(); return; }
    }
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
  // 拖动角度／重量感滑条时立即换用新参数，无需重新悬停。
  const tuning = () => {
    readTuning();
    if (max <= 0 || !active()) { release(); return; }
    if (card) schedule();
  };

  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', release, true);
  // pointerleave 不冒泡，挂在根元素上只用于指针甩出窗口时兜底回正。
  document.documentElement.addEventListener('pointerleave', leave);
  document.addEventListener('scroll', reset, true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', release);
  window.addEventListener('resize', reset);
  window.addEventListener('nai-pointer-tilt-change', tuning);
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
    window.removeEventListener('nai-pointer-tilt-change', tuning);
    motionQuery.removeEventListener('change', motion);
  };
};
