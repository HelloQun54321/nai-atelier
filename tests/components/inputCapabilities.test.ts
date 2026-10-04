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
        const matches = media.conditionText.split(',').some(condition => [...condition.matchAll(/\(([-\w]+):\s*([\w]+)\)/g)].every(([, feature, value]) => {
          if (feature === 'min-width') return device.width >= parseInt(value);
          if (feature === 'hover') return device.hover === value;
          if (feature === 'pointer') return device.pointer === value;
          if (feature === 'any-pointer') return device.anyPointer === value;
          throw new Error(`未验证的媒体条件：${feature}`);
        }));
        if (matches) visit(media.cssRules);
      } else if (rule.type === CSSRule.STYLE_RULE) {
        const css = rule as CSSStyleRule;
        const selector = css.selectorText.replaceAll(':hover', '[data-test-hover]').replaceAll(':focus-visible', '[data-test-focus-visible]');
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
const fixture = (kind: 'md' | 'lg' | 'touch') => {
  const group = document.createElement('div'); group.className = 'press-reveal-surface group';
  const actions = document.createElement('div'); actions.className = `hover-reveal-${kind}`;
  const button = document.createElement('button'); button.className = 'mobile-touch';
  actions.append(button); group.append(actions); document.body.append(group);
  return { group, actions, button };
};
const devices: Device[] = [
  { width: 390, hover: 'none', pointer: 'coarse', anyPointer: 'coarse' },
  { width: 1024, hover: 'none', pointer: 'coarse', anyPointer: 'coarse' },
  { width: 1280, hover: 'none', pointer: 'coarse', anyPointer: 'coarse' },
  { width: 1280, hover: 'hover', pointer: 'fine', anyPointer: 'coarse' },
  { width: 390, hover: 'hover', pointer: 'fine', anyPointer: 'fine' },
  { width: 1280, hover: 'hover', pointer: 'fine', anyPointer: 'fine' },
];
it.each(devices)('设备 $width / $hover / $pointer / $anyPointer：静止隐藏，长按原位显露后可点击', device => {
  for (const kind of ['md', 'lg', 'touch'] as const) {
    const { group, actions } = fixture(kind);
    const mouseFavorite = kind === 'touch' && device.anyPointer === 'fine' && device.hover === 'hover';
    expect(stylesFor(actions, device)).toMatchObject({ opacity: mouseFavorite ? '1' : '0', 'pointer-events': mouseFavorite ? 'auto' : 'none' });
    group.setAttribute('data-press-input', 'touch'); group.setAttribute('data-test-hover', '');
    expect(stylesFor(actions, device)).toMatchObject({ opacity: '0', 'pointer-events': 'none' });
    group.setAttribute('data-press-revealed', 'true');
    expect(stylesFor(actions, device)).toMatchObject({ opacity: '1', 'pointer-events': 'auto' });
    group.removeAttribute('data-press-revealed');
    expect(stylesFor(actions, device)).toMatchObject({ opacity: '0', 'pointer-events': 'none' });
  }
});
it('鼠标悬停、键盘可见焦点和 Agent 均可显露；普通触摸焦点不显露', () => {
  const device = devices[3];
  for (const kind of ['md', 'lg', 'touch'] as const) {
    const { group, actions, button } = fixture(kind);
    group.setAttribute('data-test-hover', '');
    expect(stylesFor(actions, device).opacity).toBe('1'); group.removeAttribute('data-test-hover');
    group.setAttribute('data-press-input', 'touch');
    for (const attribute of ['data-test-focus-visible', 'data-agent-hover']) {
      group.setAttribute(attribute, ''); expect(stylesFor(actions, device).opacity).toBe('1'); group.removeAttribute(attribute);
    }
    button.setAttribute('data-test-focus-visible', ''); expect(stylesFor(actions, device).opacity).toBe('1');
    button.removeAttribute('data-test-focus-visible'); expect(stylesFor(actions, device).opacity).toBe('0');
  }
});
it('纯触屏的模拟 hover 不会显露；文字层始终不拦截图片点击', () => {
  const { group, actions } = fixture('md'); group.setAttribute('data-test-hover', '');
  expect(stylesFor(actions, devices[0]).opacity).toBe('0');
  actions.classList.add('hover-reveal-info'); group.setAttribute('data-press-revealed', 'true');
  expect(stylesFor(actions, devices[0])).toMatchObject({ opacity: '1', 'pointer-events': 'none' });
});
it('触控动作保留 44px 命中区域，显露不通过更改尺寸或定位实现', () => {
  const { group, actions, button } = fixture('md');
  expect(stylesFor(button, devices[0])).toMatchObject({ 'min-width': '2.75rem', 'min-height': '2.75rem' });
  const before = stylesFor(actions, devices[0]); group.setAttribute('data-press-revealed', 'true');
  const after = stylesFor(actions, devices[0]);
  const geometric = (values: Record<string, string>) => Object.keys(values).filter(key => /height|width|display|position|padding|margin/.test(key));
  expect(geometric(before)).toEqual(geometric(after)); expect(geometric(after)).toHaveLength(0);
});
