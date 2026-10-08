#!/usr/bin/env node
/**
 * NovelAI 官方常量同步联网自检。
 *
 * 从官方 Web 应用实时抓取 JS 包并运行全部提取器，逐项对比内置默认值；
 * 任何一项未命中（官方改版或提取器被改坏）即以非零码退出。
 * 用法：npm run test:live-sync
 */
import { computeNaiRuntimeSync, DEFAULT_NAI_RUNTIME, extractNaiCostCalculator, extractNaiPriceCalculator, fetchNaiRuntimeText } from '../../scripts/media-gateway.mjs';
import { estimateNaiBilling } from '../../worker/naiBilling.mjs';
import { createContext, Script } from 'node:vm';
import assert from 'node:assert/strict';

const SOURCE = 'https://novelai.net/image';

// 仅在显式联网测试中执行提取到的公开计价函数；沙箱不提供文件、网络或进程能力。
// 生产同步只解析已识别的数值／条件，未知结构继续按健康记录报错。
const compareOfficialBilling = async (bundle, runtime) => {
  const source = extractNaiCostCalculator(bundle);
  const guard = bundle.match(/function \w+\(\w+\)\{return[^{};]*\.width\*\w+\.height<=\d+&&[^{};]*\.steps<=\d+[^{};]*\}/)?.[0];
  assert.ok(source?.includes('cost') || source?.includes('Math.ceil'), '未识别官方完整计价函数');
  assert.ok(guard, '未识别官方免费资格函数');
  const usage = source.match(/\(0,(\w+)\.(\w+)\)\(\w+\)\.opusUsageLimit/);
  const family = source.match(/\(0,(\w+)\.(\w+)\)\(\w+\)===\1\.(\w+)\.v\d+/);
  const free = source.match(/\(0,(\w+)\.(\w+)\)\(\w+\)&&\w+\.subscription\.tier/);
  const active = source.match(/subscription\.tier>=3&&\(0,(\w+)\.(\w+)\)\(/);
  const limit = source.match(/return \w+>(\w+)\.(\w+)\?-3/);
  assert.ok(usage && family && free && active && limit, '官方计价依赖结构发生变化');
  const bindings = {};
  const bind = (name, key, value) => { (bindings[name] ||= {})[key] = value; };
  bind(usage[1], usage[2], model => ({ opusUsageLimit: runtime.usageLimitedModels.includes(model) }));
  bind(family[1], family[2], model => /^nai-diffusion-5-/.test(model) ? 'v5' : 'v4');
  bind(family[1], family[3], { v4: 'v4', v5: 'v5' });
  const modelEnum = source.match(/case (\w+)\.(\w+)\.naiDiffusion/);
  if (modelEnum) bind(modelEnum[1], modelEnum[2], Object.fromEntries(
    [...bundle.matchAll(/\w+\.(naiDiffusion\w+)="(nai-diffusion-[^"]+)"/g)].map(match => [match[1], match[2]]),
  ));
  bind(active[1], active[2], subscription => subscription.active);
  bind(limit[1], limit[2], Number.MAX_SAFE_INTEGER);
  const context = createContext(bindings, { codeGeneration: { strings: false, wasm: false } });
  bind(free[1], free[2], new Script(`(${guard})`).runInContext(context, { timeout: 1000 }));
  // createContext 之后新增命名空间仍需显式暴露。
  context[free[1]] = bindings[free[1]];
  context.cost = new Script(`(${source})`).runInContext(context, { timeout: 1000 });
  const priceSource = extractNaiPriceCalculator(bundle);
  assert.ok(priceSource, '未识别官方实际费用调用');
  const params = priceSource.match(/^async\(([^)]*)\)/)?.[1].split(',');
  const price = priceSource.match(/price:\(0,(\w+)\.(\w+)\)\(/);
  const account = priceSource.match(/let \w+=\(0,(\w+)\.(\w+)\)\(\w+\((\w+)\.(\w+)\),\w+\(\1\.(\w+)\)\)/);
  const capability = priceSource.match(/\(0,(\w+)\.(\w+)\)\(\w+\)\.encodedVibes/);
  const vibePrice = priceSource.match(/\(0,(\w+)\.(\w+)\)\(\w+\.filter\(\w+=>\w+\.enabled\)\.length\)/);
  const validate = priceSource.match(/!\(0,(\w+)\.(\w+)\)\(\w+\)/);
  const inpainting = priceSource.match(/\w+\.mask\?\(0,(\w+)\.(\w+)\)\(\w+\):\w+/);
  const encoding = priceSource.match(/(\w+)\.(\w+)\.getPrice\(/);
  assert.ok(params?.length === 11 && price && account && capability && vibePrice && validate && inpainting && encoding, '官方费用调用依赖发生变化');
  bind(price[1], price[2], context.cost);
  bind(account[1], account[2], session => session);
  bind(account[1], account[5], 'state');
  bind(account[3], account[4], 'session');
  bind(capability[1], capability[2], model => ({
    encodedVibes: runtime.modelCapabilities[model]?.supportsVibes,
    characterReferences: runtime.modelCapabilities[model]?.supportsCharacterReferences,
    charRefInpainting: runtime.modelCapabilities[model]?.supportsCharacterReferenceInpainting,
  }));
  bind(vibePrice[1], vibePrice[2], count => Math.max(0, count - runtime.billing.freeVibeCount) * runtime.billing.extraVibeCost);
  bind(validate[1], validate[2], () => true);
  bind(inpainting[1], inpainting[2], model => `${model}-inpainting`);
  bind(encoding[1], encoding[2], { getPrice: async () => ({ exists: true, price: 0 }) });
  for (const [key, value] of Object.entries(bindings)) context[key] = value;
  // 外部 e 是聚焦裁剪状态；测试已经传入实际裁剪尺寸，不再次执行 Canvas 几何函数。
  context.e = null;
  context.priceCalculator = new Script(`(${priceSource})`).runInContext(context, { timeout: 1000 });
  const cases = [];
  for (const model of new Set(['nai-diffusion-4-full', 'nai-diffusion-4-5-full', 'nai-diffusion-5-full', 'nai-diffusion-5-curated',
    ...Object.keys(runtime.billing.modelStepMultipliers).filter(id => !id.endsWith('-inpainting'))]))
    for (const [width, height] of [[64, 64], [832, 1216], [1024, 1024], [1216, 960]])
      for (const steps of model.endsWith('-medium') ? [14, 28, 29] : [28, 29]) for (const strength of [0, 0.7, 1])
        for (const mode of ['generate', 'img2img', 'infill'])
          for (const [opus, usageExhausted] of [[true, false], [true, true], [false, false]])
            for (const samples of [1, 2]) for (const referenceCount of [0, 1]) {
              if (referenceCount && !runtime.modelCapabilities[model]?.supportsCharacterReferences) continue;
              const parameters = { width, height, steps, n_samples: samples,
                image: mode !== 'generate', mask: mode === 'infill', strength, inpaintImg2ImgStrength: strength };
              cases.push({ model, parameters, opus, usageExhausted, referenceCount, vibeCount: 0 });
            }
  for (const sm of [false, true]) for (const sm_dyn of [false, true]) {
    cases.push({ model: 'nai-diffusion-5-full', parameters: { width: 832, height: 1216, steps: 29, n_samples: 1, sm, sm_dyn }, opus: false, usageExhausted: false, referenceCount: 0, vibeCount: 0 });
  }
  for (const vibeCount of [0, 4, 5, 6]) for (const samples of [1, 2]) for (const opus of [false, true])
    cases.push({ model: 'nai-diffusion-4-5-full', parameters: { width: 832, height: 1216, steps: 28, n_samples: samples }, opus, usageExhausted: false, referenceCount: 0, vibeCount });
  context.cases = cases;
  const official = await new Script(`Promise.all(cases.map(async c => {
    let result;
    await priceCalculator(() => ({subscription:{active:c.opus,tier:3,usage:{isNegative:c.usageExhausted}}}),
      null,null,c.parameters,null,c.model,
      Array.from({length:c.vibeCount}, () => ({enabled:true})),
      Array.from({length:c.referenceCount}, () => ({enabled:true})),null,
      value => {result = value.price;}, message => {throw new Error(message);});
    return result;
  }))`).runInContext(context, { timeout: 1000 });
  cases.forEach((item, index) => {
    const p = item.parameters;
    const model = p.mask ? `${item.model}-inpainting` : item.model;
    const actual = estimateNaiBilling({ ...p, samples: p.n_samples, strength: p.mask ? p.inpaintImg2ImgStrength : p.image ? p.strength : 1,
      referenceCount: item.referenceCount, vibeCount: p.mask ? 0 : item.vibeCount }, model, runtime, item.opus, item.usageExhausted).cost;
    assert.equal(actual, official[index], `计价不一致：${JSON.stringify(item)}`);
  });
  return cases.length;
};

try {
  const html = await fetchNaiRuntimeText(SOURCE);
  const paths = [...new Set([...html.matchAll(/"(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(m => m[1]))];
  if (!paths.length) {
    console.error('✖ 官方页面未暴露 JS 包（页面结构可能已改版）');
    process.exit(1);
  }
  const chunks = await Promise.all(paths.map(path => fetchNaiRuntimeText(`https://novelai.net${path}`).catch(() => '')));
  const bundle = chunks.join('\n');
  const { runtime, health } = computeNaiRuntimeSync(bundle);

  const rows = [
    ['imagesPerPercent', `${DEFAULT_NAI_RUNTIME.imagesPerPercent}`, `${runtime.imagesPerPercent}`],
    ['costCoefficientArea', `${DEFAULT_NAI_RUNTIME.costCoefficientArea}`, `${runtime.costCoefficientArea}`],
    ['costCoefficientSteps', `${DEFAULT_NAI_RUNTIME.costCoefficientSteps}`, `${runtime.costCoefficientSteps}`],
    ['freeMaxArea', `${DEFAULT_NAI_RUNTIME.freeMaxArea}`, `${runtime.freeMaxArea}`],
    ['freeMaxSteps', `${DEFAULT_NAI_RUNTIME.freeMaxSteps}`, `${runtime.freeMaxSteps}`],
    ['billing', JSON.stringify(DEFAULT_NAI_RUNTIME.billing), JSON.stringify(runtime.billing)],
    ['models', `${DEFAULT_NAI_RUNTIME.models.length} 个`, `${runtime.models.length} 个`],
    ['usageLimitedModels', DEFAULT_NAI_RUNTIME.usageLimitedModels.join(' '), runtime.usageLimitedModels.join(' ') || '（空）'],
    ['streamedModels', DEFAULT_NAI_RUNTIME.streamedModels.join(' '), runtime.streamedModels.join(' ') || '（空）'],
    ['modelCapabilities', `${Object.keys(DEFAULT_NAI_RUNTIME.modelCapabilities).length} 个`, `${Object.keys(runtime.modelCapabilities || {}).length} 个`],
    ['promptPresets', '按模型同步', runtime.models.filter(id => /^nai-diffusion-\d+(?:-\d+)?-(?:full|curated)(?:-preview)?(?:-inpainting)?$/.test(id)).every(id => runtime.modelCapabilities?.[id]?.qualityPresets?.length && runtime.modelCapabilities?.[id]?.ucPresets?.length) ? '已提取' : '缺失'],
    ['metadataModels', `${Object.keys(DEFAULT_NAI_RUNTIME.metadataModelMappings).length} 个`, `${Object.keys(runtime.metadataModelMappings).length} 个`],
  ];
  console.log(`官方 bundle ${paths.length} 个 chunk，提取结果（默认值 → 实时值）：`);
  for (const [field, def, live] of rows) {
    const healthField = field.startsWith('costCoefficient') ? 'costCoefficients' : field;
    console.log(`  ${health.missed.some(missed => healthField.startsWith(missed)) || (field === 'usageLimitedModels' && health.missed.includes('models')) ? '✖' : '✔'} ${field}: ${def} → ${live}`);
  }
  if (!health.ok) {
    console.error(`\n✖ 全部提取失效：官方大概率已改版，需要人工/AI 重新对接（未命中：${health.missed.join('、')}）`);
    process.exit(1);
  }
  if (health.missed.length) {
    console.error(`\n✖ 部分提取失效（${health.missed.join('、')}），同步将保留最近完整快照，需要修复提取器`);
    process.exit(1);
  }
  console.log(`\n✔ 全部提取命中，${await compareOfficialBilling(bundle, runtime)} 组计价与官方实际费用调用一致`);
} catch (error) {
  console.error('✖ 自检失败：', error.message || error);
  process.exit(1);
}
