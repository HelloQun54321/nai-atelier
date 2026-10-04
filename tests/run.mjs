#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, readdirSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace, projectRoot, removeWorkspace } from './support/workspace.mjs';

export const discoverGatewayTests = (root = projectRoot) => {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(path);
    }
  };
  visit(join(root, 'tests'));
  return files.sort();
};

export const nodeTestArguments = (args, files = discoverGatewayTests()) => {
  const selected = args.filter(value => value.endsWith('.test.mjs')).map(value => resolve(projectRoot, value));
  if (selected.some(value => !files.includes(value))) throw new Error('指定的 Node 测试不在已发现的测试集合中');
  return ['--test', '--test-concurrency=4', '--import', pathToFileURL(join(projectRoot, 'tests/support/node-environment.mjs')).href,
    ...args.filter(value => !value.endsWith('.test.mjs')), ...(selected.length ? selected : files)];
};

/** 同时保留终端反馈与完整日志，原样传播子进程退出码。 */
export const runLoggedCommand = async (args, { logPath, cwd = projectRoot, env = process.env, output = process.stdout, errors = process.stderr } = {}) => {
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath);
  await once(log, 'open');
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const relay = (stream, destination) => stream.on('data', chunk => { destination.write(chunk); log.write(chunk); });
  relay(child.stdout, output); relay(child.stderr, errors);
  try {
    const [code, signal] = await once(child, 'close');
    return code ?? (signal ? 1 : 0);
  } finally { log.end(); await once(log, 'close'); }
};

const main = async () => {
  const [mode = 'unit', ...extra] = process.argv.slice(2);
  const modes = {
    unit: () => [join(projectRoot, 'node_modules/vitest/vitest.mjs'), 'run', ...extra],
    gateway: () => nodeTestArguments(extra),
    'live-sync': () => [join(projectRoot, 'tests/live/nai-live-sync.mjs'), ...extra],
  };
  if (!modes[mode]) throw new Error('测试类型应为 unit、gateway 或 live-sync');
  const args = modes[mode]();
  const logPath = join(projectRoot, 'logs', 'tests', `${mode}.log`);
  const runRoot = mode === 'gateway' ? createWorkspace('run-') : undefined;
  console.log(`测试完整日志：${relative(projectRoot, logPath)}`);
  try {
    process.exitCode = await runLoggedCommand(args, { logPath, env: { ...process.env, ...(runRoot ? { NAI_TEST_RUN_DIR: runRoot, NAI_NO_BROWSER: '1', NAI_NO_DESKTOP_SHORTCUT: '1' } : {}) } });
  } finally { if (runRoot) removeWorkspace(runRoot); }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
