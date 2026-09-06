import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5" />
      <stop offset="50%" stop-color="#4338ca" />
      <stop offset="100%" stop-color="#312e81" />
    </linearGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.08)" />
    </linearGradient>
    <filter id="glyphShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="rgba(15,23,42,0.45)" />
    </filter>
  </defs>

  <rect x="18" y="18" width="220" height="220" rx="54" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="2.5" />

  <path d="M22 72 C22 42, 42 22, 72 22 L184 22 C214 22, 234 42, 234 72 L234 110 C180 95, 76 95, 22 110 Z" fill="rgba(255,255,255,0.08)" />

  <g filter="url(#glyphShadow)" transform="translate(128, 128) scale(5.8) translate(-12, -12)" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
    <circle cx="13.5" cy="6.5" r=".6" fill="#ffffff" />
    <circle cx="17.5" cy="10.5" r=".6" fill="#ffffff" />
    <circle cx="6.5" cy="12.5" r=".6" fill="#ffffff" />
    <circle cx="8.5" cy="7.5" r=".6" fill="#ffffff" />
  </g>
</svg>
`;

async function main() {
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = [];

  for (const size of sizes) {
    const buffer = await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push({ width: size, height: size, buffer });
  }

  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const imageBuffers = [];

  for (const item of pngBuffers) {
    const { width, height, buffer } = item;
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);

    dirEntries.push(entry);
    imageBuffers.push(buffer);
    offset += buffer.length;
  }

  const icoBuffer = Buffer.concat([header, ...dirEntries, ...imageBuffers]);
  fs.writeFileSync('public/app-icon.ico', icoBuffer);
  fs.writeFileSync('public/app-icon.png', pngBuffers[0].buffer);
  fs.writeFileSync('public/artist-palette-3d.ico', icoBuffer);
  console.log('Successfully generated app-icon.ico, app-icon.png, and updated artist-palette-3d.ico');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
