# 独立 Android APK 方案评估

## 已确认目标与当前状态

用户要求没有电脑的创作者也能安装 APK 独立使用工坊。手机自行保存资产与凭据，使用自己的网络请求 NovelAI 等外部服务；不以电脑局域网地址或自建服务器为使用前提。NovelAI 生图仍为联网服务，独立 APK 不等于本机离线生图。

目前交付的是电脑本地服务与手机局域网页面，尚无可安装的独立 APK。下文技术路线、阶段顺序和功能适配方式是本次代码审计后的建议，尚未经过 Android 原型验证或用户定案；不视为已完成能力，也不据此删除现有功能。

## 当前依赖与适配范围

| 能力 | 当前实现 | 独立 Android 需要的工作 |
| --- | --- | --- |
| 界面、四模式、Prompt、参考与费用展示 | React 与 `services/` 中的业务逻辑 | 尽量共用现有组件、参数与成本语义，接入平台服务 |
| 资料、设置与历史索引 | `services/dbService.ts` 经 API 调用 Worker 的 D1 | Android SQLite 持久存储；验证事务、查询结果与旧资料兼容 |
| 原图、Vibe 与参考资产 | Worker 的 R2 接口及本地网关 | 手机文件存储与资源寻址；数据库和原件保存形成完整收据 |
| 生图、图片抓取与外部图库 | `services/api.ts` 与 Node 网关／Worker | Android 原生网络层；适配二进制、流式预览、取消和错误语义 |
| 账户凭据、预算与官方规则 | 本地 Key 库、网关和官方自动同步链 | 本机凭据加密、按 Key 隔离状态，共享同步与费用依据；不能固化官方常量 |
| Tag 词库与目录 | `scripts/update-tag-dictionary.mjs` 使用 `node:sqlite` | 手机下载、校验与 SQLite 查询；不在手机执行 npm 构建 |
| 图片缩略图与反推 | `sharp`、`onnxruntime-node` | Android 图片处理与推理运行时；验证具体模型、内存与耗时 |
| 内置 Agent | `scripts/prompt-agent.mjs` 与 Node 侧会话／工具 | 模型联网、流式输出、会话持久化和本机工具适配，保留确认与费用边界 |
| 收集、导入导出与备份 | Windows 剪贴板监听、电脑路径和文件工具 | 手机文件选择／分享接收、系统分享与备份目录；Windows 全局监听不能直接复用 |

`scripts/local-server.mjs` 当前编排 Wrangler、本地网关与更新服务；`worker/routes/types.ts` 依赖 D1/R2 类型。现有启动器包含 Termux 检测分支，但这不能证明安装 APK 即可独立使用，也未证明整套依赖在 Android 兼容。

## 技术路线建议

优先评估 **共用 React 界面与可移植业务逻辑 + Capacitor Android 容器 + 本机存储／网络／凭据／文件插件**。将电脑服务和 Android 实现放在共同业务接口之后，让两个平台共享模型、参数、成本、草稿和历史语义。手机前端资源随 APK 提供，不依赖远端电脑托管页面；电脑现有服务与 `local-data` 存储键保持兼容。

Capacitor 提供[原生 HTTP 能力](https://capacitorjs.com/docs/apis/http)，但官方也说明跨原生桥传输大数据有局限。需要单独验证图片传输、流式生图／Agent、取消与超时，不能假设普通 HTTP 调用完整替代当前 fetch 流程。凭据建议用 [Android Keystore](https://developer.android.com/privacy-and-security/keystore) 管理加密密钥，加密后的服务凭据留在应用本地持久层。

嵌入 Node.js 是另一条可评估路线，[nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) 提供移动运行时，但现有项目还依赖较新的 Node API、Wrangler/workerd 和原生模块；仅嵌入 Node 不能证明全部依赖可用。是否采用它应由最小原型的依赖兼容、包体、稳定性与维护成本决定，尚未定案。

Android 的[应用专用文件](https://developer.android.com/training/data-storage/app-specific)会随卸载删除；原图导出和完整备份恢复应作为资产闭环验收项。现有电脑数据不在本次评估中迁移、移动或清理；不同独立工坊的同步协议未获确认。

## 建议验证顺序

1. 用合成资料验证本机建库、原图落盘、凭据加解密和外部请求通路，形成能安装的最小原型；不调用真实收费接口。
2. 接入创作闭环：配置自己的 Key、维护风格串、四模式参数和画布、历史与原图保存、参考复用、费用与额度。真实账号与生图验收另按授权边界执行。
3. 对照上表逐项验证词库、外部图库、反推、Agent、分享接收与备份；阶段顺序不等于裁掉功能，首次交付范围须另行确定。
4. 在 Android 模拟器与真机验证长按、滚动、键盘、返回、旋转、后台切换和网络中断；失败／取消不能记账，回到前台不能自动重复发起生成，保存失败必须明确反馈。
5. 在无电脑参与的环境完成安装到使用，再验证覆盖升级与显式备份恢复。分别记录已通过、已知限制和未测项目，再发布 APK。
