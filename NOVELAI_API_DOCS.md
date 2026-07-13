
# NovelAI Image Generation API 文档

本文档基于 `nai-prompt-manager` 项目中对接的 NovelAI V4.5 接口整理。

## 1. 基础信息

- **Endpoint**: `https://image.novelai.net/ai/generate-image`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Authorization**: `Bearer <YOUR_API_KEY>`

---

## 2. 请求结构 (Request Payload)

请求体是一个 JSON 对象，核心字段如下：

| 字段名 | 类型 | 必填 | 描述 | 示例值 |
| :--- | :--- | :--- | :--- | :--- |
| `input` | String | 是 | 最终拼接好的正面提示词（包含 Base + 变量 + 模块 + Quality Tags）。 | `"1girl, ..."` |
| `model` | String | 是 | 模型名称。V4.5 模型代号。 | `"nai-diffusion-4-5-full"` |
| `action` | String | 是 | 操作类型。 | `"generate"` |
| `parameters` | Object | 是 | 详细生成参数对象，见下表。 | `{ ... }` |

### 2.1 Parameters 对象详解

`parameters` 对象控制生成的具体细节：

#### 基础生成参数
| 字段名 | 类型 | 描述 | 默认/常见值 |
| :--- | :--- | :--- | :--- |
| `params_version` | Number | 参数版本号，V3/V4 通常为 3。 | `3` |
| `width` | Number | 图片宽度。 | `832` |
| `height` | Number | 图片高度。 | `1216` |
| `scale` | Number | 提示词相关性 (CFG Scale)。 | `5` |
| `sampler` | String | 采样器。 | `"k_euler_ancestral"` |
| `steps` | Number | 步数 (V4 推荐 28)。 | `28` |
| `seed` | Number | 随机种子。若不传或为 0 则由后端随机。 | `123456` |
| `n_samples` | Number | 生成数量。本应用固定为 1。 | `1` |

#### V4/V4.5 特性参数
| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `skip_cfg_above_sigma` | Number \| null | **Variety+ (多样性)** 开关。<br>- `58`: 开启多样性 (Variety On)<br>- `null`: 关闭 (Variety Off) |
| `cfg_rescale` | Number | **Rescale (CFG Correction)**。<br>范围 0.0 - 1.0，用于在高 CFG 下修正过拟合。 |
| `use_coords` | Boolean | (旧字段兼容) 是否使用坐标控制。 |
| `qualityToggle` | Boolean | **UI 状态字段**。<br>虽对生成结果无直接算法影响（逻辑在 `input` 拼接），但请求需携带以保持兼容性。 |
| `ucPreset` | Number | **UI 状态字段**。<br>0: Heavy, 1: Light, 2: Furry, 3: Human, 4: None。请求需携带。 |

#### V4 结构化 Prompt (关键)
V4 模型引入了分离式 Prompt 结构，用于支持多角色控制。

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `v4_prompt` | Object | 正面提示词结构化对象。 |
| `v4_negative_prompt` | Object | 负面提示词结构化对象。 |

**`v4_prompt` 结构:**
```json
{
  "caption": {
    "base_caption": "string",       // 基础提示词 (环境、风格、通用描述)
    "char_captions": [              // 角色列表
      {
        "char_caption": "string",   // 角色 A 的描述 (如: 1girl, blue hair)
        "centers": [                // 角色 A 在画面中的中心点 (0.0 - 1.0)
          { "x": 0.5, "y": 0.5 }
        ]
      }
    ]
  },
  "use_coords": boolean,            // 是否启用坐标引导 (AI Choice vs Manual)
  "use_order": true                 // 固定为 true
}
```

**`v4_negative_prompt` 结构:**
```json
{
  "caption": {
    "base_caption": "string",       // 全局负面提示词
    "char_captions": [              // 对应角色的专属负面 (索引必须与 v4_prompt 一致)
      {
        "char_caption": "string",   // 角色 A 的负面
        "centers": [{ "x": 0.5, "y": 0.5 }] // 坐标需镜像
      }
    ]
  },
  "legacy_uc": false
}
```

#### 其它固定参数 (Boilerplate)
这些参数通常固定，用于保持模型行为稳定：
| 字段名 | 值 | 描述 |
| :--- | :--- | :--- |
| `sm` | `false` | SMEA 开关 (V4 不用) |
| `sm_dyn` | `false` | SMEA Dyn 开关 (V4 不用) |
| `dynamic_thresholding` | `false` | 动态阈值 |
| `controlnet_strength` | `1` | ControlNet 强度 |
| `legacy` | `false` | 是否使用旧版处理 |
| `add_original_image` | `true` | 是否包含原图 (图生图相关) |
| `uncond_scale` | `1` | 无条件 Scale |
| `noise_schedule` | `"karras"` | 噪声调度器 |
| `deliberate_euler_ancestral_bug` | `false` | 修复 Euler A 特定 Bug |
| `prefer_brownian` | `true` | 布朗噪声偏好 |

---

## 3. 完整请求示例 (JSON)

```json
{
  "input": "masterpiece, best quality, 1girl, solo, sitting, blue hair, cinematic lighting, very aesthetic, masterpiece, no text",
  "model": "nai-diffusion-4-5-full",
  "action": "generate",
  "parameters": {
    "params_version": 3,
    "width": 832,
    "height": 1216,
    "scale": 5,
    "sampler": "k_euler_ancestral",
    "steps": 28,
    "n_samples": 1,
    "seed": 123456789,
    "skip_cfg_above_sigma": 58, 
    "cfg_rescale": 0,
    "qualityToggle": true,
    "ucPreset": 4,
    "sm": false,
    "sm_dyn": false,
    "dynamic_thresholding": false,
    "controlnet_strength": 1,
    "legacy": false,
    "add_original_image": true,
    "uncond_scale": 1,
    "noise_schedule": "karras",
    "negative_prompt": "lowres, bad anatomy, bad hands, text, error...",
    "v4_prompt": {
      "caption": {
        "base_caption": "masterpiece, best quality, cinematic lighting, very aesthetic, masterpiece, no text",
        "char_captions": [
          {
            "char_caption": "1girl, solo, sitting, blue hair",
            "centers": [{ "x": 0.5, "y": 0.5 }]
          }
        ]
      },
      "use_coords": false,
      "use_order": true
    },
    "v4_negative_prompt": {
      "caption": {
        "base_caption": "lowres, bad anatomy, bad hands, text, error...",
        "char_captions": [
          { "char_caption": "", "centers": [{ "x": 0.5, "y": 0.5 }] }
        ]
      },
      "legacy_uc": false
    },
    "deliberate_euler_ancestral_bug": false,
    "prefer_brownian": true
  }
}
```

---

## 4. 响应结构 (Response)

NovelAI API 返回的是 **二进制流 (Binary Stream)**，具体格式为 **ZIP 压缩包**。

### 处理流程
1.  **Header Check**: 响应头 `Content-Type` 通常为 `application/zip` (或 `application/x-zip-compressed`)。
2.  **Unzip**: 需要使用 `JSZip` 或类似库解压。
3.  **File Extraction**: 压缩包内通常包含一个文件名格式为 `image_0.png` 的图片文件。
4.  **Data Parsing**:
    *   图片内容：直接读取为 Blob 或 Base64 用于显示。
    *   元数据 (Metadata)：NovelAI 将生成参数写入了 PNG 的 `tEXt` chunk 中（关键字通常为 `Description` 或 `Comment`），格式为 JSON 字符串或纯文本。

### 错误响应
如果发生错误（如 400/401/402/500），API 通常返回 JSON 格式的错误信息：
```json
{
  "statusCode": 402,
  "message": "Anlas depletion" 
}
```
