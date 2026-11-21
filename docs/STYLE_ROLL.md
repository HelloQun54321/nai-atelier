# Roll 串：存储边界与维护索引

Roll 串用于从现有画师库（或选定风格串来源）随机抽取组合、有限出图并挑选保存。产品原则见 [VIBER_INTENT.md](../VIBER_INTENT.md)，完整交互与业务规则见 [PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md)「Roll 串画风探索」节。

## 数据存储与兼容边界

- **存储定位**：Roll 记录沿用 `/api/style-roll` 与私人 `settings` 表（按用户与记录 ID 隔离），自定义质量预设使用 `style_roll_preset_v1`，全局画师屏蔽名单独立存于 `style_roll_blocklist_v1:<用户>`（跨记录生效，不随记录删除）。工坊完整备份自动覆盖，不新增表或改动存储键。
- **单行体积保护与归一化**：列表接口只返回记录身份与计数，选中后按 `GET /api/style-roll/:id` 读取完整内容。针对本地 D1 单行约 2.1 MB 硬上限，保存前自动把逐轮重复的来源串 ID 列表归一化为记录级集合（`sourceChainSets`，每轮快照仅存 `sourceChainSetId`）；归一化后仍超限时提前返回 413 中文提示。旧内联快照原样兼容读取，下次保存时自动归一化。
- **不可变与删除语义**：已抽出候选的画师配方与轮次快照不可改写，但记录公共模板／参数可继续修改（旧候选图片按候选 ID 关联历史，不因改模板丢失）。丢弃候选与删除整条记录均为二次确认后彻底移除（空轮随候选一并清理），不进回收站，历史原图与已另存的风格串保留；活动候选关联的首次历史原图受回收站引用保护。保存带版本校验，冲突时提示重新加载。
- **历史兼容与废弃边界**：旧三模式记录只读映射为统一随机流程（旧固定项作固定 Tag）；已明确废弃的画风对比、投票排名、进化评选、权重测试、验证副本及早期候选字段不再兼容，坏存档直接报错而不以空记录静默覆盖。

## 参考来源

「词库抽组合 → 有限出图 → 挑选保存」的探索思路参考 [sdnwls/nai-style-lab](https://github.com/sdnwls/nai-style-lab) 并结合工坊体系独立实现（未复制其代码、图片或数据集，亦未保留其遗传进化与两两对比流程）。

## 源码维护入口

- `services/styleRoll.ts`：资料校验、随机抽取、固定／偏好／保底计算、来源集合归一化与旧记录兼容。
- `services/styleRollSeed.ts`：画师名规范化与外部提示词画师 Tag 识别。
- `services/styleRollWorkflow.ts`：有限批次组装与轮次条件快照。
- `services/styleRollSeries.ts`：助手连续 Roll（`run_roll_series`）状态与停止判定。
- `services/styleRollApi.ts`、`services/styleRollGeneration.ts`、`services/styleRollWorkspace.ts`：接口读写、后台生成接缝与列表筛选排序。
- `components/StyleRollPage.tsx`、`components/roll/`：主页面、左侧记录导航、本轮／完整配置及画师管理弹窗。
- `worker/routes/styleRollRoutes.ts`：服务端归一化、体积上限与版本并发校验。
