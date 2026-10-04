// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageActivityProvider, SmartImage } from '../../components/SmartImage';
import { abortMobileThumbnailRequests, buildMediaUrl } from '../../services/mobileImageCache';

class VisibilityObserver {
  static instances: VisibilityObserver[] = [];
  target?: Element;
  disconnect = vi.fn();
  constructor(private callback: IntersectionObserverCallback) { VisibilityObserver.instances.push(this); }
  observe(target: Element) { this.target = target; }
  emit(...states: boolean[]) {
    this.callback(states.map(isIntersecting => ({ target: this.target, isIntersecting } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

let width = 480;
const resizeCallbacks = new Set<() => void>();
beforeEach(() => {
  width = 480; resizeCallbacks.clear(); VisibilityObserver.instances = [];
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.stubGlobal('IntersectionObserver', VisibilityObserver);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { resizeCallbacks.add(callback); }
    observe() {} disconnect() { resizeCallbacks.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
});
afterEach(() => { cleanup(); abortMobileThumbnailRequests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('共用缩略图加载', () => {
  it('同批先离开后进入预取区仍激活历史缩略图，离屏卡片继续等待', () => {
    const source = '/api/local-history/synthetic/image';
    render(<><SmartImage src={source} thumbnailVariant="thumb-960" alt="历史图" /><SmartImage src="/offscreen.png" alt="离屏图" /></>);
    expect(screen.queryByRole('img')).toBeNull();
    act(() => VisibilityObserver.instances[0].emit(false, true));
    const image = screen.getByRole('img', { name: '历史图' });
    expect(image.getAttribute('src')).toBe(buildMediaUrl(source, 'thumb-960'));
    expect(image.getAttribute('loading')).toBe('eager');
    fireEvent.load(image);
    expect(image.className).toContain('opacity-100');
    expect(screen.queryByRole('img', { name: '离屏图' })).toBeNull();
  });

  it('渐进高清源也处理同批后续进入记录，不影响已显示的低清图', () => {
    render(<SmartImage src="/preview.png" upgradeSrc="/clear.png" alt="渐进图" />);
    act(() => VisibilityObserver.instances[0].emit(true));
    const preview = screen.getByRole('img'); fireEvent.load(preview);
    act(() => VisibilityObserver.instances[1].emit(false, true));
    const upgrade = document.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    expect(upgrade?.getAttribute('src')).toBe('/clear.png');
    fireEvent.error(upgrade);
    expect(preview.className).toContain('opacity-100');
  });

  it('原图回退仍经过需要 Referer 的网关代理', () => {
    const source = 'https://ai-img.10118899.xyz/nai/1/synthetic.webp';
    render(<SmartImage eager src={source} alt="AITag 图" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').getAttribute('src')).toBe(buildMediaUrl(source, 'original'));
  });

  it('eager 非网关图片失败后点击重试会重新挂载图片', () => {
    render(<SmartImage eager src="/synthetic.png" alt="本地图" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /加载失败/ }));
    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toBe('/synthetic.png');
    fireEvent.load(image);
    expect(image.className).toContain('opacity-100');
  });

  it('普通懒加载卡片重试后重新进入预取区仍能挂载图片', () => {
    render(<SmartImage src="/synthetic.png" alt="重试图" />);
    act(() => VisibilityObserver.instances[0].emit(true));
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /加载失败/ }));
    act(() => VisibilityObserver.instances.at(-1)!.emit(true));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/synthetic.png');
  });

  it('主图失败后重试也重新启动 eager 高清升级源', () => {
    render(<SmartImage eager src="/synthetic.png" upgradeSrc="/synthetic-clear.png" alt="高清重试图" />);
    fireEvent.error(document.querySelector('img[aria-hidden="true"]')!);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /加载失败/ }));
    const upgrade = document.querySelector<HTMLImageElement>('img[aria-hidden="true"]')!;
    expect(upgrade?.getAttribute('src')).toBe('/synthetic-clear.png');
    fireEvent.load(upgrade);
    expect(upgrade.className).toContain('opacity-100');
    expect(screen.queryByText('加载中…')).toBeNull();
  });

  it('手机缩略请求失败后走代理原图，换图时丢弃旧请求的迟到结果', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const source = 'https://ai-img.10118899.xyz/nai/1/synthetic.webp';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    const view = render(<SmartImage eager src={source} alt="手机图" />);
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(buildMediaUrl(source, 'original')));
    let resolveOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    view.rerender(<SmartImage eager src="/api/assets/synthetic-old.png" alt="手机图" />);
    view.rerender(<SmartImage eager src="/synthetic-new.png" alt="手机图" />);
    await act(async () => resolveOld({ ok: true, blob: async () => new Blob(['synthetic'], { type: 'image/webp' }) } as Response));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/synthetic-new.png');
    fireEvent.load(screen.getByRole('img'));
    expect(screen.getByRole('img').className).toContain('opacity-100');
  });

  it('已回退原图后放大卡片不会把同一张已加载图片重新隐藏', () => {
    render(<SmartImage eager src="/api/local-history/synthetic/image" alt="回退图" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.load(screen.getByRole('img'));
    width = 960;
    act(() => resizeCallbacks.forEach(callback => callback()));
    expect(screen.getByRole('img').className).toContain('opacity-100');
  });

  it('切走保留已加载图片，隐藏期间不激活新图，切回继续处理进入记录', () => {
    const draw = (active: boolean) => <ImageActivityProvider active={active}><SmartImage src="/visible.png" alt="已加载图" /><SmartImage src="/later.png" alt="待加载图" /></ImageActivityProvider>;
    const view = render(draw(true));
    act(() => VisibilityObserver.instances[0].emit(true));
    fireEvent.load(screen.getByRole('img'));
    view.rerender(draw(false));
    expect(screen.getByRole('img').className).toContain('opacity-100');
    expect(screen.queryByRole('img', { name: '待加载图' })).toBeNull();
    view.rerender(draw(true));
    act(() => VisibilityObserver.instances.at(-1)!.emit(false, true));
    expect(screen.getByRole('img', { name: '待加载图' }).getAttribute('src')).toBe('/later.png');
  });
});
