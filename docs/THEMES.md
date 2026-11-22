# 制作和分享设计主题

在「全局设置 → 外观与显示」可实时调整强调色、表面材质、明暗双版配色、工作区背景及玻璃光学细节；明暗模式、界面密度、圆角语言、字号、动效与图库展示开关为通用显示偏好，切换主题预设时保持不变（不因预设自带圆角或模式而突改）。「另存当前主题」新建预设，「保存修改」覆盖自定义预设；内置「Cupertino Liquid Glass」（新安装与恢复出厂默认的深色基准）与「NAI Atelier 默认」（经典实色）原件锁定，可另存副本或导出分享。给外部 AI 生成主题可直接复制 [THEME_AI_PROMPT.md](./THEME_AI_PROMPT.md)，界面交互约定见 [PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md)。

## 示例与基础结构

参考 [warm-paper.json](../public/themes/warm-paper.json) 或内置 [cupertino-liquid-glass.json](../public/themes/cupertino-liquid-glass.json)。新导出统一为 `version: 3`（兼容读取 v1／v2 及旧单对象／数组；未知版本、非法颜色或未知字段整份拒绝导入，重名自动加编号，不携带密钥、生图参数或列数偏好）：

```json
{
  "version": 3,
  "presets": [
    {
      "name": "我的主题",
      "accentColor": "#b96e2b",
      "themeMode": "system",
      "palette": {
        "light": { "canvas": "#f5ecdc", "panel": "#fffbf3", "text": "#3d3025" },
        "dark": { "canvas": "#211c19", "panel": "#352c25", "text": "#f5e8d3" }
      }
    }
  ]
}
```

## 顶层与配色字段（`presets[]`）

`name` 必填（≤30 字符），颜色须为六位十六进制（如 `#fff4dd`），其余缺省取默认值：

| 字段 | 允许值 | 默认值 |
| --- | --- | --- |
| `accentColor` | 六位十六进制颜色 | `#0d8bf2` |
| `themeMode` | `light`、`dark`、`system` | `system` |
| `density` | `comfortable`、`standard`、`compact` | `standard` |
| `corners` | `soft`、`standard`、`sharp` | `standard` |
| `surfaces` | `solid`、`translucent` | `solid` |
| `motion` | `full`、`reduced`、`off` | `full` |
| `fontScale` | `small`、`standard`、`large` | `standard` |
| `galleryFrostedCaption` | 布尔值（全图磨砂卡片） | `true` |
| `galleryHoverFloat` | 布尔值（卡片悬停浮动） | `true` |
| `gallerySelectionFocus` | 布尔值（选中作品聚焦） | `true` |
| `palette` | `{ light, dark }`，按需填写下方配色键 | 默认配色 |
| `details` | 高级外观对象，支持 `light`／`dark` 局部覆盖 | 跟随基础外观 |
| `background` | 旧版兼容单背景对象（本端覆盖按预设 ID × 明暗独立保存） | 无图片，用 `canvas` |

`palette.light` / `palette.dark` 可选键：`canvas`（工作区背景）、`sidebar`（侧栏）、`toolbar`（工具栏与导航）、`panel`（面板与中性控件基色）、`text`（主要文字）、`mutedText`（次要文字）、`border`（边框）。其余中性色阶与前景对比色自动派生。

## 工作区背景（`background`）

上传上限 20 MB，前端自动缩至最长边 ≤1920px、转无元数据 WebP（data URL ≤1,000,000 字符）。本端背景按「预设 ID × 明暗」独立保存，不计入主题修改状态、不随主题导出泄漏本地图片。

| 字段 | 允许值 | 缺省值 |
| --- | --- | --- |
| `image` | PNG／JPEG／WebP 的 base64 data URL，或内置 `/themes/wallpapers/cupertino-day.webp`、`/themes/wallpapers/cupertino-night.webp`（禁外链、SVG、脚本或 CSS） | 无 |
| `fit` | `cover`（铺满）、`contain`（完整显示）、`tile`（平铺） | `cover` |
| `opacity` | `0`～`1` 背景显示强度 | `1` |
| `tileSize` | `32`～`1024` 整数（平铺单元像素宽） | `128` |

## 高级外观字段（`details`）

所有数值使用纯 JSON 数字（不带单位字符串）；顶层为共用值，`details.light`／`details.dark` 可按明暗覆盖数值字段与 `accentColor`（字体、材质、控件风格与动画曲线保持共用）：

| 字段 | 范围／允许值 | 单位与作用 |
| --- | --- | --- |
| `fontFamily` | 本机字体名列表（≤220 字符，禁 URL／CSS 语句） | 如 `system-ui, sans-serif` |
| `fontSize` | `14`～`20`（参考 `16`） | px，根字号（`fontScale` 在其上按 15/16、1、17/16 缩放） |
| `strongWeight` | `400`～`800`（参考 `600`） | 半粗体基准，粗体／特粗体递增 100／200（上限 900） |
| `lineHeight` | `1.2`～`1.8`（参考 `1.5`） | 正文行高 |
| `letterSpacing` | `-0.04`～`0.08`（参考 `0`） | em，字间距 |
| `iconStroke` | `1`～`2.5`（参考 `1.8`） | Lucide 图标线宽 |
| `controlHeight` | `32`～`48`（参考 `40`） | px，共用单行控件高度（触屏底线 44px，`density` 按 0.9/1/1.1 缩放） |
| `controlRadius` | `0`～`999`（参考 `12`） | px，按钮与单行控件圆角（导航项 ≤14px） |
| `panelRadius` | `0`～`36`（参考 `16`） | px，面板与弹窗圆角 |
| `cardRadius` | `0`～`32`（参考 `16`） | px，图片卡片圆角（多行输入 ≤16px） |
| `spacing` | `0.2`～`0.3`（参考 `0.25`） | rem，间距基准 |
| `toolbarHeight` | `44`～`72`（参考 `56`） | px，顶栏基准高度 |
| `chromeInset` | `0`～`16`（参考 `0`） | px，桌面玻璃侧栏／顶栏外留边 |
| `material` | `frosted`、`glass` | 磨砂或带高光／边缘折射／追光的液态玻璃（仅 `surfaces: "translucent"` 生效） |
| `blur` | `0`～`40`（参考 `22`） | px，背景模糊半径 |
| `saturation` | `100`～`200`（参考 `130`） | %，背景饱和度 |
| `opacity` | `0`～`1`（参考 `0.85`） | 默认表面不透明度 |
| `globalOpacity` | `0`～`1`（可选） | 全局不透明度覆盖（不影响文字／作品像素及独立的实验室编辑面） |
| `sidebarOpacity`、`toolbarOpacity`、`panelOpacity` | `0`～`1` | 侧栏、顶栏、弹窗独立不透明度，缺省继承 `opacity` |
| `labEditorOpacity` | `0`～`1` | 实验室左侧独立编辑模块不透明度（支持明暗覆盖） |
| `borderOpacity` | `0`～`1` | 边框强度 |
| `controlShadow` | `0`～`1` | 填充式按钮阴影强度 |
| `controlStyle` | `outlined`、`filled` | 描边或柔和填充控件风格 |
| `highlight` | `0`～`1`（参考 `0.5`） | 玻璃顶缘高光与交互反光强度 |
| `shadow` | `0`～`2`（参考 `1`） | 面板与导航阴影强度 |
| `refraction` | `0`～`24`（参考 `0`） | px，SVG 背景边缘折射位移（作品与画布像素不参与折射） |
| `duration` | `100`～`400`（参考 `180`） | ms，过渡时长（减少／关闭动效优先停用） |
| `motionCurve` | `smooth`、`spring` | 过渡曲线 |

*注：修改基础圆角会清除高级三项圆角覆盖；修改基础强调色会清除明暗版本强调色覆盖。*

## 材质层级与共享存储约定

- **材质语义分工**：全局背景在底层统一铺设并柔化；半透明主题下主页面内容滚入顶栏背后（由 `WorkspaceChrome` 测量高度留白）。实验室左侧各 `lab-module-section` 为独立玻璃面板（受 `labEditorOpacity` 独立控制），右侧预览透出背景不画棋盘格。通用内容分组用 `appearance-group`／`appearance-surface`（嵌套内层仅薄填充、不叠双层模糊），独立菜单／抽屉／浮层用 `appearance-panel appearance-overlay`／`appearance-popover`（至少保留 82% 阅读承托），图片与画布衬底标 `appearance-media`，高对比提示标 `appearance-contrast`。Windows 收集小窗同步当前主题材质与压缩壁纸副本在单 WPF 窗口内存合成，不取样桌面。
- **共享存储**：主题库保存在当前工坊 `settings` 表（`appearance_preset_v1:`），同工坊桌面与局域网手机共享列表，当前选用主题与未保存修改按设备独立；旧浏览器本地主题首次打开设置时幂等合入，独立 Android 使用自身工坊库。
