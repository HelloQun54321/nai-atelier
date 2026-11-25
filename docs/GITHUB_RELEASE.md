# GitHub Release 发布指南

[NAI Atelier Releases](https://github.com/HelloQun54321/nai-atelier/releases) 用于分发 Windows 安装版与版本更新元数据。应用内更新器只读取该页面已公开发布的版本；源码部署的双击更新脚本默认直接跟随官方 `main` 分支。

## 发布附件构成

每次发布 Windows 安装版需上传 `release/` 下同次构建生成的四份文件（切勿上传 `win-unpacked`、构建缓存或个人数据）：

| 文件 | 用途 |
| --- | --- |
| `NAI-Atelier-Setup-<版本>-x64.exe` | Windows 10/11 x64 安装程序 |
| `NAI-Atelier-Setup-<版本>-x64.exe.sha256` | 安装包 SHA-256 校验值 |
| `latest.yml` | 应用内自动更新元数据（含版本号、文件名与 SHA-512） |
| `INSTALL-Windows-zh-CN.txt` | 中文安装与数据目录说明（复制自 `release/安装使用说明.txt`，避免中文附件名被平台转义） |

**版本一致性要求**：Git 标签（`vX.Y.Z`）、`package.json` 版本、EXE 内部版本与 `latest.yml` 必须完全一致，且标签应精确绑定构建该安装包的代码提交（后续补充修改文档产生的新提交不要移动已发布的标签）。

## 维护者发布步骤

1. **构建与本地核验**：按 [WINDOWS_DESKTOP.md](./WINDOWS_DESKTOP.md) 完成构建与打包测试，核对 `release/` 下 EXE 与 `latest.yml` 的版本及哈希一致。
2. **推送代码与标签**：将构建对应的提交推送到 `origin/main`，基于该提交创建带注释标签并推送。
3. **创建 Release 草稿**：在 GitHub 新建 Release（或使用下方 CLI），上传上述四份附件；正式版不勾选 `pre-release` 并设为 `Latest`。
4. **核对并公开**：检查草稿附件齐全、下载校验无误后点击 **Publish release**。

### GitHub CLI 示例

将下方 `<版本>` 与 `<构建提交哈希>` 替换为当次实际值后执行：

```powershell
git push origin main
git tag -a v<版本> <构建提交哈希> -m "NAI Atelier v<版本>"
git push origin refs/tags/v<版本>
Copy-Item -LiteralPath release/安装使用说明.txt -Destination release/INSTALL-Windows-zh-CN.txt

gh release create v<版本> `
  --repo HelloQun54321/nai-atelier `
  --verify-tag `
  --draft `
  --title "NAI Atelier v<版本>" `
  --notes-file release/RELEASE-v<版本>.md `
  release/NAI-Atelier-Setup-<版本>-x64.exe `
  release/NAI-Atelier-Setup-<版本>-x64.exe.sha256 `
  release/latest.yml `
  release/INSTALL-Windows-zh-CN.txt
```

确认草稿无误后，在网页端发布或执行 `gh release edit v<版本> --repo HelloQun54321/nai-atelier --draft=false`。
