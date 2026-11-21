# 酒馆同步扩展 (npm-bridge)

连接 **SillyTavern**（自动识别已启用的 `st-chatu8` 智慧姬、`ST-BaiBai-Image` 柏宝绘或两者同时使用）与 **NAI Atelier** 的配套浏览器扩展：

- **精选风格串与配图互通**：接收工坊「待同步」队列中勾选的 V4.5／V5 风格串与封面（SHA-256 去重），并将酒馆中的风格串同步回工坊；还在 `st-chatu8` 预设弹窗中注入了「有配图」筛选开关。
- **Vibe 与分组互通**：双向同步 Vibe 编码、强度与分组（柏宝绘的扁平分组名自动映射为工坊 Vibe 组）。
- **生图历史零拷贝接入**：工坊自动索引酒馆原图路径（如未安装在常见路径，可在工坊设置中绑定或通过环境变量 `SILLY_TAVERN_ROOT` 指定酒馆根目录），无需复制图片文件。
- **柏宝绘写回保护**：因柏宝绘在启动时将配置缓存于前端内存，后台自动同步对柏宝绘保持只读接收；仅在你于扩展面板手动点击 **「立即同步」** 时写回画师串与 Vibe，并在写入后提示刷新 SillyTavern 页面使其生效。

## 安装方式

- **工坊内一键安装（推荐）**：在 NAI Atelier「全局设置 → 数据与维护」中开启「智慧姬同步」或「柏宝绘同步」，确认酒馆目录（支持原生 SillyTavern 与 TauriTavern 标准／便携／自定义数据目录）后点击 **「一键安装 / 更新扩展」**。
- **手动安装**：
  - **原生 SillyTavern**：将本目录放入 `SillyTavern/public/scripts/extensions/third-party/npm-bridge/`；
  - **TauriTavern**：将本目录放入 `<data_root>/default-user/extensions/npm-bridge/`（Windows 标准安装版默认在 `%APPDATA%\com.tauritavern.client\data\default-user\extensions\npm-bridge\`）。

## 使用说明

1. 安装或更新扩展后，**刷新 SillyTavern 网页**。
2. 打开酒馆右上角「扩展（积木图标）」面板，展开同步面板：
   - **服务地址 (Base URL)**：默认 `http://localhost:3000`，若工坊使用其他端口或局域网地址请对应修改并保存；
   - **自动同步**：开启后在页面加载、窗口切回前台及预设变更时自动同步（柏宝绘自动同步仅做只读接收）；
   - **立即同步**：手动拉取工坊待同步任务并回报落盘结果（写入柏宝绘配置后按提示刷新酒馆页面即可生效）。
