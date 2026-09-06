# SillyTavern — NAI Atelier 连接器扩展 (npm-bridge)

本扩展用于在 **SillyTavern**（配合 `st-chatu8` 扩展）与 **NAI Atelier** 之间建立双向数据同步。

---

## 核心功能

1. **画师串与配图双向互通**：
   - 自动在 NAI Atelier 的风格串与 st-chatu8 的画师预设之间同步；
   - 自动同步画师卡片封面配图（采用 SHA-256 内容哈希去重，杜绝重复写入，自动清理旧文件）；
   - 在 st-chatu8 的预设选择弹窗中注入“有配图”筛选浮层。
2. **Vibe 风格与组合同步**：
   - 双向同步 NovelAI Vibe Transfer 数据文件及强度设置；
   - 自动同步 Vibe 预设组合。
3. **生图历史无缝接入**：
   - 将 st-chatu8 生成的原图自动接入 NAI Atelier 的生成历史库，无需复制图片文件，零占用额外磁盘。

---

## 安装方法

### 方式一：直接复制目录
将本目录（`npm-bridge/`）完整复制到你的 SillyTavern 扩展目录下：
```
SillyTavern/public/scripts/extensions/third-party/npm-bridge/
```
目录结构如下：
```
SillyTavern/
└── public/
    └── scripts/
        └── extensions/
            └── third-party/
                └── npm-bridge/
                    ├── manifest.json
                    ├── index.js
                    ├── style.css
                    └── README.md
```

### 方式二：从 NAI Atelier 一键安装或导出
在 NAI Atelier 的「全局设置」→「数据与维护」→「SillyTavern 互通扩展」中：
* 填写酒馆安装根目录后点击 **“一键安装 / 更新扩展”**，系统将自动写入到上述目录；
* 或者点击 **“选择目录导出”** / **“下载 ZIP 扩展包”** 手动导出到对应目录。

---

## 使用与配置

1. 安装完成后，**刷新或重新打开 SillyTavern 网页**。
2. 点击右上角扩展按钮（积木图标），进入扩展设置面板，找到 **`NAI Atelier 连接器`**：
   - **服务地址 (Base URL)**：填入你的 NAI Atelier 访问地址（默认：`http://localhost:3000`）。若部署在自定义端口或局域网，直接在此修改保存即可；
   - **自动同步**：勾选后，将在启动、窗口获得焦点以及画师串修改后自动同步；
   - **立即同步**：点击即可手动执行一次全量同步。

---

## 常见问题与注意事项

* **依赖说明**：本扩展需要 SillyTavern 已安装并启用 `st-chatu8` 扩展。
* **生图历史读取路径**：NAI Atelier 服务端会自动在探测到的 SillyTavern 路径、`D:\SillyTavern`、`../SillyTavern` 以及环境变量 `SILLY_TAVERN_ROOT` 指定的位置寻找 SillyTavern 的数据文件。如果你的 SillyTavern 安装在非标准目录，请设置环境变量 `SILLY_TAVERN_ROOT` 指向该目录。
