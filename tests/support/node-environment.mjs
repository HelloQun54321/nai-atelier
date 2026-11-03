import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after } from 'node:test';
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
  catch (error) {
    // 清理是测试基建：偶发句柄未释放不该把用例结论判成失败，残留目录交给下次运行清理。
    console.warn(`测试临时目录留待下次清理：${error.message}`);
  }
});

// 打包校验会留下 esbuild 常驻 service 子进程：不关闭会挂住事件循环（进程跑完不退出），
// 并一直占着工作目录里的文件句柄，退出清理随之报 EPERM。全部测试结束后统一关闭一次。
after(async () => {
  try { const esbuild = await import('esbuild'); await esbuild.stop?.(); } catch { /* 本次运行未用 esbuild。 */ }
});

const { DEFAULT_NAI_RUNTIME } = await import(new URL('../../scripts/media-gateway.mjs', import.meta.url));
const data = join(workspace, 'local-data');
mkdirSync(data, { recursive: true });
writeFileSync(join(data, 'novelai-webapp-sync.json'), JSON.stringify(createNaiRuntimeSnapshot(DEFAULT_NAI_RUNTIME)));
// 工作目录里的公开包信息用于后端版本与桥接安装回归；代码仍从实际项目加载。
export { projectRoot };
