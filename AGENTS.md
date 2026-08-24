# AGENTS.md — AI 协作规则

任何 AI 编码工具（ZCode、Claude Code、Codex 等）在修改本项目前必须先读完本文件并遵守全部规则。

## 项目概览

- NAI Atelier：本地个人 NovelAI 创作工坊。React 19 + TypeScript + Vite + Tailwind 4 前端，Cloudflare Worker 后端（`worker/`），数据落本地 D1 + R2。
- 领域知识与完整功能说明见 `README.md`；NovelAI 接口说明见 `NOVELAI_API_DOCS.md`；历史变更见 `CHANGELOG.md`。

## 需求推演与同类项检查（强制）

AI 不得只机械修改用户明确指出的单个位置。开始实现前，必须先理解用户希望达成的产品目标，并在任务范围内检查需要同步处理的同类项。

1. 每次修改前都应检查与需求直接相关的范围：
   - 同一组件中的相邻、对称或成组功能；
   - 同类控件及其共同交互规则；
   - 复用该组件的所有页面、模式和入口；
   - 不同模型、Key、运行状态、桌面端与移动端；
   - 亮色／暗色主题、安全模式等全局状态；
   - 默认值、旧数据兼容、请求参数、持久化数据与最终展示；
   - 对应测试、CHANGELOG 和相关文档。
2. 满足以下全部条件时，应直接同步处理关联项，不得等待用户逐项指出：
   - 能从用户目标明确推导；
   - 属于同类行为的一致性修复；
   - 改动低风险、可逆且能够验证；
   - 不改变用户未授权的核心产品逻辑；
   - 不产生真实费用、不删除数据、不修改外部状态。
3. 遇到以下情况必须先与用户讨论，不得以“主动推演”为由自行决定：
   - 存在多种明显不同的产品方案；
   - 会显著扩大功能范围或改变现有工作流；
   - 涉及数据迁移、删除、账号、密钥、付费请求、发布或其他外部影响；
   - 无法通过现有代码、文档或测试确认用户真实意图。
4. 用户指出一个遗漏时，必须立即审计整个同类功能集合，不得继续等待用户逐项点名。例如：
   - 要求预设下拉框的 `none` 排在首位，应同步检查同组所有预设下拉框；
   - 要求设置与 Key 关联，应同步检查预算、统计、排队、额度和迟到事件；
   - 要求统一输入框样式，应同步检查所有实验室模式、终端尺寸和主题状态。
5. 主动推演出的关联修改必须补充相应回归测试。最终回复应简要区分用户直接要求的修改、AI 主动补齐的关联项，以及仍需用户决定而未擅自处理的事项。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | Vite 前端开发服务 |
| `npm run dev:local` | 本地完整服务（Worker + D1/R2） |
| `npm run build` | 完整构建（tsc + vite + worker 打包） |
| `npm run test:gateway` | 网关 / st-chatu8 桥 / Pixiv 单元测试 |
| `node scripts/bump-version.mjs <级别>` | 版本递增，见下方版本规则 |

## 提交规则（强制）

1. **每次修改完成即提交**：完成一项用户任务后立即 git commit，不得攒批；逻辑上互不相关的修改不得混进同一个提交。
2. 提交信息遵循 Conventional Commits，英文一行，与现有历史一致：`feat:` / `fix:` / `perf:` / `refactor:` / `docs:` / `chore:` / `style:`，摘要首字母小写、结尾不加句号。
3. 提交前必须跑 `npm run test:gateway`；改动涉及前端类型或构建配置时加跑 `npx tsc -b`。测试失败先修复再提交。
4. 不使用 `--no-verify`；不提交任务范围之外的改动；`node_modules`、`dist`、日志已在 .gitignore 中，禁止绕过。

## 版本规则（强制）

版本号唯一来源是 `package.json` 的 `version` 字段；运行时展示使用 `vite.config.ts` 注入的 `__APP_VERSION__` 常量（类型声明在 `env.d.ts`）。**禁止在任何代码、组件中硬编码版本字符串。**

每一个改动项目内容的提交都必须携带一次版本递增，在提交前执行：

| 提交主类型 | 递增级别 |
| --- | --- |
| `feat:`（新功能） | minor |
| `fix:` / `perf:` / `refactor:` / `style:` / `docs:` / `chore:` | patch |
| 破坏性变更，或涉及 `schema.sql` / `migration_*.sql` 的数据迁移 | major |

- 命令：`node scripts/bump-version.mjs minor`（或 `patch` / `major` / `set:X.Y.Z`），脚本自动同步 package.json、package-lock.json 与 README 版本徽章；版本变更与代码改动进同一个提交。
- 同一提交包含多种类型时按最高级别递增。
- 不得跳过递增，也不得手工散改各处版本号。

## CHANGELOG 规则

用户可见的功能与修复，须在 `CHANGELOG.md` 顶部当日日期的节下添加中文条目（当日节不存在则新建；日期节按时间倒序、新在上；同一天内新条目排上方）。

## AI 工作日志（强制）

本项目由多个 AI 工具协作修改。每次执行修改任务后，必须在根目录 `AI_WORKLOG.md` 追加一条工作记录，且该记录与对应改动进同一个提交：

- 记录必须包含：**模型 / 工具名**（如 `ZCode (GLM-5.3)`、`Claude Code (Sonnet 4.5)`）与**做了什么**（一句话概括本次修改，可附提交主题）。
- 格式：日期节 `## YYYY-MM-DD` 按时间倒序、新在上（同 CHANGELOG 规则）；同一天内新条目排上方；条目格式 `- **模型名**：做了什么。`
- 不产生用户可见功能的修改（纯文档、配置、重构等）同样必须记录。

## 官方常量自动同步（保护区）

NovelAI 的模型清单、Opus 限额换算、免费档门槛与成本公式系数依赖 `scripts/media-gateway.mjs` 中的提取器（`extractNai*`、`computeNaiRuntimeSync`、`DEFAULT_NAI_RUNTIME`、`syncNaiRuntime`）与前端 `services/naiRuntime.ts` / `services/naiUsage.ts` / `services/naiModels.ts` 自动从官方 Web 应用同步，**这是「官方调整规则后项目免改代码」的关键路径**：

- 修改上述区域必须跑 `npm run test:gateway`，并加跑联网自检 `npm run test:live-sync`（对真实官方 bundle 逐项验证提取，任何一项未命中即失败）。
- 不得删除或放宽提取器与健康记录相关测试；不得在未经 live-sync 验证的情况下改动提取正则或默认常量。
- 侧栏 Opus 限额行出现琥珀色圆点 = 同步已失效，属于需要优先修复的回归，不得视为可忽略的展示问题。

## 语言与风格

- 文档与代码注释用中文，提交信息用英文。
- 代码风格跟随现有实现（组件结构、Tailwind 类名、注释密度）；不做与任务无关的重构。
