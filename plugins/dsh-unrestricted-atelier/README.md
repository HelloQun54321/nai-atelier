# dsh-unrestricted 的 Atelier 适配包

版本 0.1.1，基于 [dsh-unrestricted v0.2.7](https://github.com/yexi-by/dsh-unrestricted/tree/v0.2.7) 的执行规则适配。它不是原始 DSH 插件，不提供 DSH 四模式、子代理或客户端扩展。

## 使用

在工坊源码根目录执行 `node scripts/package-atelier-adapter.mjs`，得到 `tests/.tmp/dsh-unrestricted-atelier-0.1.1.zip` 和 SHA256 收据。

进入「全局设置 → 创作助手 → 管理插件 → 导入 ZIP」，先查看提示词片段，再按需要启用。安装默认停用；启用后两段规则只加入下一次完全访问权限的助手任务。停用后下一次不再加入，当前运行任务保持开始时的快照。已有同名旧版须先停用并移除后安装新版。

本包不替换模型，不改工具权限、费用确认、生图框和历史，也不读取私人系统规则。源仓库根目录不是这个子包，不能直接把 Atelier 仓库根地址作为本适配包安装地址。

## 规则与来源

- `local_execution`：基于上游执行规则。公开适配版移除了忽略年龄、在性内容中强制把角色视为成人的段落，不能称为上游逐字副本。
- `appearance_tags`：单独说明 loli、kid、child 等标签可用于非性化外观描写，不把儿童化外观自动视为成人。此段是 Atelier 适配内容，不是上游原文。
- 只把两段正文注册给宿主，来源、变更说明和工程报告不注入模型。

固定上游提交 `1b4d8b9205dfa0177bd6e1e96ef1a5995e9cc6da`；来源和新旧校验值记录于 `UPSTREAM.json`。MIT 许可及第三方致谢保留在 `upstream/`。原始整份规则文件不随此包分发，也不包含任何只许自用的第三方预设。

预览声明与运行正文必须相同，打包时检查两段 SHA256 及版权文件。隔离测试覆盖安装、预览、启停和恢复；未以真实模型或 NovelAI 生图验证效果。
