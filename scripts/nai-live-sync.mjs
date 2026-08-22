#!/usr/bin/env node
/**
 * NovelAI 官方常量同步联网自检。
 *
 * 从官方 Web 应用实时抓取 JS 包并运行全部提取器，逐项对比内置默认值；
 * 任何一项未命中（官方改版或提取器被改坏）即以非零码退出。
 * 用法：npm run test:live-sync
 */
import { computeNaiRuntimeSync, DEFAULT_NAI_RUNTIME, fetchNaiRuntimeText } from './media-gateway.mjs';

const SOURCE = 'https://novelai.net/image';

try {
  const html = await fetchNaiRuntimeText(SOURCE);
  const paths = [...new Set([...html.matchAll(/"(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(m => m[1]))];
  if (!paths.length) {
    console.error('✖ 官方页面未暴露 JS 包（页面结构可能已改版）');
    process.exit(1);
  }
  const chunks = await Promise.all(paths.map(path => fetchNaiRuntimeText(`https://novelai.net${path}`).catch(() => '')));
  const { runtime, health } = computeNaiRuntimeSync(chunks.join('\n'));

  const rows = [
    ['imagesPerPercent', `${DEFAULT_NAI_RUNTIME.imagesPerPercent}`, `${runtime.imagesPerPercent}`],
    ['costCoefficientArea', `${DEFAULT_NAI_RUNTIME.costCoefficientArea}`, `${runtime.costCoefficientArea}`],
    ['costCoefficientSteps', `${DEFAULT_NAI_RUNTIME.costCoefficientSteps}`, `${runtime.costCoefficientSteps}`],
    ['freeMaxArea', `${DEFAULT_NAI_RUNTIME.freeMaxArea}`, `${runtime.freeMaxArea}`],
    ['freeMaxSteps', `${DEFAULT_NAI_RUNTIME.freeMaxSteps}`, `${runtime.freeMaxSteps}`],
    ['models', `${DEFAULT_NAI_RUNTIME.models.length} 个`, `${runtime.models.length} 个`],
    ['usageLimitedModels', DEFAULT_NAI_RUNTIME.usageLimitedModels.join(' '), runtime.usageLimitedModels.join(' ') || '（空）'],
  ];
  console.log(`官方 bundle ${paths.length} 个 chunk，提取结果（默认值 → 实时值）：`);
  for (const [field, def, live] of rows) {
    console.log(`  ${health.missed.some(missed => field.startsWith(missed)) || (field === 'usageLimitedModels' && health.missed.includes('models')) ? '✖' : '✔'} ${field}: ${def} → ${live}`);
  }
  if (!health.ok) {
    console.error(`\n✖ 全部提取失效：官方大概率已改版，需要人工/AI 重新对接（未命中：${health.missed.join('、')}）`);
    process.exit(1);
  }
  if (health.missed.length) {
    console.error(`\n✖ 部分提取失效（${health.missed.join('、')}），同步会退回默认值，建议尽快修复提取器`);
    process.exit(1);
  }
  console.log('\n✔ 全部提取命中，自动同步工作正常');
} catch (error) {
  console.error('✖ 自检失败（网络或官方站点问题）：', error.message || error);
  process.exit(1);
}
