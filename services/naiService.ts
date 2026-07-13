
import JSZip from 'jszip';
import { NAIParams } from '../types';
import { api } from './api';
import { NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';

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
  let finalPrompt = prompt;
  if (params.qualityToggle ?? true) {
    finalPrompt = finalPrompt + NAI_QUALITY_TAGS;
  }

  // 2. UC Preset (Prepend to negative prompt)
  let finalNegative = negative;
  const presetId = params.ucPreset ?? 0;
  if (presetId !== 4) { // 4 is 'None'
    // @ts-ignore - Index access is safe here as UI restricts values
    const presetString = NAI_UC_PRESETS[presetId];
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
  const useCoords = params.useCoords ?? hasCharacters;

  const payload: any = {
    input: finalPrompt, // Use processed prompt
    model: "nai-diffusion-4-5-full",
    action: "generate",
    parameters: {
      params_version: 3,
      width: params.width,
      height: params.height,
      scale: params.scale,
      sampler: params.sampler,
      steps: params.steps,
      n_samples: 1,

      // New Features
      // Variety+ is controlled by skip_cfg_above_sigma.
      // If On, set to 58 (V4 standard for variety). If Off, omit or null.
      skip_cfg_above_sigma: params.variety ? 58 : null,

      cfg_rescale: params.cfgRescale ?? 0,

      // V4 Specifics (Sent even if processed into prompt)
      qualityToggle: params.qualityToggle ?? true,
      ucPreset: params.ucPreset ?? 0,

      // Legacy / Standard params
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
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

  const fileData = await zip.files[filename].async('base64');

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

  return { image: `data:image/png;base64,${fileData}`, seed: actualSeed };
};