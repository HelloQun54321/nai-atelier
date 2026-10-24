# 测试组织与运行

所有正式测试在这里集中管理，按源码模块保留对应结构，便于 Agent 按固定路径查找与维护。修改实现时同时检查对应测试目录，以及覆盖该模块的跨模块回归。

| 位置 | 用途 |
| --- | --- |
| `tests/components/` | 对应 `components/`，保留 `chain/`、`inspiration/` 等子目录 |
| `tests/services/` | 对应 `services/` 的服务与业务逻辑测试 |
| `tests/worker/` | 对应 `worker/` 的校验、协议与 `routes/` 路由测试 |
| `tests/scripts/` | 对应 `scripts/` 的后台服务、启动、备份与工程工具测试 |
| `tests/integration/` | 应用保存流程、多个资源管理器、弹层、工具栏、全局主题、网关与桥接等跨模块回归 |
| `tests/support/` | 临时工作区、Node 隔离环境等共用工具 |
| `tests/fixtures/` | 合成的测试数据与生成器，不存私人资料或真实凭据 |
| `tests/live/` | 用户显式执行的联网检查 |
| `tests/android/` | Android 原生仪器回归，全部使用应用内独立合成目录 |
| `logs/tests/` | npm 测试入口的完整日志，每次运行独立保存；旧根目录测试日志保存在 `archive/` |
| `tests/.tmp/` | 忽略入库的临时工作区与一次性排查文件 |

## 命令

在项目根目录运行：

```powershell
# Vitest：定向运行组件／服务测试或集中回归
npm run test -- tests/components/AgentModelControl.test.tsx
npm run test -- tests/services
npm run test -- tests/integration

# 后端：自动发现后端 Node 回归，并运行 tests/worker 的 Vitest 测试
npm run test:gateway

# Node：完整入口自动发现 tests/ 中所有 *.test.mjs（含桌面、Android、工程工具）
npm run test:node

# Node：指定文件，也可传递 Node 测试筛选参数
npm run test:node -- tests/integration/media-gateway.test.mjs
npm run test:node -- tests/scripts/local-server-runtime.test.mjs
npm run test:node -- --test-name-pattern="同步健康记录" tests/integration/media-gateway.test.mjs

# 显式联网检查，不包含在上面的离线回归中
npm run test:live-sync

# 法典：显式读取当前全部书目与共创广场，校验发布清单和代表图链接
$env:CODEX_LIVE_TEST='1'
npm run test -- tests/live/codex-live.test.ts
Remove-Item Env:CODEX_LIVE_TEST

# 显式 Android 检查：先启动隔离模拟器，不向真实手机写测试资料
$env:ANDROID_SERIAL='emulator-5556'
npm run test:android
```

联网自检抓取当前官方 Web 应用，逐项验证模型、免费门槛、倍率与附加费提取，并在无文件／网络／进程能力的测试沙箱中执行官方实际费用调用及完整基础计价函数，覆盖尺寸、步数、订阅、额度、多张、参考、Vibe 与 Strength 的组合；Vibe 附加费和缓存／新编码费用执行独立官方函数，不用待验证常量拼造对照结果。按实际调用传入参考，不人为添加重试判定字段。不调用生图或付费编码接口。

[run.mjs](./run.mjs) 保留终端输出，同时将日志写入 `<类型>-<时间戳>-<进程号>.log`，并行运行互不覆盖；后端 Node 与 Worker 两阶段输出合并在本次同一日志，任一阶段失败均返回非零码。新增 Node 测试不需要再手动更新 `package.json` 的文件清单；后端入口按测试名称排除 `desktop-*`、`android-*`、图标、门禁与测试工具，其余 Node 测试自动加入。`test:gateway -- <文件.test.mjs>` 保留旧的定向调用，仅运行指定 Node 文件。Vitest 自动发现集中目录中的 `*.test.ts` 和 `*.test.tsx`。两类入口均排除 `tests/.tmp/`；目录回归检查防止正式测试重新散落到源码目录。

例如 `components/AgentModelControl.tsx` 对应 `tests/components/AgentModelControl.test.tsx`；针对同一实现的多个测试变体也放在对应目录。分类依据是主要维护归属，模块目录可以包含集成验证，不强制把所有使用多个模块的测试移入 `integration/`。

## 文件隔离与临时内容

Node 入口在被测模块加载前，通过 [node-environment.mjs](./support/node-environment.mjs) 为每个测试进程建立独立工作区、切换工作目录，并将 `TEMP`、`TMP`、`TMPDIR` 指向其中的临时目录。默认 `local-data/` 和 `local-cache/` 因而只指向合成环境；用于桥接和版本验证的工程文件只从公开文件复制，官方同步快照由 [合成数据生成器](./fixtures/nai-runtime.mjs) 构造。

真实 Pages → Worker → D1/R2 链路回归会在 Wrangler 子进程中跳过与业务无关的版本提示和 npm 更新检查，使离线回归不依赖 npm 连通性；Pages/D1/R2 实际链路、测试超时与业务断言仍保留。

统一入口等测试及其子进程结束后清理本次工作区，避免 Windows 上仍持有目录的子进程导致误报。新增需要文件的测试可复用 [workspace.mjs](./support/workspace.mjs) 创建工作区，并在 `finally` 或测试清理钩子中移除；清理工具核对父目录和实际路径，拒绝删除父目录或越界路径。涉及默认文件路径的测试若需要支持直接 `node --test`，也应先导入隔离环境。

一次性排查脚本、截图和临时输出也放在 `tests/.tmp/`，自行清理本次创建的文件；强制终止测试可能留下临时目录，不能因此清理真实部署目录。`logs/tests/` 与 `tests/.tmp/` 均由 Git、ESLint 和 TypeScript 排除。数据保护与验证梯度以 [AGENTS.md](../AGENTS.md) 为准。
