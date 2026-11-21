import { downloadFile } from '../fileDownload';
import { localHistory } from '../localHistory';
import { getPanelBoundingBox } from './comicGeometry';
import type {
  ComicBubbleItem,
  ComicLayerId,
  ComicPageDraft,
  ComicPanel,
  ComicStickerItem,
  ComicTextItem,
} from './comicTypes';

const loadImageElement = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('加载分镜图片失败'));
  img.src = url;
});

const tracePanelPath = (ctx: CanvasRenderingContext2D, panel: ComicPanel, pageW: number, pageH: number) => {
  if (panel.points.length < 3) return;
  ctx.beginPath();
  panel.points.forEach((pt, idx) => {
    const px = pt.x * pageW;
    const py = pt.y * pageH;
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
};

const drawBubbleShapePath = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shape: ComicBubbleItem['shape'],
) => {
  ctx.beginPath();
  if (shape === 'caption') {
    ctx.rect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.closePath();
    return;
  }
  if (shape === 'shout') {
    const spikes = 18;
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes;
      const factor = i % 2 === 0 ? 1.12 : 0.82;
      const x = cx + Math.cos(angle) * rx * factor;
      const y = cy + Math.sin(angle) * ry * factor;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    return;
  }
  if (shape === 'thought') {
    const bumps = 12;
    for (let i = 0; i < bumps; i++) {
      const a0 = (i / bumps) * Math.PI * 2;
      const a1 = ((i + 0.5) / bumps) * Math.PI * 2;
      const a2 = ((i + 1) / bumps) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * rx * 0.88;
      const y0 = cy + Math.sin(a0) * ry * 0.88;
      const xc = cx + Math.cos(a1) * rx * 1.12;
      const yc = cy + Math.sin(a1) * ry * 1.12;
      const x2 = cx + Math.cos(a2) * rx * 0.88;
      const y2 = cy + Math.sin(a2) * ry * 0.88;
      if (i === 0) ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(xc, yc, x2, y2);
    }
    ctx.closePath();
    return;
  }
  // oval
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
};

const drawWrappedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  maxHeight: number,
  fontSize: number,
  writingMode: 'horizontal' | 'vertical',
  color: string,
  strokeColor?: string,
  bold = false,
) => {
  const clean = text.trim();
  if (!clean) return;
  ctx.save();
  ctx.font = `${bold ? '700 ' : '600 '}${fontSize}px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (writingMode === 'vertical') {
    const colGap = fontSize * 1.25;
    const charStep = fontSize * 1.08;
    const maxCharsPerCol = Math.max(1, Math.floor(maxHeight / charStep));
    const paragraphs = clean.split('\n');
    const columns: string[][] = [];
    for (const para of paragraphs) {
      const chars = Array.from(para);
      if (!chars.length) { columns.push([]); continue; }
      for (let i = 0; i < chars.length; i += maxCharsPerCol) {
        columns.push(chars.slice(i, i + maxCharsPerCol));
      }
    }
    const totalW = Math.max(1, columns.length - 1) * colGap;
    columns.forEach((col, colIdx) => {
      // 日漫竖排从右往左排
      const x = cx + totalW / 2 - colIdx * colGap;
      const colH = Math.max(0, col.length - 1) * charStep;
      col.forEach((ch, rowIdx) => {
        const y = cy - colH / 2 + rowIdx * charStep;
        if (strokeColor) {
          ctx.lineWidth = Math.max(2, fontSize * 0.14);
          ctx.strokeStyle = strokeColor;
          ctx.lineJoin = 'round';
          ctx.strokeText(ch, x, y);
        }
        ctx.fillText(ch, x, y);
      });
    });
    ctx.restore();
    return;
  }

  const lines: string[] = [];
  for (const para of clean.split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const candidate = line + ch;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    if (line || para === '') lines.push(line);
  }
  const lineH = fontSize * 1.28;
  const totalH = Math.max(0, lines.length - 1) * lineH;
  lines.forEach((line, idx) => {
    const y = cy - totalH / 2 + idx * lineH;
    if (strokeColor) {
      ctx.lineWidth = Math.max(2, fontSize * 0.14);
      ctx.strokeStyle = strokeColor;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, cx, y);
    }
    ctx.fillText(line, cx, y);
  });
  ctx.restore();
};

const drawSticker = (ctx: CanvasRenderingContext2D, sticker: ComicStickerItem, pageW: number, pageH: number) => {
  const cx = sticker.x * pageW;
  const cy = sticker.y * pageH;
  const w = sticker.width * pageW;
  const h = sticker.height * pageH;
  const r = Math.min(w, h) / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.globalAlpha = sticker.opacity;
  ctx.strokeStyle = sticker.color;
  ctx.fillStyle = sticker.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (sticker.kind) {
    case 'speedlines': {
      const rays = 28;
      ctx.lineWidth = Math.max(2, r * 0.04);
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const inner = r * (0.48 + (i % 3) * 0.08);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a) * (w * 0.55), Math.sin(a) * (h * 0.55));
        ctx.stroke();
      }
      break;
    }
    case 'sweat': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.bezierCurveTo(r * 0.65, -r * 0.05, r * 0.6, r * 0.85, 0, r * 0.85);
      ctx.bezierCurveTo(-r * 0.6, r * 0.85, -r * 0.65, -r * 0.05, 0, -r * 0.85);
      ctx.closePath();
      ctx.fillStyle = '#e0f2fe';
      ctx.fill();
      ctx.lineWidth = Math.max(2.5, r * 0.1);
      ctx.stroke();
      break;
    }
    case 'anger': {
      ctx.lineWidth = Math.max(3, r * 0.12);
      const d = r * 0.22;
      const e = r * 0.72;
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * e, sy * d);
        ctx.quadraticCurveTo(sx * d, sy * d, sx * d, sy * e);
        ctx.stroke();
      }
      break;
    }
    case 'sparkle': {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const rad = i % 2 === 0 ? r * 0.9 : r * 0.25;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'shock': {
      ctx.lineWidth = Math.max(3, r * 0.11);
      for (let i = -2; i <= 2; i++) {
        const x = i * (w * 0.16);
        ctx.beginPath();
        ctx.moveTo(x, -h * 0.42);
        ctx.lineTo(x + (i % 2 ? 4 : -4), 0);
        ctx.lineTo(x, h * 0.42);
        ctx.stroke();
      }
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.75);
      ctx.bezierCurveTo(-r * 1.1, r * 0.1, -r * 0.95, -r * 0.85, 0, -r * 0.25);
      ctx.bezierCurveTo(r * 0.95, -r * 0.85, r * 1.1, r * 0.1, 0, r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'exclamation':
    case 'question': {
      ctx.font = `900 ${Math.round(r * 1.6)}px "Impact", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, r * 0.14);
      ctx.strokeStyle = '#ffffff';
      const symbol = sticker.kind === 'exclamation' ? '!' : '?';
      ctx.strokeText(symbol, 0, 0);
      ctx.fillText(symbol, 0, 0);
      break;
    }
  }
  ctx.restore();
};

/** 将当前漫画页所有可见图层合成导出为高清 PNG Blob。 */
export const renderComicPageToBlob = async (page: ComicPageDraft): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器画布初始化失败');

  // 纸张底色
  ctx.fillStyle = page.backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);

  // 预加载分镜格图片（含 AI 整页成图）
  const imageMap = new Map<string, HTMLImageElement>();
  let aiWholeImage: HTMLImageElement | null = null;
  await Promise.all([
    ...(page.creationMode === 'ai-page' && page.aiPage?.generatedPageImage?.url
      ? [loadImageElement(page.aiPage.generatedPageImage.url).then(img => { aiWholeImage = img; }).catch(() => {})]
      : []),
    ...page.panels
      .filter(panel => panel.image?.url)
      .map(async panel => {
        try {
          const img = await loadImageElement(panel.image!.url);
          imageMap.set(panel.id, img);
        } catch {
          // 某张外链图片失败时不阻塞整页导出
        }
      }),
  ]);

  const orderedLayers = (['panels', 'drawing', 'bubbles', 'stickers'] as ComicLayerId[])
    .filter(id => page.layers[id]?.visible !== false)
    .sort((a, b) => (page.layers[a]?.order ?? 0) - (page.layers[b]?.order ?? 0));

  for (const layerId of orderedLayers) {
    if (layerId === 'panels') {
      if (page.creationMode === 'ai-page') {
        if (aiWholeImage) {
          const img = aiWholeImage as HTMLImageElement;
          const coverScale = Math.max(page.width / img.naturalWidth, page.height / img.naturalHeight);
          const drawW = img.naturalWidth * coverScale;
          const drawH = img.naturalHeight * coverScale;
          ctx.drawImage(img, (page.width - drawW) / 2, (page.height - drawH) / 2, drawW, drawH);
        }
        continue;
      }
      const sortedPanels = [...page.panels].sort((a, b) => a.zIndex - b.zIndex);
      for (const panel of sortedPanels) {
        if (panel.points.length < 3) continue;
        const bounds = getPanelBoundingBox(panel.points, page.width, page.height);
        ctx.save();
        if (panel.rotation) {
          ctx.translate(bounds.cx, bounds.cy);
          ctx.rotate((panel.rotation * Math.PI) / 180);
          ctx.translate(-bounds.cx, -bounds.cy);
        }
        tracePanelPath(ctx, panel, page.width, page.height);
        ctx.fillStyle = panel.backgroundColor || '#f8fafc';
        ctx.fill();

        const img = imageMap.get(panel.id);
        if (img && panel.image) {
          ctx.save();
          tracePanelPath(ctx, panel, page.width, page.height);
          ctx.clip();
          const coverScale = Math.max(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight) * (panel.image.scale || 1);
          const drawW = img.naturalWidth * coverScale;
          const drawH = img.naturalHeight * coverScale;
          const drawX = bounds.cx - drawW / 2 + (panel.image.offsetX || 0) * bounds.width;
          const drawY = bounds.cy - drawH / 2 + (panel.image.offsetY || 0) * bounds.height;
          ctx.drawImage(img, drawX, drawY, drawW, drawH);
          ctx.restore();
        }

        if (panel.borderWidth > 0) {
          tracePanelPath(ctx, panel, page.width, page.height);
          ctx.strokeStyle = panel.borderColor || '#111827';
          ctx.lineWidth = panel.borderWidth;
          ctx.lineJoin = 'miter';
          ctx.stroke();
        }
        ctx.restore();
      }
      continue;
    }

    if (layerId === 'drawing' && page.strokes.length > 0) {
      // 独立透明离屏层绘制笔迹，确保橡皮擦只擦除手绘层、不伤下方分镜画面
      const drawLayer = document.createElement('canvas');
      drawLayer.width = page.width;
      drawLayer.height = page.height;
      const dctx = drawLayer.getContext('2d');
      if (dctx) {
        for (const stroke of page.strokes) {
          if (stroke.points.length === 0) continue;
          dctx.save();
          dctx.lineCap = 'round';
          dctx.lineJoin = 'round';
          dctx.lineWidth = stroke.size;
          if (stroke.tool === 'eraser') {
            dctx.globalCompositeOperation = 'destination-out';
            dctx.strokeStyle = 'rgba(0,0,0,1)';
          } else {
            dctx.globalCompositeOperation = 'source-over';
            dctx.globalAlpha = stroke.opacity;
            dctx.strokeStyle = stroke.color;
          }
          dctx.beginPath();
          stroke.points.forEach((pt, idx) => {
            const x = pt.x * page.width;
            const y = pt.y * page.height;
            if (idx === 0) dctx.moveTo(x, y);
            else dctx.lineTo(x, y);
          });
          if (stroke.points.length === 1) {
            dctx.lineTo(stroke.points[0].x * page.width + 0.1, stroke.points[0].y * page.height + 0.1);
          }
          dctx.stroke();
          dctx.restore();
        }
        ctx.drawImage(drawLayer, 0, 0);
      }
      continue;
    }

    if (layerId === 'bubbles') {
      for (const bubble of page.bubbles) {
        const cx = bubble.x * page.width;
        const cy = bubble.y * page.height;
        const rx = (bubble.width * page.width) / 2;
        const ry = (bubble.height * page.height) / 2;
        const tx = bubble.tailX * page.width;
        const ty = bubble.tailY * page.height;

        ctx.save();
        // 先画气泡尾巴
        if (bubble.hasTail && bubble.shape !== 'caption') {
          if (bubble.shape === 'thought') {
            const steps = [0.65, 0.85];
            steps.forEach((ratio, idx) => {
              const bx = cx + (tx - cx) * ratio;
              const by = cy + (ty - cy) * ratio;
              const rad = idx === 0 ? Math.min(rx, ry) * 0.16 : Math.min(rx, ry) * 0.1;
              ctx.beginPath();
              ctx.arc(bx, by, rad, 0, Math.PI * 2);
              ctx.fillStyle = bubble.fillColor;
              ctx.fill();
              ctx.lineWidth = bubble.strokeWidth;
              ctx.strokeStyle = bubble.strokeColor;
              ctx.stroke();
            });
          } else {
            const angle = Math.atan2(ty - cy, tx - cx);
            const baseW = Math.min(rx, ry) * 0.22;
            const p1x = cx + Math.cos(angle - Math.PI / 2) * baseW;
            const p1y = cy + Math.sin(angle - Math.PI / 2) * baseW;
            const p2x = cx + Math.cos(angle + Math.PI / 2) * baseW;
            const p2y = cy + Math.sin(angle + Math.PI / 2) * baseW;
            ctx.beginPath();
            ctx.moveTo(p1x, p1y);
            ctx.lineTo(tx, ty);
            ctx.lineTo(p2x, p2y);
            ctx.closePath();
            ctx.fillStyle = bubble.fillColor;
            ctx.fill();
            ctx.lineWidth = bubble.strokeWidth;
            ctx.strokeStyle = bubble.strokeColor;
            ctx.stroke();
          }
        }

        if (bubble.rotation) {
          ctx.translate(cx, cy);
          ctx.rotate((bubble.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }
        drawBubbleShapePath(ctx, cx, cy, rx, ry, bubble.shape);
        ctx.fillStyle = bubble.fillColor;
        ctx.fill();
        ctx.lineWidth = bubble.strokeWidth;
        ctx.strokeStyle = bubble.strokeColor;
        ctx.stroke();

        // 再覆盖一层无边尾巴接缝让气泡内部过渡干干净净
        if (bubble.hasTail && bubble.shape === 'oval') {
          drawBubbleShapePath(ctx, cx, cy, Math.max(1, rx - bubble.strokeWidth * 0.5), Math.max(1, ry - bubble.strokeWidth * 0.5), bubble.shape);
          ctx.fillStyle = bubble.fillColor;
          ctx.fill();
        }

        drawWrappedText(
          ctx,
          bubble.text,
          cx,
          cy,
          rx * 1.48,
          ry * 1.48,
          bubble.fontSize,
          bubble.writingMode,
          bubble.textColor,
        );
        ctx.restore();
      }

      for (const item of page.texts) {
        const cx = item.x * page.width;
        const cy = item.y * page.height;
        ctx.save();
        if (item.rotation) {
          ctx.translate(cx, cy);
          ctx.rotate((item.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }
        drawWrappedText(
          ctx,
          item.text,
          cx,
          cy,
          page.width * 0.7,
          page.height * 0.7,
          item.fontSize,
          item.writingMode,
          item.color,
          item.strokeColor || undefined,
          item.bold,
        );
        ctx.restore();
      }
      continue;
    }

    if (layerId === 'stickers') {
      for (const sticker of page.stickers) {
        drawSticker(ctx, sticker, page.width, page.height);
      }
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('导出 PNG 失败'));
    }, 'image/png');
  });
};

export const exportComicPageAndArchive = async (
  page: ComicPageDraft,
): Promise<{ historyId?: string; archiveError?: string; filename: string }> => {
  const blob = await renderComicPageToBlob(page);
  const safeName = (page.title || 'comic-page').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'comic-page';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${safeName}_${stamp}.png`;

  await downloadFile(blob, filename);

  // 已确认决策：导出整页 PNG 时同步归档一份整页成品到生成历史，方便回看、收藏与后续书架引用保护
  try {
    const combinedPrompt = page.creationMode === 'ai-page'
      ? [page.globalBasePrompt, page.aiPage.storyPrompt].filter(Boolean).join(' | ')
      : [
        page.globalBasePrompt,
        ...page.panels.map(panel => panel.prompt).filter(Boolean),
      ].filter(Boolean).join(' | ');
    const saved = await localHistory.add(
      blob,
      combinedPrompt || `[漫画整页] ${page.title || '未命名漫画页'}`,
      {
        model: page.v5Model,
        width: page.width,
        height: page.height,
        steps: page.steps,
        scale: page.scale,
        sampler: page.sampler,
        noiseSchedule: page.noiseSchedule,
        qualityPresetId: page.qualityPresetId,
        ucPresetId: page.ucPresetId,
      },
      page.globalNegativePrompt,
      {
        sourceChainId: 'comic',
        sourceChainName: `漫画 · ${page.title || '未命名漫画页'}`,
        sourceChainType: 'comic',
      },
    );
    return { historyId: saved.id, filename };
  } catch (error) {
    return {
      filename,
      archiveError: error instanceof Error ? error.message : '归档到生成历史失败',
    };
  }
};
