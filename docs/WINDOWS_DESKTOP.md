# Windows 安装版说明

Windows 安装版面向 Windows 10／11 x64 用户，内置独立窗口、Node 运行时与本地后端，开箱即用，无需安装 Node.js、Git 或配置开发环境。手机可通过家庭 Wi-Fi 局域网连接电脑工坊，或使用独立的 [Android APK](./ANDROID_STANDALONE.md)。发布流程见 [GitHub Release 指南](./GITHUB_RELEASE.md)。

## 安装、更新与卸载

1. 从 GitHub Releases 下载 `NAI-Atelier-Setup-<版本>-x64.exe`（可对照同名 `.sha256` 校验完整性）。安装包未配置商业代码签名，若遇 Windows SmartScreen 提示未知发布者，确认来源为官方仓库后选择继续运行即可。
2. 双击运行安装向导并选择程序目录。安装器会自动检查 x64 Visual C++ 运行库（14.44+）；若系统缺失会提示前往[微软官方页面](https://learn.microsoft.com/zh-cn/cpp/windows/latest-supported-vc-redist)安装后再继续。
3. 从桌面或开始菜单打开 **NAI Atelier**，在设置中填入 NovelAI Key 并下载 Tag 词库即可开始创作。关闭主窗口会最小化到系统托盘（保持局域网服务在线），在托盘菜单点击「退出工坊」才会完全停止后台。若默认的 `3000` 端口被占用，安装版会自动顺延可用端口（实际局域网地址见设置页或启动日志）。
4. **应用内更新**：在「全局设置 → 数据与维护 → 应用更新」检查并下载 GitHub Release 新版，点击「重启并安装」后会自动等待当前生图／备份／词库任务收尾、保存实验室临时文字草稿并拉起安装向导覆盖升级，个人数据原样保留。大版本（major）升级会提示先备份再手动安装。
5. **卸载**：通过系统「已安装的应用」或安装目录下的 `Uninstall NAI Atelier.exe` 卸载，仅移除程序文件与快捷方式，默认保留个人数据。

*(注：Pixiv 登录会在系统默认浏览器中完成，授权成功后自动唤起工坊并打开「Pixiv 已连接」提示页，原浏览器停留的空白页可直接关闭。)*

## 程序与数据目录

| 路径 | 用途 |
| --- | --- |
| 用户选定的安装目录 | 桌面窗口、内置 Node、预构建前端／Worker、运行依赖与卸载程序 |
| `%LOCALAPPDATA%\NAI Atelier\workspace\local-data` | **核心数据保护区**（D1 数据库、R2 原图、历史、设置、密钥、Agent 会话） |
| `%LOCALAPPDATA%\NAI Atelier\workspace\local-cache` | 可再生成的缩略图与本地反推模型缓存 |
| `%LOCALAPPDATA%\NAI Atelier\workspace\public\tag-data` | 下载或导入的 Tag 补全词库 |
| `%LOCALAPPDATA%\NAI Atelier\browser` | 桌面窗口的浏览器本地状态与缓存 |
| `%LOCALAPPDATA%\NAI Atelier\*-preferences.json` | 更新通道与启动器／托盘五语偏好 |
| `%LOCALAPPDATA%\NAI Atelier\logs\desktop.log` | 启动诊断日志（含当次局域网地址与 PIN 码） |
| `文档\NAI Atelier Backups` | 默认完整备份输出目录（可在设置中修改） |

程序与数据目录完全分离，可在「全局设置 → 数据与维护 → 存储位置」将工坊数据或缓存目录安全迁移至其他磁盘（迁移前自动停服、逐文件校验并保留原目录副本）。备份详情见 [README「本地数据主权与备份」](../README.md#-本地数据主权与备份)。

## 从源码构建与验证

在 Windows x64 + Node 24 环境下执行：

```powershell
npm ci
npm run build:desktop
```

产物输出至 `release/`（固定 `publish: never`，不会自动上传）。构建要点：
- **白名单打包**：仅打包公开前端产物、运行脚本、内置图标（`node scripts/generate-app-icon.mjs` 生成含 256px PNG 与多尺寸 DIB 的 `.ico`）及独立锁定的后台生产依赖（`desktop/runtime-package-lock.json`），绝不混入开发目录的 `local-data`、`local-cache`、`.env*` 或日志。
- **体积精简**：自动剔除前端已打包库、源码映射（`.map`）、类型声明与多余的 Electron 语言包（仅保留简／繁／英／日／韩五语），保留 `wrangler`、`workerd`、`sharp`、`onnxruntime-node` 原生模块及第三方许可证。修改后台生产依赖后须通过 `scripts/build-desktop.mjs` 的 `createRuntimePackage` 更新运行锁文件。

打包集成验证命令（在 `tests/.tmp` 隔离合成目录中验证启动、D1/R2 持久化、端口避让、更新保护与退出回收）：

```powershell
npm run build:desktop:dir
$env:NAI_DESKTOP_TEST_EXE = "$PWD\release\win-unpacked\NAI Atelier.exe"
npm run test:node -- tests/integration/desktop-package.test.mjs
Remove-Item Env:NAI_DESKTOP_TEST_EXE
```
