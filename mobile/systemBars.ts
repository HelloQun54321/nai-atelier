import { native } from './native';

/** 把计算样式里的颜色转成不透明 #rrggbb；透明或无法解析时返回 null。 */
export function opaqueHex(value: string): string | null {
  const match = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  if (!(alpha > 0)) return null;
  return '#' + match.slice(1, 4).map(part => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('');
}

/** 按相对亮度决定系统栏图标用深色还是浅色，自定义主题也能保持可读。 */
export function isDarkColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

/** 系统栏让出的上下两条与页面底色一致，图标明暗跟随当前主题而不是手机系统深色模式。 */
export function syncSystemBars(root = document.documentElement) {
  let last = '';
  let frame = 0;
  const apply = () => {
    frame = 0;
    const color = opaqueHex(getComputedStyle(document.body).backgroundColor)
      ?? opaqueHex(getComputedStyle(root).backgroundColor)
      ?? (root.classList.contains('dark') ? '#111827' : '#ffffff');
    const dark = isDarkColor(color);
    const key = color + dark;
    if (key === last) return;
    last = key;
    void native.systemBars({ color, dark }).catch(() => { last = ''; });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  // 主题、材质与自定义配色都写在根节点的类名、数据属性和内联变量上。
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-design-theme', 'data-surfaces', 'data-theme-material'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
  apply();
}
