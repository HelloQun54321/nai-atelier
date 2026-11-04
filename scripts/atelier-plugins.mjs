import { createHash, randomUUID } from 'node:crypto';
import { fork, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { build } from 'esbuild';
import { validatePromptBlocks, describePromptBlock } from './atelier-prompt-blocks.mjs';

const exec = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(projectRoot, 'scripts/atelier-plugin-runner.mjs');
const LIMIT = 50 * 1024 * 1024;
const within = (root, path) => { const rel = relative(root, resolve(root, path)); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'); };
const cleanEntry = value => typeof value === 'string' ? value.replace(/^\.\//, '') : '';

export function inspectPlugin(pkg) {
  const rootExport = typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : pkg.exports?.['.']?.import || pkg.exports?.['.']?.default;
  const entry = cleanEntry(pkg.atelier?.entry || pkg.main || (typeof pkg.exports === 'string' ? pkg.exports : rootExport));
  if (!entry || !within('/plugin', entry) || entry.startsWith('/') || entry.includes(':')) throw new Error('package.json 缺少有效的 atelier.entry / main 入口');
  const dsh = pkg.dsh || {};
  const unsupported = [];
  if (dsh.bundle?.patch) unsupported.push(`DSH 配置补丁：${dsh.bundle.patch}`);
  if (dsh.client) unsupported.push('DSH 客户端界面扩展');
  const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
  const dshDependencies = dependencies.filter(name => name.startsWith('@deepseek-ai/dsh-'));
  unsupported.push(...dshDependencies.map(name => `DSH 服务：${name}`));
  return { name: String(pkg.name || '').slice(0, 200), version: String(pkg.version || '未标注').slice(0, 80), description: String(pkg.description || '').slice(0, 600), entry, unsupported: [...new Set(unsupported)], dependencies: Object.keys(pkg.dependencies || {}), engine: pkg.engines?.dsh || '', declaredPromptBlocks: validatePromptBlocks(pkg.atelier?.promptBlocks) };
}

export class AtelierPluginManager {
  constructor({ root = join(projectRoot, 'local-plugins'), fetchRemote = fetch } = {}) {
    this.root = resolve(root); this.fetchRemote = fetchRemote; this.runtimes = new Map(); this.tail = Promise.resolve(); this.initialized = false;
  }
  serial(action) { const next = this.tail.then(action); this.tail = next.catch(() => {}); return next; }
  async registry() { try { return JSON.parse(await readFile(join(this.root, 'registry.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return { version: 1, items: [] }; throw error; } }
  async save(registry) { await mkdir(this.root, { recursive: true }); const tmp = join(this.root, `registry-${randomUUID()}.tmp`); await writeFile(tmp, JSON.stringify(registry, null, 2)); await rename(tmp, join(this.root, 'registry.json')); }
  async init() {
    if (!this.initialization) this.initialization = (async () => {
      const registry = await this.registry();
      for (const item of registry.items) if (item.enabled) await this.start(item).catch(error => this.runtimes.set(item.id, { state: 'error', error: error.message }));
      this.initialized = true;
    })().catch(error => { this.initialization = null; throw error; });
    await this.initialization;
  }
  async list() {
    await this.init(); const registry = await this.registry();
    return { modelFamily: 'deepseek', root: this.root, items: registry.items.map(item => {
      const runtime = this.runtimes.get(item.id);
      return { ...item, state: runtime?.state || (item.unsupported.length ? 'unsupported' : 'installed'), error: runtime?.error || '', tools: runtime?.tools?.map(tool => tool.name) || [], promptBlocks: runtime?.state === 'running' ? (runtime.promptBlocks || []).map(describePromptBlock) : [], log: runtime?.log || '' };
    }) };
  }
  async github(urlString) {
    const url = new URL(urlString);
    const parts = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || parts.length !== 2 || !parts.every(x => /^[\w.-]+$/.test(x))) throw new Error('请填写 GitHub 仓库根地址，例如 https://github.com/作者/仓库');
    const response = await this.fetchRemote(`https://api.github.com/repos/${parts.join('/')}`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`读取 GitHub 仓库失败（${response.status}）`);
    const repo = await response.json();
    const commitResponse = await this.fetchRemote(`https://api.github.com/repos/${parts.join('/')}/commits/${encodeURIComponent(repo.default_branch)}`, { signal: AbortSignal.timeout(20000) });
    if (!commitResponse.ok) throw new Error(`读取仓库版本失败（${commitResponse.status}）`);
    const commit = await commitResponse.json();
    if (!/^[a-f0-9]{40}$/i.test(commit.sha || '')) throw new Error('仓库版本无效');
    const zipResponse = await this.fetchRemote(`https://codeload.github.com/${parts.join('/')}/zip/${commit.sha}`, { signal: AbortSignal.timeout(60000) });
    if (!zipResponse.ok) throw new Error(`下载插件失败（${zipResponse.status}）`);
    const chunks = []; let total = 0;
    for await (const chunk of zipResponse.body) { total += chunk.length; if (total > LIMIT) throw new Error('插件压缩包超过 50 MiB'); chunks.push(chunk); }
    return this.installZip(Buffer.concat(chunks), { url: url.href, commit: commit.sha });
  }
  async installZip(buffer, source = { name: '本地 ZIP' }) { return this.serial(async () => {
    if (!buffer.length || buffer.length > LIMIT) throw new Error('插件 ZIP 需在 50 MiB 以内');
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length > 6000) throw new Error('插件文件数量超过 6000');
    for (const entry of entries) {
      const raw = entry.unsafeOriginalName || entry.name;
      if (raw.includes('\\') || raw.startsWith('/') || raw.includes(':') || raw.split('/').includes('..') || ((Number(entry.unixPermissions) & 0o170000) === 0o120000)) throw new Error('ZIP 包含无效路径或符号链接');
    }
    const roots = entries.filter(entry => /(^|\/)package\.json$/.test(entry.name) && !entry.name.includes('/node_modules/')).sort((a,b) => a.name.split('/').length - b.name.split('/').length);
    if (!roots.length) throw new Error('ZIP 中找不到 package.json');
    const minDepth = roots[0].name.split('/').length;
    if (roots.filter(entry => entry.name.split('/').length === minDepth).length !== 1) throw new Error('ZIP 有多个同级插件，请单独打包一个插件');
    const manifest = roots[0]; const prefix = manifest.name.slice(0, -'package.json'.length);
    const pkg = JSON.parse(await manifest.async('string')); const info = inspectPlugin(pkg);
    if (!info.name) throw new Error('插件需要 package.json.name');
    const registry = await this.registry();
    if (registry.items.some(item => item.name === info.name)) throw new Error('同名插件已经安装，请先停用并移除旧版本');
    const id = createHash('sha256').update(info.name).digest('hex').slice(0, 20);
    const target = join(this.root, 'packages', id); await mkdir(target, { recursive: true });
    try {
      let bytes = 0;
      for (const entry of entries.filter(file => file.name.startsWith(prefix))) {
        const local = entry.name.slice(prefix.length);
        if (!local || /(^|\/)(node_modules|\.git)(\/|$)/.test(local)) continue;
        if (!within(target, local)) throw new Error('插件路径超出安装目录');
        if (Number(entry._data?.uncompressedSize || 0) + bytes > LIMIT) throw new Error('解压后超过 50 MiB');
        const data = await entry.async('nodebuffer'); bytes += data.length;
        if (bytes > LIMIT) throw new Error('解压后超过 50 MiB');
        await mkdir(dirname(join(target, local)), { recursive: true }); await writeFile(join(target, local), data);
      }
      const item = { id, ...info, source, sha256: createHash('sha256').update(buffer).digest('hex'), installedAt: new Date().toISOString(), enabled: false, config: {} };
      registry.items.push(item); await this.save(registry); return item;
    } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  }); }
  async start(item) {
    if (item.unsupported.length) throw new Error(`尚不支持：${item.unsupported.join('；')}`);
    const directory = join(this.root, 'packages', item.id);
    if (!within(directory, item.entry)) throw new Error('无效插件入口');
    if (item.dependencies.length) {
      const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      await exec(process.execPath, [npm, 'install', '--ignore-scripts', '--omit=dev', '--package-lock=false', '--no-audit', '--no-fund'], { cwd: directory, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    }
    const cache = join(this.root, 'runtime'); await mkdir(cache, { recursive: true });
    const output = join(cache, `${item.id}.cjs`);
    await build({ stdin: { contents: `import {runPlugin} from ${JSON.stringify(runner)}; import * as plugin from ${JSON.stringify(join(directory,item.entry))}; runPlugin(plugin,JSON.parse(process.env.ATELIER_PLUGIN_CONFIG||'{}')).catch(e=>{process.send?.({type:'failure',error:e.message});process.exitCode=1;});`, resolveDir: projectRoot }, bundle: true, platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent' });
    const child = fork(output, [], { cwd: directory, windowsHide: true, stdio: ['ignore','pipe','pipe','ipc'], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, ATELIER_PLUGIN_CONFIG: JSON.stringify(item.config || {}) } });
    const runtime = { child, state: 'starting', tools: [], promptBlocks: [], pending: new Map(), log: '' }; this.runtimes.set(item.id, runtime);
    const log = data => { runtime.log = (runtime.log + data.toString()).slice(-5000); }; child.stdout.on('data', log); child.stderr.on('data', log);
    child.on('message', message => {
      if (message.type !== 'result') return; const pending = runtime.pending.get(message.id); if (!pending) return;
      runtime.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
    });
    child.on('exit', () => { if (runtime.state !== 'stopped') { runtime.state = 'error'; runtime.error ||= '插件进程已退出'; } for (const pending of runtime.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('插件进程已退出')); } runtime.pending.clear(); });
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => { child.kill(); rejectReady(new Error('插件启动超过 10 秒，可能缺少宿主服务')); }, 10000);
      const finish = (error) => { clearTimeout(timer); child.off('message', ready); child.off('exit', exited); error ? rejectReady(error) : resolveReady(); };
      const exited = () => finish(new Error(runtime.error || runtime.log || '插件启动失败'));
      const ready = message => {
        if (message.type === 'failure') { runtime.error = message.error; child.kill(); finish(new Error(message.error)); }
        else if (message.type === 'ready') {
          try { runtime.promptBlocks = validatePromptBlocks(message.promptBlocks); runtime.tools = message.tools || []; runtime.state = 'running'; finish(); }
          catch (error) { runtime.error = error.message; child.kill(); finish(error); }
        }
      };
      child.on('message', ready); child.once('exit', exited); child.once('error', finish);
    });
    return runtime;
  }
  async enable(id, enabled, config) { return this.serial(async () => {
    await this.init(); const registry = await this.registry(); const item = registry.items.find(value => value.id === id); if (!item) throw new Error('插件不存在');
    if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) throw new Error('配置需要 JSON 对象');
    const prior = this.runtimes.get(id); if (prior?.child) { prior.state = 'stopped'; prior.child.kill(); } this.runtimes.delete(id);
    item.enabled = false;
    if (config !== undefined) item.config = config;
    if (enabled) { try { await this.start(item); item.enabled = true; } catch (error) { this.runtimes.set(id, { state: 'error', error: error.message }); await this.save(registry); throw error; } }
    await this.save(registry); return this.list();
  }); }
  async remove(id) { return this.serial(async () => {
    const registry = await this.registry(); const item = registry.items.find(value => value.id === id); if (!item) throw new Error('插件不存在');
    if (item.enabled || this.runtimes.get(id)?.state === 'running') throw new Error('请先停用插件');
    // Only package-owned files are removed; personal local-data is never touched.
    if (!/^[a-f0-9]{20}$/.test(id)) throw new Error('无效插件 ID');
    const target = join(this.root, 'packages', id); if (!within(this.root, target)) throw new Error('无效安装路径');
    await rm(target, { recursive: true, force: true }); this.runtimes.delete(id);
    await rm(join(this.root, 'runtime', `${id}.cjs`), { force: true });
    registry.items = registry.items.filter(value => value.id !== id); await this.save(registry); return this.list();
  }); }
  snapshotPromptBlocks() {
    const blocks = [...this.runtimes.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, runtime]) => runtime.state === 'running'
      ? (runtime.promptBlocks || []).map(block => ({ ...block, id: `plugin_${id}_${block.id}`, pluginId: id })) : []);
    if (blocks.reduce((sum, block) => sum + block.text.length, 0) > 64000) throw new Error('启用插件的提示词片段合计超过 64000 字符，请停用部分插件');
    return structuredClone(blocks);
  }
  async promptBlocks() { await this.init(); return this.snapshotPromptBlocks(); }
  async preview(id) {
    const item = (await this.registry()).items.find(value => value.id === id);
    if (!item) throw new Error('插件不存在');
    const runtime = this.runtimes.get(id), active = runtime?.state === 'running';
    const blocks = active ? runtime.promptBlocks || [] : item.declaredPromptBlocks || [];
    return { id, name: item.name, active, kind: active ? 'runtime' : 'declared', scope: '下一次完全访问权限的助手任务', blocks: blocks.map(block => ({ ...block, ...describePromptBlock(block) })) };
  }
  async agentTools() {
    await this.init(); const tools = [];
    for (const [id, runtime] of this.runtimes) if (runtime.state === 'running') for (const tool of runtime.tools) tools.push({
      ...tool, name: `plugin_${id.slice(0,8)}_${tool.name}`, label: tool.description, executionMode: 'sequential',
      execute: async (_callId, args) => {
        const result = await new Promise((resolveResult, reject) => { const callId = randomUUID(); const timer = setTimeout(() => { runtime.pending.delete(callId); reject(new Error('插件工具执行超过 30 秒')); }, 30000); runtime.pending.set(callId, { resolve: resolveResult, reject, timer }); runtime.child.send({ type:'call', id:callId, name:tool.name, args }); });
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }], details: { plugin: id } };
      },
    });
    return tools;
  }
}
