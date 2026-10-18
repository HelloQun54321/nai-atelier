# macOS 版

macOS 版与 Windows 安装版共用同一套桌面壳与本地后台（Electron + 内置 Node + workerd），面向 macOS 12 及以上，Apple Silicon（arm64）为主，Intel Mac 可在本机自行构建 x64 版。内置的 Node、workerd、sharp、ONNX Runtime 与 esbuild 均为对应架构的原生二进制，不经过 Rosetta 转译。

## 安装与首次打开

1. 从发布页下载 `NAI-Atelier-<版本>-mac-arm64.dmg`（或同名 `.zip`）及对应 `.sha256`；
2. 打开 DMG，把 **NAI Atelier** 拖入「应用程序」；
3. 应用未做 Apple 开发者签名与公证，仅为 ad-hoc 签名。首次打开任选一种方式放行：
   - 在「应用程序」中**按住 Control 点按（或右键）→ 打开**，在弹窗中再点「打开」；macOS 15 起若无「打开」按钮，先双击一次，再到「系统设置 → 隐私与安全性」点「仍要打开」；
   - 或在终端执行：

     ```bash
     xattr -cr "/Applications/NAI Atelier.app"
     ```

放行只需一次，之后像普通应用一样从启动台或程序坞打开。

## 程序与个人数据

- 个人数据位于 `~/Library/Application Support/NAI Atelier/workspace`（`local-data` 为唯一事实源），与应用本体分离；删除或替换 `NAI Atelier.app` 不影响数据。
- 更新：设置页「应用更新」检查已发布版本并给出下载页；未签名应用不能由系统自动替换，下载新版后拖入「应用程序」覆盖即可，个人数据保留。
- 备份默认写入「文稿/NAI Atelier Backups」；存储位置、导出目录与画师图包使用系统原生的文件夹／文件选择面板。

## macOS 专属体验

- 原生红绿灯标题栏：内容延伸到标题栏，侧栏顶部与页面顶栏空白处可拖动窗口；弹窗或菜单打开时暂停拖拽区，避免挡住按钮；全屏时自动收回标题栏留白。
- 菜单栏：应用菜单（关于、设置… ⌘,、服务、隐藏、退出 ⌘Q）、文件（打开数据目录、启动日志、关闭窗口 ⌘W）、编辑（撤销、剪切、复制、粘贴、全选、查找 ⌘F）、视图、窗口、帮助。界面中的快捷键提示在 Apple 键盘上显示为 ⌘。
- 关闭窗口不退出：后台继续为手机局域网提供服务，点程序坞图标即可回到原窗口；⌘Q 才停止后台。程序坞菜单提供「打开工坊」「打开数据目录」。
- 程序坞图标显示批量生成进度，任务全部完成且窗口不在前台时轻跳提醒；风格串收集模式在程序坞角标显示已保存数量。
- 明暗跟随系统；在应用内选择浅色／深色时，系统文件面板与菜单同步切换。
- 系统代理：未设置 `HTTPS_PROXY`／`HTTP_PROXY` 时读取「系统设置 → 网络 → 代理」中已启用的 HTTPS／HTTP 代理（`scutil --proxy`）。
- 风格串收集模式：常驻 JXA 进程比对剪贴板变化计数，只把通过图片直链过滤的复制交给工坊，带图片或文件的复制直接忽略，不建立剪贴板历史；没有 Windows 的置顶状态窗，进度显示在收集按钮与程序坞角标。
- Pixiv 网页登录：应用包登记 `pixiv://` 协议，登录完成后由系统回调到应用，自动完成授权。
- 桌面快捷方式只属于 Windows；macOS 安装版不显示该设置节。

## 从公开代码构建

在 Apple Silicon（或 Intel）Mac、Node 24 与 npm 环境运行：

```bash
npm ci
npm run build:desktop        # 生成 dmg 与 zip
npm run build:desktop:dir    # 只生成可直接双击的 release/mac-arm64/NAI Atelier.app
```

- 构建按本机平台与架构选择目标：下载官方 `node-v<版本>-darwin-<arch>.tar.gz` 并按官方 SHA-256 清单校验，只解出 `bin/node` 与许可证；ONNX Runtime 只保留 `darwin/<arch>`；sharp 与 workerd 由 npm 按本机平台安装。
- 运行依赖使用 `--no-bin-links` 安装，避免 `.bin` 符号链接进入分发包（分发审计不接受符号链接）。
- 图标由 `scripts/generate-mac-icon.mjs` 按 macOS 图标网格从同一图形生成，含 16～1024px 全部 Retina 尺寸，经系统 `iconutil` 打包为 `.icns`。
- 不做 Developer ID 签名与公证：`mac.identity` 为 `'-'`（ad-hoc），`hardenedRuntime` 关闭。如需正式分发，可改为开发者证书并开启公证。
- 发布验证可复用自检：`NAI_DESKTOP_DATA_DIR=<临时目录> NAI_DESKTOP_SELF_TEST=<临时目录>/result.json "release/mac-arm64/NAI Atelier.app/Contents/MacOS/NAI Atelier"`，渲染出侧栏与设置按钮后写出结果与截图并退出。

## 已知限制

- 未签名，首次打开需按上文放行；也因此不提供应用内自动安装更新。
- 本地 Worker 运行在 `wrangler pages dev` 中，其内部开发服务器默认以 esbuild 轮询监听打包产物，空闲时约占单核几个百分点；当前 Wrangler 没有关闭该监听的参数。
