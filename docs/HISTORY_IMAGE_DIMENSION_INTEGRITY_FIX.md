# 历史图片方向错误：真实尺寸校验、旧数据容错与测试污染清理指导

## 任务目标

修复 NPM 历史页出现“真实横图被显示成竖图并裁掉左右内容”的问题。

本任务分为三个层次：

1. **界面容错**：历史卡必须能用图片真实尺寸纠正错误的 `params.width/height`。
2. **写入防护**：上传历史图片时，不能无条件相信调用方提供的宽高元数据。
3. **数据清理**：精确清理已经确认的 `batch check` 测试污染记录，但不得误删原始历史。

不要把本问题误判为最短列瀑布流算法错误。最短列算法只是根据传入比例决定高度；真正错误的是比例来源与图片文件不一致。

## 已确认的证据

异常记录：

```text
id: history-thumb-batch-1786306397692-7
prompt: batch check
createdAt（显示）: 2026-08-10 04:13:21
保存的 params: 832 × 1216
图片文件真实尺寸: 1216 × 832
SHA-256: C2670C62B3B753CFC133C12A06A408E8DDC4B5E77ED93A74C0E734560EFB163E
```

对应的正常原始记录：

```text
id: cb4ed25c-33fb-4cba-9b67-ab72d278b268
createdAt: 2026-08-03 04:41:05
保存的 params: 1216 × 832
图片文件真实尺寸: 1216 × 832
SHA-256: C2670C62B3B753CFC133C12A06A408E8DDC4B5E77ED93A74C0E734560EFB163E
```

两条记录的图片字节完全相同。异常记录是复制原图后制造的测试历史，宽高被写成了默认竖图值，并且没有在测试结束后清理。

## 当前错误链路

### 1. 测试调用方写入错误元数据

测试记录把真实 `1216×832` 横图和以下元数据一起上传：

```json
{
  "width": 832,
  "height": 1216
}
```

### 2. Worker 只验证图片格式，不验证尺寸

`worker/index.ts` 中 `parseUploadedImage()` 当前只验证：

- PNG/JPEG/WebP 类型；
- 文件大小；
- 文件签名。

它返回：

```text
bytes
format
contentType
```

没有返回真实 `width/height`。

`POST /api/local-history` 随后直接执行：

```text
JSON.stringify(body.params || {})
```

所以调用方写错宽高时，数据库会原样接受。

### 3. 历史页无条件相信错误 params

`components/GenHistory.tsx` 当前两处使用：

```tsx
(item.params.width || 832) / (item.params.height || 1216)
```

分别用于：

- 最短列预计高度；
- `.mobile-gallery-frame` 的 `aspect-ratio`。

真实横图因此被放进竖向容器。`SmartImage` 使用 `object-cover`，最终把图片左右大幅裁掉，看起来像一张竖图近景。

## 修改边界

主要文件：

- `components/GenHistory.tsx`
- `services/localHistory.ts`
- `worker/index.ts`
- `scripts/media-gateway.test.mjs` 或适合的现有测试文件
- `CHANGELOG.md`

可能需要新增一个小型纯函数模块，用于解析 PNG/JPEG/WebP 图片尺寸。不要把复杂的二进制解析全部塞进历史接口分支。

不要修改：

- `ShortestColumnMasonry` 的最短列逻辑；
- 固定列宽修复；
- 日期分组、分页、收藏和多选语义；
- 横图/竖图自然比例规则；
- 非历史页面，除非它们明确复用新增的安全图片尺寸工具且有测试覆盖。

开始前必须运行：

```powershell
git status --short
```

不要覆盖用户已有的未提交 MD 或其他无关文件。

## 第一部分：历史页使用真实图片比例容错

这是修复已有错误记录最直接、风险最低的一层。

### 1. 增加实际比例状态

在 `GenHistory` 中增加按记录 ID 保存的真实比例：

```text
actualImageRatios: Record<string, number>
```

不要直接修改 `item.params`，避免把展示层修正误当成数据库已经修复。

### 2. 收敛比例读取函数

建立一个明确函数，例如：

```text
getHistoryImageRatio(item)
```

优先级：

```text
actualImageRatios[item.id]
→ 有效的 item.params.width / item.params.height
→ 默认 832 / 1216
```

必须防御：

- 0；
- 负数；
- `NaN`；
- `Infinity`；
- 缺失 params。

### 3. 图片加载后读取真实比例

给历史卡的 `SmartImage` 增加 `onLoad`：

```text
realRatio = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight
```

当前加载的可能是缩略图，但缩略图保持原始比例，因此可以安全用于方向和比例判断。

只有在以下情况下更新状态：

- `naturalWidth/naturalHeight` 有效；
- 新比例与已保存真实比例确实不同；
- 避免每次渲染重复写状态。

### 4. 两处必须使用同一个比例函数

以下两处必须同时改用 `getHistoryImageRatio(item)`：

1. `estimateHistoryCardHeight`；
2. 卡片 `--mobile-image-ratio`。

不能只修 CSS 容器而不修最短列高度估算，否则视觉方向恢复后，分列仍然使用错误高度。

### 5. 预期行为

异常记录第一次渲染时可能短暂使用旧 params；图片加载完成后应立刻：

- 从竖向容器恢复为横向容器；
- 展示完整横图；
- 触发最短列重新计算；
- 不需要刷新页面。

正常记录的真实比例与 params 一致，不应发生可见跳动。

## 第二部分：上传历史时纠正真实宽高

界面容错只能修显示，不能阻止未来继续写入错误数据。历史写入流程必须校验图片真实尺寸。

### 推荐原则

数据库中 `params.width/height` 应表示实际生成图片画布尺寸。上传图片字节与传入 params 冲突时，以图片真实尺寸为准。

保留 `params` 中其他生成参数，例如：

- steps；
- scale；
- sampler；
- seed；
- qualityToggle；
- 角色参数等。

只覆盖：

```text
width
height
```

### A. 客户端防护

`services/localHistory.ts` 在 Blob 上传路径中已经会为缩略图调用 `createImageBitmap()`。

建议把当前只返回缩略图 Blob 的逻辑收敛为类似：

```text
thumbnail
width
height
```

然后在构造上传 metadata 时使用真实尺寸覆盖：

```text
params: {
  ...item.params,
  width: decodedWidth,
  height: decodedHeight
}
```

不要为了读尺寸再次解码同一张图片；尽量复用生成缩略图时已经创建的 bitmap。

如果缩略图生成失败，上传历史本身是否继续应保持当前语义，但服务端仍必须承担最终校验。

### B. Worker 最终防护

客户端校验可以被直接 API 调用绕过，这次的 `batch check` 就是例子。因此 Worker 才是最终可信边界。

为 PNG/JPEG/WebP 增加经过边界检查的真实尺寸解析函数，例如：

```text
readImageDimensions(bytes, format) → { width, height }
```

要求：

- PNG：读取 IHDR；
- JPEG：遍历合法段，读取 SOF 尺寸；
- WebP：覆盖项目允许的 VP8、VP8L、VP8X；
- 每一步检查缓冲区边界；
- 拒绝 0、负数、异常巨大或解析失败的尺寸；
- 不只根据文件扩展名判断。

`parseUploadedImage()` 或历史 POST 分支拿到真实尺寸后，保存参数应为：

```text
normalizedParams = {
  ...(body.params || {}),
  width: actualWidth,
  height: actualHeight
}
```

然后数据库写入和返回对象都必须使用同一个 `normalizedParams`，不能数据库写正确、响应仍返回旧值。

### 非 multipart/Data URL 路径

历史接口同时支持：

- multipart Blob；
- Data URL JSON。

两条路径都必须从最终 `bytes` 解出尺寸并统一规范化，不能只修 multipart。

## 第三部分：处理现有污染记录

### 安全原则

删除历史数据是不可逆操作。执行 AI 不得批量清理，也不得用 Prompt 模糊匹配直接删除。

只允许针对经过重新验证的精确 ID：

```text
history-thumb-batch-1786306397692-7
```

### 删除前必须重新验证

1. 异常记录仍存在；
2. Prompt 仍为 `batch check`；
3. 保存 params 仍为 `832×1216`；
4. 图片真实尺寸仍为 `1216×832`；
5. 图片 SHA-256 仍与原始记录一致；
6. 原始记录 `cb4ed25c-33fb-4cba-9b67-ab72d278b268` 仍存在且可正常读取；
7. 异常记录未被用户收藏、补充备注或用于其他资料引用。

全部满足后，向用户说明将删除的精确记录及其不可恢复性，并取得明确授权，再调用：

```text
DELETE /api/local-history/history-thumb-batch-1786306397692-7
```

删除后重新查询，确认：

- 异常记录消失；
- 原始记录仍存在；
- 原始图片仍可打开；
- 8月10日的空日期分组自动消失。

不要删除原始记录，不要直接删除 R2 对象，不要运行“清空历史”。应通过现有单条历史删除接口，让引用检查和存储清理逻辑正常执行。

如果用户没有授权删除，只完成代码防护并保留记录；前端真实比例容错仍应让它以横图显示。

## 需要补充的测试

### 图片尺寸解析测试

为最小 PNG、JPEG、WebP 测试样本验证：

- 正确读取横图尺寸；
- 正确读取竖图尺寸；
- 正确读取方图尺寸；
- 截断文件被拒绝；
- 伪造文件签名被拒绝；
- 0尺寸和异常尺寸被拒绝。

### 历史接口测试

至少覆盖：

1. 上传真实 `1216×832` 横图，metadata 伪报 `832×1216`；返回和数据库必须保存 `1216×832`。
2. 上传真实 `832×1216` 竖图，metadata 伪报横图；必须保存真实竖图尺寸。
3. metadata 不含 width/height；应补全真实尺寸。
4. 其他 params 字段保持原样。
5. multipart 和 Data URL 两条路径行为一致。

### 历史 UI 测试

构造一条旧记录：

```text
params: 832×1216
实际图片: 1216×832
```

验证：

1. 图片加载后卡片变为横图比例；
2. 左右内容不再被裁成竖版近景；
3. 最短列重新分配；
4. 正常横图和正常竖图不受影响；
5. 瀑布流、竖向卡片、方形模式均符合各自规则。

## 不要采用的方案

1. 不要把所有历史图片强制显示成横图。
2. 不要交换所有记录的 width/height。
3. 不要根据“画面看起来像横图”猜测方向。
4. 不要只改 `object-cover` 为 `object-contain`；这只会出现留黑，错误容器比例仍然存在。
5. 不要只改最短列预计高度而不改卡片 aspect-ratio。
6. 不要只改卡片 aspect-ratio 而不改最短列预计高度。
7. 不要只修这条数据库记录而不增加未来写入校验。
8. 不要只修客户端；直接 API 调用仍可绕过。
9. 不要批量删除所有 `history-thumb-*`，其中可能包含其他合法记录。
10. 不要删除原始 `cb4ed25c-33fb-4cba-9b67-ab72d278b268`。

## 浏览器验收

必须用真实历史页检查：

1. 异常副本在未删除前能自动按真实横图显示；
2. 8月3日原始横图继续正确；
3. 两张相同图片显示方向和构图一致；
4. 横图不再被竖框裁切；
5. 日期分组固定列宽没有退化；
6. 前 N 张先横向起排，后续进入最短列；
7. 收藏、多选、删除、大图、分页正常；
8. 安全模式模糊正常；
9. 窗口缩放和列数切换正常。

## 验证命令

至少执行：

```powershell
npm run test:gateway
npm run build
npx tsc -b
git diff --check
```

构建通过不能替代真实图片尺寸与界面验证。

## 最终交付说明

执行 AI 必须明确报告：

1. 前端如何从真实图片尺寸纠正旧记录；
2. Worker 如何解析并覆盖错误 width/height；
3. multipart 与 Data URL 是否都覆盖；
4. 是否验证了异常记录和原始记录的 SHA-256；
5. 是否获得用户授权并删除精确测试记录；
6. 是否确认原始记录仍然存在；
7. 测试了哪些 PNG/JPEG/WebP 尺寸组合；
8. 是否确认最短列和固定列宽没有回归。

只有用户明确要求提交时才提交。

建议提交信息：

```text
fix: validate history image dimensions against uploaded files
```
