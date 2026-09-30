// 智慧姬同步允许 V4.5 与 V5；旧条目未存 model 时沿用项目原有的 V4.5 默认语义。
export const isStChatu8ExportableChain = chain => {
  if (!chain || (chain.type && chain.type !== 'style')) return false;
  const model = String(chain.params?.model || '').trim();
  return !model || /^nai-diffusion-(?:4-5|5)-(?:full|curated)(?:-inpainting)?$/i.test(model);
};
