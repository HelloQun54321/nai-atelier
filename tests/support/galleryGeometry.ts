/** 合成列表几何，验证卡片相对可视区域的真实居中关系。 */
export function mockGalleryGeometry(cards: HTMLElement[]) {
  const root = cards[0].closest<HTMLElement>('.overflow-y-auto')!;
  const tops = cards.map((_, index) => 1800 + index * 800);
  const scrollCalls: ScrollToOptions[] = [];
  const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 800, width: 800 } as DOMRect);
  Object.defineProperties(root, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 4000 },
  });
  root.getBoundingClientRect = () => rect(100, 600);
  Object.defineProperty(root, 'scrollTo', { configurable: true, value: (options?: ScrollToOptions | number, y?: number) => {
    if (typeof options === 'object') scrollCalls.push(options);
    root.scrollTop = typeof options === 'number' ? y || 0 : options?.top ?? root.scrollTop;
  } });
  cards.forEach((card, index) => { card.getBoundingClientRect = () => rect(100 + tops[index] - root.scrollTop, 300); });
  return { root, tops, scrollCalls };
}
