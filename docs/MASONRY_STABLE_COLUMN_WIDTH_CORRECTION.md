# 最短列瀑布流纠偏：保持固定列宽，禁止少图分组放大

## 任务背景

生成历史已经从 CSS Columns 改为复用：

```text
components/ShortestColumnMasonry.tsx
```

新的“先横向起排、后续进入最短列”方向是正确的，但共享组件当前把日期分组的图片数量当成了实际网格列数，导致不同日期分组的卡片宽度不一致。

典型错误：

```text
页面设置 6 列
某天 14 张：使用 6 列，卡片宽度约为页面的 1/6
某天 5 张：缩成 5 列，卡片宽度变成页面的 1/5
某天 1 张：缩成 1 列，图片占满整行
```

这就是单张竖图被放大到接近全屏的原因。

## 本次目标

修复共享最短列组件，使它同时满足：

1. 列宽始终由用户设置/响应式规则得到的“请求列数”决定。
2. 图片少于请求列数时，只使用左侧必要列，右侧允许自然留空。
3. 少图分组不能通过减少网格轨道数量来放大卡片。
4. 图片不少于请求列数时，最初 N 张从左到右占满 N 列。
5. 后续图片继续进入当前累计高度最短的列。
6. 保留横图较矮、竖图较高的自然比例。
7. 同时修复生成历史和画师串/角色串少量筛选结果，因为它们共享同一个组件。

## 重要概念：必须分开三个数量

不要再只使用一个 `effectiveColumns` 表示所有含义。

建议明确区分：

```text
requestedColumns：用户设置或响应式规则要求的总列数
usedColumns：当前数据实际需要放入内容的列数
items.length：当前分组/列表的卡片数量
```

关系应为：

```text
requestedColumns = 至少为 1 的合法请求列数
usedColumns = min(requestedColumns, items.length)
```

但二者用途完全不同：

```text
网格轨道数、列宽计算：使用 requestedColumns
分列数组数量、实际渲染的非空列：使用 usedColumns
```

## 当前错误位置

文件：`components/ShortestColumnMasonry.tsx`

当前逻辑类似：

```tsx
const effectiveColumns = Math.max(0, Math.min(columns, items.length));

const columnWidth =
  (containerWidth - (effectiveColumns - 1) * gap) / effectiveColumns;

style={{
  gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
}}
```

问题在于：

- `items.length === 1` 时，`effectiveColumns === 1`；
- 外层因此只生成一个 `1fr`；
- 这一个 `1fr` 等于整个容器宽度；
- 竖图再按自然比例计算高度，最终形成超大的全宽长图。

高度估算函数不是本问题根因。不要通过修改比例、限制图片高度或裁切图片来掩盖列宽错误。

## 推荐修改

### 1. 在共享组件内拆分请求列数和使用列数

语义示例：

```tsx
const requestedColumns = Math.max(1, Math.floor(columns));
const usedColumns = Math.min(requestedColumns, items.length);
```

如需要防御异常数值，应同时处理 `NaN`、`Infinity` 和小于 1 的情况，但不要改变正常的 1～6 列设置。

### 2. 列宽必须按 requestedColumns 计算

正确语义：

```tsx
const columnWidth =
  containerWidth > 0
    ? (containerWidth - (requestedColumns - 1) * gap) / requestedColumns
    : 0;
```

不能使用 `usedColumns` 计算列宽。

这样无论某个日期有 1 张、5 张还是 20 张，页面设置相同时，每张卡片宽度都一致。

### 3. 外层 Grid 必须始终生成 requestedColumns 条轨道

正确语义：

```tsx
style={{
  gridTemplateColumns: `repeat(${requestedColumns}, minmax(0, 1fr))`,
  gap: `${gap}px`,
}}
```

如果只有一张图，只渲染第一个列容器。CSS Grid 会把它放入第一条轨道，其余轨道为空，但第一张图仍保持正常的单列宽度。

不要生成占位卡片，也不要人为填入空 DOM 列；只需要保留固定 Grid 轨道。

### 4. 最短列分配只使用 usedColumns

正确语义：

```tsx
const layout = computeShortestColumnAssignment(
  items,
  usedColumns,
  estimateItemHeight,
  columnWidth,
);
```

`layout` 只包含实际非空列，因此：

- 1 张图产生 1 个列容器，但列容器只占请求网格的第一轨；
- 5 张图、请求 6 列，产生 5 个列容器，占前五轨；
- 8 张图、请求 5 列，产生 5 个列容器，前五张横向起排，后三张进入最短列。

### 5. 更新 useMemo 依赖

分列结果至少依赖：

```text
items
usedColumns
columnWidth
estimateItemHeight
```

外层样式使用 `requestedColumns`。

窗口宽度、列数设置或项目数量改变后，应自然重新计算。不要使用 `setTimeout` 或强制刷新。

### 6. 修正文档和代码注释

当前组件注释包含类似：

```text
返回的列数为 min(columnCount, items.length)，不会生成空列
```

这句话会继续误导维护者。应改成：

```text
布局保持 requestedColumns 条固定宽度轨道；只渲染 min(requestedColumns, items.length)
个非空列。数据少于列数时允许右侧轨道留空，以保持不同分组的卡片宽度一致。
```

## 不需要修改的部分

如果当前实现和检查结果一致，本次原则上不需要修改：

- `components/GenHistory.tsx` 的卡片抽取；
- `estimateHistoryCardHeight` 的图片比例公式；
- 日期分组逻辑；
- `index.css` 的 `.chain-masonry` 样式；
- `services/imageDisplayPreferences.ts`；
- 非 masonry 的竖向卡片和方形布局。

`GenHistory.tsx` 当前未提交的最短列接入应保留，不要整体回退到 CSS Columns。

## 正确与错误的“空白”区别

必须区分以下两种情况。

### 需要修复的错误

```text
请求 5 列，存在 8 张图，却因为竖向分栏算法只使用前 4 列。
```

此时图片数量足够使用全部 5 列，右侧整列空白属于错误。

### 应当保留的正常空间

```text
请求 6 列，某个日期只有 1 张图。
```

此时只有一张数据，图片应保持 `1/6` 容器宽度并左对齐，其余空间自然为空。不能为了“消灭空白”把图片拉伸到全宽。

## 不要采用的方案

1. 不要修改 `estimateHistoryCardHeight` 来限制单图尺寸。
2. 不要给图片临时增加 `max-width`、`max-height` 或固定像素宽度。
3. 不要把单图强制裁成横图、方图或固定高度。
4. 不要根据每个日期的图片数量动态减少网格轨道数。
5. 不要恢复 CSS `column-count`。
6. 不要把瀑布流改回普通行 Grid。
7. 不要为缺少的列渲染伪卡片或空白占位元素。
8. 不要只修 `GenHistory.tsx`；根因在共享组件，画师串少量收藏也会受影响。
9. 不要修改排序、收藏、日期分组或分页数据来改变视觉结果。

## 验收矩阵

### 固定宽度

在同一视口、同一列数设置下测量卡片宽度：

| 请求列数 | 分组图片数 | 预期实际有内容的列 | 预期卡片宽度 |
|---:|---:|---:|---:|
| 6 | 1 | 1 | 容器约 `1/6` |
| 6 | 5 | 5 | 容器约 `1/6` |
| 6 | 14 | 6 | 容器约 `1/6` |
| 5 | 1 | 1 | 容器约 `1/5` |
| 5 | 5 | 5 | 容器约 `1/5` |
| 5 | 8 | 5 | 容器约 `1/5` |

允许 1～2px 的边框/取整误差，但同一列数下不同日期分组的卡片宽度必须基本一致。

### 排列顺序

1. 请求 5 列、8 张图：前5张必须从左到右占满5列。
2. 第6～8张必须进入当时累计高度最短的列。
3. 请求6列、只有5张：五张从左到右排列，第六轨留空。
4. 请求6列、只有1张：图片位于最左侧，宽度与其他6列分组一致。
5. 横图保持较矮、竖图保持较高，不拉伸、不统一高度。

### 跨页面回归

1. 生成历史：1张、5张、8张、14张的日期分组。
2. 生成历史收藏视图：取消收藏后5张变4张，剩余卡片宽度不能突然变大。
3. 画师串收藏：少于请求列数时卡片宽度保持正常。
4. 角色串筛选：少于请求列数时卡片宽度保持正常。
5. 窗口缩放：断点变化后，所有日期分组使用同一套新列宽。
6. 手动调整桌面/移动端列数：所有分组同步变化。
7. 竖向卡片、方形布局与修改前一致。

### 功能回归

- 打开历史大图；
- 收藏/取消收藏；
- 删除；
- 长按多选；
- 批量操作；
- 翻页；
- 安全模式模糊；
- 深色/浅色主题；
- 画师串卡片点击、收藏、删除和复制。

## 建议添加的纯函数检查

如项目现有测试结构允许，可为分列语义增加测试。重点不是只断言列数组数量，还应断言轨道数与列宽使用请求列数。

示例语义：

```text
requested=6, items=1  → used=1, tracks=6
requested=6, items=5  → used=5, tracks=6
requested=5, items=8  → used=5, tracks=5
```

之前只检查 `[1]`、`[1,1,1,1,1]` 这样的分配数组是不够的，因为它无法发现外层 Grid 把一列拉伸成全宽。

## 验证命令

至少运行：

```powershell
npm run test:gateway
npm run build
npx tsc -b
git diff --check
```

还必须在真实浏览器中验证并记录：

1. 同一屏幕中1张分组与多张分组的卡片宽度对比；
2. 取消收藏前后的卡片宽度；
3. 5列和6列设置；
4. 桌面缩放与移动端列数切换。

视觉验证的核心不是“有没有空白”，而是：

```text
同一列数设置下，所有分组的列宽是否一致。
```

## 提交要求

只有用户明确要求提交时才提交。

建议提交信息：

```text
fix: keep masonry card widths stable for sparse groups
```

最终交付必须说明：

1. `requestedColumns` 与 `usedColumns` 分别如何使用；
2. 单图分组的实测宽度；
3. 5张、8张和14张分组的排列结果；
4. 是否验证了画师串少量收藏；
5. 是否确认横竖图自然比例没有改变。
