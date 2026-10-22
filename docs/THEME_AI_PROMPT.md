# 交给其他 AI 的主题制作提示词

将以下整段复制给负责设计主题的 AI。它应交付可导入的 JSON；项目已有内置 Cupertino Liquid Glass，本提示词用于制作其他可导入的主题副本。完整参数说明见 [THEMES.md](./THEMES.md)。

```text
请为 NAI Atelier 制作一套高还原的苹果 UI 风格主题，以现代 macOS / iOS 的精致排版、层次和 Liquid Glass 导航材质为方向。最终产物必须是我能直接导入程序的 JSON 主题文件，而不是效果图、网页、CSS 或修改源码。

设计目标：
1. 这是一款 Windows / Android 上使用的本地图片创作工具，作品和 Prompt 是主体。请保持紧凑、清晰、安静，精致程度来自字重、灰阶、圆角、间距、高光和阴影的配合。
2. 给同一主题提供完整浅色和深色配色，themeMode 使用 system。浅色应通透、柔和而不发灰，深色应有表面层级而非一片纯黑。两种模式的正文、次要文字、输入框与强调色都要可读；正文和面板至少以 4.5:1 对比度为设计目标。
3. Liquid Glass 主要位于导航、工具栏、侧栏和操作层，内容卡片与原图应保持清晰。用克制的边缘高光、背景模糊、轻微折射和阴影形成真实层次，避免满屏玻璃、强发光、厚重阴影、过饱和渐变和装饰性动画。玻璃基色使用中性灰阶，让它透出实际背景的冷暖，不靠固定染蓝制造玻璃感。
4. 使用协调的按钮胶囊、面板／卡片圆角、细线图标、合理字阶和适度回弹。桌面保持紧凑；手机由引擎保持至少 44px 的共用控件高度及安全区。不要将苹果桌面窗口、菜单栏或 Dock 当作装饰添加。
5. 若能联网，先参考 Apple Human Interface Guidelines 的 Materials、Layout、Buttons 和 WWDC25 Meet Liquid Glass，使用苹果官方资料辨认视觉语言。主题仍应适配本工具的真实控件与空间，不改变业务流程。

交付规则：
- 只输出一个完整、有效的 JSON 对象，不加 Markdown 围栏、说明、注释或尾逗号。
- 根对象只能是 {"version":3,"presets":[主题对象]}，presets 中恰好一套主题；名称不超过 30 个字符。
- 不输出 id、createdAt、isBuiltin、designTheme 或任何未列出的字段。导入器拒绝未知字段；不要猜测不存在的选项。
- 请认真选择每个设计值；下面是格式约束和范围，不是让你照抄某个现成主题。配色的每个字段都请填写，details 中请填写能体现设计的参数。

主题对象字段：
name: 你命名的主题名称，字符串。
accentColor: 六位十六进制色，如 #123456；自行选择符合设计的强调色。
themeMode: "system"。
density: "standard"、"compact" 或 "comfortable"。
corners: "standard"、"soft" 或 "sharp"。
surfaces: 使用玻璃时为 "translucent"，实色为 "solid"。
motion: "full"、"reduced" 或 "off"。
fontScale: "standard"、"small" 或 "large"。
galleryFrostedCaption: 布尔值，图片底部叠放渐变磨砂信息栏。
galleryHoverFloat: 布尔值，允许鼠标悬停时卡片轻抬。
gallerySelectionFocus: 布尔值，选择后淡化其他卡片并聚焦。
palette: {"light":{配色字段},"dark":{配色字段}}。
details: {高级参数}。
background: 可省略；旧格式兼容字段，只有用户提供实际图片数据时才填写 {image:"data:image/png;base64,...",fit:"cover"|"contain"|"tile",opacity:0～1,tileSize:32～1024整数}。也接受 JPEG／WebP 的 data URL，最大 1,000,000 字符；不得编造 base64 或添加远程地址。当前设置中的图片按预设 ID 与浅色／深色独立保存在本端，重新应用预设不会覆盖，也不进入主题保存和导出；旧文件的 background 继续作为兼容回退并往返导出。

light 和 dark 各自包含且仅包含下列七个六位十六进制颜色：
canvas: 工作区背景。
sidebar: 侧栏基色。
toolbar: 工具栏与导航基色。
panel: 面板、弹层和中性控件的表面基色。
text: 正文／主要文字。
mutedText: 次要文字。
border: 边框基色。
其余中性色阶由引擎派生；强调色上的前景自动选取。保存绿色、危险红色、来源／分类色保留原语义，不能通过主题改写。

details 支持下列字段。所有数字用不带单位的 JSON 数值，不能使用 null、带 px 的字符串或超范围值：
fontFamily: 本机字体名称及回退列表，最多 220 字符；只允许文字、数字、空格、逗号、单／双引号、下划线和连字符。只能使用已安装字体；可以将 -apple-system、BlinkMacSystemFont 放在回退栈前面，但必须为 Windows 和中文给出可靠回退，例如 Segoe UI、Microsoft YaHei UI、system-ui、sans-serif。不下载或嵌入 Apple 字体。
fontSize: 14～20，px 根字号，现有 rem 字阶同步变化。
strongWeight: 400～800，标题／强调字重，覆盖 semibold、bold、extrabold。
lineHeight: 1.2～1.8，正文继承行高。
letterSpacing: -0.04～0.08，em 字间距。
iconStroke: 1～2.5，现有 Lucide 图标线宽。
controlHeight: 32～48，px 共用控件高度。
controlRadius: 0～999，px 控件圆角，999 可形成胶囊；导航条目圆角最多 14px，图上圆形操作保留原形。
panelRadius: 0～36，px 公共面板和窗口圆角。
cardRadius: 0～32，px 媒体卡片圆角，多行输入圆角最多 16px。
spacing: 0.2～0.3，rem 间距基准，普通基准为 0.25。
toolbarHeight: 44～72，px 共用工具栏高度基准。
chromeInset: 0～16，px 桌面玻璃侧栏／工具栏外留边；手机导航另有固定安全留边。
material: "frosted" 或 "glass"；玻璃效果请选择 "glass"，并配合 surfaces: "translucent"。
blur: 0～40，px 背景模糊。
saturation: 100～200，% 背景饱和度。
opacity: 0～1，表面不透明度，1 完全不透明；过高会挡住折射，过低须检查文字对比度。
globalOpacity: 0～1，可选全局不透明度，统一覆盖通用表面的分层值，嵌套填充按比例变薄；实验室编辑面仍单独使用 labEditorOpacity。支持共用／明暗覆盖，不设置则沿用旧分层值；不可通过 CSS opacity 让文字和作品一起变淡。
sidebarOpacity / toolbarOpacity / panelOpacity: 各 0～1，分别控制侧栏、工具栏、弹窗，未填继承 opacity。
labEditorOpacity: 0～1，独立控制实验室左侧连续编辑面，支持共用与 light/dark 覆盖；缺省深色 0.6、浅色为有效 panelOpacity / opacity 的一半。设置中使用百分比滑条，不改变侧栏、工具栏或右侧预览。
borderOpacity: 0～1，边框强度。
controlShadow: 0～1，填充式中性按钮阴影强度。
controlStyle: "outlined" 或 "filled"；后者提供柔和填充按钮、分段选择与清晰的导航选中态。
highlight: 0～1，玻璃边缘高光强度。
shadow: 0～2，公共面板和玻璃导航的阴影强度。
refraction: 0～24，px 背景边缘位移，0 关闭。共用工具栏和锚定菜单按实际尺寸／圆角生成折射边缘；克制使用，部分浏览器只显示普通玻璃模糊。
duration: 100～400，ms 共用控件过渡与窗口入场时长。
motionCurve: "smooth" 或 "spring"，后者是轻微回弹的三次贝塞尔曲线。

参数关系和实现边界：
- details 顶层是共用值；details.light 和 details.dark 可逐字段覆盖上述数字参数及 accentColor（六位颜色）。未填继承共用值；fontFamily、material、controlStyle、motionCurve 只在顶层填写。不支持逐组件 CSS。
- fontScale 为 small / standard / large 时，在 fontSize 上分别乘 15/16、1、17/16；density 为 compact / standard / comfortable 时，在 spacing、controlHeight、toolbarHeight 上分别乘 0.9、1、1.1。请避免重复压缩造成过小文字和拥挤控件。
- surfaces: solid 关闭玻璃；减少／关闭动效、系统减少动效和减少透明度优先。鼠标光照和按压缩放只在完整动效与鼠标条件下启用；追光仅用于中性按钮的小范围反光及侧栏／工具栏的弱反射，大面板与内容区不追光。
- 折射只处理导航／公共浮层下的背景，不改变作品或 Canvas 像素。设置和操作窗口内部避免多重叠加玻璃。
- 不支持任意 CSS、脚本、远程字体／图片、替换布局、添加系统装饰、SF Symbols、原生 Apple 连续曲率和私有材质算法。请在已有参数中达到最高还原，不虚构能力，不输出需要额外编码才能生效的字段。
- Windows 收集小窗沿用当前侧栏的明暗底色、透明度、面板／控件圆角、边线、顶缘及四边反光；Windows Composition 使用设置中的 blur、saturation、refraction 处理真实窗口背景，圆角边缘法线与侧栏同源，清晰前景独立合成。不另存小窗外观参数；修改设置实时同步，实色模式释放效果树。不支持或关闭透明时保留实色回退。

在输出前内部核对：JSON 可解析、version 为 3、仅一套主题、字段名和枚举准确、所有数值在范围内、两套配色完整、字体回退合理、文字对比度足够、玻璃与内容分层明确。然后只给最终 JSON。
```
