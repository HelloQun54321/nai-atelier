import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import {
  BUILTIN_COMIC_FONT_CATALOG,
  createComicFontManager,
  detectFontFormat,
} from '../../scripts/comic-fonts.mjs';

const makeFakeTtfBuffer = (size = 2048) => {
  const buf = Buffer.alloc(size, 0x41);
  // TrueType sfnt magic bytes: 0x00010000
  buf[0] = 0x00;
  buf[1] = 0x01;
  buf[2] = 0x00;
  buf[3] = 0x00;
  return buf;
};

const makeFakeWoff2Buffer = (size = 2048) => {
  const buf = Buffer.alloc(size, 0x42);
  buf.write('wOF2', 0, 'ascii');
  return buf;
};

test('comic-fonts: 内置开源字体下载（含 ZIP 自动解压 WOFF2）、缓存读取与删除闭环', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nai-comic-fonts-'));
  try {
    const zip = new JSZip();
    zip.file('SmileySans-Oblique.ttf.woff2', makeFakeWoff2Buffer(3000));
    const zipBytes = await zip.generateAsync({ type: 'nodebuffer' });
    const ttfBytes = makeFakeTtfBuffer(2500);

    const manager = createComicFontManager({
      cacheRoot: dir,
      fetchImpl: async url => {
        if (String(url).endsWith('.zip')) {
          return new Response(zipBytes, { status: 200 });
        }
        return new Response(ttfBytes, { status: 200 });
      },
    });

    const initial = await manager.status();
    assert.equal(initial.fonts.length, BUILTIN_COMIC_FONT_CATALOG.length);
    assert.equal(initial.fonts.every(f => f.installed === false), true);

    // 1. 直接下载 TTF 开源字体（霞鹜漫黑）
    const afterTtf = await manager.downloadBuiltin('lxgw-marker-gothic');
    const marker = afterTtf.fonts.find(f => f.id === 'lxgw-marker-gothic');
    assert.equal(marker?.installed, true);
    assert.equal(marker?.format, 'ttf');
    const servedTtf = await manager.readFontFile('lxgw-marker-gothic');
    assert.equal(servedTtf?.contentType, 'font/ttf');
    assert.equal(servedTtf?.buffer.length, 2500);

    // 2. 下载 ZIP 发布包自动提取 WOFF2（得意黑）
    const afterZip = await manager.downloadBuiltin('smiley-sans');
    const smiley = afterZip.fonts.find(f => f.id === 'smiley-sans');
    assert.equal(smiley?.installed, true);
    assert.equal(smiley?.format, 'woff2');
    const servedWoff2 = await manager.readFontFile('smiley-sans');
    assert.equal(servedWoff2?.contentType, 'font/woff2');
    assert.equal(detectFontFormat(servedWoff2.buffer), 'woff2');

    // 3. 删除缓存字体
    const afterDel = await manager.deleteFont('smiley-sans');
    assert.equal(afterDel.fonts.find(f => f.id === 'smiley-sans')?.installed, false);
    assert.equal(await manager.readFontFile('smiley-sans'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('comic-fonts: 导入本机自定义字体校验格式、持久化与删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nai-comic-fonts-custom-'));
  try {
    const manager = createComicFontManager({ cacheRoot: dir });

    await assert.rejects(
      () => manager.uploadCustomFont({ filename: 'evil.exe', buffer: Buffer.from('MZ'.padEnd(256, 'x')) }),
      /仅支持有效/,
    );

    const uploaded = await manager.uploadCustomFont({
      filename: '我的手写漫画体.ttf',
      buffer: makeFakeTtfBuffer(4096),
    });
    assert.equal(uploaded.imported.name, '我的手写漫画体');
    assert.equal(uploaded.customFonts.length, 1);

    const file = await manager.readFontFile(uploaded.imported.id);
    assert.equal(file?.contentType, 'font/ttf');
    assert.equal(file?.buffer.length, 4096);

    const afterDelete = await manager.deleteFont(uploaded.imported.id);
    assert.equal(afterDelete.customFonts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
