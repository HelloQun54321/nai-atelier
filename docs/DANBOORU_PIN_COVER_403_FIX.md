# Danbooru 图钉设封面 403：修复指导

## 任务目标

修复角色 Tag、画师 Tag 点击紫色图钉后出现以下错误的问题：

```text
设置封面失败：{"error":"Failed to fetch and store external image: Failed to fetch image: 403 Forbidden"}
```

修复后，用户当前切换到的 Danbooru 图片应被复制到项目自己的 R2 存储，并成为该 Tag 的固定封面。刷新页面、重启本地服务或 Danbooru CDN 状态变化后，封面仍应可用。

本任务不是修改图钉样式，也不是重新实现图片左右切换。

## 已确认的根本原因

当前系统有两条不同的图片下载链路。

### 卡片显示链路（成功）

```text
DanbooruCover / SmartImage
→ GET /api/media?source=<cdn.donmai.us URL>&variant=thumb-640
→ 本机 media gateway
→ cdn.donmai.us
→ 浏览器正常显示
```

本机媒体网关请求外图时会发送：

```text
Accept: image/*
User-Agent: NaiPromptManager-MediaGateway/1.0
```

相关实现：

- `components/DanbooruCover.tsx`
- `components/SmartImage.tsx`
- `services/mobileImageCache.ts`
- `scripts/media-gateway.mjs` 中的 `requestRemoteBuffer()`

### 点击图钉后的保存链路（失败）

```text
CharacterLibrary / ArtistLibrary
→ 把 candidate.sampleUrl 作为外链字符串提交给 Worker
→ Worker 的 fetchAndUploadImage() 从 cdn.donmai.us 再下载一次
→ Danbooru CDN 向 Worker 返回 403
→ 尚未写入 R2，接口返回 422
→ 前端显示“设置封面失败”
```

`worker/index.ts` 当前使用：

```ts
fetch(target.toString(), {
  redirect: 'manual',
  signal: AbortSignal.timeout(20_000),
})
```

这次请求发生在 Cloudflare Worker，而不是已经能够正常下载图片的本机媒体网关。

### 已确认的现场证据

页面中“御坂美琴”卡片当前使用的图片源为：

```text
https://cdn.donmai.us/720x720/dc/a9/dca982197296325d7f1512873cee06d8.webp
```

浏览器实际显示地址为：

```text
/api/media?source=<上述 URL>&variant=thumb-640
```

同一 CDN URL 在本机直接请求返回：

```text
200 image/webp
```

所以图片没有失效，URL 也没有写错。失败来自 Worker 与本机媒体网关之间的请求来源、请求特征和上游策略差异。

该图钉链路由提交引入：

```text
7aa6ac5 feat: browse and pin tag cover images
```

## 修复原则

不要再让 Cloudflare Worker 为“设为 Danbooru 封面”直接抓取 `cdn.donmai.us`。

应复用已经验证可用的本机 `/api/media` 链路取得图片字节，然后把图片数据提交给现有上传接口：

```text
当前选中的 candidate.sampleUrl
→ 本机 /api/media，variant=original
→ 得到原始 sample 图片 Blob
→ 转成 data:image/...;base64,...
→ PUT /api/chains/:id 或 POST /api/artists
→ Worker 走现有 processImageUpload()
→ 写入 R2
→ 数据库只保存 /api/assets/... 地址
```

这样 Worker 只接收图片数据并存储，不再负责访问 Danbooru CDN。

必须使用 `variant=original`，不能上传页面正在显示的 `thumb-640` 缩略图。否则虽然图钉可能成功，但固定封面会被永久保存成低清缩略图。

## 修改边界

主要文件：

- `components/CharacterLibrary.tsx`
- `components/ArtistLibrary.tsx`
- `services/mobileImageCache.ts`，仅复用已有 `buildMediaUrl()`，原则上不需要改变其现有行为
- 建议新增 `services/danbooruCoverImport.ts`
- `worker/index.ts`，只做必要的数据上传一致性修正
- `scripts/media-gateway.test.mjs`
- `CHANGELOG.md`

可能需要小幅修改：

- `components/TagCoverActions.tsx`，仅用于保存中的禁用状态或加载反馈

不要修改：

- Danbooru 热度排序；
- 左右切换和继续加载候选图的逻辑；
- 已保存封面与候选图之间的切换语义；
- 角色 Tag、画师 Tag 的卡片布局；
- 安全模式模糊逻辑；
- 图片瀑布流；
- R2 中已有封面；
- 与本问题无关的媒体代理、历史图片或画师串逻辑。

开始前必须运行：

```powershell
git status --short
```

不得覆盖或删除用户已有的未提交文件。

## 第一部分：建立统一的 Danbooru 封面导入函数

建议新增：

```text
services/danbooruCoverImport.ts
```

导出一个职责单一的函数，例如：

```ts
importDanbooruCoverAsDataUrl(sampleUrl: string): Promise<string>
```

### 1. 严格校验输入 URL

只允许：

```text
协议：https:
主机：cdn.donmai.us
无 username/password
```

不要接受字符串包含判断，例如：

```ts
sampleUrl.includes('cdn.donmai.us')
```

必须使用 `new URL()` 后精确比较 `hostname`，防止类似以下地址绕过：

```text
https://cdn.donmai.us.evil.example/image.webp
```

### 2. 通过本机媒体网关读取原图

复用：

```ts
buildMediaUrl(sampleUrl, 'original')
```

请求目标应类似：

```text
/api/media?source=https%3A%2F%2Fcdn.donmai.us%2F...&variant=original
```

不要直接执行：

```ts
fetch(sampleUrl)
```

也不要从 `<img>.currentSrc` 读取，因为 `SmartImage` 的 `currentSrc` 通常是 `thumb-640`。

建议为请求增加约 20 秒超时，并在 `finally` 中清理定时器。

### 3. 校验响应

必须校验：

- `response.ok`；
- `Content-Type` 只能是 `image/png`、`image/jpeg`、`image/webp`；
- Blob 实际大小大于 0；
- Blob 不超过 Worker 已有的 `MAX_MANAGED_IMAGE_BYTES`，当前为 12 MiB。

如果存在 `Content-Length`，可以提前拒绝超限响应；读取 Blob 后仍须按 `blob.size` 再检查一次。

不要相信文件扩展名来决定 MIME 类型。

### 4. 保留图片原始字节

使用 `FileReader.readAsDataURL(blob)` 转成 data URL。

不要使用 canvas 重绘，不要转成 JPEG，不要压缩，也不要缩放。Danbooru 的 `sampleUrl` 已经是适合卡片封面的中等尺寸资源，再次有损处理只会降低质量。

输出必须匹配：

```text
data:image/(png|jpeg|webp);base64,...
```

### 5. 错误信息

辅助函数应抛出对用户有意义的中文错误，例如：

```text
无法通过本机图片服务读取这张 Danbooru 图片（HTTP 403）
图片响应格式不是 PNG、JPEG 或 WebP
封面图片超过 12MB
读取封面图片失败
```

不要把完整 base64、Cookie、内部密钥或长 HTML 响应写入日志和通知。

## 第二部分：修复角色 Tag 图钉

当前错误代码位于 `CharacterLibrary.tsx` 的 `setDanbooruCover()`：

```ts
await db.updateChain(chainId, { previewImage: candidate.sampleUrl });
```

应改为以下顺序：

1. 先调用 `importDanbooruCoverAsDataUrl(candidate.sampleUrl)`；
2. 只有图片读取成功后，才查找或创建角色 chain；
3. 使用得到的 data URL 更新 `previewImage`；
4. 等接口成功后再 `onRefresh()`；
5. 最后显示成功通知。

目标语义：

```ts
const coverDataUrl = await importDanbooruCoverAsDataUrl(candidate.sampleUrl);
// 图片字节已经准备成功后，才创建缺失的角色记录。
// ...确保 chainId...
await db.updateChain(chainId, { previewImage: coverDataUrl });
```

这一顺序很重要。当前实现会先创建角色记录，再尝试下载图片；下载 403 后可能留下“已经创建但没有封面”的空记录。修复后，至少外图读取失败时不得创建新角色记录。

不要在失败时自动删除已有 chain。删除动作可能误伤用户已经编辑过的角色数据。

## 第三部分：修复画师 Tag 图钉

当前错误代码位于 `ArtistLibrary.tsx` 的 `setDanbooruCover()`：

```ts
imageUrl: candidate.sampleUrl
```

应先取得 data URL，再提交：

```ts
const coverDataUrl = await importDanbooruCoverAsDataUrl(candidate.sampleUrl);

await api.post('/artists', {
  id: artist.id,
  name: artist.name,
  imageUrl: coverDataUrl,
  previewUrl: artist.previewUrl,
  benchmarks: artist.benchmarks || [],
});
```

必须保留原有：

- `id`；
- `name`；
- `previewUrl`；
- `benchmarks`。

不能为了更新封面而清空画师已有基准图或其他配置。

## 第四部分：Worker 端保持“上传数据”路径一致

以下现有分支应继续保留：

```text
角色 previewImage 以 data: 开头
→ processImageUpload(..., 'covers', ...)

画师 imageUrl 以 data: 开头
→ processImageUpload(..., 'artists', ...)
```

角色分支已经把 `currentUser` 传入 `processImageUpload()`。

画师 data URL 分支当前没有传 `currentUser`：

```ts
processImageUpload(env, imageUrl, 'artists', id)
```

应改为：

```ts
processImageUpload(env, imageUrl, 'artists', id, currentUser)
```

否则画师的新上传路径与角色路径的存储配额行为不一致。

原有 HTTP 外链分支可以保留，避免影响其他调用方；但角色 Tag、画师 Tag 的 Danbooru 图钉不能再走这个分支。

## 第五部分：防止重复提交

建议为图钉保存增加按卡片区分的 pending 状态，例如：

```text
pinningCoverKey
```

保存期间：

- 当前卡片的图钉禁用；
- 不允许同一图片重复提交；
- 左右切换是否禁用可按现有交互决定，但提交时必须使用点击瞬间捕获的 `candidate`；
- 成功或失败后在 `finally` 中清理 pending 状态。

不要使用全页 loading 阻塞整个角色库或画师库。

这一部分不是 403 的根因，但可以避免用户看到无响应后连续点击，产生多个 R2 文件或并发更新。

## 不接受的修复方式

### 1. 只给 Worker 的 fetch 增加 User-Agent

不接受把以下做法作为最终修复：

```ts
fetch(url, { headers: { 'User-Agent': '...' } })
```

Danbooru CDN 可能按 Worker 出口、网络信誉或其他请求特征返回 403；单加请求头不能保证解决，而且会继续维持两套互不一致的下载链路。

### 2. 改存 previewUrl 或 thumb-640

不接受。这样会把低清缩略图永久存为封面，重新引入“缩略图太糊”的问题。

### 3. 数据库直接保存 Danbooru 外链

不接受。外链可能失效、改变或继续受到防盗链限制，也违背“复制到项目自己的存储”的现有设计。

### 4. 关闭 URL 白名单或 SSRF 校验

不接受。不能为了绕过 403 允许用户让服务端访问任意 URL、局域网地址或带认证信息的地址。

### 5. 前端捕获错误后仍提示成功

不接受。只有 R2 上传和数据库更新全部成功后才能提示“已设为封面”。

### 6. 用当前 DOM 图片截图或 canvas 重绘

不接受。当前 DOM 很可能显示的是 `thumb-640`，canvas 还会造成额外压缩、透明背景变化和跨域污染问题。

## 自动化验证

### 1. 媒体网关测试

在 `scripts/media-gateway.test.mjs` 增加或补强测试，确认：

- `cdn.donmai.us` 是允许的媒体源；
- 非白名单主机被拒绝；
- `requestRemoteBuffer()` 向上游发送 `Accept: image/*`；
- `variant=original` 返回上游原始字节，不经过缩略图生成；
- 403、非图片响应和超过大小限制的响应不会被当作成功图片。

不得在自动化测试中依赖真实 Danbooru 网络。使用 mock `remoteFetch` 和固定字节即可。

### 2. 类型与构建

必须执行：

```powershell
npx tsc -b
npm run build
npm run test:gateway
git diff --check
```

## 手工验收

至少完成以下场景。

### 角色 Tag

1. 打开角色 Tag；
2. 找到一个尚未保存封面的目录角色；
3. 左右切换到非第一张候选图；
4. 点击紫色图钉；
5. 不再出现 403；
6. 成功后封面仍是点击时的那一张，而不是第一张；
7. 刷新页面后仍显示为“已保存封面”；
8. 数据库中的 `preview_image` 应为 `/api/assets/covers/...`，不能是 `cdn.donmai.us` 和 `data:`。

### 画师 Tag

1. 打开画师 Tag；
2. 切换到另一张候选图；
3. 点击图钉；
4. 保存成功；
5. 刷新后仍是所选图片；
6. 画师原有 `benchmarks` 和 `previewUrl` 未丢失；
7. 数据库中的 `image_url` 应为 `/api/assets/artists/...`。

### 失败与回归

- 模拟本机媒体网关返回 403：前端显示清晰错误，不创建新的角色记录；
- 模拟非图片响应：不得上传；
- 快速连点图钉：只能产生一次有效保存；
- 安全模式开启时，浏览中的图片仍按原逻辑模糊，保存结果不受影响；
- 左右切换、热度排序、继续加载全部图片不受影响；
- 已有固定封面仍能显示；
- 角色手工生成封面与画师手工上传封面不受影响。

### 网络链路检查

使用浏览器 Network 或本地日志确认图钉保存时：

```text
浏览器先请求 /api/media?...&variant=original
随后 PUT /api/chains/:id 或 POST /api/artists 的图片字段以 data:image/... 开头
Worker 不再为这次图钉操作请求 cdn.donmai.us
最终接口返回成功
```

不要在交付截图、日志或回复中粘贴完整 data URL。

## 数据安全

- 不要删除用户已有角色、画师或封面；
- 不要为了测试覆盖正式角色的固定封面，优先使用未固定的测试对象；
- 如果测试产生了临时角色或画师，记录其精确 ID，并在确认属于本次测试后清理；
- 不要批量清理 R2；
- 不要修改用户原有收藏状态；
- 不要把 data URL、Cookie、局域网访问密钥写入日志。

## Git 要求

本任务开始和结束时都执行：

```powershell
git status --short
```

只修改本任务范围内的文件。用户没有明确要求提交时，不要执行 `git add` 或 `git commit`。

## 最终交付说明必须回答

1. 图钉保存是否已经完全绕过 Worker 对 Danbooru CDN 的直接下载；
2. 是否使用 `variant=original`，而不是 `thumb-640`；
3. 角色与画师是否共用同一个安全导入函数；
4. 新角色在图片读取失败时是否还会留下空记录；
5. 数据库最终保存的是哪个 `/api/assets/...` 地址；
6. 画师原有 `benchmarks`、`previewUrl` 是否保持；
7. 自动化与手工验收分别通过了哪些项目；
8. 是否产生或清理了测试数据；
9. 是否提交 Git；若未提交，列出工作区改动。
