
import { PromptChain } from '../types';

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

/**
 * Compiles the final prompt string by combining parts in a fixed order:
 * 1. Base Prompt
 * 2. Pre-Modules (isActive & position='pre')
 * 3. Subject/Variable Prompt (User Input)
 * 4. Post-Modules (isActive & position='post' or undefined)
 */
export const compilePrompt = (
  chain: Pick<PromptChain, 'basePrompt' | 'modules'>,
  subjectPrompt: string = '',
  activeModulesOnly: boolean = true
): string => {
  let promptParts: string[] = [];

  // 1. Add Base Prompt
  if (chain.basePrompt && chain.basePrompt.trim()) {
      promptParts.push(chain.basePrompt.trim());
  }

  // 2. Add Pre-Modules
  if (chain.modules) {
      const preModules = chain.modules.filter(m => {
          const isActive = !activeModulesOnly || m.isActive;
          return isActive && m.position === 'pre';
      });
      preModules.forEach(m => {
          if (m.content.trim()) promptParts.push(m.content.trim());
      });
  }

  // 3. Add Subject/Variable Prompt
  if (subjectPrompt && subjectPrompt.trim()) {
      promptParts.push(subjectPrompt.trim());
  }

  // 4. Add Post-Modules (Default to post if position is missing)
  if (chain.modules) {
      const postModules = chain.modules.filter(m => {
          const isActive = !activeModulesOnly || m.isActive;
          return isActive && (m.position === 'post' || !m.position);
      });
      postModules.forEach(m => {
          if (m.content.trim()) promptParts.push(m.content.trim());
      });
  }

  // 5. Join with commas and clean up
  // NAI generally prefers comma separation.
  // We join with ", " then clean up potential double commas.
  let fullPrompt = promptParts.join(', ');

  // Cleanup: remove double commas, leading/trailing commas/spaces
  fullPrompt = fullPrompt
      .replace(/,\s*,/g, ',')
      .replace(/^,\s*/, '')
      .replace(/,\s*$/, '');

  return fullPrompt;
};
