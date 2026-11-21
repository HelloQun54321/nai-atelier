export interface ComicStoryboardCastItem {
  name: string;
  prompt: string;
}

export interface ComicStoryboardInput {
  storyPrompt: string;
  targetPanelCount?: number;
  width?: number;
  height?: number;
  colorMode?: 'color' | 'monochrome';
  dialogueMode?: 'clean-vector' | 'empty-bubble' | 'ai-text';
  castCharacters?: ComicStoryboardCastItem[];
}

export interface ComicStoryboardResult {
  title?: string;
  layoutHint: string;
  guidePanels: Array<{
    label: string;
    summary: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  anchors: Array<{
    kind: 'character' | 'scene' | 'bubble' | 'inset';
    label: string;
    prompt: string;
    negativePrompt: string;
    x: number;
    y: number;
    enabled: boolean;
    bubbleShape?: 'oval' | 'shout' | 'thought' | 'caption';
    bubbleText?: string;
  }>;
  provider?: string;
  model?: string;
}

export function buildComicStoryboardSystemPrompt(): string;
export function buildComicStoryboardUserMessage(input?: ComicStoryboardInput): string;
export function parseComicStoryboardResponse(
  rawText: string,
  options?: { dialogueMode?: 'clean-vector' | 'empty-bubble' | 'ai-text' },
): ComicStoryboardResult;
