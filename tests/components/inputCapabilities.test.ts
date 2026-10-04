// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

type Device = { width: number; hover: 'hover' | 'none'; pointer: 'fine' | 'coarse'; anyPointer: 'fine' | 'coarse' };
let sheet: CSSStyleSheet;
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = readFileSync(resolve('components/inputCapabilities.css'), 'utf8');
  document.head.append(style); sheet = style.sheet!;
});
afterEach(() => { style.remove(); document.body.replaceChildren(); });

// jsdom 不执行媒体查询。读取真实 CSSOM，按测试设备匹配条件并应用声明；
// 属性标记仅模拟 :hover / :focus-within，不把生产规则复制进测试。
const stylesFor = (element: Element, device: Device) => {
  const values: Record<string, { value: string; important: boolean }> = {};
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.MEDIA_RULE) {
        const media = rule as CSSMediaRule;
        const matches = [...media.conditionText.matchAll(/\(([-\w]+):\s*([\w]+)\)/g)].every(([, feature, value]) => {
          if (feature === 'min-width') return device.width >= parseInt(value);
          if (feature === 'hover') return device.hover === value;
          if (feature === 'pointer') return device.pointer === value;
          if (feature === 'any-pointer') return device.anyPointer === value;
          throw new Error(`未验证的媒体条件：${feature}`);
        });
        if (matches) visit(media.cssRules);
      } else if (rule.type === CSSRule.STYLE_RULE) {
        const css = rule as CSSStyleRule;
        const selector = css.selectorText.replaceAll(':hover', '[data-test-hover]').replaceAll(':focus-within', '[data-test-focus-within]');
        if (!element.matches(selector)) continue;
        for (let index = 0; index < css.style.length; index++) {
          const property = css.style[index], important = css.style.getPropertyPriority(property) === 'important';
          if (!values[property]?.important || important) values[property] = { value: css.style.getPropertyValue(property), important };
        }
      }
    }
  };
  visit(sheet.cssRules);
  return Object.fromEntries(Object.entries(values).map(([key, item]) => [key, item.value]));
};
const fixture = (breakpoint: 'md' | 'lg') => {
  const group = document.createElement('div'); group.className = 'group';
  const actions = document.createElement('div'); actions.className = `hover-reveal-${breakpoint}`;
  const more = document.createElement('button'); more.className = 'touch-only-action';
  const legacy = document.createElement('button'); legacy.className = 'mouse-only-action';
  actions.append(more, legacy); group.append(actions); document.body.append(group);
  return { group, actions, more, legacy };
};

it.each([
  { width: 390, hover: 'none', pointer: 'coarse', anyPointer: 'coarse' },
  { width: 1024, hover: 'none', pointer: 'coarse', anyPointer: 'coarse' },
  { width: 1280, hover: 'none', pointer: 'coarse', anyPointer: 'coarse' },
  { width: 1280, hover: 'hover', pointer: 'fine', anyPointer: 'coarse' },
  { width: 390, hover: 'hover', pointer: 'fine', anyPointer: 'fine' },
] as Device[])('设备 $width / $hover / $pointer / $anyPointer 保留可见且能点击的入口，不重复桌面按钮', device => {
  for (const breakpoint of ['md', 'lg'] as const) {
    const { actions, more, legacy } = fixture(breakpoint);
    expect(stylesFor(actions, device)).toMatchObject({ opacity: '1', 'pointer-events': 'auto' });
    expect(stylesFor(more, device).display).toBe('inline-flex');
    expect(stylesFor(legacy, device).display).toBe('none');
  }
});
it.each(['md', 'lg'] as const)('精确鼠标的 %s 操作收起后不命中，悬停和键盘聚焦都会恢复', breakpoint => {
  const device: Device = { width: 1280, hover: 'hover', pointer: 'fine', anyPointer: 'fine' };
  const { group, actions, more, legacy } = fixture(breakpoint);
  expect(stylesFor(actions, device)).toMatchObject({ opacity: '0', 'pointer-events': 'none' });
  expect(stylesFor(more, device).display).toBe('none'); expect(stylesFor(legacy, device).display).toBe('inline-flex');
  for (const attribute of ['data-test-hover', 'data-test-focus-within', 'data-agent-hover']) {
    group.setAttribute(attribute, '');
    expect(stylesFor(actions, device)).toMatchObject({ opacity: '1', 'pointer-events': 'auto' });
    group.removeAttribute(attribute);
  }
  actions.setAttribute('data-test-focus-within', '');
  expect(stylesFor(actions, device)).toMatchObject({ opacity: '1', 'pointer-events': 'auto' });
});
it('断点各自正确：900px 鼠标收起 md 操作，lg 预览操作仍可见；时间文本不拦截图片点击', () => {
  const device: Device = { width: 900, hover: 'hover', pointer: 'fine', anyPointer: 'fine' };
  const md = fixture('md'), lg = fixture('lg');
  expect(stylesFor(md.actions, device).opacity).toBe('0'); expect(stylesFor(lg.actions, device).opacity).toBe('1');
  md.actions.classList.add('hover-reveal-info'); md.group.setAttribute('data-test-hover', '');
  expect(stylesFor(md.actions, device)['pointer-events']).toBe('none');
});
