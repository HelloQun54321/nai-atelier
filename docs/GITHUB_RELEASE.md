# GitHub Release 发布

Release 是项目的版本下载页：一个版本标签指向一份确定的代码，页面附有更新说明和维护者上传的安装包。GitHub 自动提供的 `Source code (zip)`／`Source code (tar.gz)` 是该标签的源码归档，普通 Windows 使用者应下载安装 EXE。

官方操作说明见 [创建和管理 Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。项目下载页是 [NAI Atelier Releases](https://github.com/HelloQun54321/nai-atelier/releases)。首个 Windows 安装包已于 2026-10-05 公开为 [v1.37.1 预发布版](https://github.com/HelloQun54321/nai-atelier/releases/tag/v1.37.1)；下文同时保留后续版本发布的方法。

## 当前首个 Windows 安装包

已构建并验证的安装包为 `NAI-Atelier-Setup-1.37.1-x64.exe`，构建审计版本也是 `1.37.1`，对应提交 `261a2a5f42ebe8f5ba8f75163deaf83ed56970e9`。发布标签应为 `v1.37.1`，标题可用「NAI Atelier v1.37.1 · Windows 安装版」。后续暂停 Android 或修改说明的文档提交会按工程规则递增源码版本；不应因此改名现有 EXE、把旧包挂到新版本，或让 `v1.37.1` 指向后续提交。

本地 `release/` 不入 Git。首个版本准备上传三份附件：

| 文件 | 用途 |
| --- | --- |
| `NAI-Atelier-Setup-1.37.1-x64.exe` | Windows x64 安装包，263,666,898 字节（约 263.7 MB） |
| `NAI-Atelier-Setup-1.37.1-x64.exe.sha256` | 下载完整性校验 |
| `INSTALL-Windows-zh-CN.txt`（安装使用说明） | 安装、运行库、个人数据与卸载说明；内容来自本地 `安装使用说明.txt` |

安装包 SHA-256 为 `be6355615f8fe9aa2d8f1e8ce21e7728c2521ba615ddc40b02992eaffb180ed6`。发布说明副本位于本地 `release/RELEASE-v1.37.1.md`，附件与目标提交记录在 `release/PUBLISH-v1.37.1.json`；实际发布状态以 GitHub 页面为准。三份附件均核对 GitHub 返回的大小与 SHA-256。中文文件名上传后会被平台规范化，本次说明文件使用英文文件名并设置中文显示标签，内容保持一致。

首次安装包已勾选 **This is a pre-release**。Windows 11 已做安装、完整窗口、持久化、卸载与重装验收；Windows 10 尚未单独实测，安装包尚无发布者代码签名，也没有所有杀毒引擎的认证。这不妨碍提供预发布下载，但更新说明应如实标明边界。后续验证更充分时再由维护者决定转为正式版。

## 维护者发布顺序

1. 核对将要推送的提交和工作区。运行逻辑改变时按项目规则完成相应验证及构建；仅整理这份既有安装包的发布说明，不需要重复打包。
2. 将安装包对应提交推送到项目仓库，并确认 GitHub 上可以读取该提交。其他待推送修改也需按授权范围审阅；不要向 `upstream` 或归档仓库误推。
3. 给安装包对应的确切提交建立版本标签。本次是 `v1.37.1` 指向上述完整提交哈希，再推送该标签。以后每次以实际构建版本和提交为准，不重用旧标签。
4. 在项目 **Releases → Draft a new release** 选择该标签，填写标题和发布说明。后续带应用内更新的版本上传 EXE、同名 `.sha256`、同次构建生成的 `latest.yml` 与安装说明，核对大小、哈希和版本。不要上传 `builder-debug.yml`、解包目录、构建缓存、日志、模型权重或个人工坊数据；不要继续分发有辅助脚本隔离问题的 1.37.0 包。
5. 首次版本勾选 **This is a pre-release**，可以先 **Save draft** 留作预览。确认页面与附件齐全后，再 **Publish release**。GitHub 草稿和公开发布都是远端状态修改，按用户明确授权执行。
6. 发布后打开 Release 页，确认附件可下载；复核下载文件与本地 `.sha256` 相符。README 的下载入口应指向 Release 页或确实存在的版本附件，不提前添加尚不存在的直接下载链接。

从 1.38.0 开始安装版具备应用内检查、下载与重启安装能力；1.37.1 及更早版本需先手动升级一次。更新器从该仓库读取发行信息及 `latest.yml`，默认接收预发布，用户可关闭；源码双击更新入口也只跟随公开发行标签，不追踪普通开发提交。每次发布必须让标签、package.json、EXE 内部版本、元数据版本和附件名一致，且 `latest.yml` 中的安装包名称与 SHA-512 和实际文件一致。只上传 EXE 而缺少元数据，会导致后续安装版检查失败；不能将旧包改名挂到新版本。

构建脚本配置了 GitHub 更新来源，但固定 `publish: never`，只在本地产生文件，不执行远端操作。现阶段更新为完整包下载，保留手动安装作为网络失败或主要版本变化的入口。预发布包位于 Releases 列表；`/releases/latest` 仅适合正式发行，不能用它作为当前预发布的唯一下载入口。

## 使用 GitHub CLI

以下是首个版本的发布步骤示例；`v1.37.1` 已经存在，不要重复创建。发布后续版本时，需替换版本号、构建提交、标题、说明和附件。维护者已有 GitHub CLI 时，可以在完成上面的提交审阅且获得推送、创建草稿授权后执行这些步骤。显式指定仓库与提交，避免标签错误地指向默认分支最新版本；`--verify-tag` 要求标签已存在于 GitHub。上传说明文件时先复制为英文文件名，避免平台规范化为难以辨认的名称。

```powershell
git push origin main
git tag -a v1.37.1 261a2a5f42ebe8f5ba8f75163deaf83ed56970e9 -m "NAI Atelier v1.37.1"
git push origin refs/tags/v1.37.1
Copy-Item -LiteralPath release/安装使用说明.txt -Destination release/INSTALL-Windows-zh-CN.txt
gh release create v1.37.1 --repo HelloQun54321/nai-atelier --verify-tag --draft --prerelease --title "NAI Atelier v1.37.1 · Windows 安装版" --notes-file release/RELEASE-v1.37.1.md release/NAI-Atelier-Setup-1.37.1-x64.exe release/NAI-Atelier-Setup-1.37.1-x64.exe.sha256 release/INSTALL-Windows-zh-CN.txt
```

在获得公开发布授权并检查草稿后，可在网页点击 **Publish release**，或用 `gh release edit v1.37.1 --repo HelloQun54321/nai-atelier --draft=false`。发布前仍需确认当前标签对应正确代码、附件没有漏传；不要凭命令示例执行未经授权的发布。
