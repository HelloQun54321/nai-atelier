# 本地助手插件

入口：全局设置 → 创作助手 → 助手插件 → 管理插件。

可安装 GitHub 仓库根地址或单个插件 ZIP，查看来源、固定提交、兼容缺项、配置、运行状态、日志和提示词片段。安装默认停用；启用后才运行本地代码。升级同名包时先停用、移除，再安装新版。

## 最小接口

包的 `package.json` 用 `atelier.entry`、`main` 或根 `exports` 指向 JS／TS 入口。宿主使用 Cordis 4.0.5，在独立 Node 子进程加载 `apply(ctx, config)`；不是 DSH 专属服务的完整实现。

```js
export const inject = ['atelier'];
export function apply(ctx, config) {
  ctx.atelier.registerTool({
    name: 'echo',
    description: '返回输入文字',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    execute: args => ({ text: args.text, prefix: config.prefix || '' }),
  });
  ctx.atelier.registerPromptBlock({
    id: 'writing', title: '写作规则', text: '填写插件自己的静态规则。',
  });
}
```

`ctx.atelier.apiVersion` 为 2。工具由宿主加插件前缀，通过 IPC 调用；执行超时 30 秒，启动超时 10 秒。每个包的静态片段最多 8 段、单段 20000 字符、合计 32000 字符，所有启用包合计最多 64000；超限报错，不截断。

工具和静态片段只在下一次完全访问权限任务中合入；普通／只读任务不使用。任务开始时冻结片段，模型循环及自动／手动上下文压缩使用同一正文和预算；停用只影响后续任务。插件不扩大内置工具权限，也不改变费用确认。

静态片段必须在启动完成前注册。也可在 `package.json` 的 `atelier.promptBlocks` 中声明同形片段，供停用时预览。声明只是预览，不执行代码；启用后展示实际注册正文。片段按插件 ID 稳定排序，只拼接正文，不注入标题、来源或工程说明。审计只记 ID、字符数和散列，不记片段正文；没有启用片段时保持原系统规则与指纹。

## 安装和运行边界

GitHub 下载固定到提交 SHA，记录来源和 ZIP SHA256。ZIP 校验文件路径、符号链接、文件数与解压大小；最多 6000 个文件、压缩及解压各最多 50 MiB。依赖用 `--ignore-scripts` 安装，不执行包的安装／构建脚本；启用时由宿主 esbuild 打包入口。

包、配置与运行产物位于当前工坊的 `local-plugins/`，已排除 Git，不放入 `local-data/`。独立进程用于故障隔离，**不是安全沙箱**：启用代码具有当前系统用户权限，应只启用自己信任的包。DSH 服务、客户端扩展和配置补丁缺项会列出并阻止启用。此功能依赖桌面 Node 宿主，不代表 Android 独立工坊支持。

管理及预览接口限定电脑本机与同源请求。启用失败不贡献工具或片段；停用后才可移除，移除只处理对应插件文件和配置，作品与个人资料保留。插件的模型输出效果不由安装状态保证。

## 随附适配示例

[`dsh-unrestricted-atelier`](../plugins/dsh-unrestricted-atelier/README.md) 0.1.1 是可独立打包的适配示例，保留 MIT 许可、固定来源和差异说明。它提供执行规则及非性化外观标签说明，不包含私人预设；与上游原文的区别在该包 README／UPSTREAM.json 中逐项列明。

在源码根目录执行：

```sh
node scripts/package-atelier-adapter.mjs
```

将生成的 `tests/.tmp/dsh-unrestricted-atelier-0.1.1.zip` 导入管理器。也可把输出 ZIP 的路径作为首个参数。打包只读取维护目录的明确文件，不复制真实安装目录；未用真实模型或 NovelAI 验证效果。
