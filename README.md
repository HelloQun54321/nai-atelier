
# 🎨 NovelAI Prompt Manager (NAI 助手)

> 本项目基于 [kirafishy/NaiPromptManager](https://github.com/kirafishy/NaiPromptManager) 改造而来，已作为独立项目维护，不再与原仓库保持 Git 远程关联。原项目及本项目均遵循 MIT 开源协议；详见 [LICENSE](./LICENSE)。

<div align="center">

![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![React](https://img.shields.io/badge/react-19.0-61dafb.svg)
![Cloudflare](https://img.shields.io/badge/cloudflare-D1%20%7C%20R2-orange.svg)

**专业级 NovelAI 提示词管理工具 | 全栈 Serverless 架构**

[🚀 快速部署](#-快速部署) · [✨ 功能特性](#-核心功能) · [📖 使用文档](#-使用指南) · [📝 更新日志](./CHANGELOG.md) · [🛠️ 技术架构](#-%EF%B8%8F-技术架构)

</div>

---

## 🌟 项目简介

NovelAI Prompt Manager 是一个专为 NovelAI 用户打造的现代化提示词管理平台。

**v0.4.x 重大更新**：项目已从纯前端应用升级为基于 Cloudflare Workers 的**全栈应用**。引入了 D1 数据库和 R2 对象存储，实现了多用户管理、云端数据同步、图片持久化存储等功能，同时保留了本地生成历史的隐私性。

### 💡 核心价值

- ⛓️ **Prompt Chain** - 像管理代码一样管理提示词，支持基础层、模块层、变量层的解耦与组合。
- ☁️ **云端同步** - 所有画师串、灵感图、配置信息通过 Cloudflare D1 存储，多端实时同步。
- 🖼️ **R2 图床** - 集成 Cloudflare R2 对象存储，上传封面和灵感图不再占用本地空间，支持流式上传。
- 👥 **多用户系统** - 内置完善的 Auth 系统，支持管理员（Admin）和普通用户，适合小团队或个人多设备使用。
- 🧩 **模块化设计** - 将光影、构图、人物特征拆分为独立模块，灵活开关测试。
- 🎨 **画师军火库** - 内置权重计算、Gacha 随机抽取、批量导入功能。
- 🔒 **隐私安全** - 绘图 API Key 仅存储在本地，生成历史（History）默认存储在浏览器 IndexedDB，保护隐私。

---

## ✨ 核心功能

### 🛠️ 创作工作流

| 功能 | 说明 |
|------|------|
| 📝 **Prompt Chain** | 核心数据结构，包含 Base Prompt、Modules（风格模块）、Params（参数）。支持版本迭代。 |
| 🔢 **变量系统** | 支持 `{subject}` 等动态变量输入，一套风格模板可快速复用于不同角色。 |
| 🧪 **实时预览** | 集成 NAI API (V4.5)，后端代理转发请求，解决跨域问题。 |
| 📦 **封面管理** | 生成满意的图片后，可一键上传至 R2 并设为该 Chain 的封面。 |

### 📚 资源管理

- **画师军火库**：
  - 支持 `artist:` 前缀开关，支持 `{}` `[]` 权重语法。
  - **Gacha 功能**：随机抽取画师组合，寻找意外的化学反应。
  - **批量导入**：支持从文本批量导入画师列表。
- **灵感图库 (Inspirations)**：
  - 云端存储高质量生成的图片。
  - **自动解析**：上传 PNG 图片自动读取 NAI 元数据（Prompt/Seed/Steps）。
  - 支持批量管理与删除。
- **本地历史 (GenHistory)**：
  - 生成的图片自动保存在浏览器 IndexedDB。
  - 支持一键“发布”到云端灵感图库。

---

## 🚀 快速部署

本项目依赖 Cloudflare 生态（Pages + Workers + D1 + R2）。

### 前置要求
- Node.js 18+
- Cloudflare 账号
- Wrangler CLI (可选，用于本地开发)

---

## 💻 本地开发

如果你想在本地运行和测试项目，无需 Cloudflare 账号即可体验完整功能。

### 快速启动

```bash
# 安装依赖
npm install

# 启动本地服务 (端口 3000)
npm run dev:local
```

首次运行会自动构建前端并启动本地模拟服务器。

- **访问地址**: http://localhost:3000
- **数据存储**: `./local-data/` 目录（模拟 D1 和 R2）
- **默认管理员**: `admin` / `admin_996`

### 监听模式开发

如果你需要实时预览代码改动：

```bash
# 同时监听前端和 Worker 变化
npm run dev:local:watch
```

此命令会在后台运行 Vite 构建监听、esbuild Worker 打包监听和本地服务器。

### 平台特定脚本

```bash
# Windows
npm run dev:local:win

# Linux / macOS
npm run dev:local:linux
```

### 本地数据说明

本地模式使用 Wrangler 的 `--persist-to` 功能，数据存储在 `./local-data/` 目录：

- D1 数据库数据存储为 SQLite 文件
- R2 存储桶数据存储为本地文件
- 数据在重启后保留，适合长期本地测试

> **注意**: 本地数据与云端部署的数据完全隔离，不会同步。

### 1. 准备 Cloudflare 资源

你可以通过 Wrangler CLI 命令行创建，也可以直接在 Cloudflare 网页控制台（Dashboard）创建。

#### 方式 A：使用 Wrangler CLI (推荐)
```bash
# 1. 创建 D1 数据库
wrangler d1 create nai-db

# 2. 创建 R2 存储桶
wrangler r2 bucket create nai-assets
```

#### 方式 B：使用 Cloudflare 网页控制台
1. **D1 数据库**：进入 `Workers & Pages` -> `D1 SQL Database`，点击创建，命名为 `nai-db`。
2. **R2 存储桶**：进入 `R2`，点击创建存储桶，命名为 `nai-assets`。
3. 创建完成后，记下它们的 ID 和名称。

### 2. 配置项目

修改项目根目录下的 `wrangler.toml` 文件，填入上一步生成的 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "nai-db"
database_id = "替换为你刚刚创建的数据库ID"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "nai-assets"
```

### 3. 设置构建命令 (Pages Settings)

在 Cloudflare Pages 项目创建后，进入 **Settings** -> **Build & deployments** -> **Build configurations**。

将 **Build command** 修改为：
```bash
npx wrangler pages project create nai-prompt-manager --production-branch main || true && npx wrangler pages deploy dist --branch main
```
> 注意：此命令用于在构建时自动绑定资源并部署。如果使用 Git 集成部署，通常只需 `npm run build`，并在控制台手动绑定 D1 (变量名 `DB`) 和 R2 (变量名 `BUCKET`)。上述命令适用于某些特定的 CI/CD 流程或确保资源绑定的场景。

### 4. 部署与初始化

1. 推送代码到 Git 仓库，触发 Cloudflare Pages 构建。
2. 部署完成后，访问你的 Pages 域名。
3. 系统会自动初始化数据库结构。
4. 默认管理员账号：`admin`，密码：`admin_996`。
5. **强烈建议**：首次登录后，进入“我的 -> 个人设置”修改密码。

---

## 📖 使用指南

### 配置 API Key
首次生成图片时，在编辑器右上角输入你的 NovelAI API Key。
> 🔑 Key 存储在浏览器 LocalStorage 中，并通过 HTTPS Header 发送给 Worker 代理，Worker 不会保存你的 Key。

### 权限说明
- **Admin (管理员)**：
  - 管理所有用户、画师数据。
  - 可以查看和删除所有人的公开数据。
  - 创建新用户。
- **User (普通用户)**：
  - 创建、编辑、删除自己的 Prompt Chain。
  - 只能管理自己的灵感图。
  - 有存储空间配额限制（默认 300MB）。

---

## 🛠️ 技术架构

- **Frontend**: React 19, TypeScript, Tailwind CSS, Vite
- **Backend (Serverless)**: Cloudflare Workers (Functions)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (Object Storage)
- **Local Storage**: IndexedDB (Dexie-like raw implementation)
- **Security**: BCrypt password hashing, HttpOnly Session Cookies

---

## 📄 开源协议

本项目采用 [MIT License](./LICENSE) 开源协议。

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！**

</div>
