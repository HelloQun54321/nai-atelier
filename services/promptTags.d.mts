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
  groupEdge?: 'open' | 'close' | 'both';
}

export function parsePromptTags(prompt: string): PromptTagToken[];
