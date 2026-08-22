# AI 工作日志

记录每次由 AI 工具执行的项目修改：模型名、日期与所做工作，规则见 `AGENTS.md`。日期节按时间倒序排列，最新记录在最上方；同一天内新条目排上方。

本日志自 2026-08-22 启用；此前的项目修改没有留存 AI 记录，历史改动请查阅 git 提交历史与 `CHANGELOG.md`。

## 2026-08-22

- **ZCode (GLM-5.3)**：风格串模型筛选改为常驻（fix: make chain model filter always visible）——选项固定为可选模型清单（getSelectableNaiModels，含网关同步新模型），无串/单模型时也显示；重建 dist。
- **ZCode (GLM-5.3)**：修复 AITag 模型筛选与首图缓存（fix: normalize aitag model labels and retry first image cache）——模型标签去掉版本哈希后缀按系列归并（筛选项与详情显示同步）、error 状态首图缓存改为后续加载自动重试、批量缓存连续 2 次失败熔断防轰炸；重新构建 dist。
- **ZCode (GLM-5.3)**：模型版本标签与筛选（feat: add model version tags and filters）——风格串列表按 params.model 筛选并显示卡片徽标（旧串归入 V4.5 Full）、AITag 筛选面板按首图元数据模型过滤已加载条目、历史详情 ParamsViewer 新增 Model 行；naiModels 新增 getNaiModelDisplayLabel（未知标识推导显示名）。
- **ZCode (GLM-5.3)**：全站文案「画师串」更名为「风格串」（feat: rename artist chains to style chains）——侧栏/列表/编辑器/Agent 工具描述/README 同步替换，历史修复文档与 CHANGELOG 保留原文。
- **ZCode (GLM-5.3)**：常量同步失效时生成前强制警告（feat: warn before generating on stale runtime sync）——免费估算路径在同步失效时弹红色警告确认后才生成，扣费路径在原确认弹窗追加警示，Agent 生图同样拦截；失效判断与描述文案收敛为 naiRuntime 的共享函数（isNaiRuntimeSyncUnhealthy / describeNaiRuntimeSyncProblem）。
- **ZCode (GLM-5.3)**：常量同步健康监控与自检（feat: guard novelai runtime sync health）——同步器重构为纯计算+健康记录（逐项命中/未命中、抓取失败原因，持久化并打日志），侧栏限额行琥珀色圆点示警同步失效或 48 小时未更新，新增 npm run test:live-sync 联网自检命令（实测官方 bundle 全部命中），AGENTS.md 划定保护区约束后续 AI 修改。
- **ZCode (GLM-5.3)**：官方规则常量自动同步（feat: auto-sync novelai runtime constants）——网关每日从官方 Web 应用 JS 提取模型清单/限额换算系数/免费档门槛/成本系数（提取器带锚点窗口防误匹配，真实 bundle 验证通过），持久化至 local-data 并经 /api/novelai-runtime 供前端使用；模型下拉自动追加新模型、未知标识透传服务端；新增提取器与估算器跟随单测。
- **ZCode (GLM-5.3)**：修复 Opus 限额代理域名（fix: use image host for novelai subscription）——实测发现 api.novelai.net 对第三方工具返回 400，订阅接口改走 image.novelai.net，同步修正单测断言。
- **ZCode (GLM-5.3)**：Opus 限额适配拼车共享账号（feat: keep opus usage fresh for shared accounts）——限额轮询缩短为每分钟、侧栏限额行可点击立即刷新、受限额模型生成前强制刷新真实额度再算费用、网关透支快照过期时扣费前自动重取。
- **ZCode (GLM-5.3)**：新增 Opus 免费生成限额显示（feat: surface opus usage limit）——网关新增 /api/novelai-subscription 代理（剥离敏感字段）、services/naiUsage.ts 官方映射纯函数与刷新 hook、侧栏 Anlas 预算下方 OpusUsageBar 组件、生图费用估算在透支时对 V5 取消免费档，新增 5 个单元测试锁定映射。
- **ZCode (GLM-5.3)**：生图模型解锁为可选（feat: make generation model selectable）——新增 services/naiModels.ts 注册表（标识对照官方 Web 应用 bundle 核对）、NAIParams.model 字段、参数面板模型选择器、V5 的 Vibe/角色参考边界提示与生成拦截、元数据导入携带模型标识。
- **ZCode (GLM-5.3)**：日志头部补充启用日期（2026-08-22）与说明，明确此前修改无 AI 记录、需查 git 历史与 CHANGELOG。
- **ZCode (GLM-5.3)**：README 项目结构树补列 AGENTS.md 与 AI_WORKLOG.md 两个文档，方便新加入的 AI 与协作者找到规则文件。
- **ZCode (GLM-5.3)**：新增 AI 工作日志强制规则（AGENTS.md）并创建本文件，此后每次 AI 修改都须在此登记模型名与所做工作。
