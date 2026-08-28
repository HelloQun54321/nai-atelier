import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version?: string };

export default defineConfig({
  server: {
    port: 3000,
    // 仅本机可访问：vite dev server 会暴露开发机文件系统（Dependabot 报告的 4 条文件读取类
    // 漏洞的暴露面），绑回环后局域网设备彻底不可达。手机预览移动端走 dev:local 的构建产物，
    // 不经过这里。
    host: '127.0.0.1',
  },
  plugins: [react(), tailwindcss()],
  define: {
    '__APP_VERSION__': JSON.stringify(packageJson.version || '0.0.0'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
