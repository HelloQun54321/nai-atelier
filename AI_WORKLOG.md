# AI 工作日志

记录每次由 AI 工具执行的项目修改：模型名、日期与所做工作，规则见 `AGENTS.md`。日期节按时间倒序排列，最新记录在最上方；同一天内新条目排上方。

本日志自 2026-08-22 启用；此前的项目修改没有留存 AI 记录，历史改动请查阅 git 提交历史与 `CHANGELOG.md`。

## 2026-08-23

- **Codex (GPT-5)**：在实验室右上角新增带 `o`／`−` 状态标记的持久化 Tag 辅助开关，统一控制全部提示词框的补全、翻译与词典查询（feat: add laboratory tag assist toggle）。
- **Codex (GPT-5)**：修复单字段全局提示词吞掉末尾逗号，以及 Tag 补全重复查询、抢占键盘、干扰中文输入法、双击选择和中间替换残留等问题，并补充完整输入交互测试（fix: stop tag autocomplete from disrupting input）。
- **Codex (GPT-5)**：为实验室保存到库和风格串待保存状态增加 emerald 绿色语义色，同时保持 Fork 蓝色、重置红色与已保存灰色（style: color save actions green）。
- **Codex (GPT-5)**：将实验室配置导入移至右上角并修正图标与操作顺序，移除 JSON 粘贴入口，统一正面、主体和负面提示词的主题化就地复制按钮（style: refine laboratory import and copy actions）。
- **Codex (GPT-5)**：让实验室新建与已有风格串保存时自动把当前预览图片复制为独立封面，并补充当前图片选择回归测试（feat: use current preview as chain cover）。
- **Codex (GPT-5)**：统一工作区与全屏管理页的固定高度顶栏，重做画师 Tag 单行命令栏，并将角色、AITag、风格串与编辑器的次要控件收进弹层（style: unify workspace toolbar layouts）。
- **Codex (GPT-5)**：新增可持久化的实验室模块排序与默认折叠设置，支持拖拽、上下移动、恢复推荐顺序及桌面/移动端共用配置（feat: add customizable laboratory layout）。
- **Codex (GPT-5)**：移除 Opus 限额显示的 100% 上限，保留官方活动加成后的真实百分比与张数，并为超额满圈状态补充回归测试（fix: show uncapped opus allowance）。
- **Codex (GPT-5)**：将桌面生成按钮改为低强调度的主题化紧凑操作，采用“生成图片”文案与图片图标，补充费用标签及深浅色交互状态并完成浏览器视觉验收（style: refine generation button hierarchy）。
- **Codex (GPT-5)**：将桌面生成按钮、排队状态和错误提示统一移动到图片预览下方，形成作品优先且位置稳定的底部操作区（style: move generation action below preview）。
- **Codex (GPT-5)**：统一侧栏 Anlas/Opus 字体层级并补充折叠态 Anlas 余额，将主体提示词迁移到左侧全局编辑区，让右侧专注生成与图片预览（feat: refine quota and prompt layouts）。
- **Codex (GPT-5)**：新增可持久化的提示词拆分设置，支持双字段与单一全局提示词界面切换，并让 NovelAI 元数据按设置直接导入而不再弹出选择框（feat: add configurable prompt field layout）。
- **Codex (GPT-5)**：将生成参数控件改为宽屏分行布局，移除桌面编辑器重复底栏并保留顶部保存入口（fix: refine generation parameter layout）。
- **Codex (GPT-5)**：重排生成参数区，新增 NovelAI 元数据导入拆分预览，并接入官方图片模型哈希映射同步与 V5 自动选择（feat: improve novelai metadata import）。
- **Codex (GPT-5)**：按 NovelAI 官方格式新增 Alpha Stealth PNG 元数据导入，补齐标准压缩文本块和损坏数据保护，并用 V5/V4.5 原图验证新旧解析路径（feat: support novelai stealth png metadata）。
- **Codex (GPT-5)**：修复切换 Key 后订阅请求失败会让 Opus 限额整行消失的问题，增加可重试错误态及对应回归测试（fix: keep opus status visible on key switch failure）。
- **Codex (GPT-5)**：修复失败生图误记个人 Opus、受限模型判断依赖 V5 前缀和切 Key 迟到预算事件覆盖风险，并补充对应回归测试（fix: harden key-scoped usage settlement）。
- **Codex (GPT-5)**：修复个人用量字段错位与生图后设置页不刷新问题，并校正“困困的小群福利”历史 NAI5 生成的 1 张 Opus 免费图（fix: repair key-scoped personal usage accounting）。
- **Codex (GPT-5)**：统一生成按钮与公共队列各状态的主题色和动效开关，移除移动端队列阴影与遗留生成入口的硬编码样式（fix: unify generation and queue status visuals）。
- **Codex (GPT-5)**：修正生成按钮普通状态误启用粒子渐变的问题，将渐变和光斑动画限定在生成中状态（fix: limit action gradient to loading）。
- **Codex (GPT-5)**：将生成按钮改为跟随主题强调色的同色系多段粒子渐变，增加左右往返流光、生成中加速与动效偏好适配（fix: theme generation action gradient）。

## 2026-08-22

- **Codex (GPT-5)**：修正 NAI 5 系列生成按钮误显示「免费」的问题，按模型区分 Opus 额度、免费档和 Anlas 点数，并补充回归测试（fix: label opus allowance generation）。
- **Codex (GPT-5)**：为 Opus 限额增加点击刷新旋转动画、同步失败红色叉号状态与额度圆环过渡动画，并补充刷新 loading 回归测试（fix: animate opus quota refresh state）。
- **Codex (GPT-5)**：修复官方常量同步的分块请求重试、部分结果保护、失败短间隔重试与前端旧缓存问题（fix: stabilize official runtime sync）。
- **Codex (GPT-5)**：修复切换 NovelAI API Key 后 Opus 限额、公共队列状态和 Anlas 预算的刷新竞态与跨 Key 串用问题，并补充回归测试（fix: guard key scoped state across key switches）。
- **Codex (GPT-5)**：按确认方案调整密钥「使用/使用中」操作位置与 Opus 限额单行布局，移除不必要图标、恢复文案和省略号（fix: refine key status and opus quota layout）。
- **Codex (GPT-5)**：按 NovelAI API Key 隔离公共队列、Anlas 预算、个人用量与 Opus 快照，优化密钥「使用中」标识、Opus 限额圆环和风格串模型下拉筛选（feat: isolate key-scoped usage and polish model filters）。
- **Codex (GPT-5)**：新增启动时自动开启安全模式设置（feat: add safe mode startup preference）——全局设置增加默认开启的启动偏好，启动时按该偏好初始化安全模式，并同步 Agent 设置上下文。
- **ZCode (GLM-5.3)**：密钥保管箱防误填与统计口径说明（fix: guard key vault against autofill mistakes）——添加表单 new-password 防浏览器自动填充、pst- 前缀校验拒绝非 NovelAI 密钥、存量可疑条目加「格式可疑」标记；个人统计空状态区分未配密钥/无计费记录并写明计入口径（V4.5 免费小图不计入）。
- **ZCode (GLM-5.3)**：个人用量统计与预算警告（feat: track personal usage and warn on exhausted budget）——网关按密钥哈希累计个人 Anlas 花费与 Opus 免费档张数（computeGenerationPersonalUsage 纯函数+单测，生图与 Vibe 编码双扣费点接入），worker /api/anlas-budget 扩展 personal 存储与 DELETE 重置，设置页新增个人统计展示，预算用尽仍扣费时弹红色警告（Agent 路径同拦）。
- **ZCode (GLM-5.3)**：NovelAI 多密钥保管箱（feat: add named novelai key vault）——新增 services/naiKeyVault.ts（localStorage 保管箱 + 激活写回 nai_api_key 槽位并广播事件 + 首次自动迁移现有单密钥），全局设置密钥区改为多密钥管理 UI（脱敏展示、使用/备注/删除、添加表单），切换即时刷新 Opus 限额。
- **ZCode (GLM-5.3)**：本地启动提速（perf: speed up local startup）——dev:local 构建改走 build:local 快速通道（跳过 tsc，实测 21s→13.4s）、官方常量同步延迟至网关就绪 30 秒后、启动日志打印构建/worker（D1/R2 恢复）/网关各阶段耗时与总耗时。
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
