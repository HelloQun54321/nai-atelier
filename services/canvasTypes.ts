/** 独立画布工程的持久模型。几何坐标均为实际画布或素材像素。 */
export interface CanvasPoint { x: number; y: number }
export interface CanvasSelection { points: CanvasPoint[] }
/** 图层局部坐标中的像素编辑，按顺序重放以保留原始素材。 */
export type CanvasPixelEdit =
  | { kind: 'move'; points: CanvasPoint[]; dx: number; dy: number }
  | { kind: 'erase-selection'; points: CanvasPoint[] }
  | { kind: 'crop'; points: CanvasPoint[] }
  | { kind: 'brush'; stroke: CanvasBrushStroke; selection: CanvasSelection | null; transform: [number, number, number, number, number, number] };
export interface CanvasImageLayer {
  id: string;
  name: string;
  /** 原始图片 data URL；工程保存时一并携带。 */
  source: string;
  width: number;
  height: number;
  /** 局部原点在画布中的位置，旋转单位为角度；负缩放表示镜像。 */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** 白色表示保留、透明表示擦除的素材坐标蒙版；空值代表完整显示。 */
  mask?: string;
  /** 每个多边形为素材坐标，交集为当前可见区域；保留原图以支持恢复。 */
  crops: CanvasSelection[];
  pixelEdits?: CanvasPixelEdit[];
  /** 手动新建的空层可接收粘贴内容。 */
  empty?: boolean;
}
export interface CanvasProject {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  background: { kind: 'transparent' | 'color'; color: string };
  /** 从下到上的绘制顺序。 */
  layers: CanvasImageLayer[];
  /** 用于工程列表的合成预览，不影响原图和最终导出。 */
  thumbnail?: string;
  updatedAt: number;
}
export type CanvasTool = 'move' | 'rectangle' | 'polygon' | 'lasso' | 'erase' | 'restore';
export interface CanvasBrushStroke { points: CanvasPoint[]; size: number; mode: 'erase' | 'restore' }
