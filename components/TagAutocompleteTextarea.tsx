import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Languages, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import { InfoPopover } from './InfoPopover';
import { normalizeTagQuery, preloadTagDictionary, searchTagDictionary, TagSuggestion } from '../services/tagDictionary';
import {
  parsePromptTags,
  PromptTagToken,
  PromptTagTranslation,
  PromptWeightKind,
  resolvePromptTranslations,
  removePromptTagTokens,
  subscribeTagTranslations,
  transformPromptWeight,
  translateMissingPromptTags,
  wrapPromptTag,
  wrapPromptTagTokens,
} from '../services/tagTranslations';

interface CompletionTarget {
  query: string;
  replaceStart: number;
  replaceEnd: number;
  closingLength: number;
}

interface TagAutocompleteTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  containerClassName?: string;
  tagAssistEnabled?: boolean;
  showTranslations?: boolean;
  allowAiTranslation?: boolean;
}

const isPromptDelimiter = (character: string) => character === ',' || character === '，' || character === '\n' || character === '|';

export const findCompletionTarget = (value: string, caret: number): CompletionTarget | null => {
  const beforeCaret = value.slice(0, caret);
  const delimiterIndex = Math.max(
    beforeCaret.lastIndexOf(','),
    beforeCaret.lastIndexOf('，'),
    beforeCaret.lastIndexOf('\n'),
    beforeCaret.lastIndexOf('|')
  );
  let replaceStart = delimiterIndex + 1;

  const lastScopeMarker = beforeCaret.lastIndexOf('::');
  if (lastScopeMarker >= replaceStart) replaceStart = lastScopeMarker + 2;

  while (replaceStart < caret && /[\s{\[]/.test(value[replaceStart])) replaceStart++;
  if (value.slice(replaceStart, replaceStart + 7).toLowerCase() === 'artist:') replaceStart += 7;

  let queryEnd = caret;
  while (queryEnd > replaceStart && /[}\]]/.test(value[queryEnd - 1])) queryEnd--;
  const closingLength = caret - queryEnd;
  const query = normalizeTagQuery(value.slice(replaceStart, queryEnd));

  if (!query || query.length > 100 || query.includes('::')) return null;

  let replaceEnd = queryEnd;
  while (
    replaceEnd < value.length
    && !isPromptDelimiter(value[replaceEnd])
    && !/[}\]]/.test(value[replaceEnd])
    && value.slice(replaceEnd, replaceEnd + 2) !== '::'
  ) replaceEnd++;

  return { query, replaceStart, replaceEnd, closingLength };
};

const formatPostCount = (count: number) => {
  if (!Number.isFinite(count) || count >= Number.MAX_SAFE_INTEGER) return '官方';
  return new Intl.NumberFormat(getLanguage(), { notation: count >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(count);
};

export const TagAutocompleteTextarea: React.FC<TagAutocompleteTextareaProps> = ({
  value,
  onValueChange,
  className,
  containerClassName = '',
  tagAssistEnabled = true,
  showTranslations = true,
  allowAiTranslation = true,
  disabled,
  readOnly,
  onFocus,
  onBlur,
  onKeyDown,
  onClick,
  onKeyUp,
  onCompositionStart,
  onCompositionEnd,
  ...textareaProps
}) => {
  useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const composingRef = useRef(false);
  const blurTimerRef = useRef<number | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [target, setTarget] = useState<CompletionTarget | null>(null);
  const [completionSource, setCompletionSource] = useState<'prompt' | 'tag'>('prompt');
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const [isLoading, setIsLoading] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [translations, setTranslations] = useState<PromptTagTranslation[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [translationRevision, setTranslationRevision] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [deleteMode, setDeleteMode] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const historyRef = useRef({ value, past: [] as string[], future: [] as string[], typedAt: 0 });
  const neutralGroupsRef = useRef({ value, groups: [] as Array<{ start: number; end: number }> });
  const [, refreshHistory] = useState(0);
  const editable = !disabled && !readOnly;
  const listboxId = useId();
  const closeSuggestions = useCallback(() => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    blurTimerRef.current = null;
    searchTimerRef.current = null;
    requestIdRef.current++;
    setSuggestions([]);
    setTarget(null);
    setActiveIndex(-1);
    setIsLoading(false);
  }, []);
  const parsedTokens = useMemo(() => tagAssistEnabled ? parsePromptTags(value) : [], [tagAssistEnabled, value]);
  const promptTokens = useMemo(() => {
    if (neutralGroupsRef.current.value !== value || !neutralGroupsRef.current.groups.length) return parsedTokens;
    const tokens = parsedTokens.map(token => ({ ...token }));
    // 无权重原文无法记录组界限，只在本次整组选择期间保留范围，供连续加减使用。
    neutralGroupsRef.current.groups.forEach(({ start, end }) => {
      const members = tokens.filter(token => token.start !== undefined && token.start >= start && token.end !== undefined && token.end <= end);
      if (members.length < 2 || !members.every(token => selectedTagIds.has(token.id))) return;
      members.forEach((token, index) => Object.assign(token, {
        groupId: `neutral:${start}:${end}`, groupStart: start, groupEnd: end,
        groupKind: undefined, groupWeight: undefined, groupLevel: undefined,
        groupEdge: index === 0 ? 'open' : index === members.length - 1 ? 'close' : undefined,
      }));
    });
    return tokens;
  }, [parsedTokens, value, selectedTagIds]);
  // 翻译异步返回，但标签位置始终来自当前原文，避免旧结果指向其他词。
  const currentTranslations = useMemo(() => {
    const cached = new Map(translations.map(item => [item.lookupTag, item]));
    return promptTokens.map(token => ({ ...token, chinese: cached.get(token.lookupTag)?.chinese, source: cached.get(token.lookupTag)?.source || 'missing' as const }));
  }, [promptTokens, translations]);

  useEffect(() => {
    if (historyRef.current.value === value) return;
    historyRef.current = { value, past: [], future: [], typedAt: 0 };
    neutralGroupsRef.current = { value, groups: [] };
    setSelectedTagIds(new Set());
    setDeleteMode(false);
    setTagInput('');
    closeSuggestions();
    refreshHistory(revision => revision + 1);
  }, [value, closeSuggestions]);

  const commitValue = (next: string, typing = false) => {
    if (!editable || next === value) return;
    if (neutralGroupsRef.current.value !== next) neutralGroupsRef.current = { value: next, groups: [] };
    const history = historyRef.current;
    const now = Date.now();
    if (!typing || now - history.typedAt > 800 || !history.past.length || history.future.length) {
      history.past.push(value);
      if (history.past.length > 100) history.past.shift();
    }
    history.future = [];
    history.value = next;
    history.typedAt = typing ? now : 0;
    onValueChange(next);
    refreshHistory(revision => revision + 1);
  };

  const moveHistory = (redo = false) => {
    if (!editable) return false;
    const history = historyRef.current;
    const next = (redo ? history.future : history.past).pop();
    if (next === undefined) return false;
    (redo ? history.past : history.future).push(value);
    history.value = next;
    history.typedAt = 0;
    neutralGroupsRef.current = { value: next, groups: [] };
    setSelectedTagIds(new Set());
    setDeleteMode(false);
    onValueChange(next);
    refreshHistory(revision => revision + 1);
    return true;
  };

  useEffect(() => subscribeTagTranslations(() => setTranslationRevision(revision => revision + 1)), []);

  useEffect(() => {
    if (!tagAssistEnabled || !showTranslations || parsedTokens.length === 0) {
      setTranslations([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void resolvePromptTranslations(parsedTokens).then(items => {
        if (active) setTranslations(items);
      }).catch(error => {
        if (active) console.warn('Prompt translation lookup failed:', error);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [parsedTokens, showTranslations, tagAssistEnabled, translationRevision]);

  const missingTags = useMemo(() => [...new Set(currentTranslations
    .filter(item => item.source === 'missing')
    .map(item => item.lookupTag))], [currentTranslations]);

  const translateMissing = async () => {
    if (!tagAssistEnabled || !missingTags.length || translationLoading) return;
    setTranslationLoading(true);
    setTranslationError('');
    try {
      await translateMissingPromptTags(missingTags);
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : '翻译失败');
    } finally {
      setTranslationLoading(false);
    }
  };

  const selectedTokens = promptTokens.filter(token => selectedTagIds.has(token.id));
  const clearSelection = () => {
    neutralGroupsRef.current.groups = [];
    setSelectedTagIds(new Set());
  };
  const deleteSelected = () => {
    if (!editable || !selectedTokens.length) return;
    commitValue(removePromptTagTokens(value, selectedTokens));
    clearSelection();
    setDeleteMode(false);
  };
  const appendTags = (text: string) => {
    const addition = text.trim();
    if (!editable || !addition) return;
    const prefix = !value.trim() ? '' : /[,，|\n]\s*$/.test(value) ? value + (/\s$/.test(value) ? '' : ' ') : `${value.trimEnd()}, `;
    commitValue(prefix + addition);
    setTagInput('');
    closeSuggestions();
    clearSelection();
    setDeleteMode(false);
  };
  const copySelection = (event: React.ClipboardEvent, cut = false) => {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || window.getSelection()?.toString() || !selectedTokens.length || cut && !editable) return;
    event.clipboardData.setData('text/plain', removePromptTagTokens(value, promptTokens.filter(token => !selectedTagIds.has(token.id))));
    event.preventDefault();
    if (cut) deleteSelected();
  };
  const selectedWeightKinds = new Set<'brace' | 'numeric'>(selectedTokens.map(token => token.groupKind === 'numeric' ? 'numeric' : 'brace'));
  const selectedWeightKind = selectedWeightKinds.size === 1 ? [...selectedWeightKinds][0] : undefined;
  const hasSelectedWeight = selectedTokens.some(token => token.groupKind);
  const selectedWeightValues = selectedTokens.map(token => token.groupKind === 'numeric'
    ? Number(token.groupWeight || 1)
    : 1.05 ** (token.groupKind === 'brace' ? token.groupLevel || 1 : token.groupKind === 'bracket' ? -(token.groupLevel || 1) : 0));
  const selectedWeightValue = selectedWeightValues[0] ?? 1;
  // 比较实际倍率，仅容忍浮点计算误差，不把显示时的小数取舍用于判断。
  const differentWeights = selectedWeightValues.some(weight => Math.abs(weight - selectedWeightValue) > 1e-12 * Math.max(1, Math.abs(weight), Math.abs(selectedWeightValue)));
  const displayedWeight = selectedWeightValues.length && !differentWeights && Number.isFinite(selectedWeightValue) ? String(Number(selectedWeightValue.toFixed(6))) : '';
  const selectionKey = selectedTokens.map(token => token.id).join('|');
  const [weightInput, setWeightInput] = useState('');
  const [weightInputEdited, setWeightInputEdited] = useState(false);
  const [weightKind, setWeightKind] = useState<'brace' | 'numeric'>('brace');
  useEffect(() => {
    setWeightInput(displayedWeight);
    setWeightInputEdited(false);
  }, [displayedWeight, selectionKey, weightKind]);
  useEffect(() => {
    if (hasSelectedWeight && selectedWeightKind) setWeightKind(selectedWeightKind);
  }, [hasSelectedWeight, selectedWeightKind, selectionKey]);
  useEffect(() => {
    const validIds = new Set(promptTokens.map(token => token.id));
    neutralGroupsRef.current.groups = neutralGroupsRef.current.groups.filter(({ start, end }) => {
      const members = promptTokens.filter(token => token.start !== undefined && token.start >= start && token.end !== undefined && token.end <= end);
      return members.length > 1 && members.every(token => selectedTagIds.has(token.id));
    });
    setSelectedTagIds(current => {
      const next = new Set([...current].filter(id => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [promptTokens, selectedTagIds]);

  const commitWeightInput = () => {
    if (!editable || deleteMode || weightKind !== 'numeric' || !weightInputEdited) return;
    const next = Number(weightInput);
    if (!weightInput.trim() || !Number.isFinite(next) || !selectedTokens.length) {
      setWeightInput(displayedWeight);
      setWeightInputEdited(false);
      return;
    }
    const uniqueGroupIds = new Set(selectedTokens.map(t => t.groupId).filter(Boolean));
    const allNumeric = selectedTokens.length > 0 && selectedTokens.every(t => t.groupKind === 'numeric');
    if (uniqueGroupIds.size === 1 && allNumeric) {
      applyWeight('numeric', next);
    } else {
      applyWeightWrap('numeric', next);
    }
    setWeightInputEdited(false);
  };

  const replaceSelectedGroups = (transform: (raw: string, token: PromptTagToken) => string) => {
    if (!editable || !selectedTokens.length) return;
    const groups = new Map<string, PromptTagToken[]>();
    selectedTokens.forEach(token => groups.set(token.groupId || token.id, [...(groups.get(token.groupId || token.id) || []), token]));
    const replacements = [...groups.values()].map(tokens => {
      const first = tokens[0];
      const start = first.groupStart ?? first.start ?? 0;
      const end = first.groupEnd ?? first.end ?? start;
      const raw = value.slice(start, end);
      const next = transform(raw, first);
      const neutral = Boolean(first.groupId) && tokens.length > 1 && (!first.groupKind && next === raw
        || next !== raw && next === transformPromptWeight(raw, first, 'remove'));
      return { start, end, value: next, neutral };
    }).filter(item => Boolean(item.value)).sort((a, b) => b.start - a.start);
    let nextValue = value;
    replacements.forEach(item => { nextValue = nextValue.slice(0, item.start) + item.value + nextValue.slice(item.end); });
    let offset = 0;
    const neutralGroups = [...replacements].reverse().flatMap(item => {
      const start = item.start + offset;
      offset += item.value.length - (item.end - item.start);
      return item.neutral ? [{ start, end: start + item.value.length }] : [];
    });
    neutralGroupsRef.current = { value: nextValue, groups: neutralGroups };
    commitValue(nextValue);
  };

  const applyWeight = (mode: 'up' | 'down' | 'remove' | 'numeric', numericWeight?: number, step = 0.1) => {
    if (mode === 'numeric' && !Number.isFinite(numericWeight)) return;
    replaceSelectedGroups((raw, token) => !token.groupKind && weightKind === 'numeric' && (mode === 'up' || mode === 'down')
      ? wrapPromptTag(raw, token, 'numeric', 1 + (mode === 'up' ? step : -step))
      : transformPromptWeight(raw, token, mode, numericWeight, step));
  };

  const applyWeightWrap = (kind: PromptWeightKind, numericWeight?: number) => {
    if (!selectedTokens.length) return;
    const nextValue = wrapPromptTagTokens(value, selectedTokens, kind, numericWeight);
    if (nextValue !== value) commitValue(nextValue);
  };

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    requestIdRef.current++;
  }, []);

  useEffect(() => {
    if (tagAssistEnabled) return;
    closeSuggestions();
    setTranslations([]);
    setTranslationError('');
    setDeleteMode(false);
    clearSelection();
  }, [tagAssistEnabled, closeSuggestions]);

  useEffect(() => {
    if (!editable || completionSource === 'tag' && (!showTranslations || deleteMode)) closeSuggestions();
  }, [editable, completionSource, showTranslations, deleteMode, closeSuggestions]);

  const refreshSuggestions = useCallback((nextValue = value, caret = textareaRef.current?.selectionStart ?? 0, source: 'prompt' | 'tag' = 'prompt') => {
    if (!tagAssistEnabled || !editable || composingRef.current) return;
    closeSuggestions();
    setCompletionSource(source);
    const nextTarget = findCompletionTarget(nextValue, caret);
    setTarget(nextTarget);
    setActiveIndex(-1);
    const requestId = ++requestIdRef.current;

    if (!nextTarget) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      void searchTagDictionary(nextTarget.query).then(results => {
        if (requestId === requestIdRef.current) setSuggestions(results);
      }).catch(error => {
        if (requestId === requestIdRef.current) setSuggestions([]);
        console.warn('Tag autocomplete search failed:', error);
      }).finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });
    }, 80);
  }, [editable, tagAssistEnabled, value, closeSuggestions]);

  const selectSuggestion = (suggestion: TagSuggestion) => {
    if (!target || !editable) return;
    const input = completionSource === 'tag' ? tagInputRef.current : textareaRef.current;
    const sourceValue = completionSource === 'tag' ? tagInput : value;
    const nextValue = sourceValue.slice(0, target.replaceStart)
      + suggestion.name
      + sourceValue.slice(target.replaceEnd);
    const nextCaret = target.replaceStart + suggestion.name.length + target.closingLength;
    if (completionSource === 'tag') setTagInput(nextValue);
    else commitValue(nextValue);
    closeSuggestions();
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
      closeSuggestions();
    });
  };

  const isOpen = tagAssistEnabled && editable && (completionSource === 'prompt' || showTranslations && !deleteMode) && Boolean(target && (suggestions.length > 0 || isLoading));
  const handleCompletionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || !isOpen
      || event.currentTarget !== (completionSource === 'tag' ? tagInputRef.current : textareaRef.current)) return false;
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(index => event.key === 'ArrowDown'
          ? index < 0 ? 0 : (index + 1) % suggestions.length
          : index < 0 ? suggestions.length - 1 : (index - 1 + suggestions.length) % suggestions.length);
        return true;
      }
      if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
        return true;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSuggestions();
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!isOpen) return;
    const listbox = listboxRef.current;
    const option = optionRefs.current[activeIndex];
    if (!listbox || !option) return;

    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    if (optionTop < listbox.scrollTop) {
      listbox.scrollTop = optionTop;
    } else if (optionBottom > listbox.scrollTop + listbox.clientHeight) {
      listbox.scrollTop = optionBottom - listbox.clientHeight;
    }
  }, [activeIndex, isOpen, suggestions]);

  useEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const rect = (completionSource === 'tag' ? tagInputRef.current : textareaRef.current)?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const below = viewportHeight - rect.bottom;
      const showUp = below < 240 && rect.top > below;
      setDropUp(showUp);
      const width = Math.min(560, Math.max(280, rect.width));
      // 浮层跟随当前输入位置，限制在视口内，避免末尾输入框的候选溢出右侧。
      setPopupStyle({
        position: 'fixed',
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: showUp ? undefined : rect.bottom + 4,
        bottom: showUp ? viewportHeight - rect.top + 4 : undefined,
        width,
        maxHeight: 'min(18rem, 42dvh)',
        zIndex: 9999,
      });
    };
    updatePosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (textareaRef.current) observer?.observe(textareaRef.current);
    if (completionSource === 'tag' && tagInputRef.current?.parentElement) observer?.observe(tagInputRef.current.parentElement);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.addEventListener('resize', updatePosition);
    // 捕获阶段监听滚动：容器滚动时弹窗跟随输入框移动，不被裁切
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer?.disconnect();
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, completionSource]);

  return (
    <div className={`relative ${containerClassName}`} onKeyDownCapture={event => {
      if (!tagAssistEnabled || !showTranslations || event.nativeEvent.isComposing) return;
      const field = (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (!field || field === textareaRef.current)) {
        if ((key === 'z' || key === 'y') && moveHistory(key === 'y' || event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
        if (key === 'a' && !field) { event.preventDefault(); setSelectedTagIds(new Set(promptTokens.map(token => token.id))); }
      }
      if (event.key === 'Escape' && deleteMode) { event.preventDefault(); event.stopPropagation(); setDeleteMode(false); clearSelection(); }
    }}>
      <textarea
        {...textareaProps}
        ref={textareaRef}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        className={className}
        role={tagAssistEnabled ? 'combobox' : undefined}
        aria-autocomplete={tagAssistEnabled ? 'list' : undefined}
        aria-expanded={tagAssistEnabled ? isOpen && completionSource === 'prompt' : undefined}
        aria-controls={tagAssistEnabled && isOpen && completionSource === 'prompt' ? listboxId : undefined}
        aria-activedescendant={tagAssistEnabled && isOpen && completionSource === 'prompt' && suggestions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        onChange={(event) => {
          commitValue(event.target.value, true);
          clearSelection();
          if (tagAssistEnabled) refreshSuggestions(event.target.value, event.target.selectionStart);
        }}
        onFocus={(event) => {
          composingRef.current = false;
          if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
          if (tagAssistEnabled) {
            preloadTagDictionary();
            refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          }
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (!listboxRef.current?.contains(event.relatedTarget as Node)) {
            blurTimerRef.current = window.setTimeout(closeSuggestions, 120);
          }
          onBlur?.(event);
        }}
        onClick={(event) => {
          if (tagAssistEnabled) refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          onClick?.(event);
        }}
        onKeyUp={onKeyUp}
        onKeyDown={(event) => {
          if (handleCompletionKeyDown(event)) return;
          onKeyDown?.(event);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          closeSuggestions();
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          if (tagAssistEnabled) refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          onCompositionEnd?.(event);
        }}
      />

      {tagAssistEnabled && showTranslations && (currentTranslations.length > 0 || editable) && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-900/55" aria-label={t("提示词中文翻译")} tabIndex={0}
          onCopy={event => copySelection(event)} onCut={event => copySelection(event, true)}
          onPaste={event => {
            if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || !editable) return;
            const text = event.clipboardData.getData('text/plain');
            if (text.trim()) { event.preventDefault(); appendTags(text); }
          }}>
          <div className="flex h-36 min-h-10 resize-y flex-wrap content-start items-start gap-1.5 overflow-y-auto overscroll-contain pr-1.5 pb-1.5">
            {(() => {
              // 权重组按连续区间渲染为单个胶囊：中间无间隔、强调色贯穿，选择粒度也是整组。
              const nodes: React.ReactNode[] = [];
              let cursor = 0;
              while (cursor < currentTranslations.length) {
                const item = currentTranslations[cursor];
                if (deleteMode || !item.groupId) {
                  const selected = selectedTagIds.has(item.id);
                  nodes.push(
                    <button
                      type="button"
                      onClick={() => setSelectedTagIds(current => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                        return next;
                      })}
                      key={item.id}
                      className={`inline-flex max-w-full flex-col rounded-md border px-2 py-1 text-left leading-tight transition-colors ${deleteMode ? 'hover:border-red-400' : 'hover:border-[var(--nai-accent)]'} ${selected
                        ? deleteMode ? 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-950/40' : 'border-[var(--nai-accent)] bg-[color-mix(in_srgb,var(--nai-accent)_14%,transparent)]'
                        : 'border-gray-200 bg-white/60 dark:border-gray-700 dark:bg-gray-900/50'}`}
                      aria-pressed={selected}
                    >
                      <span className={`max-w-52 truncate font-mono text-micro ${selected ? deleteMode ? 'text-red-600 dark:text-red-400' : 'text-[var(--nai-accent)]' : 'text-gray-500 dark:text-gray-400'}`} title={item.displayTag}>{item.displayTag}</span>
                      <span className={`max-w-48 truncate text-xs font-medium ${selected ? deleteMode ? 'text-red-600 dark:text-red-400' : 'text-[var(--nai-accent)]' : 'text-gray-500 dark:text-gray-400'}`} title={item.chinese || t("词库暂无翻译")}>{item.chinese || t("待翻译")}</span>
                    </button>,
                  );
                  cursor += 1;
                  continue;
                }
                const members: PromptTagTranslation[] = [];
                while (cursor < currentTranslations.length && currentTranslations[cursor].groupId === item.groupId) {
                  members.push(currentTranslations[cursor]);
                  cursor += 1;
                }
                const first = members[0];
                const last = members[members.length - 1];
                const openSyntax = first.groupKind === 'numeric' ? `${first.groupWeight || '1'}::`
                  : first.groupKind === 'brace' ? '{'.repeat(first.groupLevel || 1)
                    : first.groupKind === 'bracket' ? '['.repeat(first.groupLevel || 1) : '';
                const closeSyntax = last.groupKind === 'numeric' ? '::'
                  : last.groupKind === 'brace' ? '}'.repeat(last.groupLevel || 1)
                    : last.groupKind === 'bracket' ? ']'.repeat(last.groupLevel || 1) : '';
                const groupSelected = members.every(member => selectedTagIds.has(member.id));
                // 未选中时权重组与散 Tag 同为中性灰白，强调色只留给选中态。
                const groupTextTone = groupSelected ? 'text-[var(--nai-accent)]' : 'text-gray-500 dark:text-gray-400';
                nodes.push(
                  <button
                    type="button"
                    onClick={() => setSelectedTagIds(current => {
                      const groupIds = members.map(member => member.id);
                      const allSelected = groupIds.every(id => current.has(id));
                      const next = new Set(current);
                      groupIds.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
                      return next;
                    })}
                    key={item.groupId}
                    className={`inline-flex max-w-full flex-wrap items-start overflow-hidden rounded-md border text-left leading-tight transition-colors hover:border-[var(--nai-accent)] ${groupSelected
                      ? 'border-[var(--nai-accent)] bg-[color-mix(in_srgb,var(--nai-accent)_14%,transparent)]'
                      : 'border-gray-200 bg-white/60 dark:border-gray-700 dark:bg-gray-900/50'}`}
                    aria-pressed={groupSelected}
                  >
                    {openSyntax && <span className={`shrink-0 py-1 pl-2 font-mono text-micro font-bold ${groupTextTone}`}>{openSyntax}</span>}
                    {members.map((member, memberIndex) => (
                      <span key={member.id} className={`flex min-w-0 flex-col px-2 py-1 ${memberIndex > 0 ? (groupSelected ? 'border-l border-[color-mix(in_srgb,var(--nai-accent)_25%,transparent)]' : 'border-l border-gray-200 dark:border-gray-700') : ''}`}>
                        <span className={`max-w-52 truncate font-mono text-micro ${groupTextTone}`} title={member.displayTag}>{member.displayTag}</span>
                        <span className={`max-w-48 truncate text-xs font-medium ${groupTextTone}`} title={member.chinese || t("词库暂无翻译")}>{member.chinese || t("待翻译")}</span>
                      </span>
                    ))}
                    {closeSyntax && <span className={`shrink-0 py-1 pr-2 font-mono text-micro font-bold ${groupTextTone}`}>{closeSyntax}</span>}
                  </button>,
                );
              }
              return nodes;
            })()}
            {!deleteMode && editable && <input ref={tagInputRef} role="combobox" aria-label={t("添加提示词")} placeholder={t("添加提示词")} value={tagInput}
              aria-autocomplete="list" aria-expanded={isOpen && completionSource === 'tag'}
              aria-controls={isOpen && completionSource === 'tag' ? listboxId : undefined}
              aria-activedescendant={isOpen && completionSource === 'tag' && suggestions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
              onChange={event => {
                setTagInput(event.target.value);
                refreshSuggestions(event.target.value, event.target.selectionStart ?? event.target.value.length, 'tag');
              }}
              onFocus={event => {
                composingRef.current = false;
                preloadTagDictionary();
                refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart ?? 0, 'tag');
              }}
              onClick={event => refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart ?? 0, 'tag')}
              onBlur={event => {
                if (listboxRef.current?.contains(event.relatedTarget as Node)) return;
                appendTags(event.currentTarget.value);
                closeSuggestions();
              }}
              onKeyDown={event => {
                if (handleCompletionKeyDown(event) || composingRef.current || event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); appendTags(tagInput); }
              }}
              onCompositionStart={() => { composingRef.current = true; closeSuggestions(); }}
              onCompositionEnd={event => {
                composingRef.current = false;
                refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, 'tag');
              }}
              className="min-h-10 min-w-28 flex-1 rounded-md bg-transparent px-2 py-1 font-mono text-xs text-gray-700 outline-none placeholder:text-gray-400 focus:bg-white/70 focus:ring-1 focus:ring-[var(--nai-accent)] dark:text-gray-200 dark:focus:bg-gray-900/60" />}
          </div>
          <div className="mt-1.5 flex min-h-7 flex-wrap items-center gap-1.5 border-t border-gray-200/70 pt-1.5 dark:border-gray-700/70">
            <button type="button" aria-label={t("撤销")} title={t("撤销")} disabled={!editable || !historyRef.current.past.length} onClick={() => moveHistory()} className="mobile-touch flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"><RotateCcw className="h-4 w-4" /></button>
            {deleteMode ? <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={() => { setDeleteMode(false); clearSelection(); }} className="mobile-touch rounded-md px-2 py-1 text-meta font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">{t("取消")}</button>
              <button type="button" disabled={!editable || !selectedTokens.length} onClick={deleteSelected} className="mobile-touch inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-meta font-bold text-white hover:bg-red-500 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />{t("删除 {0} 个 Tag", [selectedTokens.length])}</button>
            </div> : <>
            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <span className="text-meta text-gray-500 dark:text-gray-400">{t("权重类型")}</span>
              <div role="group" aria-label={t("权重类型")} className="flex items-stretch overflow-hidden rounded-md border border-gray-300 bg-gray-100 p-0.5 dark:border-gray-600 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => setWeightKind('brace')}
                aria-pressed={weightKind === 'brace'}
                className={`rounded px-2 py-0.5 text-meta font-bold transition-colors ${weightKind === 'brace' ? 'bg-white text-[var(--nai-accent)] shadow-sm dark:bg-gray-700' : 'text-gray-500 hover:text-[var(--nai-accent)] dark:text-gray-400'}`}
              >{t("括号")}</button>
              <button
                type="button"
                onClick={() => setWeightKind('numeric')}
                aria-pressed={weightKind === 'numeric'}
                className={`rounded px-2 py-0.5 text-meta font-bold transition-colors ${weightKind === 'numeric' ? 'bg-white text-[var(--nai-accent)] shadow-sm dark:bg-gray-700' : 'text-gray-500 hover:text-[var(--nai-accent)] dark:text-gray-400'}`}
              >{t("数值")}</button>
              </div>
              <button
                type="button"
                onClick={() => {
                  const parsed = Number(weightInput);
                  const numericWeight = weightInputEdited && weightInput.trim() && Number.isFinite(parsed) ? parsed
                    : hasSelectedWeight && !differentWeights && Number.isFinite(selectedWeightValue) ? selectedWeightValue : undefined;
                  applyWeightWrap(weightKind, weightKind === 'numeric' ? numericWeight : undefined);
                  setWeightInputEdited(false);
                }}
                disabled={!editable || !selectedTokens.length}
                className="rounded-md border border-[var(--nai-accent)] px-2 py-1 text-meta font-bold text-[var(--nai-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nai-accent)_10%,transparent)] disabled:pointer-events-none disabled:opacity-40"
                title={t("把选中的 Tag 按当前选择的类型添加/转换权重")}
              >{t("添加权重")}</button>
            </div>
            <div className={`flex shrink-0 items-stretch overflow-hidden whitespace-nowrap rounded-md border transition-colors [&>button]:shrink-0 ${selectedTokens.length ? 'border-[var(--nai-accent)]' : 'border-gray-300 opacity-40 dark:border-gray-600'}`}>
              <button
                type="button"
                onClick={event => applyWeight('down', undefined, event.shiftKey ? 0.01 : 0.1)}
                disabled={!editable || !selectedTokens.length}
                className="px-2 text-meta font-bold text-[var(--nai-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nai-accent)_10%,transparent)] disabled:pointer-events-none"
                title={t("减弱权重：括号减一层，数值减 0.1（Shift 为 0.01）")}
              >−</button>
              {weightKind === 'numeric' ? <input
                value={weightInput}
                onChange={event => { setWeightInput(event.target.value.replace(/[^\d.]/g, '')); setWeightInputEdited(true); }}
                onBlur={commitWeightInput}
                onKeyDown={event => { if (event.key === 'Enter') commitWeightInput(); }}
                disabled={!editable || !selectedTokens.length}
                inputMode="decimal"
                aria-label={t("数值权重")}
                placeholder={t(differentWeights ? "不同权重" : "权重")}
                title={t("输入数值权重后回车，作用于选中的整组")}
                className={`${differentWeights ? 'w-36' : 'w-20'} shrink-0 border-x border-gray-200 bg-transparent px-1 py-1 text-center font-mono text-meta text-gray-600 placeholder:text-gray-400 focus:outline-none dark:border-gray-700 dark:text-gray-300 dark:placeholder:text-gray-500`}
              /> : <output aria-label={t("权重倍率")} className="flex min-w-20 shrink-0 items-center justify-center border-x border-gray-200 px-2 py-1 font-mono text-meta text-gray-600 dark:border-gray-700 dark:text-gray-300">
                {differentWeights ? t("不同权重") : displayedWeight || '—'}
              </output>}
              <button
                type="button"
                onClick={event => applyWeight('up', undefined, event.shiftKey ? 0.01 : 0.1)}
                disabled={!editable || !selectedTokens.length}
                className="px-2 text-meta font-bold text-[var(--nai-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nai-accent)_10%,transparent)] disabled:pointer-events-none"
                title={t("增强权重：括号加一层，数值加 0.1（Shift 为 0.01）")}
              >+</button>
            </div>
            <button
              type="button"
              onClick={() => applyWeight('remove')}
              disabled={!editable || !selectedTokens.length}
              className="shrink-0 whitespace-nowrap rounded-md border border-[var(--nai-accent)] px-2 py-1 text-meta font-bold text-[var(--nai-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nai-accent)_10%,transparent)] disabled:pointer-events-none disabled:opacity-40"
            >{t("移除权重")}</button>
            {translationError && <InfoPopover label={t("翻译失败详情")} preserveSelection content={translationError} className="min-w-0 flex-1 truncate text-left text-micro text-red-500 underline decoration-dotted underline-offset-2">{translationError}</InfoPopover>}
            {allowAiTranslation && editable && missingTags.length > 0 && (
              <button
                type="button"
                onClick={() => void translateMissing()}
                disabled={translationLoading}
                className="inline-flex min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-meta font-medium text-[var(--nai-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--nai-accent)_10%,transparent)] disabled:opacity-60"
                title={t("使用当前助手模型翻译 {0} 个词库缺失项", [missingTags.length])}
              >
                {translationLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                {translationLoading ? t("翻译中") : t("翻译缺失项 {0}", [missingTags.length])}
              </button>
            )}
            <button type="button" aria-label={t("删除模式")} title={t("删除模式")} disabled={!editable || !promptTokens.length} onClick={() => { clearSelection(); setDeleteMode(true); }} className="mobile-touch ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"><Trash2 className="h-4 w-4" /></button>
            </>}
          </div>
        </div>
      )}

      {isOpen && createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          style={popupStyle}
          className={`appearance-panel touch-pan-y overflow-y-auto rounded-xl border border-gray-200 bg-white select-none shadow-2xl dark:border-gray-800 dark:bg-gray-900 ${dropUp ? 'mb-1' : 'mt-1'}`}
        >
          {isLoading && suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">{t("正在加载 Tag…")}</div>
          ) : suggestions.map((suggestion, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              key={`${suggestion.category}-${suggestion.name}`}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`w-full px-3 py-2 flex items-center gap-3 text-left text-sm border-b last:border-b-0 border-gray-100 dark:border-gray-800 ${index === activeIndex
                ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200'
              }`}
              onClick={() => selectSuggestion(suggestion)}
              onMouseDown={event => event.preventDefault()}
              onPointerMove={() => setActiveIndex(index)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono">{suggestion.name}</span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400 mt-0.5">{suggestion.chinese}</span>
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-micro ${suggestion.isNovelAI
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>{suggestion.categoryLabel}</span>
              <span className="w-14 shrink-0 text-right text-micro text-gray-400">{formatPostCount(suggestion.postCount)}</span>
            </button>
          ))}
        </div>
        ,
        document.body
      )}
    </div>
  );
};
