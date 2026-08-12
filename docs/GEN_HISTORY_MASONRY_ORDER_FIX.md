# 生成历史瀑布流：横向起排与最短列分配修复指导

> **纠偏提醒：** 本文最初要求 `effectiveColumns = min(requestedColumns, group.items.length)`，会导致单图日期分组占满整行。该要求已被废止。继续修复前必须改读 `docs/MASONRY_STABLE_COLUMN_WIDTH_CORRECTION.md`，以请求列数保持固定网格轨道和稳定卡片宽度。

## 任务目标

修复 NPM「历史」页面在瀑布流模式下的排列顺序：

1. 同一日期分组内，最初的图片先从左到右占满可用列。
2. 列被占满后，后续图片放到当前累计高度最短的列下面。
3. 横图和竖图继续保持相同列宽及各自自然宽高比。
4. 不把横图、竖图强制做成相同高度，也不裁成统一方形。
5. 「竖向卡片」和「方形」两种布局保持现状。

目标效果不是“让横图和竖图看起来一样大”，而是：

```text
等宽自然比例 + 先横向起排 + 后续进入最短列
```

## 修改边界

主要文件：

- `components/GenHistory.tsx`
- `components/ShortestColumnMasonry.tsx`（优先复用，原则上不需要重写）

可能需要核对但尽量不要修改：

- `index.css`
- `services/imageDisplayPreferences.ts`
- `CHANGELOG.md`

不要顺手改 AITag、Danbooru、灵感库、画师 Tag 或角色 Tag 的布局。这次只处理生成历史。

开始前先运行 `git status --short`，不要覆盖用户已有的未提交文件。

## 当前问题及原因

历史页在 `components/GenHistory.tsx` 中按日期生成独立分组：

```tsx
{historyGroups.map(group => <section key={group.key}>
  ...
  <div className={`${mobileGalleryClassName(imageDisplay)} ...`}>
    {group.items.map(/* history card */)}
  </div>
</section>)}
```

瀑布流模式仍依赖 `index.css` 的 CSS Multi-column：

```css
.mobile-gallery--masonry {
  display: block;
  column-count: var(--mobile-gallery-columns, ...);
}

.mobile-gallery--masonry > * {
  display: inline-flex;
  width: 100%;
  break-inside: avoid;
}
```

CSS Columns 的数据流向是“先从上到下，再进入下一列”，并由浏览器平衡列高。它不是常见图片应用所期待的“先从左到右，再放入最短列”。

因此，同一天只有 5 张图时，可能出现：

```text
第1列：图1、图2
第2列：图3、图4
第3列：图5
第4、5列：空
```

而目标应为：

```text
第1列：图1
第2列：图2
第3列：图3
第4列：图4
第5列：图5
```

有更多图片时，再把下一张放到当前最短列下方。

## 关于横图较矮、竖图较高

这部分是正确的瀑布流行为，不要“修复”。

历史卡当前使用生成参数作为图片比例：

```tsx
style={{
  '--mobile-image-ratio': `${item.params.width || 832} / ${item.params.height || 1216}`,
}}
```

相同列宽下：

- 横图的高度自然较小；
- 竖图的高度自然较大。

这就是等宽自然比例瀑布流。如果产品以后要让横图具有更大的视觉面积，应另行设计“横图跨两列”或“等高行画廊”，不属于本修复。

## 复用现有最短列组件

提交 `b90c0dd` 已新增：

```text
components/ShortestColumnMasonry.tsx
```

它已经提供：

- `ShortestColumnMasonry`
- `useMasonryColumnCount`
- `computeShortestColumnAssignment`

虽然部分注释和 CSS 类名还写着 `ChainList`，组件接口本身是泛型的，可以直接用于 `LocalGenItem`。不要在 `GenHistory.tsx` 中再复制一份相同算法。

本次优先最小化修改：复用现有组件。不要为了名称更通用而同时大规模重命名 CSS 类；如确实要重命名，必须同步验证画师串和角色串。

## 推荐实施步骤

### 1. 引入最短列组件和列数 Hook

在 `GenHistory.tsx` 中引入：

```tsx
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
```

在组件顶层，根据现有 `imageDisplay` 取得请求列数：

```tsx
const masonryColumns = useMasonryColumnCount(imageDisplay);
```

不要在日期分组的 `.map()` 内调用 Hook。

### 2. 抽取历史卡片渲染函数

把当前 `group.items.map(item => (...))` 中的整张卡片 JSX 抽成一个函数，例如：

```tsx
const renderHistoryCard = (item: LocalGenItem) => (...);
```

必须原样保留：

- 打开大图；
- 长按进入多选；
- 单张选择状态；
- 收藏/取消收藏；
- 删除；
- 悬停时间信息；
- 手机端时间文字；
- 安全模式和缩略图网关；
- 当前 `thumbnailVariant`；
- 深色/浅色样式。

不要在抽取过程中顺手格式化或改写其他历史页逻辑。

### 3. 提供准确的预计卡片高度

历史图片的比例已经存在于数据中，不需要等待图片 `onLoad`：

```text
ratio = (item.params.width || 832) / (item.params.height || 1216)
imageHeight = columnWidth / ratio
```

预计高度还应计入：

- 卡片上下边框；
- 手机端显示的时间行高度；
- 同列卡片之间的 12px 间距。

可按以下语义实现：

```text
desktopEstimatedHeight = imageHeight + 2 + 12
mobileEstimatedHeight  = imageHeight + mobileTimeRowHeight + 2 + 12
```

重点不是精确到 1px，而是横竖图之间的相对高度必须正确，并且每新增一张卡应计入列间纵向间距。

如果当前组件无法方便地判断手机端，可以使用与现有 768px 断点一致的响应式状态；不要在循环中反复读取 DOM。

### 4. 仅在 masonry 分支使用最短列布局

每个日期分组内部使用：

```tsx
{imageDisplay.layout === 'masonry' ? (
  <ShortestColumnMasonry
    items={group.items}
    columns={masonryColumns}
    getItemKey={item => item.id}
    estimateItemHeight={estimateHistoryCardHeight}
    renderItem={renderHistoryCard}
  />
) : (
  <div
    className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-history-grid`}
    style={mobileGalleryStyle(imageDisplay)}
  >
    {group.items.map(renderHistoryCard)}
  </div>
)}
```

关键要求：

- 一个日期分组对应一个独立的 `ShortestColumnMasonry`；
- 不允许把不同日期的图片混到同一组最短列计算中；
- 非 masonry 模式继续使用原来的 Grid；
- 最短列外层不要再带 `.mobile-gallery--masonry`，否则 CSS Columns 会再次介入。

### 5. 保持日期内现有顺序

布局组件只能消费已经排好顺序的 `group.items`。

不要在布局层根据高度、横竖图或收藏状态重新排序。最短列算法应按原数据顺序逐张放置：

1. 所有列高度初始为 0；
2. 高度相同时选择最左列；
3. 因此前 N 张会从左到右占满 N 列；
4. 之后选择当前累计高度最小的列。

这能同时满足时间顺序起排和瀑布流紧凑排列。

## 需要特别检查的风险

### 日期分组数量较少

组件应使用：

```text
effectiveColumns = min(requestedColumns, group.items.length)
```

例如设置 6 列但当天只有 5 张时，应渲染 5 个有效列，不能生成第六个完整空列。

### 收藏视图即时移除

在“只看收藏”中取消收藏后，图片可能立即从 `items` 和 `historyGroups` 中消失。分列必须随 `group.items` 更新，不得保留旧列或空占位。

### 多选模式

选择状态变化不应改变卡片预计高度。边框和 `ring` 不应造成明显跳列。

### 分页和日期边界

当前页可能从一天的中间开始，也可能同时包含多个日期。只按当前实际加载的 `group.items` 排列，不要为了填满布局跨页请求更多数据。

### 响应式变化

窗口缩放、桌面列数改变和手机旋转后必须重新计算列宽和分配。现有 `ShortestColumnMasonry` 已使用 `ResizeObserver`，不要再叠加轮询或 `setTimeout`。

## 不要采用的方案

1. 不要把 `.mobile-gallery--masonry` 全局改成普通 Grid。
2. 不要使用 `align-items: start` 的普通 Grid 冒充瀑布流。
3. 不要继续使用 CSS `column-count`，只给它增加 `min(列数, 图片数)`。
4. 不要通过固定成 3 列或 4 列来掩盖空列。
5. 不要统一图片高度、统一裁成方形或改变 `object-cover` 作为本问题的解决方案。
6. 不要让横图自动跨两列；那是另一种产品设计。
7. 不要重新排序 `group.items` 来让版面看起来更齐。
8. 不要复制一份新的最短列算法，优先复用现有组件。
9. 不要使用固定延迟、强制刷新或图片加载完成后手动刷新页面。

## 验收标准

### 排列逻辑

1. 设置 5 列、同一天 5 张：5 张必须从左到右各占一列。
2. 设置 5 列、同一天 8 张：前 5 张横向占满，后 3 张分别进入当时最短的列。
3. 设置 6 列、同一天只有 5张：只生成 5 个有效列，不出现完整空列。
4. 同一天包含横图、竖图、方图：所有卡片保持自然比例。
5. 极高竖图旁边有多张横图：横图应连续接入较短列，不能按固定行对齐。
6. 图片日期或时间排序不得改变。

### 操作回归

1. 单击打开大图正常。
2. 收藏、取消收藏正常。
3. 收藏筛选中取消收藏后立即重新排布。
4. 删除单张图片正常。
5. 桌面悬停按钮正常。
6. 手机长按多选、批量收藏和批量删除正常。
7. 翻页后布局正常。
8. 多个日期分组分别独立排布。
9. 安全模式模糊正常。

### 其他布局

1. 切换到「竖向卡片」后与修改前一致。
2. 切换到「方形」后与修改前一致。
3. 修改桌面/移动端列数后立即生效。
4. 调整浏览器宽度或旋转手机后立即重新分列。

## 验证要求

至少执行：

```powershell
npm run test:gateway
npm run build
git diff --check
```

还必须进行真实浏览器视觉验证，至少准备以下日期分组：

```text
5 张：2 横 + 3 竖
8 张：横竖混合
12 张以上：极端比例混合
两个相邻日期：每组数量不同
```

只看到构建通过不能证明排列顺序正确。

## 最终交付说明

完成后应明确报告：

1. 是否复用了 `ShortestColumnMasonry`；
2. 历史卡预计高度如何计算；
3. 验证了哪些日期分组和图片数量；
4. 是否验证了收藏即时移除、多选、窗口缩放；
5. 是否确认「竖向卡片」「方形」未受影响。

建议提交信息（只有用户要求提交时才提交）：

```text
fix: fill history masonry from left to right
```
