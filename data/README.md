# Tag 自动补全数据

运行 `npm run update:tags` 会从 Danbooru 官方 `tags.json` API 下载所有未废弃且至少关联一张作品的 Tag，并与 `novelai-v45-tags.json` 中依据 NovelAI 官方文档整理的 V4.5 专属 Tag 合并。

生成结果位于 `public/tag-data/`。数据按标准化名称的前两个字符分片，实验室仅在输入提示词时按需加载相应分片，不会在日常启动时访问外网。

Danbooru 的 `post_count` 仅用于候选排序，不用于剔除冷门 Tag。更新脚本会在 `manifest.json` 中记录快照生成时间、来源和各类别数量。
