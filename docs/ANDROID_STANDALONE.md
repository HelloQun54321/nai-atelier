# 独立 Android APK 说明

独立 Android 版将完整创作工坊（四大生图模式、资源图库、内置创作助手与按需下载的本地 WD Tagger 反推）封装为手机端原生应用：复用 React 触控界面，在手机本地直接运行 SQLite 数据库、文件存储与 ONNX Runtime CPU 推理，无需依赖电脑或 Termux。

## 运行要求与安装升级

- **环境要求**：Android 8.0+（64 位 ARM 设备），保持系统 Android System WebView 为较新版本；生图、外部图库与助手 API 使用手机自身网络。
- **版本与覆盖升级**：APK 显示版本（`versionName`）读取 `package.json`，安装构建号由 `android/gradle.properties` 中的 `atelierAndroidBuild` 独立递增。使用同一签名且构建号更高的 APK 可直接覆盖安装并完整保留手机内资料。
- **独立数据边界**：手机独立工坊与电脑工坊各自保存资料，互不自动同步。图片卡片长按约 450ms 唤出底部操作面板；大图支持双指缩放、双击放大／复原、单指平移与适应窗口时横滑翻页。

## 存储结构与加密备份

| 内容 | 存储方式 | 说明 |
| --- | --- | --- |
| 风格串、角色、收藏索引、预算、设置 | 应用私有 SQLite（事务写入） | 核心持久数据，清缓存不会删除 |
| 历史、收藏、Vibe、精准参考与封面原图 | 私有目录（SHA-256 内容寻址去重） | 相同原图只存一份，全部引用解除后才释放 |
| NovelAI Key、助手与 Pixiv 凭据 | Android Keystore 硬件／系统加密 | 明文不落入普通网页存储 |
| 缩略图缓存 | WebP 与 IndexedDB | 默认上限 100 MB（可改 25／50 MB 或关闭），清理不影响原图 |
| Tag 词库与本地反推模型 | 按需下载至缓存目录 | 校验通过后生效，支持断点续传与单独删除（最小 ViT 模型约 378 MB） |

> **重要提醒：卸载 APK 会清除手机应用私有目录中的全部资料！**
> 卸载、换机或刷机前，请先在「全局设置 → 数据与维护」设置至少 8 位密码，导出加密的 `.naiatelier` 完整备份文件（含数据库、全部原图、设置、加密凭据与助手会话），并妥善保管密码。

作品默认导出位置支持「系统默认」（图片存入系统相册 `Pictures/NAI Atelier`，其他文件走系统保存面板）、「自定义文件夹」（持久目录授权）与「每次询问」。

## 平台能力差异

- **后台生图保活**：多张生成与队列任务启动 Android 前台服务与 CPU 唤醒锁，覆盖等待间隔、图像处理与落盘保存；若系统权限拒绝启动前台服务，会在提交前直接提示。
- **桌面专属能力边界**：创作助手的文件桥在 Android 上仅访问应用内 `/documents` 创作目录；Windows 剪贴板收集悬浮窗、本地画师大体积图包挂载、SillyTavern 本机目录桥接及 EXE 更新仅限电脑端使用。
- **外站连接**：Pixiv 登录通过系统浏览器与 `pixiv://account/login` 协议回调完成；AITag 列表请求复用系统 Chromium WebView 网络栈以兼容站点校验。

## 构建与模拟器回归

需准备 Node.js 22+、JDK 21+、Android SDK 36 与 Build Tools 36.0.0（设置 `JAVA_HOME` 与 `ANDROID_HOME`）：

```powershell
npm ci
npm run build:android          # 生成 release/NAI-Atelier-<版本>-android-arm64.apk
npm run build:android:debug    # 生成模拟器调试包

# 启动隔离模拟器（如 emulator-5556）后运行自动化回归，勿连接真实手机跑测试
$env:ANDROID_SERIAL = 'emulator-5556'
npm run test:android
```

首次正式打包会自动生成 `.android-build/atelier-release.jks` 与 `.android-build/signing.properties`——**请务必备份这两个签名文件**，丢失签名将导致后续构建的 APK 无法覆盖安装旧版。
