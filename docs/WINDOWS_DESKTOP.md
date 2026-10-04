# Windows 安装版

安装版面向 Windows 10／11 x64，将完整工坊交给没有开发环境的使用者。源码版仍保留现有部署流程；Android 独立 APK 继续属于已确认但尚未交付的方向。

## 安装、打开与卸载

1. 取得发布者提供的 `NAI-Atelier-Setup-<版本>-x64.exe` 和对应 `.sha256` 文件。
2. 双击安装包，接受项目 MIT 许可，在目录选择页指定程序安装位置。普通用户默认按当前账户安装；选择需要系统权限的位置时，Windows 会要求管理员授权。
3. 完成后从桌面／开始菜单的 **NAI Atelier** 打开工坊，或双击安装目录的 `NAI Atelier.exe`。不需要 Node、npm、Git、自建服务器或 Cloudflare 账户。
4. 在「NovelAI 与 Anlas」配置自己的 Key，在「Tag 补全词库」安装词库。生图仍需要能连接 NovelAI，并遵守自己的订阅与费用边界。
5. 从 Windows「应用和功能／已安装的应用」卸载 **NAI Atelier**，或运行安装目录的 `Uninstall NAI Atelier.exe`。程序和系统入口会移除，个人数据默认保留。

安装器检查 x64 Visual C++ 运行库；缺失或版本过旧时，从微软官方 HTTPS 下载、验证微软数字签名后运行原安装器，可能需要网络和管理员授权。无需 WebView2。未提供签名证书时，工坊安装包没有发布者代码签名，Windows 下载信誉／SmartScreen 可能提示未知发布者；不要把没有签名描述为已经获得系统信任。

重复打开回到原窗口，不重启正在工作的后台。关闭窗口会收进系统托盘，局域网服务继续运行；托盘「退出工坊」或菜单「退出工坊」结束本应用的后台。Alt 可显示菜单，其中可打开数据目录和启动日志。启动失败窗口提供重试、日志与退出，不要求用户手工运行部署命令。

升级前结束生成、Agent、收集与备份任务，通过托盘退出，保留一份完整数据备份，再运行新版安装器。安装器不接管源码部署的数据，不自动迁移或合并独立工坊；不要自行替换数据库存储名称或 ID。

## 程序与个人数据

| 位置 | 内容 |
| --- | --- |
| 使用者选择的安装目录 | 窗口、内置 Node、预构建前端／Worker、运行依赖与卸载器 |
| `%LOCALAPPDATA%\NAI Atelier\workspace\local-data` | D1、R2 原图、历史、设置、凭据、局域网授权、Agent 会话，完整备份的事实源 |
| 同一工作区的 `local-cache` | 可再生成的缩略图与反推模型缓存 |
| 同一工作区的 `public\tag-data` | 使用者自行安装的词库 |
| `%LOCALAPPDATA%\NAI Atelier\browser` | 独立窗口的浏览器草稿、访问选择和缓存 |
| `%LOCALAPPDATA%\NAI Atelier\logs\desktop.log` | 启动诊断，含本次局域网地址与密码，不作为分发材料 |
| 用户「文档」内的 `NAI Atelier Backups` | 安装版默认备份目标，可在设置中自行更改 |

程序位置与数据位置独立。重装、更换程序目录不会删除个人资料；本版本不提供数据目录迁移功能。默认数据目录按 Windows 用户隔离，不从开发机、源码目录或其他工坊复制任何状态。应用内备份与停服复制规则沿用 README「备份与数据持久化」；停服应通过托盘退出，备份安装版上述 `local-data` 的完整内容。浏览器尚未提交的草稿不在 D1/R2 备份中。

已有服务占用 3000 时，安装版选择另一组端口，不终止原服务。电脑窗口、内部请求和词库服务使用实际端口；手机访问地址以本次启动日志为准。仅用于可信局域网，不自动配置公网访问或修改防火墙。

## 从公开代码构建

在 Windows x64、Node 24 与 npm 环境运行：

```powershell
npm ci
npm run build:desktop
```

输出目录是 Git 忽略的 `release/`。分发安装 EXE、校验文件和使用说明即可，不需要分发源码、`win-unpacked` 或 `.desktop-build`。构建过程联网取得 Electron、Node 和依赖；Node 官方 ZIP 必须通过官方 SHA-256 清单校验。所有第三方运行依赖按各自许可保留许可材料。

- 前端构建仅使用公开图标白名单，禁用 `.env*` 文件加载；运行脚本、助手规则和酒馆连接器也采用公开文件白名单。
- 不复制源码的 `local-data`、`local-cache`、`public/tag-data`、`.wrangler`、日志、测试材料、环境配置或 `node_modules`。
- 安装版运行依赖在 `desktop/runtime-package-lock.json` 独立锁定，`runtime-dependencies.json` 声明安装版 Wrangler 版本；源码 Wrangler 保持原版本，避免更换旧工坊的数据库运行环境。
- 安装版读取预构建资源，词库写入用户工作区后直接提供，无需 npm 构建或写安装目录。
- 构建后检查实际安装资源必须包含 Wrangler 和原生 ONNX 模块，桌面壳不得混入开发项目依赖。审计清单位于 `.desktop-build/distribution-audit.json`，不包含个人数据。

修改生产依赖声明后，应在新的临时构建目录调用 `createRuntimePackage`（`scripts/build-desktop.mjs`），根据根包的依赖加上运行版本覆盖生成 `package.json`，执行 `npm install --package-lock-only --ignore-scripts`，审计并更新 `desktop/runtime-package-lock.json`。不要把源码锁文件直接当作安装版运行锁文件。`--reuse-deps` 仅用于本次锁文件完全一致的重复构建，发现变化会拒绝复用。

## 发布验证

```powershell
npm run test:gateway
npm run test -- tests/components/DesktopLauncherManager.test.ts
npm run build:desktop:dir
$env:NAI_DESKTOP_TEST_EXE = "$PWD\release\win-unpacked\NAI Atelier.exe"
npm run test:gateway -- tests/integration/desktop-package.test.mjs
Remove-Item Env:NAI_DESKTOP_TEST_EXE
```

明确指定构建应用时，集成测试才执行；普通 gateway 回归跳过该项。测试在 `tests/.tmp` 新建合成工作区，只保存合成 Prompt 和 2×2 PNG，验证空工坊、D1／R2 持久化、词库可写、没有 Node/npm 的 PATH、端口冲突、正常退出与 IPC 断开回收，不读取真实工坊或调用付费生成。

另需实际运行安装器，选择含中文和空格的目录，打开应用并核对窗口渲染，验证卸载登记、程序清理、数据保留与重装恢复。环境变量 `NAI_DESKTOP_DATA_DIR`、`NAI_DESKTOP_SELF_TEST`、`NAI_DESKTOP_PORT` 仅供开发验证隔离工作区、输出本次页面渲染报告／截图和指定起始端口；自检短暂显示本次测试窗口后自动退出，必须等到业务导航与设置入口出现才能通过。日常使用无需设置。分别记录 Windows 10、Windows 11 的实测范围，不能以一个系统的成功启动冒充两个系统都已真机验收。

### 2026-10-05 验收范围

- 在 Windows 11 Professional x64（系统构建 26100）实际安装到含中文和空格的自选目录，核对应用与卸载器、Windows 卸载登记，内置运行库检查通过。
- 以全新合成工作区打开实际桌面窗口，PATH 仅含 Windows 系统目录，核对空工坊主界面；源码工坊占用 3000 时，桌面工坊使用 3010，测试退出后原服务仍运行。
- 安装资源集成测试验证合成风格串、2×2 PNG 的 D1/R2 保存与重启恢复、词库工作区可写、正常退出和父进程断开后的端口回收。卸载后程序及登记被移除，28 个合成数据文件的 SHA-256 保持一致；重新安装成功（退出码 0），实际桌面窗口再次打开，合成风格串恢复、R2 原图逐字节一致。
- 最终 gateway 回归显式指定实际安装的 EXE，428 项全部通过（包含安装资源、脚本编码、子进程回收回归，无跳过）；前端入口 3 项通过，官方常量联网提取全部命中，安装版生产依赖审计为 0 项已知漏洞。
- Windows 10 按官方运行环境支持范围作为目标，尚未在独立 Windows 10 系统上实测；缺少微软运行库的系统也尚未做干净虚拟机验收。本次不配置真实账户或调用付费生成，联网生图、第三方登录与反推模型推理仍需后续真实使用验收。
