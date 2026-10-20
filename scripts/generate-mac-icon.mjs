import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// 与 Windows 图标同一图形；按 macOS 图标网格把圆角主体放进 1024 画布中央 824px，并加系统风格投影。
const body = 824 / 220, offset = (1024 - 824) / 2 - 18 * body;
export const MAC_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#38bdf8"/><stop offset="45%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#0284c7"/></linearGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="rgba(255,255,255,0.5)"/><stop offset="100%" stop-color="rgba(255,255,255,0.15)"/></linearGradient>
    <filter id="bodyShadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="rgba(0,0,0,0.28)"/></filter>
    <filter id="glyphShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="rgba(3,105,161,0.45)"/></filter>
  </defs>
  <g transform="translate(${offset.toFixed(3)} ${offset.toFixed(3)}) scale(${body.toFixed(5)})">
    <rect x="18" y="18" width="220" height="220" rx="50" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="1.5" filter="url(#bodyShadow)"/>
    <path d="M22 72 C22 42, 42 22, 72 22 L184 22 C214 22, 234 42, 234 72 L234 110 C180 95, 76 95, 22 110 Z" fill="rgba(255,255,255,0.08)"/>
    <g filter="url(#glyphShadow)" transform="translate(128, 128) scale(5.8) translate(-12, -12)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/>
      <circle cx="13.5" cy="6.5" r=".6" fill="#fff"/><circle cx="17.5" cy="10.5" r=".6" fill="#fff"/><circle cx="6.5" cy="12.5" r=".6" fill="#fff"/><circle cx="8.5" cy="7.5" r=".6" fill="#fff"/>
    </g>
  </g>
</svg>`;

/** iconutil 所需的全部尺寸，含 Retina @2x；只在 macOS 构建机调用系统 iconutil。 */
export const MAC_ICONSET = [16, 32, 128, 256, 512].flatMap(size => [[`icon_${size}x${size}.png`, size], [`icon_${size}x${size}@2x.png`, size * 2]]);

export async function generateMacIcon(output, { sharp, iconutil = 'iconutil' } = {}) {
  const render = sharp || (await import('sharp')).default;
  const iconset = output.replace(/\.icns$/, '.iconset');
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  for (const [name, size] of MAC_ICONSET) {
    await writeFile(join(iconset, name), await render(Buffer.from(MAC_ICON_SVG)).resize(size, size).png().toBuffer());
  }
  await mkdir(dirname(output), { recursive: true });
  await run(iconutil, ['-c', 'icns', iconset, '-o', output]);
  await rm(iconset, { recursive: true, force: true });
  return output;
}
