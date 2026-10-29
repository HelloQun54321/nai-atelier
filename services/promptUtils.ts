export { getGlobalPromptSectionKeys } from './agentLabSync.mjs';

/**
 * NAI V4 Specific String Constants
 */
export const NAI_QUALITY_TAGS = ', very aesthetic, masterpiece, no text';

// Map ID to String. Order matches UI options: 0:Heavy, 1:Light, 2:Furry, 3:Human
export const NAI_UC_PRESETS = {
    0: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, ',
    1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page, ',
    2: 'nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic, ',
    3: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy, '
};

export { mergePromptFields, getEditableGlobalPrompt, getEditableGlobalNegative } from './agentLabSync.mjs';

export { compilePrompt } from './agentLabSync.mjs';
