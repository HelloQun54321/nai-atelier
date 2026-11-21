# 测试组织与运行

正式测试集中存放在 `tests/` 下，按源码模块保持对应目录结构：

| 目录 | 用途 |
| --- | --- |
| `tests/components/` | 前端组件测试（保留 `chain/`、`inspiration/` 等子目录） |
| `tests/services/` | 前端服务与纯业务逻辑测试 |
| `tests/worker/` | Cloudflare Worker 路由、参数校验与存储协议测试 |
| `tests/scripts/` | 本地网关、启动器、备份、创作助手等 Node 脚本测试 |
| `tests/integration/` | 跨模块集成回归（网关链路、密钥保管箱、酒馆桥接、打包验证等） |
| `tests/support/` | 隔离工作区（`workspace.mjs`）与 Node 预加载环境（`node-environment.mjs`） |
| `tests/fixtures/` | 合成测试夹具（严禁存放私人资料或真实凭据） |
| `tests/live/` | 需显式手动执行的联网检查（不进入日常离线回归） |
| `tests/android/` | Android 模拟器仪器测试 |
| `logs/tests/` | 测试运行日志（自动轮转保留最近 20 份，Git 忽略） |
| `tests/.tmp/` | 测试临时工作区与一次性排查输出（Git 忽略） |

## 常用命令

```powershell
# 前端与纯逻辑定向测试（Vitest）
npm run test -- tests/components/AgentModelControl.test.tsx
npm run test -- tests/services

# 后端回归（自动发现网关／桥接等 Node 测试 + tests/worker）
npm run test:gateway

# Node 脚本定向或全量回归（全量含桌面与 Android 打包测试）
npm run test:node -- tests/integration/media-gateway.test.mjs
npm run test:node

# 显式联网自检：实时抓取 NovelAI 官方前端包并核对模型与计价公式提取（零生图消耗）
npm run test:live-sync

# 显式联网检查所长法典在线清单
$env:CODEX_LIVE_TEST = '1'
npm run test -- tests/live/codex-live.test.ts
Remove-Item Env:CODEX_LIVE_TEST

# Android 隔离模拟器回归（勿连接真实手机）
$env:ANDROID_SERIAL = 'emulator-5556'
npm run test:android
```

## 沙盒隔离约定

- `tests/run.mjs` 在加载被测 Node 模块前自动注入 `tests/support/node-environment.mjs`，为每个测试进程在 `tests/.tmp/` 下建立独立临时目录并接管当前工作目录与 `TEMP`/`TMP`；测试中的 `local-data/` 与 `local-cache/` 均指向临时合成环境，绝不触碰主项目真实数据，运行结束后自动清理。
- 需要读写文件的测试统一调用 `createWorkspace()` 创建临时目录，并在 `finally` 或 `after` 钩子中调用 `removeWorkspace()` 清理。
- 如需将临时目录与测试日志放到仓库外，可设置绝对路径环境变量 `NAI_TEST_TEMP_ROOT` 与 `NAI_TEST_LOG_ROOT`。验证分级与断言规范见 [AGENTS.md](../AGENTS.md)。
