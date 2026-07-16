
import JSZip from 'jszip';
import { NAIParams } from '../types';
import { api } from './api';
import { NAI_CURATED_QUALITY_TAGS, NAI_CURATED_UC_PRESETS, NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';

const resolvePromptRandomizers = (value: string) => value.replace(/\|\|([\s\S]*?)\|\|/g, (_match, choices: string) => {
  const options = choices.split('|').map(option => option.trim()).filter(Boolean);
  return options.length ? options[Math.floor(Math.random() * options.length)] : '';
});

export const generateImage = async (apiKey: string, prompt: string, negative: string, params: NAIParams) => {
  // Logic update: NAI API treats missing seed as random. 0 is a specific seed.
  // We pass seed only if it is a valid number and not -1 (our internal convention for random).
  let seed: number | undefined = undefined;
  if (params.seed !== undefined && params.seed !== null && params.seed !== -1) {
    seed = params.seed;
  }

  // --- Pre-process Prompt & Negative based on V4 Settings ---

  // 1. Quality Tags (Append to positive prompt if enabled)
  // Note: NAI Appends strictly at the end.
  const actualPrompt = resolvePromptRandomizers(prompt);
  const actualNegative = resolvePromptRandomizers(negative);
  let finalPrompt = actualPrompt;
  if (params.qualityToggle ?? true) {
    finalPrompt = finalPrompt + (params.model === 'nai-diffusion-4-5-curated' ? NAI_CURATED_QUALITY_TAGS : NAI_QUALITY_TAGS);
  }

  // 2. UC Preset (Prepend to negative prompt)
  let finalNegative = actualNegative;
  const presetId = params.ucPreset ?? 0;
  if (presetId !== 4) { // 4 is 'None'
    // @ts-ignore - Index access is safe here as UI restricts values
    const presetMap = params.model === 'nai-diffusion-4-5-curated' ? NAI_CURATED_UC_PRESETS : NAI_UC_PRESETS;
    const presetString = presetMap[presetId as keyof typeof presetMap];
    if (presetString) {
      finalNegative = presetString + finalNegative;
    }
  }

  // Prepare Character Captions for V4.5
  const hasCharacters = params.characters && params.characters.length > 0;

  // 1. Positive Character Captions
  const charCaptions = hasCharacters ? params.characters!.map(c => ({
    char_caption: c.prompt,
    centers: [{ x: c.x, y: c.y }]
  })) : [];

  // 2. Negative Character Captions (Structure must mirror positive)
  const charNegativeCaptions = hasCharacters ? params.characters!.map(c => ({
    char_caption: c.negativePrompt || "", // Use empty string placeholder if undefined
    centers: [{ x: c.x, y: c.y }] // Coordinates mirrored
  })) : [];

  // 3. AI's Choice Logic
  const useCoords = params.useCoords ?? false;

  const payload: any = {
    input: finalPrompt, // Use processed prompt
    model: params.model ?? "nai-diffusion-4-5-full",
    action: "generate",
    parameters: {
      params_version: 3,
      width: params.width,
      height: params.height,
      scale: params.scale,
      sampler: params.sampler,
      steps: params.steps,
      n_samples: Math.max(1, Math.min(4, params.nSamples ?? 1)),

      // New Features
      // Variety+ is controlled by skip_cfg_above_sigma.
      // If On, set to 58 (V4 standard for variety). If Off, omit or null.
      skip_cfg_above_sigma: params.variety ? 58 : null,

      cfg_rescale: params.cfgRescale ?? 0,

      // V4 Specifics (Sent even if processed into prompt)
      qualityToggle: params.qualityToggle ?? true,
      ucPreset: params.ucPreset ?? 0,

      // Legacy / Standard params
      sm: params.smea === 'smea' || params.smea === 'smea_dyn' || (params.smea === 'auto' && params.width * params.height > 1024 * 1024),
      sm_dyn: params.smea === 'smea_dyn',
      dynamic_thresholding: params.decrisper ?? false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      uncond_scale: 1,
      noise_schedule: "karras",
      negative_prompt: finalNegative, // Use processed negative
      // seed key is added conditionally below

      v4_prompt: {
        caption: {
          base_caption: finalPrompt, // Use processed prompt
          char_captions: charCaptions
        },
        use_coords: useCoords, // Controlled by UI toggle
        use_order: true
      },
      v4_negative_prompt: {
        caption: {
          base_caption: finalNegative, // Use processed negative
          char_captions: charNegativeCaptions
        },
        legacy_uc: false
      },

      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true
    }
  };

  if (seed !== undefined) {
    payload.parameters.seed = seed;
  }

  // 调用 Worker Proxy, 传递 API Key Header
  const blob = await api.postBinary('/generate', payload, {
    'Authorization': `Bearer ${apiKey}`
  });

  // 解析 Zip (逻辑保持不变)
  const zip = await JSZip.loadAsync(blob);
  const filename = Object.keys(zip.files)[0];
  if (!filename) throw new Error("No image found in response");

  const imageFiles = Object.keys(zip.files).filter(file => /\.(png|webp|jpe?g)$/i.test(file));
  if (!imageFiles.length) throw new Error("No image found in response");
  const images = await Promise.all(imageFiles.map(async file => {
    const ext = file.split('.').pop()?.toLowerCase();
    const mime = ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${await zip.files[file].async('base64')}`;
  }));

  // Extract seed from payload if available, or finding it in metadata would be ideal but for now we rely on what we sent
  // Actually, NAI returns the seed in the response JSON if we used the proper endpoint or read the png info.
  // The current implementation reads the ZIP. 
  // IMPORTANT: The backend usually returns a JSON with the seed if not successful, but for Zip response, the seed is often in the filename or we must trust what we sent.
  // HOWEVER, if we sent -1 (or undefined), the server picked one. The server response headers or a specific JSON file in the ZIP might have it.
  // NAI Zip often contains the image and sometimes a JSON metadata file.

  // Let's try to find a .json file in the zip
  let actualSeed = seed ?? 0;
  const jsonFile = Object.keys(zip.files).find(f => f.endsWith('.json'));
  if (jsonFile) {
    const jsonText = await zip.files[jsonFile].async('text');
    try {
      const json = JSON.parse(jsonText);
      /* 
         NAI JSON format usually usually has:
         { ... "seed": 123456 ... }
      */
      if (json.seed) actualSeed = json.seed;
    } catch (e) { console.error('Failed to parse metadata json', e); }
  } else {
    // Fallback: If we didn't send a seed, and can't find it, we might be out of luck without reading PNG chunks.
    // But typically NAI returns a JSON alongside the image in the zip.
  }

  return { image: images[0], images, seed: actualSeed, actualPrompt: finalPrompt, actualNegative: finalNegative };
};
