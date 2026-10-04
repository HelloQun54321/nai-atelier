# GitHub Release 发布

Release 是项目的版本下载页：一个版本标签指向一份确定的代码，页面附有更新说明和维护者上传的安装包。GitHub 自动提供的 `Source code (zip)`／`Source code (tar.gz)` 是该标签的源码归档，普通 Windows 使用者应下载安装 EXE。

官方操作说明见 [创建和管理 Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。项目下载页是 [NAI Atelier Releases](https://github.com/HelloQun54321/nai-atelier/releases)。本指南提供发布方法，不表示某个版本已经公开。

## 当前首个 Windows 安装包

已构建并验证的安装包为 `NAI-Atelier-Setup-1.37.1-x64.exe`，构建审计版本也是 `1.37.1`，对应提交 `261a2a5f42ebe8f5ba8f75163deaf83ed56970e9`。发布标签应为 `v1.37.1`，标题可用「NAI Atelier v1.37.1 · Windows 安装版」。后续暂停 Android 或修改说明的文档提交会按工程规则递增源码版本；不应因此改名现有 EXE、把旧包挂到新版本，或让 `v1.37.1` 指向后续提交。

本地 `release/` 不入 Git。首个版本准备上传三份附件：

| 文件 | 用途 |
| --- | --- |
| `NAI-Atelier-Setup-1.37.1-x64.exe` | Windows x64 安装包，263,666,898 字节（约 263.7 MB） |
| `NAI-Atelier-Setup-1.37.1-x64.exe.sha256` | 下载完整性校验 |
| `安装使用说明.txt` | 安装、运行库、个人数据与卸载说明 |

安装包 SHA-256 为 `be6355615f8fe9aa2d8f1e8ce21e7728c2521ba615ddc40b02992eaffb180ed6`。发布说明草稿位于本地 `release/RELEASE-v1.37.1.md`，附件与目标提交记录在 `release/PUBLISH-v1.37.1.json`；两者是本地准备材料，并非已经创建的 GitHub 草稿。

首次安装包建议勾选 **This is a pre-release**。Windows 11 已做安装、完整窗口、持久化、卸载与重装验收；Windows 10 尚未单独实测，安装包尚无发布者代码签名，也没有所有杀毒引擎的认证。这不妨碍提供预发布下载，但更新说明应如实标明边界。后续验证更充分时再由维护者决定转为正式版。

## 维护者发布顺序

1. 核对将要推送的提交和工作区。运行逻辑改变时按项目规则完成相应验证及构建；仅整理这份既有安装包的发布说明，不需要重复打包。
2. 将安装包对应提交推送到项目仓库，并确认 GitHub 上可以读取该提交。其他待推送修改也需按授权范围审阅；不要向 `upstream` 或归档仓库误推。
3. 给安装包对应的确切提交建立版本标签。本次是 `v1.37.1` 指向上述完整提交哈希，再推送该标签。以后每次以实际构建版本和提交为准，不重用旧标签。
4. 在项目 **Releases → Draft a new release** 选择该标签，填写标题和发布说明，上传上表三份附件，核对大小、哈希和使用说明。不要上传 `builder-debug.yml`、解包目录、构建缓存、日志、模型权重或个人工坊数据；不要继续分发有辅助脚本隔离问题的 1.37.0 包。
5. 首次版本勾选 **This is a pre-release**，可以先 **Save draft** 留作预览。确认页面与附件齐全后，再 **Publish release**。GitHub 草稿和公开发布都是远端状态修改，按用户明确授权执行。
6. 发布后打开 Release 页，确认附件可下载；复核下载文件与本地 `.sha256` 相符。README 的下载入口应指向 Release 页或确实存在的版本附件，不提前添加尚不存在的直接下载链接。

安装版保留原有手动升级方式：结束进行中的任务，通过托盘退出，备份个人数据，再运行新版安装包。建立 Release 本身不会让应用获得自动更新能力。

## 使用 GitHub CLI

维护者已有 GitHub CLI 时，可以在完成上面的提交审阅且获得推送、创建草稿授权后执行以下步骤。显式指定仓库与提交，避免标签错误地指向默认分支最新版本；`--verify-tag` 要求标签已存在于 GitHub。

```powershell
git push origin main
git tag -a v1.37.1 261a2a5f42ebe8f5ba8f75163deaf83ed56970e9 -m "NAI Atelier v1.37.1"
git push origin refs/tags/v1.37.1
gh release create v1.37.1 --repo HelloQun54321/nai-atelier --verify-tag --draft --prerelease --title "NAI Atelier v1.37.1 · Windows 安装版" --notes-file release/RELEASE-v1.37.1.md release/NAI-Atelier-Setup-1.37.1-x64.exe release/NAI-Atelier-Setup-1.37.1-x64.exe.sha256 release/安装使用说明.txt
```

在获得公开发布授权并检查草稿后，可在网页点击 **Publish release**，或用 `gh release edit v1.37.1 --repo HelloQun54321/nai-atelier --draft=false`。发布前仍需确认当前标签对应正确代码、附件没有漏传；不要凭命令示例执行未经授权的发布。
