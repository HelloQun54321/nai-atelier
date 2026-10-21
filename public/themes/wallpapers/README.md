# Cupertino 配套壁纸

使用 Codex 内置 ImageGen 生成，以项目已有的 sharp 导出 WebP（quality 86），未添加依赖。两张图片均为 1672 × 941，随程序分发；本端自选背景优先，重新应用主题不覆盖本端选择。

- `cupertino-day.webp`：雾蓝光场。按用户要求，先移除壁纸并截取真实界面，再图生图设计整页效果，最后从效果图重建没有控件的背景；先前的风景与绿色方案不进入交付。
- `cupertino-night.webp`：深蓝星空与海面，保留已认可的夜间方向。

## 白天整体效果提示词

```text
Use case: ui-mockup.
Input image: an actual screenshot of NAI Atelier with its wallpaper removed. This screenshot is the exact layout and content reference.
Primary request: redesign ONLY the visual finish of this real light-mode desktop screen into a beautifully balanced, breathable Apple-inspired liquid-glass interface. The user has rejected saturated blue sky/ocean photographs, white cloud landscapes, green landscapes and green abstract ribbons. This image must establish the complete composition BEFORE a wallpaper is made.
Preserve: exact screen aspect ratio, all three columns, sidebar width, both top navigation rows, every real Chinese label, every control, text field, icon and button in its current location. Do not simplify away controls or invent any new UI.
Design direction: quiet premium cool-blue daylight. Stable near-black navy body text and clear secondary labels. Frosted pearl glass surfaces gently pick up the environment, with crisp delicate rims and soft depth; no gray haze across the whole screen and no glowing text. Inputs are subtly defined without white blocks. Sidebar and editor feel light but readable. Blue selected tabs and the blue generate button remain the clearest accents.
Environment behind the UI: a restrained atmospheric blue background with broad soft gradients from muted arctic blue to slightly deeper slate-blue, a faint luminous mist-blue opening behind the preview center, and subtle depth at the far right and lower edge. Suggest an airy glacial atmosphere without recognizable scenery. No clouds, sky photo, ocean, hills, vegetation, glass ribbons, folds, bubbles, swooshes or high-contrast shapes. No busy detail, no vivid cyan, no blinding white.
Treat the screenshot as a real functioning app, not a marketing poster. Preserve its proportions and fill the frame. Beautiful coherent materials, excellent legibility, realistic subtle glass, calm visual hierarchy. No title, border around the screenshot, mockup device, annotations or watermark.
```

## 从整体效果重建壁纸的提示词

```text
Use case: background-extraction.
Input image: complete light-mode NAI Atelier interface design study. This is a visual color and atmosphere reference, not UI to retain.
Primary request: reconstruct and extract ONLY the continuous blue background environment behind the interface in the reference, as a clean edge-to-edge 16:9 desktop wallpaper. Remove every interface element and naturally reconstruct the obscured background.
Match the reference's soft luminous mist-blue and arctic-blue atmosphere precisely: airy pale blue in the middle and upper right, slightly deeper muted blue around the lower corners and edges, extremely broad smooth blurred tonal variation with soft luminous diffusion. It should look like the same background that belongs behind this specific interface. The beauty is in quiet balanced blue light and depth.
The result is a wallpaper, no UI or glass panels: no text, icons, borders, rounded rectangles, windows, buttons, numbers, layouts or ghosts of removed UI. No recognizable clouds, sky photograph, ocean, horizon, landscape, hills, vegetation, green, glass ribbons, folds, swirls, streaks, spheres or bubbles. No dark navy or saturated cyan and no pure white glare. No noise or tiny details. Keep the full image airy, gently colored and low contrast so dark navy app text remains readable.
```

## 夜间生成提示词要点

16:9 landscape desktop wallpaper for a translucent glass creative app. Deep blue night ocean with a low horizon, subtle Milky Way and restrained stars, indigo and midnight azure with luminous blue depth. Quiet negative space behind UI; no flat gray, pitch black, overwhelming star noise, text, UI, people, boats, buildings, logos or watermark.
