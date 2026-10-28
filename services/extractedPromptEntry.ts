import { readPromptPurposes, type PromptPurposeId } from './promptPurposes.mjs';
/**
 * 把审阅后的「AI 提取候选」转换成本地库条目。
 *
 * 与 components/PromptLibrary.tsx 的保存路径保持同一套参数结构（LAB_DEFAULT_PARAMS +
 * _promptLibrary），这样提取出来的条目在编辑、搭配、选择器里与别处新建的条目表现一致。
 * 中文原文写入 _promptLibrary.bilingual 做中英对照，不塞进 basePrompt。
 */
import { LAB_DEFAULT_PARAMS } from './labWorkspace';
import type { ChainType, NAIParams, PromptChain } from '../types';

/** 审阅后仍要落库的候选（与 PromptExtractionCandidate 同形，避免两处字段漂移）。 */
export interface ExtractedEntryDraft {
  /** 同一候选的保存身份，重试与编辑时保持，不作为内容中的原串 ID。 */
  entryId: string;
  kind: ChainType;
  /** 显式空数组为未归类；旧候选未提供时保留原类型兼容。 */
  purposes?: PromptPurposeId[];
  directoryIds?: string[];
  name: string;
  prompt: string;
  original?: string;
}

/** NAIParams 上的扩展键，与 components/PromptLibrary.tsx 的 PromptLibraryParams 同形。 */
type ExtractedParams = NAIParams & {
  _promptLibraryDirectoryIds?: string[];
  _collectedCategory?: 'general';
  _promptLibrary?: { bilingual?: string; references?: Array<{ id: string; url: string; prompt: string }> };
};

/**
 * 生成 createChainWithData 需要的数据。
 * 只搬运已经由用户确认过的内容：名称、英文提示词、中文对照，不在这里补写提示词。
 */
export const buildExtractedChainPayload = (draft: ExtractedEntryDraft): {
  name: string;
  type: ChainType;
  data: Partial<PromptChain>;
} => {
  const params: ExtractedParams = {
    ...LAB_DEFAULT_PARAMS,
    _promptLibraryPurposes: readPromptPurposes(draft.purposes),
    _promptLibrary: { bilingual: String(draft.original || '').trim(), references: [] },
    ...(draft.directoryIds === undefined ? {} : { _promptLibraryDirectoryIds: [...new Set(draft.directoryIds)] }),
    ...(draft.kind === 'preset' ? { _collectedCategory: 'general' as const } : {}),
  };
  return {
    name: String(draft.name || '').trim() || '未命名提取条目',
    type: draft.kind,
    data: {
      basePrompt: String(draft.prompt || '').trim(),
      params,
      variableValues: { subject: '' },
      modules: [],
    },
  };
};
