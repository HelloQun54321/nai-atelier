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
    // 整套组件测试并发跑满时，个别重测试会逼近默认 5s 上限而随机超时（单独跑通常 2～3s）。
    // 放宽到 15s：既留出高负载余量，又不至于把真正卡死拖太久。
    testTimeout: 15000,
  },
});
