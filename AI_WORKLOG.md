# AI 工作日志

记录每次由 AI 工具执行的项目修改：模型名、日期与所做工作，规则见 `AGENTS.md`。日期节按时间倒序排列，最新记录在最上方；同一天内新条目排上方。

本日志自 2026-08-22 启用；此前的项目修改没有留存 AI 记录，历史改动请查阅 git 提交历史与 `CHANGELOG.md`。

## 2026-08-27
- **qianlian/deepseek-v4-flash-0731**：修复官方常量同步临时失效（琥珀圆点）—— 根因为 TUN 出口抖动引发 chunk 部分抓取失败,同步改走网关代理分流并验证 health 恢复（fix: route official runtime sync through gateway proxy to avoid TUN black-hole partial fetches）。
- **qianlian/deepseek-v4-flash-0731**：启动窗口日志静音——过滤 wrangler 高频请求日志;弃用实测会拖慢启动 25 倍的 --log-level warn 方案（fix: quiet wrangler request logs via output filtering）。
- **Gemini (Flash)**：设置中新增本地数据备份功能，支持异步将 local-data 备份至指定目录、实时进度反馈、历史备份扫描与唤起资源管理器打开目录（feat: add local data backup management with async progress and explorer integration）。
- **qianlian/deepseek-v4-flash-0731**：标注数据边界——AGENTS.md 新增保护区强制节（local-data 禁删禁改、database_id 为存储键）、README 补 local-data 内部构成清单、.gitignore 补性质注释（docs: mark data boundaries and local-data inventory as do-not-delete）。
- **qianlian/deepseek-v4-flash-0731**：修复“启动后数据消失”事故 —— database_id 是本地 D1 存储键的一部分,此前误删导致加载空库;已恢复 ID 并验证全部数据回归,删除误生成空库文件（fix: restore d1 database_id to keep local store mapping stable）。
- **qianlian/deepseek-v4-flash-0731**：移除上游多用户与云端遗留——sessions 表、users 配额列、ROLE_POLICY、admin 管理路由死代码,auth/me 收窄,并查明 pages dev 直接使用 dist/_worker.js 的加载机制（refactor: remove upstream multi-user remnants from worker database layer）。
- **qianlian/deepseek-v4-flash-0731**：修复本地启动偶发卡死 —— 为 wrangler 注入快速失败代理跳过启动期外连检查，网关出站代理在 TUN 系统代理失效时改用本机真实端口（fix: prevent wrangler startup hang by fast-failing outbound check when the system proxy is black-holed）。
- **qianlian/deepseek-v4-flash-0731**：本地启动提速 —— 历史缩略图预热延迟 35 秒且用户浏览时让行、前端静态资源改由网关直出、启动时清理过期 Wrangler 临时目录（perf: speed up local startup by deferring history prewarm, serving static assets from the gateway, and cleaning stale wrangler temp dirs）。
- **Gemini (Flash)**：修复 Pixiv 收藏 400 状态平滑兼容、移除顶栏冗余搜索 Tab、修复 Danbooru 抽卡漫游 500 报错与高级搜索符号支持（fix: handle pixiv bookmark already bookmarked state, remove redundant search tab, and fix danbooru random pagination 500 error with advanced query symbols）。

- **Gemini (Flash)**：修复画廊独立审计缺陷：足迹翻页语义对齐、存储异常内存态同步、随机抽卡抖动与画师直达守卫（fix: align gallery history page count, sync storage quota cache, jitter random gacha, and add author id guard）。

- **Gemini (Flash)**：Danbooru 与 Pixiv 图库全生态升级：多维筛选排序、Pixiv 个人资产联动（关注/收藏/点赞）、全套排行榜体系（含AI专榜与日期穿越）与相关作品推荐（feat: comprehensive Danbooru and Pixiv gallery upgrade with personal asset sync, ranking explorer, multi-dimensional filters and related works）。

- **Gemini (Flash)**：解除 Danbooru 与角色库封面的 Safebooru 全年龄限制，接入 Danbooru 官方全库与多级候选兜底（refactor: switch Danbooru endpoint to main site and remove rating:g restriction with candidate fallback）。

- **Gemini (Flash)**：文件夹批量导入查重规则改为纯提示词识别，排除尺寸/步数/模型/种子等非提示词参数干扰（refactor: refine batch import fingerprint to match purely on prompts）。

- **Gemini (Flash)**：文件夹批量导入查重指纹排除随机种子维度，确保预设清空或修改种子后依然能被准确识别为同一预设（fix: exclude seed from batch import fingerprint to prevent false duplication on seed change）。

- **Gemini (Flash)**：全局设置新增「强制清空随机种子（始终随机）」模式，支持非破坏性临时置空种子并在关闭后完整恢复（feat: add force empty seed preference to global settings with non-destructive restore）。

- **Gemini (Flash)**：修复风格串常规保存时自动覆盖已有封面的问题，保护既有封面并限定仅在无封面时自动设置初始封面（fix: preserve existing chain cover on general save and only auto-set cover when none exists）。

- **Gemini (Flash)**：修复元数据解析时普通 V5 非透明图片因存在 straight_alpha 字段被误开启透明背景开关的问题（fix: prevent v5 non-transparent metadata from mistakenly enabling transparent background）。

- **Gemini (Flash)**：为文件夹批量导入增加内容指纹智能去重机制，自动识别并排除已入库的重复预设（feat: add generation fingerprint deduplication to folder batch import）。

- **Gemini (Flash)**：支持从本地文件夹批量读取原图为风格串，智能识别 NovelAI 元数据并直出封面，引入「待实测」状态与生成后自动销标闭环（feat: add folder batch import to style chains with untested tag lifecycle）。

## 2026-08-26
- **Gemini (Flash)**：全面重构与净化前端文案体系，消除底层字段/Git/SaaS技术术语泄露，统一全局资产/提示词/模式概念，精简冗余操作说明（refactor: overhaul user-facing copywriting and unify terminology across frontend）。

- **Gemini (Flash)**：将实验室角色参考与 Vibe 氛围参考从全屏覆盖层重构为精致居中模态大弹窗，支持磨砂遮罩透光、点击外部/ESC关闭与底部快捷应用（refactor: convert character reference and vibe managers from full-screen overlays to centered modal dialogs）。

- **Gemini (Flash)**：建立全局视口层叠 Z-Index 六级阶梯体系（收敛至 z-[900/1100/1250/1500/1800/2000]），并全面收敛卡片/弹窗/控件的 Design Token 边框与圆角规范（style: unify z-index stacking hierarchy and standardize design tokens across all components）。

- **Gemini (Flash)**：重塑侧栏为现代连贯纵向立柱（移除 Logo 下方多余横线）并将主工作区顶栏恢复至精炼干练的 56px（style: adopt modern seamless vertical rail sidebar and restore 56px workspace toolbar）。

- **Gemini (Flash)**：从底层 CSS 变量 `--workspace-toolbar-height` 同步左右顶栏高度为 64px 并给侧栏头部绑定 workspace-command-bar 类，彻底消除 8px 水平断阶（style: sync sidebar header with workspace-toolbar-height variable at 64px）。

- **Gemini (Flash)**：统一定义全局工作区顶栏与指令条高度为 h-16（64px），与侧边栏标题栏严格对齐消除 8px 水平断阶（style: align workspace toolbar height with sidebar header at 64px）。

- **Gemini (Flash)**：优化主题导入与导出按钮图标为语义无歧义的 FolderInput（装入）与 FolderOutput（输出）（style: update theme import and export icons to FolderInput and FolderOutput）。

- **Gemini (Flash)**：将外观预设管理能力直接融合进设置顶层「设计主题」区域，所有预设均以界面骨架卡片统一呈现，移除多余的独立预设块（refactor: unify theme preset management into main design theme section）。

- **Gemini (Flash)**：新增外观与主题预设管理系统——支持将当前外观配置保存为新预设、一键切换、JSON 导入/导出、重命名与删除，并锁定出厂默认预设（feat: add appearance preset management with json import export and builtin lock）。

- **Gemini (Flash)**：将默认主题强调色由偏紫的靛蓝（#6366f1）调整为预设选项中的晴空蓝（#0ea5e9），并在设置面板中排在预设首位（style: set default accent color to sky blue preset）。

- **Gemini (Flash)**：修复本地服务启动时内部 Worker 端口冲突导致 workerd 抛出 std::terminate 异常崩溃的问题——自动探测可用端口并与网关动态同步（fix: dynamically resolve available worker port on local startup）。

- **Gemini (Flash)**：全面重构默认主题 NAI Atelier 黑夜模式——将底色升级为沉静石墨灰、拉开侧栏与卡片表面明度差建立清晰立体层级、对自定义强调色实施暗色自适应音调映射（消除荧光蓝眩光刺眼感）、升级安全模式暗色磨砂遮罩质感（style: redesign default dark mode theme tokens and visual contrast）。

- **Claude (Sonnet)**：AITag 画廊过滤掉首图没有有效 prompt（无 prompt_text）的作品——列表加载/搜索/缓存/滚动追加统一按 `hasAitagImagePrompt`（与 `extractAitagPrompt` 同一提取顺序）过滤，详情面板同步过滤无 prompt 图片、预览壳直接跳过，整页被过滤时追加流自动连拉后续分页填补空白，并补充 extractAitagPrompt/hasAitagImagePrompt 定向单测（fix: filter aitag works without valid prompt）。

- **Gemini (Flash)**：修复实验室切换 V5 模型时步数仍停留 28 的问题——旧会话「V5 模型 + 28 步」过期组合在 V5 系列内部切换或重选时不再卡住，改为按目标模型判断的稳健步数规则（默认值 23/28 自动跟随、自定义值保留），`LAB_DEFAULT_PARAMS` 步数改由默认模型推导，并补充 naiModels 与 ChainEditorParams 单测（fix: ensure v5 model switch correctly updates default steps to 23）。

- **Gemini (Flash)**：为实验室模型切换增加步数自适应逻辑（V5 系列默认 23 步，其他 28 步，保留自定义步数与外部导入元数据），并补充单测（feat: adapt default steps on model switch to 23 for v5）。

- **Gemini (Flash)**：彻底统一正面提示词为纯净单框输入流，移除 splitPromptFields 偏好设置及相关双框状态与导入拆分逻辑（refactor: unify prompt input to single field and remove splitPromptFields）。

- **Gemini (Flash)**：移除实验室提示词输入区域中冗余过时的「提示词模块」组件与对应文件，消除视觉噪音与过度设计（refactor: remove legacy prompt modules component from lab editor）。

- **Gemini (Flash)**：将实验室折叠栏重构为一体化手风琴卡片，并剥离参数设置、角色专属提示词、Vibe 与图片编辑模块内的冗余嵌套外框与边距，消除视觉断层与多层套框（style: integrate laboratory accordion card and strip nested module borders）。

- **Gemini (Flash)**：消除实验室各功能模块（参数设置、角色专属提示词、提示词输入、负面提示词、图片编辑）在 LabModuleSection 折叠栏与内层卡片间的同名重复标题，精简纵向空间（style: deduplicate laboratory module headers and card titles）。

- **Gemini (Flash)**：优化 ChainEditorParams 布局结构，将生成模型与图片尺寸对称平分，自定义分辨率改为全宽展开卡片，采样器/步数/Seed 恢复干净 3 列栅格，消除视觉高低失衡（style: optimize chain editor params grid and custom resolution card）。

- **Gemini (Flash)**：为风格串与角色串新增设为封面/上传封面时自动保存全部改动的功能，消除更换封面后的二次保存负担（feat: auto-save chain on cover update）。


- **Gemini (Flash)**：优化 AITag 页面在模型筛选（如 V5）时的瀑布流加载机制，增加自适应多页自动批拉填充（凑满 15 张目标增量或最多连拉 4 页），消除稀疏命中时的串行等待（perf: auto-fill batches on sparse aitag model filter）。

- **DeepSeek (V4 Flash)**：将 ChainEditor 巨石组件（2849 行）拆分为 components/chain 下 6 个模块化子组件（Header/PromptInputs/Modules/Characters/PresetModal/ForkModal），共享展示件与 PromptAgentOverlayController 移入 PresetSourceBadges.tsx，主组件瘦身为编排器，纯结构重构行为不变，tsc、191 个前端测试与 130 个 gateway 测试全部通过（refactor: split ChainEditor monolith into modular chain subcomponents）。
- **DeepSeek (V4 Flash)**：将生图实验室重置按钮的作用域严格限定为当前激活的页面——文生图仅重置提示词/模块/参数与预设来源徽章，图生图/局部重绘/扩图仅清空当前模式的底图、蒙版与草稿，并补充默认参数常量与重置定向单测（fix: scope laboratory reset to active mode）。

- **DeepSeek (V4 Flash)**：将生图实验室重置按钮的作用域严格限定为当前激活的页面——文生图仅重置提示词/模块/参数与预设来源徽章，图生图/局部重绘/扩图仅清空当前模式的底图、蒙版与草稿，并补充默认参数常量与重置定向单测（fix: scope laboratory reset to active mode）。
- **DeepSeek (V4 Flash)**：将 Worker 后端 4481 行超级文件按业务域拆分为 8 个路由模块（settings/history/vibe/aitag/danbooru/stBridge/pixiv/types），`worker/index.ts` 精简至约 200 行仅保留初始化、CORS、错误捕获与按原顺序分发，纯结构重构行为不变，130 个 gateway 测试与 tsc、esbuild 全部通过（refactor: split worker/index.ts into domain route modules）。
- **Gemini (Flash)**：在 AGENTS.md 中新增 AI 协作生命周期与会话管理规范（Director-Worker 规范），约束跨会话上下文继承基于项目文档、同模块连续调整禁止随意销毁 Worker、新建任务保持 Brief 自包含（docs: codify agent lifecycle and session management rules）。


- **Gemini (Flash)**：在 VIBER_INTENT.md 与 AGENTS.md 中补充 AI 协作效率与分级验证梯度准绳（Pragmatic Verification），确立轻量敏捷反馈与重型全流程验收的边界，并强调避免断点逻辑倒置与单测假阳性（docs: document verification gradient and efficiency principles）。
- **DeepSeek (V4 Flash)**：彻底修正移动端生成按钮逻辑倒置——`hideGenerateButtonOnMobile` 由错误的 `lg:hidden`（手机显示）改为 `hidden lg:flex`（手机隐藏）；编辑模式悬浮胶囊改为 `onGenerateBarChange` 回调驱动父组件状态，费用标签与禁用态即时同步；移动端编辑预览卡壳按内容自适应，修复塌缩为 1px 与遮挡底图控制区的问题（fix: fix mobile generate button inversion and capsule sync）。
- **DeepSeek (V4 Flash)**：为图生图、局部重绘和扩图统一移动端交互——底部大矩形生成按钮改为与文生图一致的悬浮胶囊「生成 · 点数」，并修复预览卡固定高度溢出遮挡底图说明的问题（fix: align mobile image edit actions and preview flow）。
- **Claude (Omni)**：新增 Viber 创作意志与产品哲学宪章 VIBER_INTENT.md，并让 AGENTS.md 将其列为最高优先级必读，同步递增补丁版本至 0.115.1（docs: document viber creator intent and design philosophy）。

## 2026-08-25

- **OpenAI (GPT-5.6)**：为实验室图片编辑新增拖拽底图导入，为文生图增加 Opus 免费像素联动的自定义分辨率，并隔离编辑请求中的文生图多角色参数（feat: enhance laboratory image workflows）。

## 2026-08-25

- **Codex (GPT-5)**：修正返回位置修复记录的日期归档，并同步递增项目补丁版本至 0.114.4。

- **Codex (GPT-5)**：为风格串与角色串详情增加返回箭头，保留列表滚动位置并在排序变化后恢复目标卡片，补齐桌面、手机及角色串同类验证（fix: restore chain list position on return）。

- **Codex (GPT-5)**：将风格串与角色串详情限定为文生图，并将顶部改为可重命名的铅笔加截断名称布局，同时保留实验室四模式（fix: separate chain details from laboratory modes）。

- **Codex (GPT-5)**：补回编辑模式右侧预览的历史管理操作，并将底图选择器接入历史页全量分页数据与完整比例缩略图（fix: restore edit preview actions and history picker）。

- **Codex (GPT-5)**：统一四种实验室模式的右侧大图预览，将蒙版画板移入左侧底图区，并新增文生图最新与历史图片底图来源（feat: unify laboratory image editing workspace）。

- **Codex (GPT-5)**：让 Tag 辅助、图片反推 Tag、元数据和预设导入跟随当前实验室页面，并避免编辑页误存不完整配置（fix: scope laboratory tools to active mode）。

- **Codex (GPT-5)**：统一实验室 Variety+ 与 CFG 控件的主题强调色，并让四模式导航按桌面双栏、窄屏堆叠及手机布局自适应编辑区宽度（fix: align laboratory theme and mode navigation）。

- **Codex (GPT-5)**：将实验室 Variety+ 从预设区归入 CFG 引导控制，统一开关样式与手机响应式布局并补充交互回归测试（fix: align variety guidance layout）。

- **Codex (GPT-5)**：为 AGENTS.md 增加需求推演、同类项审计及自主修改边界，要求后续 AI 主动补齐明确相关的低风险改动（docs: require related-change reasoning）。

- **Codex (GPT-5)**：统一正负面预设下拉框的关闭项排序，让四种实验室模式始终将 none 显示在首位（fix: prioritize none in preset dropdowns）。

- **Codex (GPT-5)**：按模型恢复单一正面质量预设下拉框，并将 none 置于 V5 与 V4／V4.5 选项首位（fix: restore quality preset dropdown）。

- **Codex (GPT-5)**：按 NovelAI 官方语义重做质量预设开关与 V5 类型选择，修复实时预设关闭失效及旧数据默认模型无法读取负面预设（fix: align official prompt preset controls）。

- **Codex (GPT-5)**：移除图生图、局部重绘和扩图参数区中不可调节的画布尺寸伪输入框，并清理无用尺寸传参（fix: remove read-only image edit fields）。

- **Codex (GPT-5)**：修复实验室 CFG 滑块误显为灰色禁用状态，并统一四种模式提示词输入框的字体与字重（fix: align laboratory input styling）。

- **Codex (GPT-5)**：让安全模式同时禁用实验室蒙版工具、透明画布和 Focused 选区交互，并在关闭后无损恢复编辑（fix: block mask painting in safe mode）。

- **Codex (GPT-5)**：按模式隔离图片编辑蒙版交互，禁用图生图画笔，并让扩图画笔仅在“手动调整蒙版”开启后可用（fix: isolate image edit mask tools）。

- **Codex (GPT-5)**：修复全局设置实验室布局折叠块读取失效事件对象导致的白屏，清理同类状态更新隐患并补充设置页交互回归测试（fix: prevent settings event state crashes）。

- **Codex (GPT-5)**：为实验室 Canvas 底图接入安全模式遮挡与临时揭示，并让大图查看器豁免安全模式（fix: align laboratory safe mode behavior）。

- **Codex (GPT-5)**：为文生图、图生图、局部重绘和扩图分别接入可排序、可配置默认展开状态的实验室模块布局，并兼容旧版文生图布局偏好（feat: add per-mode laboratory module layouts）。

- **Codex (GPT-5)**：按当前模型与编辑模式隐藏不支持的 Vibe／角色参考，统一角色提示词 6／32 上限、Vibe 16 张限制、额外费用和网关校验，并补充实验室能力回归测试（feat: align laboratory controls with official capabilities）。

- **Codex (GPT-5)**：按官方运行时能力改用模型专属质量／UC 预设，修复 Focused 与扩图的角色坐标换算、编辑请求能力校验和旧预设兼容（fix: align model presets and edit coordinate normalization）。

- **Codex (GPT-5)**：扩展 NovelAI 官方运行时同步，提取模型能力、角色上限及按模型质量／Undesired Content 预设，为实验室能力对齐提供唯一数据源（feat: sync official model capabilities and prompt presets）。

## 2026-08-24

- **Codex (GPT-5)**：将编辑历史蒙版迁移到独立 IndexedDB／R2 存储，补齐按需读取、旧数据迁移、历史恢复、资产清理、Focused 选区移动缩放与异步状态隔离（feat: isolate image edit masks and restore history）。

- **Codex (GPT-5)**：让图片编辑费用确认与最终请求共用底图真实尺寸，并将提示改为本地结算估算语义（fix: align image edit settlement and request dimensions）。

- **Codex (GPT-5)**：重建图片编辑的官方请求链，补齐 1/8 蒙版、Focused 局部裁切回贴、Seed/采样器/估算费用一致性与任意尺寸底图规范化（feat: implement official image edit pipeline）。

- **Codex (GPT-5)**：修复图片编辑器底图重载、撤销快捷键、笔刷断点、Focused 模式范围、编辑期间重复提交和移动端错误生成入口（fix: stabilize image edit interactions）。

## 2026-08-23

- **Codex (GPT-5)**：让图生图、局部重绘和扩图复用文生图的左右布局外壳，补齐调用接口、模式控件与预览按钮布局测试（fix: unify image edit workspace shell）。
- **Codex (GPT-5)**：修正图生图、局部重绘和扩图的前端布局与文生图保持一致，控制区回到左侧，底图预览和生成按钮固定在右侧（fix: align image edit workspace layout）。
- **Codex (GPT-5)**：将图片编辑重构为实验室内嵌的四模式同级工作区，加入独立 Prompt 草稿、IndexedDB 私有底图／蒙版资产、历史 Prompt 恢复、编辑参数持久化并移除旧返回与弹窗入口（feat: unify image generation modes）。
- **Codex (GPT-5)**：实现统一图片编辑工作区，接入图生图、局部重绘、Focused Inpainting、扩图、历史元数据、Key 隔离费用结算、移动端入口与 Mock 回归测试（feat: add image editing workspace）。
- **Codex (GPT-5)**：新增 V5 Alpha 透明 PNG、可记忆的生成过程预览与 SSE 网关，按最终事件和原请求 Key 隔离结算用量，并接入官方流式能力同步及回归测试（feat: add transparent and streamed generation）。
- **Codex (GPT-5)**：移除失效明文游客口令与前端 Gemini 密钥注入，完善敏感文件忽略规则，并新增接入测试和提交钩子的无回显密钥扫描（fix: prevent credentials from entering git）。
- **Codex (GPT-5)**：为项目 Agent 新增按模型检索的 NovelAI 官方知识索引与工具，传入实验室模型和提示词界面状态，并修正 V5 与 V4.5 的提示容量、多角色和定位规则隔离（feat: add model-aware NovelAI agent knowledge）。
- **Codex (GPT-5)**：在实验室右上角新增带 `o`／`−` 状态标记的持久化 Tag 辅助开关，统一控制全部提示词框的补全、翻译与词典查询（feat: add laboratory tag assist toggle）。
- **Codex (GPT-5)**：修复单字段全局提示词吞掉末尾逗号，以及 Tag 补全重复查询、抢占键盘、干扰中文输入法、双击选择和中间替换残留等问题，并补充完整输入交互测试（fix: stop tag autocomplete from disrupting input）。
- **Codex (GPT-5)**：为实验室保存到库和风格串待保存状态增加 emerald 绿色语义色，同时保持 Fork 蓝色、重置红色与已保存灰色（style: color save actions green）。
- **Codex (GPT-5)**：将实验室配置导入移至右上角并修正图标与操作顺序，移除 JSON 粘贴入口，统一正面、主体和负面提示词的主题化就地复制按钮（style: refine laboratory import and copy actions）。
- **Codex (GPT-5)**：让实验室新建与已有风格串保存时自动把当前预览图片复制为独立封面，并补充当前图片选择回归测试（feat: use current preview as chain cover）。
- **Codex (GPT-5)**：统一工作区与全屏管理页的固定高度顶栏，重做画师 Tag 单行命令栏，并将角色、AITag、风格串与编辑器的次要控件收进弹层（style: unify workspace toolbar layouts）。
- **Codex (GPT-5)**：新增可持久化的实验室模块排序与默认折叠设置，支持拖拽、上下移动、恢复推荐顺序及桌面/移动端共用配置（feat: add customizable laboratory layout）。
- **Codex (GPT-5)**：移除 Opus 限额显示的 100% 上限，保留官方活动加成后的真实百分比与张数，并为超额满圈状态补充回归测试（fix: show uncapped opus allowance）。
- **Codex (GPT-5)**：将桌面生成按钮改为低强调度的主题化紧凑操作，采用“生成图片”文案与图片图标，补充费用标签及深浅色交互状态并完成浏览器视觉验收（style: refine generation button hierarchy）。
- **Codex (GPT-5)**：将桌面生成按钮、排队状态和错误提示统一移动到图片预览下方，形成作品优先且位置稳定的底部操作区（style: move generation action below preview）。
- **Codex (GPT-5)**：统一侧栏 Anlas/Opus 字体层级并补充折叠态 Anlas 余额，将主体提示词迁移到左侧全局编辑区，让右侧专注生成与图片预览（feat: refine quota and prompt layouts）。
- **Codex (GPT-5)**：新增可持久化的提示词拆分设置，支持双字段与单一全局提示词界面切换，并让 NovelAI 元数据按设置直接导入而不再弹出选择框（feat: add configurable prompt field layout）。
- **Codex (GPT-5)**：将生成参数控件改为宽屏分行布局，移除桌面编辑器重复底栏并保留顶部保存入口（fix: refine generation parameter layout）。
- **Codex (GPT-5)**：重排生成参数区，新增 NovelAI 元数据导入拆分预览，并接入官方图片模型哈希映射同步与 V5 自动选择（feat: improve novelai metadata import）。
- **Codex (GPT-5)**：按 NovelAI 官方格式新增 Alpha Stealth PNG 元数据导入，补齐标准压缩文本块和损坏数据保护，并用 V5/V4.5 原图验证新旧解析路径（feat: support novelai stealth png metadata）。
- **Codex (GPT-5)**：修复切换 Key 后订阅请求失败会让 Opus 限额整行消失的问题，增加可重试错误态及对应回归测试（fix: keep opus status visible on key switch failure）。
- **Codex (GPT-5)**：修复失败生图误记个人 Opus、受限模型判断依赖 V5 前缀和切 Key 迟到预算事件覆盖风险，并补充对应回归测试（fix: harden key-scoped usage settlement）。
- **Codex (GPT-5)**：修复个人用量字段错位与生图后设置页不刷新问题，并校正“困困的小群福利”历史 NAI5 生成的 1 张 Opus 免费图（fix: repair key-scoped personal usage accounting）。
- **Codex (GPT-5)**：统一生成按钮与公共队列各状态的主题色和动效开关，移除移动端队列阴影与遗留生成入口的硬编码样式（fix: unify generation and queue status visuals）。
- **Codex (GPT-5)**：修正生成按钮普通状态误启用粒子渐变的问题，将渐变和光斑动画限定在生成中状态（fix: limit action gradient to loading）。
- **Codex (GPT-5)**：将生成按钮改为跟随主题强调色的同色系多段粒子渐变，增加左右往返流光、生成中加速与动效偏好适配（fix: theme generation action gradient）。

## 2026-08-22

- **Codex (GPT-5)**：修正 NAI 5 系列生成按钮误显示「免费」的问题，按模型区分 Opus 额度、免费档和 Anlas 点数，并补充回归测试（fix: label opus allowance generation）。
- **Codex (GPT-5)**：为 Opus 限额增加点击刷新旋转动画、同步失败红色叉号状态与额度圆环过渡动画，并补充刷新 loading 回归测试（fix: animate opus quota refresh state）。
- **Codex (GPT-5)**：修复官方常量同步的分块请求重试、部分结果保护、失败短间隔重试与前端旧缓存问题（fix: stabilize official runtime sync）。
- **Codex (GPT-5)**：修复切换 NovelAI API Key 后 Opus 限额、公共队列状态和 Anlas 预算的刷新竞态与跨 Key 串用问题，并补充回归测试（fix: guard key scoped state across key switches）。
- **Codex (GPT-5)**：按确认方案调整密钥「使用/使用中」操作位置与 Opus 限额单行布局，移除不必要图标、恢复文案和省略号（fix: refine key status and opus quota layout）。
- **Codex (GPT-5)**：按 NovelAI API Key 隔离公共队列、Anlas 预算、个人用量与 Opus 快照，优化密钥「使用中」标识、Opus 限额圆环和风格串模型下拉筛选（feat: isolate key-scoped usage and polish model filters）。
- **Codex (GPT-5)**：新增启动时自动开启安全模式设置（feat: add safe mode startup preference）——全局设置增加默认开启的启动偏好，启动时按该偏好初始化安全模式，并同步 Agent 设置上下文。
- **ZCode (GLM-5.3)**：密钥保管箱防误填与统计口径说明（fix: guard key vault against autofill mistakes）——添加表单 new-password 防浏览器自动填充、pst- 前缀校验拒绝非 NovelAI 密钥、存量可疑条目加「格式可疑」标记；个人统计空状态区分未配密钥/无计费记录并写明计入口径（V4.5 免费小图不计入）。
- **ZCode (GLM-5.3)**：个人用量统计与预算警告（feat: track personal usage and warn on exhausted budget）——网关按密钥哈希累计个人 Anlas 花费与 Opus 免费档张数（computeGenerationPersonalUsage 纯函数+单测，生图与 Vibe 编码双扣费点接入），worker /api/anlas-budget 扩展 personal 存储与 DELETE 重置，设置页新增个人统计展示，预算用尽仍扣费时弹红色警告（Agent 路径同拦）。
- **ZCode (GLM-5.3)**：NovelAI 多密钥保管箱（feat: add named novelai key vault）——新增 services/naiKeyVault.ts（localStorage 保管箱 + 激活写回 nai_api_key 槽位并广播事件 + 首次自动迁移现有单密钥），全局设置密钥区改为多密钥管理 UI（脱敏展示、使用/备注/删除、添加表单），切换即时刷新 Opus 限额。
- **ZCode (GLM-5.3)**：本地启动提速（perf: speed up local startup）——dev:local 构建改走 build:local 快速通道（跳过 tsc，实测 21s→13.4s）、官方常量同步延迟至网关就绪 30 秒后、启动日志打印构建/worker（D1/R2 恢复）/网关各阶段耗时与总耗时。
- **ZCode (GLM-5.3)**：风格串模型筛选改为常驻（fix: make chain model filter always visible）——选项固定为可选模型清单（getSelectableNaiModels，含网关同步新模型），无串/单模型时也显示；重建 dist。
- **ZCode (GLM-5.3)**：修复 AITag 模型筛选与首图缓存（fix: normalize aitag model labels and retry first image cache）——模型标签去掉版本哈希后缀按系列归并（筛选项与详情显示同步）、error 状态首图缓存改为后续加载自动重试、批量缓存连续 2 次失败熔断防轰炸；重新构建 dist。
- **ZCode (GLM-5.3)**：模型版本标签与筛选（feat: add model version tags and filters）——风格串列表按 params.model 筛选并显示卡片徽标（旧串归入 V4.5 Full）、AITag 筛选面板按首图元数据模型过滤已加载条目、历史详情 ParamsViewer 新增 Model 行；naiModels 新增 getNaiModelDisplayLabel（未知标识推导显示名）。
- **ZCode (GLM-5.3)**：全站文案「画师串」更名为「风格串」（feat: rename artist chains to style chains）——侧栏/列表/编辑器/Agent 工具描述/README 同步替换，历史修复文档与 CHANGELOG 保留原文。
- **ZCode (GLM-5.3)**：常量同步失效时生成前强制警告（feat: warn before generating on stale runtime sync）——免费估算路径在同步失效时弹红色警告确认后才生成，扣费路径在原确认弹窗追加警示，Agent 生图同样拦截；失效判断与描述文案收敛为 naiRuntime 的共享函数（isNaiRuntimeSyncUnhealthy / describeNaiRuntimeSyncProblem）。
- **ZCode (GLM-5.3)**：常量同步健康监控与自检（feat: guard novelai runtime sync health）——同步器重构为纯计算+健康记录（逐项命中/未命中、抓取失败原因，持久化并打日志），侧栏限额行琥珀色圆点示警同步失效或 48 小时未更新，新增 npm run test:live-sync 联网自检命令（实测官方 bundle 全部命中），AGENTS.md 划定保护区约束后续 AI 修改。
- **ZCode (GLM-5.3)**：官方规则常量自动同步（feat: auto-sync novelai runtime constants）——网关每日从官方 Web 应用 JS 提取模型清单/限额换算系数/免费档门槛/成本系数（提取器带锚点窗口防误匹配，真实 bundle 验证通过），持久化至 local-data 并经 /api/novelai-runtime 供前端使用；模型下拉自动追加新模型、未知标识透传服务端；新增提取器与估算器跟随单测。
- **ZCode (GLM-5.3)**：修复 Opus 限额代理域名（fix: use image host for novelai subscription）——实测发现 api.novelai.net 对第三方工具返回 400，订阅接口改走 image.novelai.net，同步修正单测断言。
- **ZCode (GLM-5.3)**：Opus 限额适配拼车共享账号（feat: keep opus usage fresh for shared accounts）——限额轮询缩短为每分钟、侧栏限额行可点击立即刷新、受限额模型生成前强制刷新真实额度再算费用、网关透支快照过期时扣费前自动重取。
- **ZCode (GLM-5.3)**：新增 Opus 免费生成限额显示（feat: surface opus usage limit）——网关新增 /api/novelai-subscription 代理（剥离敏感字段）、services/naiUsage.ts 官方映射纯函数与刷新 hook、侧栏 Anlas 预算下方 OpusUsageBar 组件、生图费用估算在透支时对 V5 取消免费档，新增 5 个单元测试锁定映射。
- **ZCode (GLM-5.3)**：生图模型解锁为可选（feat: make generation model selectable）——新增 services/naiModels.ts 注册表（标识对照官方 Web 应用 bundle 核对）、NAIParams.model 字段、参数面板模型选择器、V5 的 Vibe/角色参考边界提示与生成拦截、元数据导入携带模型标识。
- **ZCode (GLM-5.3)**：日志头部补充启用日期（2026-08-22）与说明，明确此前修改无 AI 记录、需查 git 历史与 CHANGELOG。
- **ZCode (GLM-5.3)**：README 项目结构树补列 AGENTS.md 与 AI_WORKLOG.md 两个文档，方便新加入的 AI 与协作者找到规则文件。
- **ZCode (GLM-5.3)**：新增 AI 工作日志强制规则（AGENTS.md）并创建本文件，此后每次 AI 修改都须在此登记模型名与所做工作。
