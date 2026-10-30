import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const zValues = (source: string) => Array.from(source.matchAll(/z-\[(\d+)\]/g), match => Number(match[1]));
const read = (file: string) => readFileSync(file, 'utf8');

// 菜单、信息浮层、手机底部面板与确认框可从任意窗口内打开，必须整体高于全部内容窗口；
// 曾因确认框 1800、筛选浮层 1800、手机面板 1100 低于提示词库窗口 1900 而在窗口内被盖住。
const PRIMITIVES: Record<string, number[]> = {
  'components/ToolbarPopover.tsx': [2100, 2101],
  'components/InteractionPopover.tsx': [2100, 2101],
  'components/ConfirmDialog.tsx': [2400],
};

it('锚定浮层与手机底部面板高于全部内容窗口，确认框再高一层，提示最高', () => {
  for (const [file, expected] of Object.entries(PRIMITIVES)) expect(zValues(read(file)).sort(), file).toEqual(expected);
  expect(read('index.css')).toMatch(/\.mobile-layer \{[^}]*z-index: 2100;/);
  const layout = zValues(read('components/Layout.tsx'));
  expect(Math.max(...layout)).toBe(2300);

  const files = ['App.tsx', ...readdirSync('components', { recursive: true }).map(String).filter(file => /\.tsx$/.test(file)).map(file => join('components', file).replace(/\\/g, '/'))];
  const content = files.filter(file => !(file in PRIMITIVES)).flatMap(file => zValues(read(file)).filter(value => value !== 2300 || file !== 'components/Layout.tsx').map(value => ({ file, value })));
  expect(content.length).toBeGreaterThan(20);
  // 目录编辑等需在浮层内打开的嵌套窗口可与浮层同为 2100，同档时按打开顺序叠放；不能高过默认浮层。
  expect(content.filter(item => item.value > 2100)).toEqual([]);
  expect(Math.max(...content.map(item => item.value))).toBeLessThanOrEqual(2100);
});
