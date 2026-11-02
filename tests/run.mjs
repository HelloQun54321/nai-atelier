#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, readdirSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanupStaleWorkspaces, createWorkspace, projectRoot, removeWorkspace } from './support/workspace.mjs';

export const discoverNodeTests = (root = projectRoot) => {
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

// 日常后端回归不夹带桌面／Android 打包与工程工具；完整 Node 入口仍自动发现全部文件。
export const discoverGatewayTests = (root = projectRoot) => discoverNodeTests(root)
  .filter(file => !/^(?:desktop-|android-|generate-app-icon\.|gitignore\.|git-hooks\.|secret-scan\.|run\.test\.|node-workspace\.)/.test(basename(file)));

export const nodeTestArguments = (args, files = discoverNodeTests()) => {
  const selected = args.filter(value => value.endsWith('.test.mjs')).map(value => resolve(projectRoot, value));
  if (selected.some(value => !files.includes(value))) throw new Error('指定的 Node 测试不在已发现的测试集合中');
  return ['--test', '--test-concurrency=2', '--import', pathToFileURL(join(projectRoot, 'tests/support/node-environment.mjs')).href,
    ...args.filter(value => !value.endsWith('.test.mjs')), ...(selected.length ? selected : files)];
};

/** 同时保留终端反馈与完整日志，原样传播子进程退出码。 */
export const runLoggedCommand = async (args, { logPath, append = false, cwd = projectRoot, env = process.env, output = process.stdout, errors = process.stderr } = {}) => {
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: append ? 'a' : 'w' });
  await once(log, 'open');
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const relay = (stream, destination) => stream.on('data', chunk => { destination.write(chunk); log.write(chunk); });
  relay(child.stdout, output); relay(child.stderr, errors);
  try {
    const [code, signal] = await once(child, 'close');
    return code ?? (signal ? 1 : 0);
  } finally { log.end(); await once(log, 'close'); }
};

export const testLogPath = mode => join(projectRoot, 'logs', 'tests', `${mode}-${Date.now()}-${process.pid}.log`);

const main = async () => {
  const [mode = 'unit', ...extra] = process.argv.slice(2);
  const modes = {
    unit: () => [[join(projectRoot, 'node_modules/vitest/vitest.mjs'), 'run', ...extra]],
    node: () => [nodeTestArguments(extra)],
    gateway: () => extra.some(value => value.endsWith('.test.mjs')) ? [nodeTestArguments(extra)] : [
      nodeTestArguments(extra, discoverGatewayTests()),
      [join(projectRoot, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/worker'],
    ],
    'live-sync': () => [[join(projectRoot, 'tests/live/nai-live-sync.mjs'), ...extra]],
  };
  if (!modes[mode]) throw new Error('测试类型应为 unit、node、gateway 或 live-sync');
  const commands = modes[mode]();
  // 上次被中断的运行会留下工作区，开跑前先清掉，避免 tests/.tmp 越积越大。
  cleanupStaleWorkspaces();
  const logPath = testLogPath(mode);
  const runRoot = ['gateway', 'node'].includes(mode) ? createWorkspace('run-') : undefined;
  console.log(`测试完整日志：${relative(projectRoot, logPath)}`);
  try {
    for (const [index, args] of commands.entries()) {
      const code = await runLoggedCommand(args, { logPath, append: index > 0,
        env: { ...process.env, ...(runRoot ? { NAI_TEST_RUN_DIR: runRoot, NAI_NO_BROWSER: '1', NAI_NO_DESKTOP_SHORTCUT: '1' } : {}) } });
      process.exitCode ||= code;
    }
  } finally { if (runRoot) removeWorkspace(runRoot); }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
