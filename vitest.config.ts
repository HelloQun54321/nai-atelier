import { defineConfig } from 'vitest/config';
import path from 'path';

// TS 侧单元测试（纯逻辑）：组件与集成验证仍以 test:gateway 与手动 smoke 为准
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['services/**/*.test.ts', 'worker/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
