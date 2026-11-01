// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPointerTilt } from '../../services/pointerTilt';

const installFrames = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  // 一帧只执行当前批次的回调；回调内新注册的帧留到下一次 flush，模拟真实 rAF 节奏。
  const flush = (count = 1) => {
    for (let index = 0; index < count; index++) {
      const pending = [...frames.values()];
      frames.clear();
      if (!pending.length) return index;
      for (const callback of pending) callback(index * 16);
    }
    return count;
  };
  return { frames, flush };
};

const angleOf = (card: HTMLElement, axis: 'rotateX' | 'rotateY') => {
  const matched = card.style.transform.match(new RegExp(`${axis}\\((-?[\\d.]+)deg\\)`));
  return matched ? Number(matched[1]) : null;
};

describe('卡片指针倾斜', () => {
  let cleanup: (() => void) | null = null;
  let card: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    document.documentElement.dataset.motion = 'full';
    delete document.documentElement.dataset.galleryPointerTilt;
    // 角度与重量感是 CSS 变量，跨用例必须显式复位，否则上一个用例的设置会漏到下一个。
    document.documentElement.style.removeProperty('--nai-pointer-tilt');
    document.documentElement.style.removeProperty('--nai-pointer-tilt-weight');
    card = document.createElement('article');
    card.className = 'gallery-image-card';
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.append(card);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    card.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const move = (x: number, y: number, pointerType = 'mouse', target: HTMLElement = card) =>
    target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerType, clientX: x, clientY: y }));

  it('鼠标压在右侧和下方时，命中侧下沉、对侧翘起', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(180, 90);
    flush(2);
    // 右侧命中 → rotateY 为正（右侧远离观察者下沉）；下方命中 → rotateX 为负（底部远离观察者下沉）。
    expect(angleOf(card, 'rotateY')).toBeGreaterThan(0);
    expect(angleOf(card, 'rotateX')).toBeLessThan(0);
    expect(card.dataset.pointerTilt).toBe('true');
    expect(card.style.transform.startsWith('perspective(900px)')).toBe(true);
  });

  it('左上角命中时两个轴同时反向', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(20, 10);
    flush(2);
    expect(angleOf(card, 'rotateY')).toBeLessThan(0);
    expect(angleOf(card, 'rotateX')).toBeGreaterThan(0);
  });

  it('角度按惯性逐帧逼近目标而不是立即跳到位', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50);
    flush(1);
    const first = angleOf(card, 'rotateY')!;
    flush(3);
    const later = angleOf(card, 'rotateY')!;
    // 目标约 6.3 度：首帧只走一小步，几帧后明显更接近但不超过目标太多。
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(2);
    expect(later).toBeGreaterThan(first);
    expect(later).toBeLessThan(7);
  });

  it('指针移出卡片后自动回正并清理内联样式与标记', () => {
    const { frames, flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50);
    flush(4);
    expect(card.style.transform).not.toBe('');
    move(0, 0, 'mouse', document.body);
    flush(200);
    expect(frames.size).toBe(0);
    expect(card.style.transform).toBe('');
    expect(card.dataset.pointerTilt).toBeUndefined();
  });

  it('关闭动效或关闭本项开关时完全不介入', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    document.documentElement.dataset.motion = 'off';
    move(190, 50);
    flush(2);
    expect(card.style.transform).toBe('');
    expect(card.dataset.pointerTilt).toBeUndefined();
    document.documentElement.dataset.motion = 'full';
    document.documentElement.dataset.galleryPointerTilt = 'false';
    move(190, 50);
    flush(2);
    expect(card.style.transform).toBe('');
  });

  it('触屏和手写笔不触发倾斜', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50, 'touch');
    move(190, 50, 'pen');
    flush(2);
    expect(card.style.transform).toBe('');
    expect(card.dataset.pointerTilt).toBeUndefined();
  });

  it('滚动时立即回正，不把倾斜带到新的滚动位置', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50);
    flush(3);
    expect(card.style.transform).not.toBe('');
    document.dispatchEvent(new Event('scroll'));
    flush(200);
    expect(card.style.transform).toBe('');
  });

  it('按下指针时立即释放，避免拖拽卡片时仍带偏转', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50);
    flush(3);
    card.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse' }));
    expect(card.style.transform).toBe('');
  });

  it('系统要求减少动效时不介入', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50);
    flush(2);
    expect(card.style.transform).toBe('');
  });

  it('角度设为 0 时不接管指针', () => {
    document.documentElement.style.setProperty('--nai-pointer-tilt', '0');
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(180, 50);
    flush(2);
    expect(card.style.transform).toBe('');
    expect(card.dataset.pointerTilt).toBeUndefined();
  });

  it('重量感越大，首帧跟随越慢', () => {
    const sample = (weight: string) => {
      document.documentElement.style.setProperty('--nai-pointer-tilt-weight', weight);
      card.style.removeProperty('transform');
      delete card.dataset.pointerTilt;
      const { flush } = installFrames();
      const stop = initPointerTilt();
      move(190, 50);
      flush(1);
      const value = angleOf(card, 'rotateY') ?? 0;
      stop();
      card.style.removeProperty('transform');
      delete card.dataset.pointerTilt;
      return value;
    };
    const light = sample('0');
    const heavy = sample('100');
    expect(light).toBeGreaterThan(heavy);
    expect(heavy).toBeGreaterThan(0);
  });

  it('修改角度后已悬停的卡片立即换用新角度', () => {
    const { flush } = installFrames();
    cleanup = initPointerTilt();
    move(190, 50);
    flush(20);
    const before = angleOf(card, 'rotateY')!;
    document.documentElement.style.setProperty('--nai-pointer-tilt', '3');
    window.dispatchEvent(new Event('nai-pointer-tilt-change'));
    move(190, 50);
    flush(20);
    const after = angleOf(card, 'rotateY')!;
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(3.5);
  });
});
