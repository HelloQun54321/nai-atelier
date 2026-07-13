# NovelAI 导入配置与参数解析逻辑分析

本文档基于 `ChainEditor.tsx` 中的 `handleImportImage` 核心代码，梳理当前程序对由图片导入的 NovelAI 元数据（Metadata）的实际解析思路与策略。该逻辑承担了补齐 `NOVELAI_API_DOCS.md` 细节的解析职能。

## 1. 入口判别与数据分流

程序在获得图片的 EXIF/tEXt 字符串数据后，首先根据前缀判断其格式：
*   **JSON 路线**：若字符串以 `{` 开头，进入 V3/V4/V4.5 的现代 JSON 对象解析流程。
*   **Legacy (纯文本) 路线**：否则进入旧版类似 `A girl, blue eyes... Negative prompt: ... Steps: 28...` 这种键值拼图纯文本模式的解析。

---

## 2. JSON 路线深度解析

JSON 格式是目前 NovelAI 获取完整参数的最可靠来源。

### 2.1 核心基础参数提取
*   `prompt`: 提取对应的正面提示词。
*   `uc`: 提取赋值为全局负面提示词 (`negative`)。
*   对以下常规参数进行原封不动转抛：`steps`, `scale`, `seed`, `sampler`, `width`, `height`, `cfg_rescale`。

### 2.2 V4/V4.5 高级特性解析
*   **Variety (多样性/CFG跳流开关)**：
    *   通过探测 `skip_cfg_above_sigma` 字段，如果该字段存在且不为 null，则视为开启 (`variety = true`)，反之为关闭 (`false`)。
*   **手控坐标开关**：
    *   如果在 `v4_prompt` 对象下发现了 `use_coords`，将其赋值给本界面的同名开关（AI Choice 即 false，Manual 即 true）。

### 2.3 结构化角色列表解析 (`v4_prompt` & `v4_negative_prompt`)
V4 版本以后支持画布分区域（多角色）设置，这部分数据存放在 `caption.char_captions` 中。
*   **全局覆盖**：检测到 `v4_prompt.caption.base_caption` 或 `v4_negative_prompt.caption.base_caption` 时，它们将作为优先级更高的来源**覆盖**最外层的全局正/负面提示词。
*   **角色实例拆分**：
    *   遍历读取 `v4_prompt.caption.char_captions`，为页面生成对应的角色卡片。
    *   每个角色包含一个 `prompt`（来源于原 `char_caption`），并提取对应的 `centers[0].x` 与 `centers[0].y`（如果原图未定义坐标参数，则默认居中赋给 `0.5`）。
*   **角色专属负面配对**：
    *   遍历 `v4_negative_prompt.caption.char_captions`。
    *   **严格按照索引数组下标**，将各个角色专属的负面词（`char_caption`）一一贴装到上面拆分出来的角色实例属性中（`negativePrompt`）。

---

## 3. Legacy 文本路线解析

*   以关键字 `Steps:` 和 `Negative prompt:` 作为切割特征码。
*   第一段截取为 `prompt`（正面），第二段切分为 `negative`。
*   末尾基于正则表达式的字符串匹配分别截取 `Steps`, `Sampler`, `CFG scale`, `Seed`, `Size`。其中 `Size` 会被按 `x` 号拆解转为整形格式给 `width` 和 `height`。

---

## 4. 特有隐式参数逆向反推 (Quality / UC Preset)

NovelAI 会在生成图片时根据界面选项向提示词中注入**固定前缀/后缀**。解析器需要在获得上述合并后的基础提示文段后，进行一次反向正则切割：

### 4.1 核心质量词开关逆向 (Quality Toggle)
*   判断提取完毕的 `prompt` 字符串末尾是否精准匹配内置的恒定后缀字典 `NAI_QUALITY_TAGS`（如 `best quality, masterpiece...` 等组合）。
*   若命中，则界面开启 `qualityToggle = true` 开关，**并从原 `prompt` 内容里删去该段后缀**，以免在应用上造成提示词在以后每次生成时越来越长（自我循环复读）。如果不存在则为 false。

### 4.2 全局负面预制位逆向 (UC Preset)
负面词的前缀匹配由于部分内置句重合率极高，使用了**降序严格匹配**：
*   **比对列表及判断顺序**：3: Human Focus -> 2: Furry -> 1: Light -> 0: Heavy。如果没有命中任何前缀，就是 4: None 开关。
*   **为什么这种顺序极度关键**？因为 `Human Focus(3)` 内容实际上包含了 `Heavy(0)` 的前缀主体且更加修长。如果先检验 `Heavy` 就会引发过早截断错误。
*   若成功匹配对应字典的内置字符串，则在页面对应选择该号下拉框项，**并将该特定文段从原始 `negative` (UC) 中完整删去**。
