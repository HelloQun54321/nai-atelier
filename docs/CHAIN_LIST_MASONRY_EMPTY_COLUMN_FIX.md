# 画师串收藏页瀑布流右侧空列：修复指导

> **纠偏提醒：** 本文最初要求根据卡片数量减少实际网格列数，这会使少量收藏被异常放大。该要求已被废止。后续修复必须改读 `docs/MASONRY_STABLE_COLUMN_WIDTH_CORRECTION.md`，区分请求网格轨道数和实际非空列数。

## 任务目标

修复 NPM「画师串 → 收藏 → 瀑布流」在收藏数量较少或图片比例差异较大时，最右侧出现完整空列的问题。

本任务必须同时满足：

1. 瀑布流仍然是真正的瀑布流：下一张卡片应接在当前最短列下方。
2. 可用列应从左到右全部使用，不能在右侧保留完整空列。
3. 保留卡片自身的自然图片比例，不能把卡片拉成相同高度。
4. 不改变「竖向卡片」和「方形」两种布局。
5. 先只修复 `ChainList`（画师串/角色串列表），不要直接改坏所有使用 `.mobile-gallery` 的页面。

## 当前基线

分析时的当前提交：

```text
956dcbe revert: restore gallery layout to pre-waterfall-fix state
```

开始修改前请先检查工作区，不要覆盖用户已有的未提交改动。

关键文件：

- `components/ChainList.tsx`
- `services/imageDisplayPreferences.ts`
- `index.css`

`ChainList.tsx` 当前将筛选后的 `visibleChains` 直接放进通用画廊容器：

```tsx
<div
  className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-chain-grid`}
  style={mobileGalleryStyle(imageDisplay)}
>
  {visibleChains.map(/* card */)}
</div>
```

当前瀑布流依靠下面的 CSS：

```css
.mobile-gallery--masonry {
  display: block;
  width: 100%;
  column-count: var(--mobile-gallery-columns, var(--mobile-gallery-cols-setting, 2));
  column-gap: .75rem;
}

.mobile-gallery--masonry > * {
  display: inline-flex;
  width: 100%;
  margin: 0 0 .75rem;
  break-inside: avoid;
}
```

## 根本原因

这不是外层容器没有 `width: 100%`，也不是收藏筛选丢失了数据。

CSS Multi-column 的排列方向是从上到下，再进入下一列。浏览器还会尝试平衡列高。每张卡片又因为 `break-inside: avoid` 而不可拆分，所以在以下组合下会出现空列：

- 设置为 5 列；
- 收藏只有 8 张左右；
- 图片横竖比例和卡片高度差异明显；
- 浏览器判断每列放约 2 张最容易平衡。

最终 8 张卡片可能被装进前 4 列，而 `column-count: 5` 仍然为第 5 列保留宽度，因此右侧出现一整块空白。

完整画师串数量多时，每列通常都有内容，所以问题主要在「收藏」「搜索结果」等少量结果中出现。

另外，`ChainList` 已经在图片 `onLoad` 后把实际宽高比写入 `previewRatios`。宽高比改变会触发二次排版，使 CSS Columns 的平衡结果发生跳动，但这只是放大问题，不是根因。

## 之前四轮修复为什么失败

不要直接恢复或重复以下提交中的方案。

### `3d727b4`：按卡片数量限制列数

它使用类似 `min(设置列数, 卡片数量)` 的逻辑。

这只能处理「卡片数少于列数」，不能处理截图中的情况：8 张卡片大于 5 列，最终列数仍然是 5，但 CSS Columns 仍可能只实际使用前 4 列。

### `056965a`：把瀑布流改成普通 Grid

普通 Grid 会按水平方向填满，不会留下完整的第五列，但同一行受最高卡片控制，不再是真正的瀑布流。

### `ec04212`：为自然高度页面恢复 CSS Columns

它恢复了真正的竖向瀑布效果，同时也恢复了本问题。提交说明中「CSS Columns 会填满所有列」这一假设不成立。

### `1472571`：Grid 加 `align-items: start`

这只是不再拉伸矮卡片。下一行仍然必须从上一行最高卡片的下方开始，会产生行级空洞，依然不是真正的瀑布流。

### `956dcbe`：整体回退

当前代码已回到上述修复之前的 CSS Columns 方案，所以问题仍然存在。

## 推荐修复方向

为 `ChainList` 增加组件级的“最短列分配”布局。不要继续依赖 CSS `column-count` 自动平衡，也不要把全局瀑布流直接替换成普通 Grid。

建议做成一个小型、可测试的组件或 Hook，例如：

```text
components/ShortestColumnMasonry.tsx
```

也可以暂时写在 `ChainList.tsx` 内，但不要把分列计算散落在卡片 JSX 中。

### 1. 只在瀑布流模式启用新布局

当 `imageDisplay.layout === 'masonry'` 时使用最短列布局。

当布局是 `portrait` 或 `square` 时，继续使用现有的 `mobileGalleryClassName()`、`mobileGalleryStyle()` 和普通 Grid，不改变现有行为。

### 2. 正确解析当前列数

列数必须同时响应：

- 移动端列数设置；
- 桌面端列数设置；
- `auto` 模式的响应式断点；
- 浏览器窗口尺寸变化。

当前自动列数规则在 `index.css` 中是：

```text
默认/手机：2
>= 768px：4
>= 1280px：5
>= 1600px：6
```

如果 `desktopColumns` 是明确数值，应优先使用它。不要在 `ChainList` 中永久硬编码为 4 或 5。

建议把“偏好 + 当前视口 → 实际列数”收敛成一个公共函数或 Hook，并监听窗口/容器尺寸变化。

实际渲染列数还应满足：

```text
effectiveColumnCount = min(requestedColumnCount, visibleChains.length)
```

空列表继续走现有空状态，不创建 0 列。

### 3. 按最短列分配卡片

创建 `effectiveColumnCount` 个列数组和对应的预计高度。

按 `visibleChains` 当前排序顺序逐张处理：

1. 找到当前预计高度最小的列；
2. 将卡片放入该列；
3. 把这张卡片的预计高度加到该列高度中。

高度估算应使用项目已经保存的实际图片比例：

```text
ratio = previewRatios[chain.id] || 4 / 3
imageHeight = columnWidth / ratio
cardHeight = imageHeight + 48px 标题区 + 边框/列间距
```

所有列宽相同，因此也可以使用等价的归一化高度计算，但必须计入每张卡都有的固定标题区，否则横图很多的列可能被低估。

最短列相同的情况下选择索引最小的列。这样最初的 N 张卡会自然地从左到右各占一列，不会跳过最右列。

### 4. 利用现有 `previewRatios` 自动重新分配

不要再建立第二套图片尺寸状态。

`ChainList` 当前已经在图片加载后执行：

```tsx
setPreviewRatios(previous => ({ ...previous, [chain.id]: ratio }))
```

分列结果应通过 `useMemo` 依赖以下数据：

- `visibleChains`
- `previewRatios`
- 实际列数
- 容器/列宽

图片比例更新后自然重新计算即可。不要用固定 `setTimeout` 等待图片，也不要通过刷新页面解决。

### 5. 渲染显式列容器

外层使用等宽 Grid，只负责生成列：

```text
外层：grid，N 个等宽列，gap 12px
每列：flex column，gap 12px，min-width 0
卡片：保持当前自然高度与现有点击、收藏、删除、悬停操作
```

注意：新瀑布流容器不要继续带上 `.mobile-gallery--masonry`，否则全局的 `column-count` 会再次作用在外层或子项上。

建议给它单独的明确类名，例如：

```text
chain-masonry
chain-masonry-column
```

### 6. 保持现有数据语义

布局层只能消费已经排好序的 `visibleChains`，不能重新筛选或重新排序原数据。

必须保留：

- 最近更新/创建排序；
- 收藏筛选；
- Tag 筛选；
- 搜索；
- 分批“加载更多”；
- 点击进入画师串；
- 收藏/取消收藏；
- 删除；
- 复制/查看详情；
- 安全模式图片处理。

## 不要采用的方案

以下方案不算完成修复：

1. 只给外层补 `width: 100%`、`flex: 1` 或 `max-width: none`。
2. 只使用 `min(列数, 卡片数量)`，然后继续交给 `column-count` 排版。
3. 使用普通 Grid 或 `align-items: start` 冒充瀑布流。
4. 通过减少固定列数（例如始终改成 4 列）掩盖问题。
5. 在所有 `.mobile-gallery--masonry` 页面上一次性替换布局，扩大回归范围。
6. 依赖实验性、当前运行环境未验证的 CSS Masonry 语法。
7. 用 `setTimeout`、强制刷新或反复读取 DOM 来碰运气。
8. 为了填满右侧而拉伸图片、裁切封面或统一卡片高度。

## 验收用例

### 必须通过

1. 2048px 左右宽屏、设置 5 列、8 张收藏：5 列都必须有卡片。
2. 5 张收藏、设置 5 列：从左到右正好使用 5 列。
3. 4 张收藏、设置 5 列：生成 4 个有效列，不保留完整的第五空列。
4. 图片同时包含极高竖图、横图和接近方图：后续卡片接在当前最短列下方。
5. 图片加载完成、宽高比更新后：布局可以平滑重排，右侧不能再次出现整列空白。
6. 从“全部”切换到“收藏”，再切回：两种状态均正确重算。
7. 在收藏视图取消某张收藏：卡片消失后立即重新分列。
8. 改变桌面列数或调整窗口宽度：列数和卡片分配立即更新。
9. 移动端 1/2/3 列设置正常。
10. 「竖向卡片」「方形」布局与修改前一致。

### 回归检查

- 画师串完整列表；
- 角色串列表；
- 搜索和 Tag 筛选；
- 加载更多；
- 安全模式模糊；
- 卡片点击、收藏、删除和复制按钮；
- 深色/浅色主题。

## 验证命令

完成后至少运行：

```powershell
npm run test:gateway
npm run build
git diff --check
```

还必须在浏览器中用真实收藏数据进行视觉验证。只看构建通过不能证明瀑布流正确。

## 提交要求

1. 不夹带无关格式化或其他页面重构。
2. 在 `CHANGELOG.md` 的当前日期下简要记录修复。
3. 提交信息建议：

```text
fix: fill chain masonry columns without losing natural heights
```

4. 最终说明中明确写出：采用了什么分列算法、测试了哪些收藏数量、是否验证了窗口缩放和图片加载后的重排。
