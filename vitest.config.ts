import { defineConfig } from 'vitest/config';
import path from 'path';

// 服务纯逻辑与 jsdom 组件定向测试；网关验证仍由 test:gateway 独立执行。
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/.tmp/**'],
    // 整套组件测试并发跑满时，个别重测试（滚动到底、批量加载）会逼近上限而随机超时，
    // 单独跑通常 2～3s。放宽到 30s：留足高负载余量，又不至于把真正卡死拖太久。
    testTimeout: 30000,
    // 默认会按核心数开满 worker（16 核就开 16 个），把本机 CPU 吃干、开发时整机卡顿。
    // 固定 4 个进程：跑测试期间仍能正常用电脑，代价是整套慢一些。
    maxWorkers: 4,
    minWorkers: 1,
  },
});
