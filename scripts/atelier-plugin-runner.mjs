// A separate local process keeps plugin failures and unloading outside the agent service.
import { Context } from '@deepseek-ai/cordis';
import { validatePromptBlocks } from './atelier-prompt-blocks.mjs';

export async function runPlugin(module, config) {
  const ctx = new Context();
  const tools = new Map();
  const promptBlocks = new Map();
  let registrationOpen = true;
  ctx.provide('atelier');
  ctx.set('atelier', Object.freeze({
    apiVersion: 2,
    modelFamily: 'deepseek',
    registerTool(tool) {
      if (!/^[a-z][a-z0-9_]{0,47}$/.test(tool?.name || '') || typeof tool.execute !== 'function') throw new Error('插件工具需要合法 name 和 execute 函数');
      if (tools.has(tool.name)) throw new Error(`重复工具：${tool.name}`);
      if (!tool.description || tool.parameters?.type !== 'object') throw new Error('插件工具需要 description 和 JSON Schema parameters');
      tools.set(tool.name, tool);
      return () => tools.delete(tool.name);
    },
    registerPromptBlock(block) {
      if (!registrationOpen) throw new Error('静态提示词片段必须在插件启动完成前注册');
      const checked = validatePromptBlocks([...promptBlocks.values(), block]);
      promptBlocks.set(block.id, checked.at(-1));
      return () => promptBlocks.delete(block.id);
    },
  }));
  const plugin = module.default || module;
  const inject = plugin.inject || module.inject;
  const required = Array.isArray(inject) ? inject : inject?.required || [];
  const missing = required.filter(key => !ctx.get(key));
  if (missing.length) throw new Error(`缺少宿主接口：${missing.join('、')}`);
  const fiber = ctx.plugin(plugin, config || {});
  await fiber;
  registrationOpen = false;
  process.once('disconnect', () => { void fiber.dispose().finally(() => process.exit(0)); });
  const describe = () => [...tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
  process.on('message', async message => {
    if (message?.type === 'stop') { await fiber.dispose(); process.exit(0); }
    if (message?.type !== 'call') return;
    try {
      const tool = tools.get(message.name);
      if (!tool) throw new Error('插件工具不存在');
      const result = await tool.execute(message.args || {});
      process.send?.({ type: 'result', id: message.id, result });
    } catch (error) { process.send?.({ type: 'result', id: message.id, error: String(error.message || error) }); }
  });
  process.send?.({ type: 'ready', tools: describe(), promptBlocks: [...promptBlocks.values()] });
}
