import { defineConfig } from 'vitest/config';
import path from 'path';

// 服务纯逻辑与 jsdom 组件定向测试；网关验证仍由 test:gateway 独立执行。
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['services/**/*.test.ts', 'worker/**/*.test.ts', 'components/**/*.test.{ts,tsx}'],
  },
});
