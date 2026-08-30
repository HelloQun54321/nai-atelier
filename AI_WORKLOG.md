# AI 工作日志

记录每次由 AI 工具执行的项目修改：模型名、日期与所做工作，规则见 `AGENTS.md`。日期节按时间倒序排列，最新记录在最上方；同一天内新条目排上方。

本日志自 2026-08-22 启用；此前的项目修改没有留存 AI 记录，历史改动请查阅 git 提交历史与 `CHANGELOG.md`。

## 2026-08-31
- **Antigravity (Gemini 3.7 Flash)**：修复空文件夹批量导入卡死、AITag 作品组远程图（P2/P3）防盗链拦截无法显示、以及数据维护密码框触发浏览器向风格串搜索框误填用户名的问题（fix: empty folder scan lockup, aitag multi-image proxy, and password autofill isolation）。
- **Antigravity (Gemini 3.7 Flash)**：修复历史页面、AITag 画廊及 Danbooru 画廊刷新按钮传参错误导致列表跳向更早历史的问题，统一重置回第 1 页并回顶（fix: reset to page 1 on refresh in history, aitag and danbooru galleries）。
- **Antigravity (Gemini 3.7 Flash)**：风格串批量导入选项全面接入 localStorage 偏好持久化（含「标记为待实测」、「自动清理无用素材」与「导入后删除本地源文件」），保持同组控件持久化行为一致（fix: persist markUntested preference to localStorage in batch import modal）。
- **Antigravity (Gemini 3.7 Flash)**：风格串批量导入增加「自动清理无用素材」与「导入后删除本地源文件（收件箱模式）」开关，支持 localStorage 偏好记忆与导入联动物理删除，消除二级弹窗确认并彻底解决源文件残留导致的重复垃圾问题（feat: support auto cleaning junk and imported source files in batch import）。

## 2026-08-29
- **ZCode (GLM-5.3)**：vite dev server 由 0.0.0.0 改绑 127.0.0.1——Dependabot 报告的 4 条 vite 漏洞全部只在 dev server 运行时暴露，绑回环后局域网暴露面归零，替代 vite 6→7 大版本升级的安全收益（fix: bind vite dev server to loopback only）。
- **ZCode (GLM-5.3)**：依赖安全升级第三项——npm overrides 强制 shell-quote 1.8.3 → 1.10.0（concurrently 的传递依赖，清除 critical+high 两条告警；本项目无攻击者可控输入，实际不可利用）；concurrently 冒烟通过，顺手重建了安装残留损坏的 rxjs 包（chore: force-upgrade shell-quote via npm overrides）。
- **ZCode (GLM-5.3)**：依赖安全升级第二项——sharp 0.34.5 → 0.35.4（libvips 8.18.6），消除不可信图片缩略图处理的 4 个内存安全 CVE；网关同款操作冒烟（resize+webp）与网关测试 140/140 通过（fix: upgrade sharp to 0.35.4 to clear libvips memory-safety advisories）。
- **ZCode (GLM-5.3)**：依赖安全升级第一项——undici 7.28.0 → 7.29.0，清空该包全部 11 条 Dependabot 告警（网关对外请求链路的 HTTP 客户端）；API 无变更，网关测试 140/140 通过（fix: upgrade undici to 7.29.0 to clear proxy fetch advisories）。
- **ZCode (GLM-5.3)**：桌面端 keep-alive 上限 8 → 9（全部可保留页面常驻、永不淘汰）。浏览器实测定位剩余重载根因：上限 8 时全 9 页轮换必有一个页面被挤出重建；提高后全轮换返回 AITag，页面 DOM 节点存活（探针验证）、封面零重新请求。测试中发现图片组件修复在 8 槽内本就生效（两页往返 DOM 存活、零请求）（perf: keep all desktop gallery views mounted so switching never remounts）。
- **ZCode (GLM-5.3)**：keep-alive 待机上限按视口区分——桌面 4 → 8（可保留页面几乎全部常驻，多页轮换不再触发整页卸载重建），手机维持 4（规避移动浏览器内存压力导致的整页刷新；已有 Cache API 图片缓存兜底）（perf: raise desktop keep-alive limit to 8 so page switches never unmount galleries）。
- **ZCode (GLM-5.3)**：画师库同源修复——收藏画师时落展示快照（nai_artist_favorite_details），"只看收藏"改为按收藏清单渲染（本地已保存画师 → 已加载词库条目 → 快照兜底），旧收藏进入筛选时按名字串行检索补齐；nai_fav_artists 格式不变，Agent 面板读写不受影响（fix: render artist favorites from the stored list instead of the loaded catalog slice）。
- **ZCode (GLM-5.3)**：修复角色库"只看收藏"看不到词库角色——词库是无限分页加载而筛选只作用已加载子集；收藏时落展示快照（nai_character_favorite_details），筛选改为按收藏清单渲染（自定义取本地链、词库取快照/已加载条目、与标签页组合语义一致），旧收藏进入筛选时按名字串行检索补齐（fix: render character favorites from the stored list instead of the loaded catalog slice）。
- **ZCode (GLM-5.3)**：按用户指定语义反转安全模式启动判定——"启动时自动开启安全模式"开关成为唯一决定者（开→每次启动必开；关→必关），上一轮的"优先恢复上次手动状态"逻辑移除；nai_safe_mode 键降级为当前状态镜像供 Agent 读取（fix: make safe mode startup preference authoritative）。
- **ZCode (GLM-5.3)**：SmartImage 改为页面隐藏时保留已显示图片不卸载（懒加载观察器仅可见时激活新图；换图/重试仍正常重置）——切页往返不再整列表闪现"加载中"，全图库受益；代价是隐藏页面保留已解码图片的内存占用（fix: keep gallery images mounted while their view is hidden）。
- **ZCode (GLM-5.3)**：修复实验室误触发自动设封面——autoSaveCoverOnExit 补上 chain.id === 'playground' 豁免（与 handleSavePreview 对齐）：实验室 keep-alive 实例被 LRU 淘汰卸载时不再把生成图"自动设为封面"并跨页弹提示，真实风格串功能不变（fix: exempt playground from auto cover save on unmount）。
- **ZCode (GLM-5.3)**：按用户决定彻底去掉 AITag 画廊"无 prompt 作品不显示"的过滤规则（列表过滤、详情预览壳、详情图片列表三处一并移除并清理 import）——根因是 prompt 元数据由搜索响应后的后台任务异步补齐，首开时条目未补完被整页滤空显示"没有匹配结果"；现画廊与上游所见即所得，首开立即出全量列表（feat: drop prompt-metadata filter so the aitag gallery shows results immediately）。
- **ZCode (GLM-5.3)**：修复 DataBackupManager 把上次备份完成误报为"刚刚完成"（首次观测只记录基线）；扩展 secret-scan 覆盖 sk 家族变体/hf_/glpat-/Telegram token/无引号命名密钥并排除引用误报，补测试用例，仓库全量扫描通过（fix: dedupe backup completion toasts and widen secret-scan coverage）。
- **ZCode (GLM-5.3)**：脚本层小修——流式生图端点缺 parameters 返回 400（原 TypeError→502）；st-chatu8 桥 Vibe 同步统一判空；bump-version 先校验后落盘；withJobSlot 改循环等待消除唤醒竞态；tag-update-server POST 消费请求体。核查确认 pixiv.key 损坏 fail-closed 为有测试锚定的有意设计，未改动（fix: harden gateway stream params, bridge null safety and script utilities）。
- **ZCode (GLM-5.3)**：修复两处响应式样式缺陷——新增 .mobile-size-locked 让小圆钮豁免 44px 最小高度（历史收藏/灵感选择钮不再被拉成蛋形）；把 mobile-gallery 比例规则移入 @layer components 使桌面端 md:aspect-square 正常生效（fix: keep round icon buttons round and let desktop square layout preference apply）。
- **ZCode (GLM-5.3)**：修复安全模式开关重启后状态丢失——safeMode 初始化优先读上次手动开关的 nai_safe_mode，无记录时回退启动偏好 nai_safe_mode_startup（fix: restore last safe mode toggle state on startup）。
- **ZCode (GLM-5.3)**：蒙版绘制增加多点触控防护——按下/移动/抬起只响应主指针（isPrimary），第二指/手掌误触不再导致笔迹跳变与撤销栈污染（fix: ignore non-primary pointers in mask drawing）。
- **ZCode (GLM-5.3)**：worker 后端请求处理加固——chains/chains name·description、benchmarks config 等缺字段 bind 补默认值；vibe 强度/灵感 useCount·updatedAt/历史 createdAt 等 NaN 归一；/api/assets If-None-Match 支持弱校验器与多值；st-chatu8 导入按 meta.changes 计数；agent 概览先 ensure vibe/角色参考 schema；灵感 sourceUrl 仅接受 https（fix: harden worker request binding, cache negotiation and agent overview queries）。
- **ZCode (GLM-5.3)**：App.refreshData 加请求代际并发守卫，过期刷新不再提前清 loading 或覆盖新数据（fix: serialize concurrent chain list refreshes with a seq guard）。
- **ZCode (GLM-5.3)**：Pixiv"加入灵感库"改走 /api/upload 转存 R2 资产 URL（importPixivImageAsDataUrl → importPixivImageAsFile），消除多 MB base64 原图入库并随灵感缓存常驻内存的问题（perf: store pixiv inspirations as uploaded assets instead of data urls）。
- **ZCode (GLM-5.3)**：修复历史批量删除裸 await 无异常保护——加 try/catch 统一处理（失败保留选中集便于重试），清理预览计数请求加 catch 兜底（fix: guard bulk history deletion against partial failures）。
- **ZCode (GLM-5.3)**：修复 Agent 面板初始化错误被吞（卡死在"正在加载对话"）——增加错误提示与重试按钮；request_generation 生图流程异常时补回 finalize 失败终态，服务端任务不再永久等待（fix: surface agent init errors and finalize generation on failure）。
- **ZCode (GLM-5.3)**：补齐四个视图的竞态守卫缺口——AITag 后台追加连拉改为单序号且让位用户加载、修复 finally 提前关 spinner；Danbooru 同款 finally 守卫；Pixiv"看了又看"加代际守卫、登录轮询加在途去重与连续失败容忍；Vibe 库搜索加请求代际（fix: add stale-response guards across gallery and vibe loading paths）。
- **ZCode (GLM-5.3)**：修复 Tag 词库更新先删后写的非原子性——先写 public/tag-data.staging 暂存目录、manifest 就绪后原子替换正式目录，失败路径清理暂存，中途失败不再留下无 manifest 的残缺词库（fix: write tag dictionary to staging dir and swap atomically）。
- **ZCode (GLM-5.3)**：重写 local-server.sh 为薄启动器——保留 Termux/Node 检测后 exec 委托给 local-server.mjs，消除 Unix 端缺网关/PIN/Agent/桥接且端口布局冲突的功能残缺问题（fix: delegate local-server.sh to the shared orchestrator）。
- **ZCode (GLM-5.3)**：修复 NAI_WRANGLER_LOG=all 模式 stdout 无人消费导致 wrangler 管道阻塞假死 + 看门狗误杀健康进程——新增 fullWranglerLog 透传函数，完整日志模式仍持续消费输出并推进看门狗标记（fix: keep consuming wrangler stdout in full-log debug mode）。
- **ZCode (GLM-5.3)**：修复 PIN 限流失败计数在触发锁定时被清零的问题（worker 与网关两处同步）——计数改为跨锁定周期累计、仅成功解锁时清零，堵住 4 位 PIN 被按天持续爆破的路径（fix: keep LAN PIN failure count across lockout windows）。
- **ZCode (GLM-5.3)**：修复空/全透明蒙版可提交 infill/outpaint 白耗 Anlas——提交前用 maskHasInk 检查蒙版 alpha 通道，为空时拦截并给出对应操作提示（fix: block empty-mask infill submissions that waste Anlas）。
- **ZCode (GLM-5.3)**：修复 PromptAgent 会话历史加载无竞态守卫（快速切换会话时旧响应覆盖新对话）——加会话加载代际计数丢弃晚到响应；同批修复 Agent 输入框与 AITag 三处搜索框的回车未排除中文输入法组字态（isComposing）导致的误发/误搜（fix: guard agent session loading races and IME enter handling）。
- **ZCode (GLM-5.3)**：修复移动端悬浮层互相遮挡——画师库复制历史抽屉与遮罩提升到 z-[60]/z-[55] 高于底部导航，恢复「清空历史」可点；实验室页 Agent 悬浮球垂直上限收紧到 0.78，不再遮挡生成 FAB（fix: keep mobile history drawer and agent ball from covering nav and generate FAB）。
- **ZCode (GLM-5.3)**：为 ensureLocalHistorySchema/ensureVibeSchema/ensureCharacterReferenceSchema 补上进程级幂等标记（与灵感表既有做法同型），消除每个请求重跑整套 DDL + 全表扫描的性能回归（perf: cache local history and vibe schema ensure per process）。
- **ZCode (GLM-5.3)**：修复隐私模式/配额满时 localStorage 写入抛异常击穿渲染进程树白屏——外观偏好（useLayoutEffect 内）与移动端图片显示偏好两处 setItem 加 try/catch 兜底（fix: guard localStorage writes in appearance and display preferences）。
- **ZCode (GLM-5.3)**：修复 .naiv4vibe 导入先落库后校验的脏数据——把编码校验（范围/格式/长度）前移为预扫描，全新 Vibe 无可用编码时直接 400 且零写入，不再留下零编码资产行与孤儿 R2 文件（fix: validate vibe encodings before persisting imported assets）。
- **ZCode (GLM-5.3)**：修复画师 benchmarks 列两处裸 JSON.parse——保存路径改用与删除路径一致的 parseStoredJson 容错解析、数组元素先做字符串归一，`/api/config/benchmarks` 读取加 try/catch，列/配置损坏不再永久 500（fix: tolerate corrupted benchmarks data in artist save and config endpoints）。
- **ZCode (GLM-5.3)**：修复 `POST /api/local-history` 的 INSERT OR REPLACE 缺 `external_source`/`external_id` 列——同 id 重存 st-chatu8 外部来源行时外链标记被整行重插抹掉；现补入列清单并按"请求值优先、已有值兜底"回填（fix: preserve external source fields when re-saving local history rows）。
- **ZCode (GLM-5.3)**：统一网关流式路径的取消消息为「已取消排队」（原为「已取消生成」）——前端终态判定按「已取消排队」匹配，导致流式取消被显示为错误态（fix: align stream cancel message with queue cancelled terminal phase）。
- **ZCode (GLM-5.3)**：新增顶层 ErrorBoundary（components/ErrorBoundary.tsx 并接入 index.tsx）——任一视图渲染崩溃时显示可恢复的错误页而非整站白屏（fix: add top-level error boundary to recover from render crashes）。
- **ZCode (GLM-5.3)**：修复角色库与画师库同源的"清空搜索词后 loading 永久卡死"——防抖 effect 空词分支不复位加载状态，而在途请求的 finally 又被递增的请求代际守卫拦截；两处空词分支同步复位 loading（fix: reset library search loading state when the query is cleared）。
- **ZCode (GLM-5.3)**：补齐手机端实验室预览功能入口——大图灯箱左上角新增「下载」与条件显示的「设为封面」操作条（<lg 预览卡隐藏时的唯一入口），生成完成自动弹灯箱的断点从 767px 修正为与布局一致的 1023px，消除平板区间生成后无可见反馈的死角（fix: restore preview actions on mobile via lightbox and align auto-open breakpoint）。
- **ZCode (GLM-5.3)**：修复编辑模式切换的三处蒙版状态机竞态——切模式前先清空 imageEditMaskData 防止旧模式蒙版画进新模式画布；applyOutpaint 调整画布尺寸后清空撤销/重做栈防过期快照破坏扩图语义；键盘 Ctrl+Z/Y 改经 latest-ref 调用最新 undo/redo，修复空依赖 effect 过期闭包把蒙版写进另一模式草稿（fix: resolve mask state races when switching lab edit modes）。
- **ZCode (GLM-5.3)**：修复编辑画布三套 CSS 盒模型不同步导致的蒙版坐标错位——ImageEditCanvas 改为 ResizeObserver 量取容器可用空间后统一计算显示尺寸，底图/蒙版/叠加三画布绝对定位填满同一盒子，笔刷落点所见即所得；无 ResizeObserver 环境退化为 resize 监听（fix: unify image edit canvas boxes so mask coordinates match the visible base image）。
- **ZCode (GLM-5.3)**：封堵上传通道存储型 XSS——`/api/upload` 增加图片扩展名白名单（PNG/JPEG/WebP，Content-Type 由白名单推导）与 12MB 大小上限，`/api/assets` 响应补 `X-Content-Type-Options: nosniff`（fix: restrict uploads to images and add nosniff to asset responses）。
- **ZCode (GLM-5.3)**：移除 worker 全局 CORS 通配头（`corsHeaders` 常量与 json/error/aitag/zip/SSE/assets 各处展开）——回环免认证 + `ACAO:*` 组合允许本机浏览器中的恶意网页无认证读写全部 API（drive-by CSRF）；同源应用不需要 CORS，跨源预检现必然失败，OPTIONS 分支改为空 204（fix: remove wildcard CORS headers from worker responses）。
- **ZCode (GLM-5.3)**：修复网关三处无 try/catch 的裸 JSON.parse（`/api/lan/unlock`、`/api/lan/pin`、`/api/generation-queue/cancel`）——局域网设备无需认证发送畸形 JSON 即可触发未捕获异常令整个 local-server 进程退出；新增 readJsonBody 安全解析助手统一按空对象兜底（fix: harden gateway JSON body parsing against unauthenticated DoS）。
- **ZCode (GLM-5.3)**：修复网关 readRequestBody 的 30 秒 socket 空闲超时在 body 读完未解除的问题——该超时会误杀排队/上游生成超过 30 秒的请求，非流式路径出现"已扣费却拿不到图"；现于 'end' 事件中 `setTimeout(0)` 解除，慢 body 防护保留（fix: release gateway socket idle timeout after request body is read）。
- **ZCode (GLM-5.3)**：实现用户指定的步数上限开关——新增偏好 `enforceFreeStepLimit`（默认开启），全局设置提供开关；开启时生成步数锁定为官方同步的 `freeMaxSteps`（替换写死的 28，官方调整自动跟随），关闭时放宽到 NovelAI 硬上限 50 并显示「已解除上限」提示；覆盖工坊与实验室四模式参数面板，补偏好回归测试（feat: add toggle for free step limit on generation）。
- **ZCode (GLM-5.3)**：按用户确认的意图完成全项目 bug 排查（12 轮只读审计，未改代码）；随后开始逐项修复。第一项：README「项目定位」增加适用范围声明——本项目仅面向 NovelAI Opus 档位会员，其他档位与第三方服务未做适配；顺带补上 CHANGELOG 缺失的 2026-08-28 日期节标题（docs: note opus-only subscription scope in readme）。

## 2026-08-28
- **ZCode (GLM-5.3)**：与用户讨论后修复手机端实验室导航死角——实验室顶栏模式导航左侧新增返回箭头（仅 <md 窄屏显示，与侧边栏互斥不造重复入口），返回记录的进入前内容页并兜底风格串列表，补断点与回调回归测试（fix: add mobile lab back arrow to exit playground dead end）。
- **ZCode (GLM-5.3)**：排查「启动本地服务时快时慢/卡住数分钟」——用带时间戳的对照实验定位为 wrangler 横幅前的 npm 更新检查（update-check 库无视代理环境变量直连 registry 被黑洞，实测阻塞 36 秒+且失败不缓存），经 npm_config_registry 注入快速失败端口后实测启动降至 1 秒内（fix: short-circuit wrangler npm update check to unblock local server startup）。
- **ZCode (GLM-5.3)**：按用户选择重构手机端编辑器工具栏——低频操作（导入/引用预设/反推/Tag 辅助/重置/保存）全部收进模式导航行右侧 ⋯ 底部动作面板（复用 MobileBottomSheet），平板与桌面保持原布局，新增面板交互与断点回归测试（feat: collapse editor toolbar into mobile more menu sheet）。
- **ZCode (GLM-5.3)**：修复手机端编辑器工具栏居中未生效——grid 项的无前缀 ml-auto 会收缩行宽并钉右、令 justify-center 失效，改为 lg:ml-auto 桌面端专属，并新增 ChainEditorHeader 断点回归测试（fix: center editor toolbar on mobile by scoping auto margin to desktop）。
- **ZCode (GLM-5.3)**：手机端实验室图生图/局部重绘/扩图隐藏顶部大图预览区，与文生图对齐仅保留底部浮动圆圈查看当前预览（编辑模式圆圈与顶部预览同源），编辑器工具栏按钮行移动端居中，并清理移动端预览壳死 CSS、补预览壳断点回归测试（fix: hide lab edit-mode preview on mobile and center editor toolbar）。
- **ZCode (GLM-5.3)**：清理 AI_WORKLOG 两处重复条目，并还原 App.tsx 无语义的编辑器格式化残留（docs: remove duplicate AI worklog entries）。
- **DeepSeek V4 Flash (qianlian)**：完成 10 轮手机端前端显示检查并修复五类问题——移动端实验室生成错误提示可见、Pixiv 顶栏移动端导航独立成行、画师配置弹窗窄屏参数降级单列、画师复制历史抽屉移动端全屏化、全站弹窗高度 vh 改 dvh（fix: repair mobile display issues across galleries and lab）。
- **DeepSeek V4 Flash (qianlian)**：局域网访问密码可在设置中实时修改（网关承载解锁校验与会话签发、新增 PUT /api/lan/pin 写回 lan-access.json），改密立即生效无需重启（feat: support changing LAN access pin at runtime）。
- **DeepSeek V4 Flash (qianlian)**：启动日志的局域网访问地址过滤 WSL/Hyper-V、TUN 等虚拟网卡，只展示真实可访问地址（fix: filter virtual adapter addresses from LAN access list）。
- **Gemini (Flash)**：修复编辑页左上角返回按钮偶发点击无响应，修正 handleReturnFromEditor 逻辑并移除导航外层 startTransition 确保同步即时跳转（fix: resolve unresponsive editor back button and make navigation synchronous）。
- **Gemini (Flash)**：修复从编辑页返回列表时丢失浏览位置直接回到顶部，为 useKeepAliveScrollRestore 增加隐藏清零防护并在返回时携带 returnTargetId 确保渲染高度（fix: maintain scroll position and prewarm batch render on return from editor）。
- **Gemini (Flash)**：修复 st-chatu8 同步风格串缺失完整生成参数导致进入 ChainEditor 触发 TypeError 白屏崩溃，四层全链路补齐 normalizeParams 与空值防御并自动修复本地存量 30 个同步风格串（fix: resolve blank screen crash on opening st-chatu8 chains and repair legacy chain params）。
- **Gemini (Flash)**：Pixiv 顶栏改为搜索栏拉宽铺满 + 独立导航按钮组，对齐 Danbooru 风格（feat: widen Pixiv search bar and convert feed tabs to standalone buttons）。
- **Gemini (Flash)**：Tag 补全弹窗改为 Portal 渲染至 body 顶层（z-index 9999），消除被模块卡片遮挡问题并随输入框实时对齐；聚焦时预热角色搜索记录（fix: render tag autocomplete listbox as top-layer portal and preload character search records）。
- **Gemini (Flash)**：实验室输入框支持中文搜角色 Tag，角色库自定义卡片增加直接编辑/Prompt预览，并优化封面并发枚举吞吐（feat: support Chinese character autocomplete in lab, add direct edit to custom cards, and accelerate cover loading）。
- **Gemini (Flash)**：修复 Danbooru 全局高分榜与收藏榜数据库查询超时卡死，自动路由至官方 explore popular 聚合接口（fix: route global Danbooru score and favcount sorts to official explore popular endpoints）。
- **Gemini (Flash)**：收敛 Danbooru 图库为单行顶栏下拉筛选，修复上游 2-Tag 上限下的评级/比例/单人多维筛选生效（feat: consolidate Danbooru toolbar into single row and fix multi-dimensional filtering）。
- **Gemini (Flash)**：编辑页返回列表恢复浏览位置，任意方式离开编辑页时自动为未设封面的风格串补全封面（fix: restore list position on editor exit and auto-fill missing style covers）。
- **Gemini (Flash)**：新增 keep-alive 图库滚动位置保持 hook，修复侧边栏切换页面跳回顶部问题（fix: restore scroll position across keep-alive gallery views）。
- **Gemini (Flash)**：重构画师库多选栏为居中悬浮胶囊 Dock 并为角色库增强多角色槽位调序与自动装载导入（feat: align artist cart dock and enhance character slots ordering and auto-import）。
- **Gemini (Flash)**：规范角色库来源筛选下拉文案为「自定义角色」并为卡片增加「Tag 词库/自定义」来源徽标（fix: clean character library filter labels and add card source badges）。

## 2026-08-27
- **Gemini (Flash)**：将画师库与角色库顶栏搜索框自适应拉长铺满，操作控件右移消除空位（feat: elongate search bar and right-shift controls in character and artist libraries）。
- **Gemini (Flash)**：彻底清理画师库与角色库中显示设置关联的死代码（refactor: purge dead layout and display state/views in character and artist libraries）。
- **Gemini (Flash)**：移除角色库与画师库顶栏冗余的显示设置按钮与弹窗（feat: remove redundant display settings button and popovers from character and artist libraries）。
- **Gemini (Flash)**：修复 ArtistLibrary 控制栏与列表视图 JSX 闭合问题（fix: restore JSX tag closures in ArtistLibrary toolbar and list layout）。
- **Gemini (Flash)**：将角色库范围选项卡替换为同款下拉框并移除重复的收藏项（refactor: convert character scope tab to select dropdown and deduplicate favorites）。
- **Gemini (Flash)**：镜像对齐角色库与画师库顶栏布局，为角色库增配独立收藏按钮并精简画师库冗余跑图入口（feat: harmonize topbars and favorite actions between character and artist libraries）。
- **Gemini (Flash)**：恢复 AITag 画廊顶栏桌面端筛选按钮（fix: restore desktop filter button in AitagGallery toolbar）。
- **Gemini (Flash)**：修复 ArtistLibraryConfig 弹窗内部容器闭合缺陷（fix: restore inner container div in ArtistLibraryConfig）。
- **Gemini (Flash)**：执行审查阶段三：对齐角色卡片外壳圆角、暗黑背景与选中光晕至 DesignSystem MediaCard 标准（style: harmonize character card shell and selection rings with DesignSystem standards）。
- **Gemini (Flash)**：执行审查阶段二：全面规范化生图实验室参数输入与下拉控件圆角与聚焦光晕（style: harmonize parameter form inputs and focus rings in ChainEditorParams）。
- **Gemini (Flash)**：执行审查阶段一：补齐全站 Modal 弹窗的 ESC 键盘监听与遮罩点击关闭交互闭环（feat: complete ESC key and backdrop click dismissal across all modals）。
- **Gemini (Flash)**：统一全站所有画廊与资料库顶栏左上角为绝对锚定搜索框（fix: unify top-left search anchor across all galleries and libraries）。
- **Gemini (Flash)**：全局画廊与资料库顶栏空间网格与搜索交互深度归一化（refactor: deeply harmonize top bar spatial grids and search interactions across galleries）。
- **Gemini (Flash)**：将串列表顶栏「标签筛选」弹层修改为以触发按钮为基准水平居中对齐（fix: center align tag filter popover under trigger button in ChainList）。
- **Gemini (Flash)**：执行自检轮次三：强化 SegmentedControl、FilterPill 与 GenerationModeNav 在暗色模式下的边缘对比度与外框契约（style: refine dark mode contrast and border contracts for segmented controls）。
- **Gemini (Flash)**：执行自检轮次二：为角色库、画师库、串列表、灵感库与 AITag 全局下拉气泡与浮动菜单补充点击外部自动关闭（feat: add click-outside dismiss backdrops for top bar popovers across galleries）。
- **Gemini (Flash)**：执行自检轮次一：优化 AITag 移动端顶栏纵向居中对齐，规范化灵感智能分类 CollectionButton 图标选择器（style: harmonize mobile toolbar alignment and collection button icon selectors）。
- **Gemini (Flash)**：全面统一 DesignSystem 按钮内部图标尺寸（升级为后代选择器 [&_svg]:h-4，彻底消除包裹 span 导致回退 24px 与硬编码尺寸冲突）（fix: strictly unify button icon sizes to standard 16px across design system）。
- **Gemini (Flash)**：修复生图实验室顶栏布局，恢复桌面端「文生图/图生图...」模式切换器与左侧 50% 调参列的网格对齐（fix: restore laboratory mode nav alignment with left parameter column）。
- **qianlian/deepseek-v4-flash-0731**：wrangler 启动偶发卡顿加固——25 秒零输出看门狗自动重启 + 慢启动不误杀（任意输出即活）+ 被淘汰实例退出静默 + 注入 ALL_PROXY 全覆盖（fix: add wrangler zero-output watchdog with restart and retire guard）。
- **Gemini (Flash)**：角色库多选栏升级为底部居中悬浮胶囊栏，精细化生图历史多选工具栏与角色参考管理弹层交互规范（feat: standardize floating action dock and character reference manager interactions）。
- **Gemini (Flash)**：在 DesignSystem 中抽象 SegmentedControl 与 FilterPill，收敛角色库、Pixiv 画廊与 Danbooru 画廊的二级选项卡与过滤胶囊（feat: harmonize segmented controls and filter pills across galleries）。
- **Gemini (Flash)**：角色库抽卡升级为 Split-Button 组合控件，解耦纯视图列数与抽卡配置，引入画廊统一 Active State Banner 探索状态横幅（feat: standardize gacha split button and active state exploration banner across galleries）。
- **Gemini (Flash)**：规范生成历史顶栏管理按钮视觉样式，纠偏清理管理菜单中的图标语义（refactor: normalize history toolbar layout and cleanup menu icon semantics）。
- **Gemini (Flash)**：重构生图实验室顶层命令栏接入 WorkspaceToolbar 契约，收敛所有散装操作按钮至 DesignSystem 标准 IconButton / ToolbarButton 规范（refactor: align laboratory command bar with design system toolbar standards）。
- **Gemini (Flash)**：建立全页面顶栏统一空间网格（Zone A/B/C/D）与固定操作区契约，补齐角色库桌面刷新与 Pixiv 反推入口（feat: unify top bar spatial grid and action layouts across all workspace pages）。
- **Gemini (Flash)**：优化全局控件与交互设计语言一致性，统一 `<select>` 尺寸与动态圆角适配、收敛收藏高亮色系、规范浮层圆角并清理 Danbooru 冗余引用（style: align control styling and popovers across galleries with dynamic corner adaptation）。
- **qianlian/deepseek-v4-flash-0731**：修复启动器回归——恢复被误删的 gatewayStartedAt 声明,启动恢复 2.2 秒就绪（fix: restore gatewayStartedAt declaration in launcher）。
- **qianlian/deepseek-v4-flash-0731**：启动偶发卡住排查与加固——网关 init 逐点计时证明偶发性,新增「图片网关初始化中…」提示与 90 秒超时保护,不再无限静默（fix: surface gateway init progress and add timeout guard）。
- **qianlian/deepseek-v4-flash-0731**：修复 Pixiv「我的收藏」Invalid request.—— 根因为 bookmarks 接口必须真实数字 user_id 而代码写死 'me';OAuth 刷新响应提取并持久化 uid,收藏 Feed 自动携带（fix: use real pixiv user id for bookmarks feed）。
- **qianlian/deepseek-v4-flash-0731**：Pixiv 收藏失败诊断与文案——加收藏诊断日志、Invalid request. 文案友好化、TS lib 升 ES2024（fix: diagnose pixiv bookmark failures and localize error message）。
- **qianlian/deepseek-v4-flash-0731**：按用户决定移除 Danbooru 抽卡漫游（order:random 上游不稳定）;保留 worker 手动输入兼容与通用超时重试,画师抽卡不受影响（refactor: remove danbooru gacha feature due to upstream instability）。
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
