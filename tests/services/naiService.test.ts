// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationJobDescriptor } from '../../services/generationJob';
import { hashNaiApiKey } from '../../services/anlasBudget';
import { prepareImageEdit, type PreparedImageEdit } from '../../services/imageEdit';
import { buildGenerationJobDescriptor, type GenerationJobDescriptorInput } from '../../services/naiService';
import type { CharacterParams, ImageEditOperation, NAIParams, PromptModule } from '../../types';

vi.mock('../../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getNaiRuntimeConfig: vi.fn(async () => actual.DEFAULT_NAI_RUNTIME) };
});
// 预处理依赖真实画布；这里只替换像素处理，保留全部坐标换算与校验逻辑。
vi.mock('../../services/imageEdit', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, prepareImageEdit: vi.fn() };
});

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BYTES = Uint8Array.from(atob(PNG_DATA_URL.split(',')[1]), character => character.charCodeAt(0));
const MODEL = 'nai-diffusion-4-5-full';

const promptModule: PromptModule = { id: 'm1', name: '风格', content: 'detail', isActive: true };
const character: CharacterParams = { id: 'c1', prompt: 'blue hair, blue dress', negativePrompt: 'red hair', x: 0.5, y: 0.5 };
const positionedCharacter: CharacterParams = { id: 'c1', prompt: 'blue hair, blue dress', negativePrompt: 'red hair', x: 0.42, y: 0.62 };
const pausedCharacter: CharacterParams = { id: 'c2', enabled: false, prompt: 'paused character', negativePrompt: 'paused', x: 0.9, y: 0.9 };
const emptyCharacter: CharacterParams = { id: 'c3', prompt: '   ', negativePrompt: 'empty', x: 0.1, y: 0.1 };

const baseParams = (): NAIParams => ({
  model: MODEL, width: 832, height: 1216, steps: 28,
  scale: 5, sampler: 'k_euler_ancestral', qualityToggle: true, ucPreset: 1,
});

const prepared = (overrides: Partial<PreparedImageEdit> = {}): PreparedImageEdit => ({
  image: PNG_DATA_URL, mask: PNG_DATA_URL,
  originalImage: new Blob([PNG_BYTES], { type: 'image/png' }),
  compositeMask: new Blob([PNG_BYTES], { type: 'image/png' }),
  requestWidth: 832, requestHeight: 1216, sourceWidth: 832, sourceHeight: 1216,
  ...overrides,
});

interface CharacterCaption { char_caption: string; centers: { x: number; y: number }[] }
interface PayloadParameters {
  seed?: number;
  extra_noise_seed?: number;
  stream?: string;
  n_samples: number;
  negative_prompt: string;
  qualityPresetId: string;
  ucPresetId: string;
  width: number;
  height: number;
  image?: string;
  mask?: string;
  strength?: number;
  inpaintImg2ImgStrength?: number;
  _local_edit_operation?: string;
  _local_focused_inpainting?: boolean;
  v4_prompt: { caption: { base_caption: string; char_captions: CharacterCaption[] }; use_coords: boolean; use_order: boolean };
  v4_negative_prompt: { caption: { base_caption: string; char_captions: CharacterCaption[] } };
}

const readParameters = (descriptor: GenerationJobDescriptor): PayloadParameters =>
  descriptor.payload.parameters as unknown as PayloadParameters;

const textDescriptor = (overrides: Partial<GenerationJobDescriptorInput> = {}) => buildGenerationJobDescriptor({
  operation: 'text-to-image', prompt: 'base scene', negative: 'global negative',
  params: baseParams(), approvedCost: 12, history: {}, ...overrides,
});

const editDescriptor = (operation: ImageEditOperation, overrides: Partial<GenerationJobDescriptorInput> = {}) =>
  buildGenerationJobDescriptor({
    operation, prompt: 'base scene', negative: 'global negative', params: baseParams(), approvedCost: 12, history: {},
    edit: { image: PNG_DATA_URL, mask: PNG_DATA_URL, strength: 0.7, noise: 0.1 }, ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prepareImageEdit).mockImplementation(async () => prepared());
});

describe('文生图描述符', () => {
  it('复用同次真实预处理结果，不再读取或转换底图，并保持描述符一致', async () => {
    const input: GenerationJobDescriptorInput = {
      operation: 'inpaint', prompt: 'scene', negative: '', params: baseParams(), approvedCost: 0, history: {},
      edit: { image: PNG_DATA_URL, mask: PNG_DATA_URL, strength: 0.7, noise: 0.1 },
    };
    const pixels = prepared();
    vi.mocked(prepareImageEdit).mockResolvedValue(pixels);
    const expected = await buildGenerationJobDescriptor(input);
    vi.mocked(prepareImageEdit).mockClear();
    const actual = await buildGenerationJobDescriptor(input, pixels);
    expect(prepareImageEdit).not.toHaveBeenCalled();
    expect(actual).toEqual(expected);
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 分栏只在请求中编译，历史保留可继续编辑的原始分栏', async operation => {
    const role = { ...character, prompt: 'manual text', sections: { wardrobe: 'white dress' }, sectionNegatives: { wardrobe: 'coat' } };
    const params = { ...baseParams(), characters: [role] };
    const descriptor = operation === 'text-to-image' ? await textDescriptor({ params }) : await editDescriptor(operation, { params });
    expect(readParameters(descriptor).v4_prompt.caption.char_captions[0].char_caption).toBe('white dress, manual text');
    expect(readParameters(descriptor).v4_negative_prompt.caption.char_captions[0].char_caption).toBe('coat, red hair');
    expect(descriptor.history.params.characters![0]).toMatchObject({ prompt: 'manual text', sections: { wardrobe: 'white dress' }, sectionNegatives: { wardrobe: 'coat' } });
    expect(params.characters[0]).toEqual(role);
  });
  it('按模型设置构建生成 payload，并原样带上历史来源与授权费用', async () => {
    const draft = { ...baseParams(), characters: [positionedCharacter, pausedCharacter, emptyCharacter] };
    const snapshot = structuredClone(draft);
    const descriptor = await textDescriptor({
      params: draft, approvedCost: 25,
      history: { basePrompt: 'chain base', subjectPrompt: 'subject text', modules: [promptModule],
        sourceChainId: 'chain-1', sourceChainName: 'Chain One', sourceChainType: 'style' },
    });
    const parameters = readParameters(descriptor);

    expect(descriptor.payload.action).toBe('generate');
    expect(descriptor.payload.model).toBe(MODEL);
    expect(descriptor.payload.input).toBe('base scene, very aesthetic, masterpiece, no text');
    expect(parameters.n_samples).toBe(1);
    expect(parameters).toMatchObject({ width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' });
    expect(parameters.qualityPresetId).toBe('standard');
    expect(parameters.ucPresetId).toBe('light');
    expect(parameters.negative_prompt).toBe('lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page, global negative');
    expect(parameters.v4_prompt).toEqual({
      caption: { base_caption: 'base scene, very aesthetic, masterpiece, no text',
        char_captions: [{ char_caption: 'blue hair, blue dress', centers: [{ x: 0.5, y: 0.7 }] }] },
      use_coords: false,
      use_order: true,
    });
    expect(parameters.v4_negative_prompt.caption.char_captions).toEqual([{ char_caption: 'red hair', centers: [{ x: 0.5, y: 0.7 }] }]);

    expect(descriptor.randomSeed).toBe(true);
    expect('seed' in parameters).toBe(false);
    expect(descriptor.stream).toBe(false);
    expect(descriptor.approvedCost).toBe(25);
    expect(descriptor.history).toMatchObject({ prompt: 'base scene', negativePrompt: 'global negative',
      basePrompt: 'chain base', subjectPrompt: 'subject text',
      sourceChainId: 'chain-1', sourceChainName: 'Chain One', sourceChainType: 'style' });
    expect(descriptor.history.modules).toEqual([promptModule]);
    // 历史只保留启用且非空的角色，并按非 freeform 模型吸附坐标；其余草稿字段不变。
    expect(descriptor.history.params).toEqual({ ...draft, useCoords: false, characters: [{ ...positionedCharacter, x: 0.5, y: 0.7 }] });
    expect('edit' in descriptor.history).toBe(false);
    expect('composition' in descriptor).toBe(false);
    expect('editMask' in descriptor).toBe(false);
    // 草稿只读：模型设置与随机种子都不回写
    expect(draft).toEqual(snapshot);
  });

  it('固定 seed 关闭随机种子并原样发送；seed 未设或为 -1 时交给后端抽取', async () => {
    const fixed = readParameters(await textDescriptor({ params: { ...baseParams(), seed: 123 } }));
    expect(fixed.seed).toBe(123);
    expect((await textDescriptor({ params: { ...baseParams(), seed: 123 } })).randomSeed).toBe(false);

    const unset = await textDescriptor();
    expect(unset.randomSeed).toBe(true);
    expect('seed' in readParameters(unset)).toBe(false);

    const minusOne = await textDescriptor({ params: { ...baseParams(), seed: -1 } });
    expect(minusOne.randomSeed).toBe(true);
    expect('seed' in readParameters(minusOne)).toBe(false);

    const forced = await textDescriptor({ params: { ...baseParams(), seed: 123 }, forceEmptySeed: true });
    expect(forced.randomSeed).toBe(true);
    expect('seed' in readParameters(forced)).toBe(false);
    expect(forced.history.params.seed).toBeUndefined();
  });

  it('流式只改 payload 的 stream 标记，不改变历史结果', async () => {
    const descriptor = await textDescriptor({ stream: true });
    expect(descriptor.stream).toBe(true);
    expect(readParameters(descriptor).stream).toBe('sse');
    expect(descriptor.history.prompt).toBe('base scene');
  });

  it('固定档位模型记录空负面词与固定参数，V5 历史保留自由角色坐标', async () => {
    const descriptor = await textDescriptor({
      params: { ...baseParams(), model: 'nai-diffusion-5-full-medium', characters: [positionedCharacter, pausedCharacter] },
    });
    expect(descriptor.history.negativePrompt).toBe('');
    expect(descriptor.history.params).toMatchObject({ model: 'nai-diffusion-5-full-medium', steps: 14, sampler: 'k_euler_ancestral', ucPresetId: 'heavy', cfgRescale: 0 });
    expect(descriptor.history.params.characters).toEqual([{ ...positionedCharacter, negativePrompt: '', x: 0.42, y: 0.62 }]);
    // 共享 payload 类型把 input 标为可选：先确认类型再断言，不做盲目属性访问。
    const { input } = descriptor.payload;
    if (typeof input !== 'string') throw new Error('描述符缺少 input');
    expect(input.startsWith('base scene')).toBe(true);
    expect(readParameters(descriptor).negative_prompt).not.toContain('global negative');
  });
});

describe('编辑描述符', () => {
  it.each([
    ['image-to-image', 'img2img', MODEL],
    ['inpaint', 'infill', `${MODEL}-inpainting`],
    ['outpaint', 'infill', `${MODEL}-inpainting`],
  ] as const)('%s 随机 seed 交给后端每张重抽，不带 seed 与 extra_noise_seed', async (operation, action, model) => {
    const descriptor = await editDescriptor(operation);
    const parameters = readParameters(descriptor);
    expect(descriptor.payload.action).toBe(action);
    expect(descriptor.payload.model).toBe(model);
    expect(descriptor.randomSeed).toBe(true);
    expect('seed' in parameters).toBe(false);
    expect('extra_noise_seed' in parameters).toBe(false);
    expect(parameters._local_edit_operation).toBe(operation);
    expect(parameters.image).toBe(PNG_DATA_URL.split(',')[1]);
    expect(parameters.mask).toBe(PNG_DATA_URL.split(',')[1]);
    expect(operation === 'image-to-image' ? parameters.strength : parameters.inpaintImg2ImgStrength).toBe(0.7);
    expect(descriptor.editMask).toBe(PNG_DATA_URL);
    expect(descriptor.composition?.originalImage.startsWith('data:image/png;base64,')).toBe(true);
    expect(descriptor.composition?.compositeMask.startsWith('data:image/png;base64,')).toBe(true);
    expect(descriptor.composition && 'focusedGeometry' in descriptor.composition).toBe(false);
  });

  it('固定 seed 同时发送 seed 与 seed-1 的噪声种子，forceEmptySeed 可强制随机', async () => {
    const fixed = readParameters(await editDescriptor('inpaint', { params: { ...baseParams(), seed: 123 } }));
    expect(fixed.seed).toBe(123);
    expect(fixed.extra_noise_seed).toBe(122);
    expect((await editDescriptor('inpaint', { params: { ...baseParams(), seed: 123 } })).randomSeed).toBe(false);
    expect((await editDescriptor('inpaint', { params: { ...baseParams(), seed: -1 } })).randomSeed).toBe(true);

    const forced = await editDescriptor('inpaint', { params: { ...baseParams(), seed: 123 }, forceEmptySeed: true });
    const forcedParameters = readParameters(forced);
    expect(forced.randomSeed).toBe(true);
    expect('seed' in forcedParameters).toBe(false);
    expect('extra_noise_seed' in forcedParameters).toBe(false);
  });

  it('图生图整图无蒙版：不带 composition、不带蒙版参数与顶层 editMask', async () => {
    vi.mocked(prepareImageEdit).mockResolvedValueOnce(prepared({ mask: undefined, compositeMask: undefined }));
    const descriptor = await editDescriptor('image-to-image', {
      edit: { image: PNG_DATA_URL, strength: 0.6, noise: 0 },
      history: { edit: { baseImageSource: 'upload', parentHistoryId: 'h-1' } },
    });
    expect('composition' in descriptor).toBe(false);
    expect('editMask' in descriptor).toBe(false);
    expect('mask' in descriptor.payload.parameters).toBe(false);
    expect(descriptor.history.edit).toMatchObject({ baseImageSource: 'upload', parentHistoryId: 'h-1', maskAvailable: false, fullSizeMask: false });
  });

  it('补全历史编辑 metadata：请求尺寸、蒙版可用性、预估费用与 Key 指纹', async () => {
    const descriptor = await editDescriptor('inpaint', { apiKey: 'test-key', estimatedCost: 12.5, history: { edit: { baseImageSource: 'clipboard' } } });
    expect(descriptor.history.edit).toMatchObject({
      operation: 'inpaint', requestWidth: 832, requestHeight: 1216,
      maskAvailable: true, fullSizeMask: true, estimatedCost: 12.5,
      settlementStatus: 'estimated', baseImageSource: 'clipboard',
    });
    expect(descriptor.history.edit?.keyHash).toBe(await hashNaiApiKey('test-key'));

    const anonymous = await editDescriptor('inpaint');
    expect(anonymous.history.edit?.keyHash).toBeUndefined();
    expect(anonymous.history.edit?.estimatedCost).toBeUndefined();
    expect(anonymous.history.edit?.maskAvailable).toBe(true);
  });

  it('编辑历史负面词取实际生效值：固定档位模型为空，其余等于输入', async () => {
    expect((await editDescriptor('image-to-image')).history.negativePrompt).toBe('global negative');
    const fixed = await editDescriptor('inpaint', { params: { ...baseParams(), model: 'nai-diffusion-5-full-medium' } });
    expect(fixed.payload.model).toBe('nai-diffusion-5-full-medium-inpainting');
    expect(fixed.history.negativePrompt).toBe('');
    expect(readParameters(fixed).negative_prompt).not.toContain('global negative');
  });

  it('Focused 裁剪只改请求坐标，历史保留整图尺寸与角色位置', async () => {
    vi.mocked(prepareImageEdit).mockResolvedValueOnce(prepared({
      requestWidth: 832, requestHeight: 1216, sourceWidth: 1536, sourceHeight: 2048,
      originalImage: new Blob([PNG_BYTES], { type: 'image/png' }),
      compositeMask: new Blob([PNG_BYTES], { type: 'image/png' }),
      focusedGeometry: { crop: { x: 768, y: 1024, width: 768, height: 1024 }, inner: { x: 800, y: 1056, width: 704, height: 960 },
        requestWidth: 832, requestHeight: 1216, fullSizeMask: true },
    }));
    const descriptor = await editDescriptor('inpaint', {
      params: { ...baseParams(), width: 1536, height: 2048, useCoords: true, characters: [{ ...character, x: 0.5, y: 0.5 }] },
      edit: { image: PNG_DATA_URL, mask: PNG_DATA_URL, strength: 1, noise: 0, focused: true },
    });
    const parameters = readParameters(descriptor);
    expect([parameters.width, parameters.height]).toEqual([832, 1216]);
    expect(parameters._local_focused_inpainting).toBe(true);
    expect(parameters.v4_prompt.use_coords).toBe(true);
    expect(parameters.v4_prompt.caption.char_captions[0].centers[0]).toEqual({ x: 0.1, y: 0.1 });
    expect(parameters.v4_negative_prompt.caption.char_captions[0].centers).toEqual(parameters.v4_prompt.caption.char_captions[0].centers);
    expect(descriptor.composition?.focusedGeometry).toEqual({ crop: { x: 768, y: 1024, width: 768, height: 1024 },
      inner: { x: 800, y: 1056, width: 704, height: 960 }, requestWidth: 832, requestHeight: 1216, fullSizeMask: true });
    expect(descriptor.history.params.width).toBe(1536);
    expect(descriptor.history.params.height).toBe(2048);
    expect(descriptor.history.params.characters).toEqual([{ ...character, x: 0.5, y: 0.5 }]);
    expect(descriptor.history.edit?.requestWidth).toBe(832);
    expect(descriptor.history.edit?.requestHeight).toBe(1216);
  });
});

describe('能力校验', () => {
  it('未导入的 PNG 编码阻止参考生成，但不阻止本来就不发送 Vibe 的重绘与扩图', async () => {
    const params: NAIParams = { ...baseParams(), vibes: { enabled: true, normalizeStrengths: true, slots: [],
      embedded: { model: MODEL, encodings: ['synthetic-encoding'], strengths: [0.6] } } };
    await expect(textDescriptor({ params })).rejects.toThrow('Vibe 编码尚未完成导入');
    await expect(editDescriptor('image-to-image', { params })).rejects.toThrow('Vibe 编码尚未完成导入');
    for (const operation of ['inpaint', 'outpaint'] as const) {
      const descriptor = await editDescriptor(operation, { params });
      expect(descriptor.payload.parameters).not.toHaveProperty('_local_vibe_slots');
    }
  });

  it('模型不支持 Vibe 时拒绝提交', async () => {
    await expect(textDescriptor({
      params: { ...baseParams(), model: 'nai-diffusion-5-full',
        vibes: { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'v1', encodingId: 'e1', informationExtracted: 0.9, strength: 0.6 }] } },
    })).rejects.toThrow('暂不支持 Vibe Transfer');
  });

  it('角色数超过模型上限时拒绝提交', async () => {
    const characters = Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, prompt: `char ${index}`, x: 0.5, y: 0.5 }));
    await expect(textDescriptor({ params: { ...baseParams(), characters } })).rejects.toThrow('最多支持 6 个角色提示词');
  });

  it('精准参考超过数量上限时拒绝提交', async () => {
    const slots = Array.from({ length: 5 }, (_, index) => ({ assetId: `a${index}`, type: 'character' as const, strength: 0.6, fidelity: 1 }));
    await expect(textDescriptor({ params: { ...baseParams(), characterReferences: { enabled: true, slots } } }))
      .rejects.toThrow('一次最多使用 4 个精准参考');
  });
});
