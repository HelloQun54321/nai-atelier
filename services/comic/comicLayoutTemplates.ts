import { createUuid } from '../id';
import type { ComicPanel, ComicPoint } from './comicTypes';

export type ComicLayoutTemplateCategory =
  | 'narrative'
  | 'hero'
  | 'slanted'
  | 'strip'
  | 'special';

export interface ComicLayoutTemplateCategoryMeta {
  id: ComicLayoutTemplateCategory;
  label: string;
}

export const COMIC_LAYOUT_TEMPLATE_CATEGORIES: ComicLayoutTemplateCategoryMeta[] = [
  { id: 'narrative', label: '常用叙事' },
  { id: 'hero', label: '主次焦点' },
  { id: 'slanted', label: '动作斜切' },
  { id: 'strip', label: '四格与多格' },
  { id: 'special', label: '无框与叠框' },
];

export interface ComicLayoutTemplate {
  id: string;
  label: string;
  description: string;
  category: ComicLayoutTemplateCategory;
  panelCount: number;
  buildPanels: (gutterX: number, gutterY: number) => ComicPanel[];
}

export const rectToPolygon = (x: number, y: number, w: number, h: number): ComicPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

const signedPolygonArea = (pts: ReadonlyArray<readonly [number, number]>): number => {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
};

const toClockwiseComicPoints = (rawPts: ReadonlyArray<readonly [number, number]>): ComicPoint[] => {
  const ordered = signedPolygonArea(rawPts) >= 0 ? rawPts : [...rawPts].reverse();
  return ordered.map(([x, y]) => ({ x: round4(x), y: round4(y) }));
};

const makePanel = (
  name: string,
  points: ComicPoint[],
  zIndex: number,
  extra: Partial<ComicPanel> = {},
): ComicPanel => ({
  id: createUuid(),
  name,
  points,
  rotation: 0,
  zIndex,
  borderColor: '#111827',
  borderWidth: 3,
  backgroundColor: '#f8fafc',
  prompt: '',
  negativePrompt: '',
  anchors: [],
  useCoords: true,
  ...extra,
});

const buildRowGridPanels = (
  rowHeights: number[],
  rowCols: number[][],
  gx: number,
  gy: number,
  options?: {
    marginX?: number;
    marginY?: number;
    panelExtras?: Array<Partial<ComicPanel>>;
    names?: string[];
  },
): ComicPanel[] => {
  const mx = options?.marginX ?? 0.04;
  const my = options?.marginY ?? 0.04;
  const usableW = Math.max(0.1, 1 - mx * 2);
  const usableH = Math.max(0.1, 1 - my * 2);
  const totalHWeight = rowHeights.reduce((sum, v) => sum + v, 0) || 1;
  const availH = Math.max(0.1, usableH - gy * Math.max(0, rowHeights.length - 1));

  const panels: ComicPanel[] = [];
  let cursorY = my;
  let idx = 0;
  for (let r = 0; r < rowHeights.length; r++) {
    const h = (rowHeights[r] / totalHWeight) * availH;
    const cols = rowCols[r];
    const totalWWeight = cols.reduce((sum, v) => sum + v, 0) || 1;
    const availW = Math.max(0.1, usableW - gx * Math.max(0, cols.length - 1));
    let cursorX = mx;
    for (let c = 0; c < cols.length; c++) {
      const w = (cols[c] / totalWWeight) * availW;
      const name = options?.names?.[idx] ?? `第 ${idx + 1} 格`;
      const extra = options?.panelExtras?.[idx] ?? {};
      panels.push(makePanel(name, rectToPolygon(cursorX, cursorY, w, h), idx + 1, extra));
      cursorX += w + gx;
      idx += 1;
    }
    cursorY += h + gy;
  }
  return panels;
};

const isOuterUnitEdge = (
  a: readonly [number, number],
  b: readonly [number, number],
): boolean => {
  const eps = 0.001;
  return (
    (Math.abs(a[0]) < eps && Math.abs(b[0]) < eps) ||
    (Math.abs(a[0] - 1) < eps && Math.abs(b[0] - 1) < eps) ||
    (Math.abs(a[1]) < eps && Math.abs(b[1]) < eps) ||
    (Math.abs(a[1] - 1) < eps && Math.abs(b[1] - 1) < eps)
  );
};

/**
 * 对贴边无缝的凸多边形按页边距与格间距做等距内缩，
 * 保证斜切分镜与三角冲击格在任意 gutterPx 下均拥有均匀直角格缝。
 */
const insetConvexPolygon = (
  rawPts: ReadonlyArray<readonly [number, number]>,
  outerMargin: number,
  gutterHalfX: number,
  gutterHalfY: number,
): ComicPoint[] => {
  const pts = signedPolygonArea(rawPts) >= 0 ? rawPts : [...rawPts].reverse();
  const n = pts.length;
  const shiftedLines: Array<{ p: [number, number]; dir: [number, number] }> = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const outer = isOuterUnitEdge(a, b);
    const sx = outer ? outerMargin : gutterHalfX;
    const sy = outer ? outerMargin : gutterHalfY;
    shiftedLines.push({
      p: [a[0] + nx * sx, a[1] + ny * sy],
      dir: [dx, dy],
    });
  }

  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const l1 = shiftedLines[(i - 1 + n) % n];
    const l2 = shiftedLines[i];
    const det = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
    if (Math.abs(det) < 1e-9) {
      out.push([round4(l2.p[0]), round4(l2.p[1])]);
    } else {
      const rx = l2.p[0] - l1.p[0];
      const ry = l2.p[1] - l1.p[1];
      const t = (rx * l2.dir[1] - ry * l2.dir[0]) / det;
      out.push([
        round4(l1.p[0] + t * l1.dir[0]),
        round4(l1.p[1] + t * l1.dir[1]),
      ]);
    }
  }
  return toClockwiseComicPoints(out);
};

const buildInsetSlantedPanels = (
  polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  gx: number,
  gy: number,
  outerMargin = 0.04,
): ComicPanel[] =>
  polygons.map((poly, idx) =>
    makePanel(
      `第 ${idx + 1} 格`,
      insetConvexPolygon(poly, outerMargin, gx * 0.5, gy * 0.5),
      idx + 1,
    ),
  );

const buildNormalizedPolygons = (
  rawPolys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  margin = 0.04,
): ComicPanel[] => {
  const span = 1 - margin * 2;
  return rawPolys.map((poly, idx) => {
    const mapped = poly.map(([x, y]) => [margin + x * span, margin + y * span] as const);
    return makePanel(`第 ${idx + 1} 格`, toClockwiseComicPoints(mapped), idx + 1);
  });
};

export const COMIC_LAYOUT_TEMPLATES: ComicLayoutTemplate[] = [
  // ==================== 1. 常用叙事 (11) ====================
  {
    id: 'classic-4-121',
    label: '经典 4 格（1-2-1）',
    description: '上宽格引入、中双格对切、下宽格收尾',
    category: 'narrative',
    panelCount: 4,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.30, 0.36, 0.34], [[1], [0.5, 0.5], [1]], gx, gy),
  },
  {
    id: 'grid-2x2',
    label: '均衡 2×2 四格',
    description: '四等分叙事页，节奏平稳',
    category: 'narrative',
    panelCount: 4,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.5, 0.5], [[0.5, 0.5], [0.5, 0.5]], gx, gy),
  },
  {
    id: 'single-splash',
    label: '单格满页跨幅',
    description: '空白单格，适合自由一刀切分',
    category: 'narrative',
    panelCount: 1,
    buildPanels: () => [makePanel('第 1 格', rectToPolygon(0.04, 0.04, 0.92, 0.92), 1)],
  },
  {
    id: 'two-horizontal',
    label: '双横格',
    description: '上下对半双景，适合对话或场景对比',
    category: 'narrative',
    panelCount: 2,
    buildPanels: (gx, gy) => buildRowGridPanels([0.5, 0.5], [[1], [1]], gx, gy),
  },
  {
    id: 'two-vertical',
    label: '双竖格',
    description: '左右对半双竖格，适合人物并立或对峙',
    category: 'narrative',
    panelCount: 2,
    buildPanels: (gx, gy) => buildRowGridPanels([1], [[0.5, 0.5]], gx, gy),
  },
  {
    id: 'three-horizontal',
    label: '三段叙事',
    description: '三行均分横格，依次推进动作或时间',
    category: 'narrative',
    panelCount: 3,
    buildPanels: (gx, gy) => buildRowGridPanels([1, 1, 1], [[1], [1], [1]], gx, gy),
  },
  {
    id: 'three-vertical',
    label: '三列并行',
    description: '三列竖长格并排，适合多人同步反应',
    category: 'narrative',
    panelCount: 3,
    buildPanels: (gx, gy) => buildRowGridPanels([1], [[1, 1, 1]], gx, gy),
  },
  {
    id: 'cinematic',
    label: '宽景与特写',
    description: '上下宽景夹中段三七开双格，电影分镜感',
    category: 'narrative',
    panelCount: 4,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.24, 0.52, 0.24], [[1], [0.35, 0.65], [1]], gx, gy),
  },
  {
    id: 'five-beats',
    label: '五格推进',
    description: '上下双格夹中央宽画幅，节奏张弛有序',
    category: 'narrative',
    panelCount: 5,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.28, 0.44, 0.28], [[0.5, 0.5], [1], [0.5, 0.5]], gx, gy),
  },
  {
    id: 'opening-panorama',
    label: '开场全景',
    description: '顶部宽幅定场，下方四格展开剧情',
    category: 'narrative',
    panelCount: 5,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.30, 0.35, 0.35], [[1], [0.5, 0.5], [0.5, 0.5]], gx, gy),
  },
  {
    id: 'closing-panorama',
    label: '结尾全景',
    description: '前四格铺垫，底部宽幅定格收尾',
    category: 'narrative',
    panelCount: 5,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.35, 0.35, 0.30], [[0.5, 0.5], [0.5, 0.5], [1]], gx, gy),
  },

  // ==================== 2. 主次焦点 (9) ====================
  {
    id: 'dynamic-l-shape',
    label: '动感 L 型 4 格',
    description: '左高立绘格 + 右侧三连特写',
    category: 'hero',
    panelCount: 4,
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const leftW = (usableW - gx) * 0.44;
      const rightW = usableW - gx - leftW;
      const rightH = (usableH - gy * 2) / 3;
      return [
        makePanel('主立绘格', rectToPolygon(m, m, leftW, usableH), 1),
        makePanel('右上格', rectToPolygon(m + leftW + gx, m, rightW, rightH), 2),
        makePanel('右中格', rectToPolygon(m + leftW + gx, m + rightH + gy, rightW, rightH), 3),
        makePanel('右下格', rectToPolygon(m + leftW + gx, m + (rightH + gy) * 2, rightW, rightH), 4),
      ];
    },
  },
  {
    id: 'hero-top',
    label: '上方主镜头',
    description: '上方大画幅主镜头 + 下方双格接续',
    category: 'hero',
    panelCount: 3,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.62, 0.38], [[1], [0.5, 0.5]], gx, gy),
  },
  {
    id: 'hero-bottom',
    label: '下方主镜头',
    description: '上方双格铺垫 + 下方大画幅冲击收尾',
    category: 'hero',
    panelCount: 3,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.38, 0.62], [[0.5, 0.5], [1]], gx, gy),
  },
  {
    id: 'hero-left',
    label: '左侧主镜头',
    description: '左高立绘主格 + 右侧上下双格补充',
    category: 'hero',
    panelCount: 3,
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const leftW = (usableW - gx) * 0.62;
      const rightW = usableW - gx - leftW;
      const rightH = (usableH - gy) / 2;
      return [
        makePanel('第 1 格', rectToPolygon(m, m, leftW, usableH), 1),
        makePanel('第 2 格', rectToPolygon(m + leftW + gx, m, rightW, rightH), 2),
        makePanel('第 3 格', rectToPolygon(m + leftW + gx, m + rightH + gy, rightW, rightH), 3),
      ];
    },
  },
  {
    id: 'hero-right',
    label: '右侧主镜头',
    description: '左侧上下双格 + 右侧高立绘主格',
    category: 'hero',
    panelCount: 3,
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const leftW = (usableW - gx) * 0.38;
      const rightW = usableW - gx - leftW;
      const leftH = (usableH - gy) / 2;
      return [
        makePanel('第 1 格', rectToPolygon(m, m, leftW, leftH), 1),
        makePanel('第 2 格', rectToPolygon(m, m + leftH + gy, leftW, leftH), 2),
        makePanel('第 3 格', rectToPolygon(m + leftW + gx, m, rightW, usableH), 3),
      ];
    },
  },
  {
    id: 'fp-orthodox-2',
    label: '日漫右竖左双 4 格',
    description: '上宽格引出，下层右高竖格配左双小格',
    category: 'hero',
    panelCount: 4,
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const topH = (usableH - gy) / 3;
      const bottomH = usableH - gy - topH;
      const colW = (usableW - gx) / 2;
      const leftSmallH = (bottomH - gy) / 2;
      return [
        makePanel('第 1 格', rectToPolygon(m, m, usableW, topH), 1),
        makePanel('第 2 格', rectToPolygon(m + colW + gx, m + topH + gy, colW, bottomH), 2),
        makePanel('第 3 格', rectToPolygon(m, m + topH + gy, colW, leftSmallH), 3),
        makePanel('第 4 格', rectToPolygon(m, m + topH + gy + leftSmallH + gy, colW, leftSmallH), 4),
      ];
    },
  },
  {
    id: 'fp-ai-4',
    label: '日漫三层 4 格',
    description: '上双格、中窄条、下大格的经典日漫三层节奏',
    category: 'hero',
    panelCount: 4,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.32, 0.23, 0.45], [[0.5, 0.5], [1], [1]], gx, gy),
  },
  {
    id: 'tall-center',
    label: '中央长镜头',
    description: '中央贯通高格为核心，两侧各配上下双格',
    category: 'hero',
    panelCount: 5,
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const sideW = (usableW - gx * 2) * 0.25;
      const midW = (usableW - gx * 2) * 0.50;
      const sideH = (usableH - gy) / 2;
      return [
        makePanel('第 1 格', rectToPolygon(m, m, sideW, sideH), 1),
        makePanel('第 2 格', rectToPolygon(m, m + sideH + gy, sideW, sideH), 2),
        makePanel('第 3 格', rectToPolygon(m + sideW + gx, m, midW, usableH), 3),
        makePanel('第 4 格', rectToPolygon(m + sideW + gx + midW + gx, m, sideW, sideH), 4),
        makePanel('第 5 格', rectToPolygon(m + sideW + gx + midW + gx, m + sideH + gy, sideW, sideH), 5),
      ];
    },
  },
  {
    id: 'med-left-hero-5',
    label: '左竖主格 + 右四连',
    description: '左侧满高主视角配合右侧四段连续节奏',
    category: 'hero',
    panelCount: 5,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.481, 0.001], [0.001, 0.001], [0.001, 0.999], [0.481, 0.999]],
        [[0.999, 0.233], [0.999, 0.001], [0.495, 0.001], [0.495, 0.233]],
        [[0.999, 0.488], [0.999, 0.243], [0.495, 0.243], [0.495, 0.488]],
        [[0.999, 0.728], [0.999, 0.499], [0.495, 0.499], [0.495, 0.728]],
        [[0.495, 0.999], [0.999, 0.999], [0.999, 0.739], [0.495, 0.739]],
      ]),
  },

  // ==================== 3. 动作斜切 (15) ====================
  {
    id: 'slanted-action-5',
    label: '斜切动作 5 格',
    description: '带斜角分镜线的戏剧冲突构图',
    category: 'slanted',
    panelCount: 5,
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const r = 1 - m;
      const y1 = 0.30;
      const y2 = 0.65;
      const skew = 0.045;
      const midX = 0.5;
      return [
        makePanel('开场宽格', [
          { x: m, y: m },
          { x: r, y: m },
          { x: r, y: y1 - skew },
          { x: m, y: y1 + skew },
        ], 1),
        makePanel('中左斜格', [
          { x: m, y: y1 + skew + gy },
          { x: midX - gx * 0.5 + 0.03, y: y1 + gy },
          { x: midX - gx * 0.5 - 0.03, y: y2 - gy },
          { x: m, y: y2 - gy },
        ], 2),
        makePanel('中右斜格', [
          { x: midX + gx * 0.5 + 0.03, y: y1 + gy - skew * 0.5 },
          { x: r, y: y1 - skew + gy },
          { x: r, y: y2 - gy },
          { x: midX + gx * 0.5 - 0.03, y: y2 - gy },
        ], 3),
        makePanel('下左格', rectToPolygon(m, y2, (r - m - gx) * 0.42, r - y2), 4),
        makePanel('下右格', rectToPolygon(m + (r - m - gx) * 0.42 + gx, y2, (r - m - gx) * 0.58, r - y2), 5),
      ];
    },
  },
  {
    id: 'diagonal-duo',
    label: '斜切双格',
    description: '大幅斜切横线一分为二，强烈动感对比',
    category: 'slanted',
    panelCount: 2,
    buildPanels: (gx, gy) =>
      buildInsetSlantedPanels(
        [
          [[0, 0], [1, 0], [1, 0.35], [0, 0.65]],
          [[0, 0.65], [1, 0.35], [1, 1], [0, 1]],
        ],
        gx,
        gy,
      ),
  },
  {
    id: 'diagonal-action',
    label: '斜向动作',
    description: '纵向大斜线对切双格，适合双人对峙交锋',
    category: 'slanted',
    panelCount: 2,
    buildPanels: (gx, gy) =>
      buildInsetSlantedPanels(
        [
          [[0, 0], [0.7, 0], [0.3, 1], [0, 1]],
          [[0.7, 0], [1, 0], [1, 1], [0.3, 1]],
        ],
        gx,
        gy,
      ),
  },
  {
    id: 'diagonal-three',
    label: '三段斜切',
    description: '交错斜线切分三段横格，强化动作递进',
    category: 'slanted',
    panelCount: 3,
    buildPanels: (gx, gy) =>
      buildInsetSlantedPanels(
        [
          [[0, 0], [1, 0], [1, 0.2], [0, 0.42]],
          [[0, 0.42], [1, 0.2], [1, 0.68], [0, 0.8]],
          [[0, 0.8], [1, 0.68], [1, 1], [0, 1]],
        ],
        gx,
        gy,
      ),
  },
  {
    id: 'diagonal-opening',
    label: '斜格开场',
    description: '上双格斜切起势，下宽格稳住重心',
    category: 'slanted',
    panelCount: 3,
    buildPanels: (gx, gy) =>
      buildInsetSlantedPanels(
        [
          [[0, 0], [0.65, 0], [0.4, 0.55], [0, 0.55]],
          [[0.65, 0], [1, 0], [1, 0.55], [0.4, 0.55]],
          [[0, 0.55], [1, 0.55], [1, 1], [0, 1]],
        ],
        gx,
        gy,
      ),
  },
  {
    id: 'diagonal-ending',
    label: '斜格收束',
    description: '上宽格铺垫，下双格斜切增强结尾张力',
    category: 'slanted',
    panelCount: 3,
    buildPanels: (gx, gy) =>
      buildInsetSlantedPanels(
        [
          [[0, 0], [1, 0], [1, 0.45], [0, 0.45]],
          [[0, 0.45], [0.6, 0.45], [0.35, 1], [0, 1]],
          [[0.6, 0.45], [1, 0.45], [1, 1], [0.35, 1]],
        ],
        gx,
        gy,
      ),
  },
  {
    id: 'triangle-impact',
    label: '三角冲击',
    description: '四格交汇中心爆发点，极强视觉冲击力',
    category: 'slanted',
    panelCount: 4,
    buildPanels: (gx, gy) =>
      buildInsetSlantedPanels(
        [
          [[0, 0], [1, 0], [0.5, 0.6]],
          [[0, 0], [0.5, 0.6], [0, 1]],
          [[1, 0], [1, 1], [0.5, 0.6]],
          [[0, 1], [0.5, 0.6], [1, 1]],
        ],
        gx,
        gy,
      ),
  },
  {
    id: 'med-slant-right-hero-4',
    label: '右斜主格 + 左三格',
    description: '右侧贯通大斜格压阵，左侧三格推进',
    category: 'slanted',
    panelCount: 4,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.59, 0.001], [0.002, 0.001], [0.002, 0.25], [0.612, 0.201]],
        [[0.002, 0.261], [0.002, 0.502], [0.642, 0.502], [0.612, 0.212]],
        [[0.709, 0.999], [0.999, 0.999], [0.999, 0.001], [0.607, 0.001]],
        [[0.002, 0.513], [0.002, 0.999], [0.693, 0.999], [0.642, 0.513]],
      ]),
  },
  {
    id: 'med-slant-bottom-4',
    label: '双横 + 斜切收束',
    description: '上两段平稳叙事，底部斜切分格制造反差',
    category: 'slanted',
    panelCount: 4,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.999, 0.277], [0.999, 0.001], [0.002, 0.001], [0.002, 0.277]],
        [[0.002, 0.288], [0.002, 0.518], [0.999, 0.518], [0.999, 0.288]],
        [[0.002, 0.53], [0.002, 0.999], [0.544, 0.999], [0.604, 0.53]],
        [[0.56, 0.999], [0.999, 0.999], [0.999, 0.53], [0.62, 0.53]],
      ]),
  },
  {
    id: 'med-cross-slant-4',
    label: '十字全斜切 4 格',
    description: '四角全斜线交错分割，高速战斗或混乱感',
    category: 'slanted',
    panelCount: 4,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.453, 0.001], [0.001, 0.001], [0.001, 0.32], [0.43, 0.277]],
        [[0.999, 0.222], [0.999, 0.001], [0.468, 0.001], [0.444, 0.277]],
        [[0.001, 0.331], [0.001, 0.999], [0.449, 0.999], [0.6, 0.27]],
        [[0.464, 0.999], [0.999, 0.999], [0.999, 0.233], [0.615, 0.27]],
      ]),
  },
  {
    id: 'med-triple-closeup-5',
    label: '中段斜切三连特写',
    description: '上下大格夹中段斜切三连镜头，适合眼神交锋',
    category: 'slanted',
    panelCount: 5,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.999, 0.243], [0.999, 0.001], [0.002, 0.001], [0.002, 0.288]],
        [[0.002, 0.3], [0.002, 0.571], [0.269, 0.571], [0.319, 0.285]],
        [[0.285, 0.571], [0.644, 0.571], [0.644, 0.271], [0.335, 0.285]],
        [[0.66, 0.571], [0.999, 0.571], [0.999, 0.255], [0.66, 0.271]],
        [[0.002, 0.582], [0.002, 0.999], [0.999, 0.999], [0.999, 0.582]],
      ]),
  },
  {
    id: 'med-slant-beats-5',
    label: '斜切推进 5 格',
    description: '顶部错斜双格、中段斜切大格、底部斜切收尾',
    category: 'slanted',
    panelCount: 5,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.479, 0.001], [0.002, 0.001], [0.002, 0.268], [0.479, 0.291]],
        [[0.999, 0.316], [0.999, 0.001], [0.495, 0.001], [0.495, 0.291]],
        [[0.002, 0.279], [0.002, 0.647], [0.999, 0.647], [0.999, 0.327]],
        [[0.002, 0.658], [0.002, 0.999], [0.63, 0.999], [0.481, 0.658]],
        [[0.646, 0.999], [0.999, 0.999], [0.999, 0.658], [0.497, 0.658]],
      ]),
  },
  {
    id: 'med-slant-stack-5',
    label: '左斜三叠 + 右竖主格',
    description: '右高竖格伴随左侧斜梯三连，日漫感极强',
    category: 'slanted',
    panelCount: 5,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.437, 0.001], [0.001, 0.001], [0.001, 0.225], [0.498, 0.225]],
        [[0.001, 0.236], [0.001, 0.452], [0.556, 0.452], [0.498, 0.236]],
        [[0.999, 0.651], [0.999, 0.001], [0.452, 0.001], [0.62, 0.651]],
        [[0.001, 0.463], [0.001, 0.651], [0.605, 0.651], [0.556, 0.463]],
        [[0.001, 0.662], [0.001, 0.999], [0.999, 0.999], [0.999, 0.662]],
      ]),
  },
  {
    id: 'med-slant-cascade-6',
    label: '上斜三连 + 下主格 6 格',
    description: '顶部斜切三连入场，中段过渡，底部宽格定调',
    category: 'slanted',
    panelCount: 6,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.274, 0.001], [0.001, 0.001], [0.001, 0.326], [0.37, 0.326]],
        [[0.72, 0.001], [0.288, 0.001], [0.384, 0.326], [0.72, 0.326]],
        [[0.999, 0.326], [0.999, 0.001], [0.734, 0.001], [0.734, 0.326]],
        [[0.001, 0.336], [0.001, 0.559], [0.302, 0.559], [0.341, 0.336]],
        [[0.316, 0.559], [0.999, 0.559], [0.999, 0.336], [0.355, 0.336]],
        [[0.001, 0.569], [0.001, 0.999], [0.999, 0.999], [0.999, 0.569]],
      ]),
  },
  {
    id: 'med-rush-four-6',
    label: '中段四连斜冲刺 6 格',
    description: '上下大格夹中段四枚斜切连续特写',
    category: 'slanted',
    panelCount: 6,
    buildPanels: () =>
      buildNormalizedPolygons([
        [[0.999, 0.325], [0.999, 0.001], [0.001, 0.001], [0.001, 0.435]],
        [[0.001, 0.449], [0.001, 0.67], [0.268, 0.634], [0.191, 0.427]],
        [[0.285, 0.633], [0.533, 0.6], [0.449, 0.397], [0.208, 0.424]],
        [[0.546, 0.598], [0.814, 0.562], [0.731, 0.363], [0.463, 0.395]],
        [[0.828, 0.562], [0.999, 0.54], [0.999, 0.336], [0.746, 0.363]],
        [[0.001, 0.679], [0.001, 0.999], [0.999, 0.999], [0.999, 0.55]],
      ]),
  },

  // ==================== 4. 四格与多格 (6) ====================
  {
    id: 'yonkoma-vertical',
    label: '竖排四格漫',
    description: '起承转合经典四格长条',
    category: 'strip',
    panelCount: 4,
    buildPanels: (_gx, gy) =>
      buildRowGridPanels([1, 1, 1, 1], [[1], [1], [1], [1]], 0, gy, {
        marginX: 0.08,
        marginY: 0.035,
      }),
  },
  {
    id: 'fp-4koma',
    label: '日式居中四格漫',
    description: '居中单列四格，顶部预留标题写字空间',
    category: 'strip',
    panelCount: 4,
    buildPanels: (_gx, gy) => {
      const x = 0.28;
      const w = 0.44;
      const top = 0.10;
      const bottom = 0.96;
      const h = (bottom - top - gy * 3) / 4;
      return [0, 1, 2, 3].map(idx =>
        makePanel(`第 ${idx + 1} 格`, rectToPolygon(x, top + idx * (h + gy), w, h), idx + 1),
      );
    },
  },
  {
    id: 'fp-4koma-2col',
    label: '双列八格四格漫',
    description: '并排双列四格漫，顶部预留双标题区',
    category: 'strip',
    panelCount: 8,
    buildPanels: (gx, gy) => {
      const mx = 0.08;
      const colGap = Math.max(0.06, gx * 2);
      const colW = (1 - mx * 2 - colGap) / 2;
      const top = 0.10;
      const bottom = 0.96;
      const h = (bottom - top - gy * 3) / 4;
      const panels: ComicPanel[] = [];
      for (let idx = 0; idx < 4; idx++) {
        panels.push(
          makePanel(`第 ${idx + 1} 格`, rectToPolygon(mx + colW + colGap, top + idx * (h + gy), colW, h), idx + 1),
        );
      }
      for (let idx = 0; idx < 4; idx++) {
        panels.push(
          makePanel(`第 ${idx + 5} 格`, rectToPolygon(mx, top + idx * (h + gy), colW, h), idx + 5),
        );
      }
      return panels;
    },
  },
  {
    id: 'grid-six',
    label: '六格叙事',
    description: '工整 2×3 六格，适合稳步推进长剧情',
    category: 'strip',
    panelCount: 6,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([1, 1, 1], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], gx, gy),
  },
  {
    id: 'six-alternating',
    label: '错位六格',
    description: '三行交错宽窄六格，避免排版的呆板感',
    category: 'strip',
    panelCount: 6,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.30, 0.40, 0.30], [[0.35, 0.65], [0.65, 0.35], [0.40, 0.60]], gx, gy),
  },
  {
    id: 'grid-nine',
    label: '九格节奏',
    description: '3×3 九宫格分镜，适合快速蒙太奇或群像',
    category: 'strip',
    panelCount: 9,
    buildPanels: (gx, gy) =>
      buildRowGridPanels(
        [1, 1, 1],
        [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
        gx,
        gy,
      ),
  },

  // ==================== 5. 无框与叠框 (4) ====================
  {
    id: 'inset-overlay',
    label: '主格 + 双特写叠框',
    description: '满页主画面配右上、右下特写画中画',
    category: 'special',
    panelCount: 3,
    buildPanels: () => [
      makePanel('主画面格', rectToPolygon(0.04, 0.04, 0.92, 0.92), 1),
      makePanel('特写叠框 1', rectToPolygon(0.56, 0.08, 0.36, 0.24), 2, { borderWidth: 4, inset: true }),
      makePanel('特写叠框 2', rectToPolygon(0.58, 0.66, 0.34, 0.24), 3, { borderWidth: 4, inset: true }),
    ],
  },
  {
    id: 'fp-single-bleed',
    label: '满版出血单格',
    description: '无边距无黑框全页满铺，适合海报或扉页',
    category: 'special',
    panelCount: 1,
    buildPanels: () => [
      makePanel('第 1 格', rectToPolygon(0, 0, 1, 1), 1, { borderWidth: 0, bleed: true }),
    ],
  },
  {
    id: 'borderless-pair',
    label: '无框双景',
    description: '上下双景均不描黑框，营造淡入淡出氛围感',
    category: 'special',
    panelCount: 2,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.6, 0.4], [[1], [1]], gx, gy, {
        marginX: 0.024,
        marginY: 0.024,
        panelExtras: [{ borderWidth: 0 }, { borderWidth: 0 }],
      }),
  },
  {
    id: 'open-hero',
    label: '无框主镜头',
    description: '上方开放无框主景，下方双有框小格点题',
    category: 'special',
    panelCount: 3,
    buildPanels: (gx, gy) =>
      buildRowGridPanels([0.65, 0.35], [[1], [0.5, 0.5]], gx, gy, {
        panelExtras: [{ borderWidth: 0 }, { borderWidth: 3 }, { borderWidth: 3 }],
      }),
  },
];
