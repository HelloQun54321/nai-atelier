# Tag 自动补全数据

运行 `npm run update:tags` 会下载 ffdkj 每日更新的 Danbooru 中英对照 SQLite（收录 `post_count >= 10` 的 Tag），并与 `novelai-v45-tags.json` 中依据 NovelAI 官方文档整理的 V4.5 专属 Tag 合并。更新词库需要 Node.js 22 或更高版本提供的内置 SQLite 读取能力。

生成结果位于 `public/tag-data/`。英文数据按名称前两个字符分片，中文索引按首字哈希到 256 个分片；实验室仅在输入提示词时按需加载相应分片，不会在日常启动时访问外网。

候选会同时显示英文原名和中文解释，选择后只向 NovelAI 提示词中插入英文。更新脚本会在 `manifest.json` 中记录快照生成时间、来源和各类别数量。
