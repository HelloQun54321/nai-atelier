import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, copyPublicFixtures, projectRoot, removeWorkspace } from './workspace.mjs';
import { createNaiRuntimeSnapshot } from '../fixtures/nai-runtime.mjs';

// 在被测模块求值前切换 cwd；其默认 local-data/local-cache 只能指向合成目录。
const originalCwd = process.cwd();
export const workspace = createWorkspace(`node-${process.pid}-`, process.env.NAI_TEST_RUN_DIR);
copyPublicFixtures(workspace);
process.chdir(workspace);
process.env.NAI_TEST_WORKSPACE = workspace;
const scratch = join(workspace, 'scratch');
mkdirSync(scratch);
// 既有 mkdtemp(tmpdir()) 用例与它们的子进程也归入本次测试目录。
process.env.TEMP = scratch; process.env.TMP = scratch; process.env.TMPDIR = scratch;
process.on('exit', () => {
  // 统一入口等全部测试进程退出后清理，避免 Windows 上 esbuild 等子进程尚持有目录。
  try { process.chdir(originalCwd); if (!process.env.NAI_TEST_RUN_DIR) removeWorkspace(workspace); }
  catch (error) { console.error(`测试临时目录清理失败：${error.message}`); process.exitCode = 1; }
});

const { DEFAULT_NAI_RUNTIME } = await import(new URL('../../scripts/media-gateway.mjs', import.meta.url));
const data = join(workspace, 'local-data');
mkdirSync(data, { recursive: true });
writeFileSync(join(data, 'novelai-webapp-sync.json'), JSON.stringify(createNaiRuntimeSnapshot(DEFAULT_NAI_RUNTIME)));
// 工作目录里的公开包信息用于后端版本与桥接安装回归；代码仍从实际项目加载。
export { projectRoot };
