import { downloadFile } from '../fileDownload';
import { localHistory } from '../localHistory';
import {
  buildComicBubbleRenderModel,
  computeAutoFitFontSize,
  drawComicBubbleOnCanvas,
  resolveComicFont,
  seededUnit,
} from './comicArtwork';
import type { ComicBook } from './comicBookshelf';
import { getPanelBoundingBox } from './comicGeometry';
import type {
  ComicBubbleItem,
  ComicFontFamily,
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
  fontFamily?: ComicFontFamily,
) => {
  const clean = text.trim();
  if (!clean) return;
  const fontMeta = resolveComicFont(fontFamily);
  const weight = bold ? Math.max(800, fontMeta.defaultWeight) : fontMeta.defaultWeight;
  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${fontMeta.cssFamily}`;
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
      const rays = 42;
      for (let i = 0; i < rays; i++) {
        const jitter = (seededUnit(sticker.id, i * 3) - 0.5) * 0.08;
        const a = (i / rays) * Math.PI * 2 + jitter;
        const inner = r * (0.42 + seededUnit(sticker.id, i * 3 + 1) * 0.24);
        const halfSpread = 0.012 + seededUnit(sticker.id, i * 3 + 2) * 0.022;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a - halfSpread) * (w * 0.54), Math.sin(a - halfSpread) * (h * 0.54));
        ctx.lineTo(Math.cos(a + halfSpread) * (w * 0.54), Math.sin(a + halfSpread) * (h * 0.54));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'sweat': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.92);
      ctx.bezierCurveTo(r * 0.58, -r * 0.08, r * 0.68, r * 0.88, 0, r * 0.88);
      ctx.bezierCurveTo(-r * 0.68, r * 0.88, -r * 0.58, -r * 0.08, 0, -r * 0.92);
      ctx.closePath();
      ctx.fillStyle = '#e0f2fe';
      ctx.fill();
      ctx.lineWidth = Math.max(2.5, r * 0.11);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, -r * 0.15);
      ctx.bezierCurveTo(-r * 0.34, r * 0.15, -r * 0.28, r * 0.52, -r * 0.04, r * 0.58);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2.5, r * 0.14);
      ctx.stroke();
      break;
    }
    case 'anger': {
      const d = r * 0.2;
      const e = r * 0.78;
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * e, sy * r * 0.18);
        ctx.quadraticCurveTo(sx * d, sy * d, sx * r * 0.18, sy * e);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(5.5, r * 0.22);
        ctx.stroke();
        ctx.strokeStyle = sticker.color;
        ctx.lineWidth = Math.max(3, r * 0.13);
        ctx.stroke();
      }
      break;
    }
    case 'sparkle': {
      const drawFourStar = (scale: number) => {
        const s = r * scale;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s * 0.09, -s * 0.09, s, 0);
        ctx.quadraticCurveTo(s * 0.09, s * 0.09, 0, s);
        ctx.quadraticCurveTo(-s * 0.09, s * 0.09, -s, 0);
        ctx.quadraticCurveTo(-s * 0.09, -s * 0.09, 0, -s);
        ctx.closePath();
        ctx.fill();
      };
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, r * 0.06);
      drawFourStar(0.95);
      ctx.save();
      ctx.translate(r * 0.56, -r * 0.56);
      drawFourStar(0.36);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(-r * 0.55, r * 0.52, Math.max(2, r * 0.09), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shock': {
      for (let i = -3; i <= 3; i++) {
        const x = i * (w * 0.12);
        const lenFactor = 0.72 + (Math.abs(i) % 2) * 0.22;
        const thick = Math.max(2, r * (0.045 + (3 - Math.abs(i)) * 0.015));
        ctx.beginPath();
        ctx.moveTo(x - thick, -h * 0.45 * lenFactor);
        ctx.lineTo(x + thick, -h * 0.45 * lenFactor);
        ctx.lineTo(x + (i % 2 ? 2 : -2), h * 0.46 * lenFactor);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.78);
      ctx.bezierCurveTo(-r * 1.1, r * 0.12, -r * 0.95, -r * 0.85, 0, -r * 0.24);
      ctx.bezierCurveTo(r * 0.95, -r * 0.85, r * 1.1, r * 0.12, 0, r * 0.78);
      ctx.closePath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2.5, r * 0.09);
      ctx.stroke();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.48, -r * 0.25);
      ctx.quadraticCurveTo(-r * 0.42, -r * 0.48, -r * 0.22, -r * 0.45);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2.2, r * 0.1);
      ctx.stroke();
      break;
    }
    case 'exclamation':
    case 'question': {
      ctx.rotate((-8 * Math.PI) / 180);
      ctx.font = `900 ${Math.round(r * 1.7)}px ${resolveComicFont('impact').cssFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(4, r * 0.22);
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

        const isTransparentFill = !bubble.fillColor || bubble.fillColor === 'transparent';
        ctx.save();
        let localTx = tx;
        let localTy = ty;
        if (bubble.rotation) {
          const rad = (-bubble.rotation * Math.PI) / 180;
          const dx = tx - cx;
          const dy = ty - cy;
          localTx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
          localTy = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
          ctx.translate(cx, cy);
          ctx.rotate((bubble.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }

        const model = buildComicBubbleRenderModel(cx, cy, rx, ry, bubble.shape, bubble.id, {
          enabled: bubble.hasTail && !isTransparentFill,
          tx: localTx,
          ty: localTy,
        });
        drawComicBubbleOnCanvas(ctx, model, {
          fillColor: bubble.fillColor,
          strokeColor: bubble.strokeColor,
          strokeWidth: bubble.strokeWidth,
          cx,
          cy,
          rx,
          ry,
        });

        const fittedSize = computeAutoFitFontSize(
          bubble.text,
          bubble.fontSize,
          rx * 1.52,
          ry * 1.52,
          bubble.writingMode,
        );
        drawWrappedText(
          ctx,
          bubble.text,
          cx,
          cy,
          rx * 1.52,
          ry * 1.52,
          fittedSize,
          bubble.writingMode,
          bubble.textColor,
          undefined,
          false,
          bubble.fontFamily,
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
          item.fontFamily || 'impact',
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

/**
 * 第四期：整话批量打包导出高清 PNG ZIP（按页序命名 01_页名.png、02_页名.png…）。
 */
export const exportComicBookAsZip = async (
  book: ComicBook,
  onProgress?: (current: number, total: number) => void,
): Promise<{ filename: string; pageCount: number }> => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const total = book.pages.length;

  for (let i = 0; i < total; i++) {
    const page = book.pages[i];
    onProgress?.(i + 1, total);
    const blob = await renderComicPageToBlob(page);
    const num = String(i + 1).padStart(2, '0');
    const safePageName = (page.title || `第${i + 1}页`).replace(/[\\/:*?"<>|]+/g, '_').trim() || `page_${num}`;
    zip.file(`${num}_${safePageName}.png`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const safeBookName = (book.title || 'comic-book').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'comic-book';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${safeBookName}_${total}p_${stamp}.zip`;
  await downloadFile(zipBlob, filename);
  return { filename, pageCount: total };
};

/** 导出可重新打开继续编辑的漫画工程包（.comic.json，保留全部矢量分镜、锚点、气泡、笔迹与参数）。 */
export const exportComicBookProjectJson = async (book: ComicBook): Promise<{ filename: string }> => {
  const payload = {
    format: 'nai-atelier-comic-project',
    schemaVersion: 1,
    exportedAt: Date.now(),
    book,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const safeBookName = (book.title || 'comic-project').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'comic-project';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${safeBookName}_${stamp}.comic.json`;
  await downloadFile(blob, filename);
  return { filename };
};


