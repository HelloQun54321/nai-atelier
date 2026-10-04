// npm install／npm ci 完成依赖安装后，建立日常入口并安装提交门禁。
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDesktopLauncher } from './desktop-launcher.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await ensureDesktopLauncher({ projectDir });
// ZIP 部署没有 .git，旧门禁脚本会正常跳过；快捷方式已经独立完成。
await import('./install-git-hooks.mjs');
