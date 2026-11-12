export interface PromptTagToken {
  id: string;
  displayTag: string;
  lookupTag: string;
  start?: number;
  end?: number;
  groupId?: string;
  groupStart?: number;
  groupEnd?: number;
  groupWeight?: string;
  groupKind?: 'numeric' | 'brace' | 'bracket';
  groupLevel?: number;
  /** 数值权重是否已有结尾 ::；仅 numeric 组设置，false 表示原文尚未闭合。 */
  groupClosed?: boolean;
  groupEdge?: 'open' | 'close' | 'both';
}

export function parsePromptTags(prompt: string): PromptTagToken[];
