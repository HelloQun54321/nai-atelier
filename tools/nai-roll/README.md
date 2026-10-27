# 一键 Roll · 补丁工具链与端到端验收

本目录是「一键 Roll / Roll 内容搭配库」这批改动的**可复现交付物**：补丁脚本、功能片段、端到端验收套件与说明。

## 当前交付与原型工具

本目录保留最初针对**已构建产物**（`dist/assets/*`）制作的原型补丁、片段和手动验收工具。PR #4 的产品功能现已实现于仓库源码中的 `components/ContentRoll*`、角色分栏及 `services/contentRoll*`，正常开发与分发直接使用项目构建，不需要运行本目录的部署补丁。

当前行为与已确认限制见 [README](../../README.md#-图片提示词库) 和[产品决策记录](../../docs/PRODUCT_DECISIONS.md#图片提示词库与分栏编辑)。`PR.md` 是原型阶段说明，补丁锚点与手动浏览器套件依赖当时的安装包快照，不能将其执行成功当作新版完整功能的验收。正式离线回归位于 `tests/`，一致性测试只覆盖选定的纯逻辑语义。

原型的纯内容快照固定为 v1，作为旧六类内容的兼容基线；正式源码使用支持自定义目录的 v2。`tests/integration/naiRollParity.test.ts` 分别锁定两边版本，严格比较共同内容、约束与抽取证据，并验证新版读取器兼容真实 v1 快照；v2 动态目录的正文、负面、路径与来源单独验证，不要求历史原型复制新版目录实现。

## 目录

```
tools/nai-roll/
├── PR.md                      # PR 正文（问题与效果 / 修改范围 / 验证 / 约束 / 基线）
├── README.md                  # 本文件
├── patches/
│   ├── apply-roll.mjs         # 主注入脚本（幂等、唯一锚点、写前自动备份、写前语法自检、跨 chunk 导出）
│   ├── deploy.mjs             # 打补丁 → bump → 版本串归一 → 四个产物 node --check
│   ├── normalize-version-query.mjs   # 版本查询串归一 + 「dist 只能有一种版本串」自检
│   ├── picker-layout.mjs      # 选择面板版式修复（候选列表被底部说明挤成一条缝）
│   ├── library-direct-edit.mjs# 图片提示词库：点卡片直接进编辑器
│   └── roll/
│       ├── core.mjs           # 纯逻辑核（抽取 / 单栏换一个 / 四态约束 / 证据 / 内容快照白名单）
│       ├── view.js            # 工作区视图（Roll + Roll 内容库 + 封面选图）
│       ├── panel.js           # 实验室确认面板 + 撤销横幅
│       ├── host-tu.js         # 全局分区一次提交（含主体提示词同步）
│       ├── host-pi.js         # 角色分区一次提交（含新建/移除角色）
│       ├── host-au.js         # 计划、应用、撤销、目标角色解析
│       ├── apply.js           # 落盘入口分派（roll-apply / roll-content-load）
│       ├── content-load.js    # Roll 内容库载入 + 选择器
│       └── bump-version.mjs   # 版本串递增（幂等、写前备份）
└── testenv/                   # 端到端验收（需要已安装应用 + 真浏览器）
    ├── start.mjs              # 隔离实例（独立 persist 目录，默认 :3055）
    ├── seed.mjs               # 合成基线数据（幂等）
    ├── lib/{cdp,env,guard,walk,lab}.mjs
    └── tests/roll-*.mjs       # 纯逻辑核 / R01–R18 / 内容库 C01–C23 / bump 冒烟 / 布局几何
```

## 用法

```bash
# 运行目录（默认已安装的桌面版；可用 NAI_RUNTIME 指向别处）
export NAI_RUNTIME="C:/path/to/NAI Atelier/resources/runtime"

node tools/nai-roll/patches/deploy.mjs            # 打补丁 + 版本串归一 + 语法自检
node tools/nai-roll/patches/deploy.mjs v1.91.2    # 顺便把版本串推到指定值

# 隔离实例（有自己的 persist 目录，不会碰 :3000 的生产数据）
node tools/nai-roll/testenv/start.mjs reset
node tools/nai-roll/testenv/seed.mjs

# 验收
node tools/nai-roll/testenv/tests/roll-core-suite.mjs     # 纯逻辑核
node tools/nai-roll/testenv/tests/roll-ui-suite.mjs       # R01–R18 真机
node tools/nai-roll/testenv/tests/roll-content-suite.mjs  # 内容库 C01–C23
node tools/nai-roll/testenv/tests/roll-post-bump-smoke.mjs 3055
node tools/nai-roll/testenv/tests/roll-layout-check.mjs 3055
```

## 与仓库规范的关系

- 本目录的脚本按 `AGENTS.md`「验证梯度」定位为**手动端到端验收**：它们需要已安装的桌面应用、一个隔离实例和真浏览器（CDP），无法纳入 `npm test` 的离线单测，因此随工具放在 `tools/nai-roll/`，不进 `tests/` 自动发现范围。
- 不改 `local-data/`、不改存储键与 binding；隔离实例只用 `testenv/persist`。
- 不调用生成接口、不消耗额度；生产环境只做只读验证。
