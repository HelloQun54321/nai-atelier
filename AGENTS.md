# AGENTS.md — AI 协作规则

任何 AI 编码工具（ZCode、Claude Code、Codex 等）在修改本项目前必须先读完本文件并遵守全部规则。

## 项目概览

- NaiPromptManager：本地个人 NovelAI 创作管理工具。React 19 + TypeScript + Vite + Tailwind 4 前端，Cloudflare Worker 后端（`worker/`），数据落本地 D1 + R2。
- 领域知识与完整功能说明见 `README.md`；NovelAI 接口说明见 `NOVELAI_API_DOCS.md`；历史变更见 `CHANGELOG.md`。

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

## 语言与风格

- 文档与代码注释用中文，提交信息用英文。
- 代码风格跟随现有实现（组件结构、Tailwind 类名、注释密度）；不做与任务无关的重构。
