import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Languages, LoaderCircle } from 'lucide-react';
import { normalizeTagQuery, preloadTagDictionary, searchTagDictionary, TagSuggestion } from '../services/tagDictionary';
import {
  parsePromptTags,
  PromptTagTranslation,
  resolvePromptTranslations,
  subscribeTagTranslations,
  translateMissingPromptTags,
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
  return new Intl.NumberFormat('zh-CN', { notation: count >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(count);
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
  onFocus,
  onBlur,
  onKeyDown,
  onClick,
  onKeyUp,
  onCompositionStart,
  onCompositionEnd,
  ...textareaProps
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestIdRef = useRef(0);
  const composingRef = useRef(false);
  const blurTimerRef = useRef<number | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [target, setTarget] = useState<CompletionTarget | null>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const [isLoading, setIsLoading] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [translations, setTranslations] = useState<PromptTagTranslation[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [translationRevision, setTranslationRevision] = useState(0);
  const listboxId = useId();
  const promptTokens = useMemo(() => tagAssistEnabled ? parsePromptTags(value) : [], [tagAssistEnabled, value]);

  useEffect(() => subscribeTagTranslations(() => setTranslationRevision(revision => revision + 1)), []);

  useEffect(() => {
    if (!tagAssistEnabled || !showTranslations || promptTokens.length === 0) {
      setTranslations([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void resolvePromptTranslations(promptTokens).then(items => {
        if (active) setTranslations(items);
      }).catch(error => {
        if (active) console.warn('Prompt translation lookup failed:', error);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [promptTokens, showTranslations, tagAssistEnabled, translationRevision]);

  const missingTags = useMemo(() => [...new Set(translations
    .filter(item => item.source === 'missing')
    .map(item => item.lookupTag))], [translations]);

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

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    requestIdRef.current++;
  }, []);

  useEffect(() => {
    if (tagAssistEnabled) return;
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    requestIdRef.current++;
    setSuggestions([]);
    setTarget(null);
    setActiveIndex(-1);
    setIsLoading(false);
    setTranslations([]);
    setTranslationError('');
  }, [tagAssistEnabled]);

  const refreshSuggestions = useCallback((nextValue = value, caret = textareaRef.current?.selectionStart ?? 0) => {
    if (!tagAssistEnabled || disabled || composingRef.current) return;
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
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
  }, [disabled, tagAssistEnabled, value]);

  const selectSuggestion = (suggestion: TagSuggestion) => {
    if (!target) return;
    const nextValue = value.slice(0, target.replaceStart)
      + suggestion.name
      + value.slice(target.replaceEnd);
    const nextCaret = target.replaceStart + suggestion.name.length + target.closingLength;
    onValueChange(nextValue);
    setSuggestions([]);
    setTarget(null);
    setActiveIndex(-1);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const isOpen = tagAssistEnabled && Boolean(target && (suggestions.length > 0 || isLoading));

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
      const rect = textareaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const below = viewportHeight - rect.bottom;
      const showUp = below < 240 && rect.top > below;
      setDropUp(showUp);
      const width = Math.min(560, Math.max(280, rect.width));
      // 弹窗以固定定位渲染到 body 顶层，随 textarea 位置绝对对齐，宽度与输入框一致
      setPopupStyle({
        position: 'fixed',
        left: Math.max(8, rect.left),
        top: showUp ? undefined : rect.bottom + 4,
        bottom: showUp ? viewportHeight - rect.top + 4 : undefined,
        width,
        maxHeight: 'min(18rem, 42dvh)',
        zIndex: 9999,
      });
    };
    updatePosition();
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.addEventListener('resize', updatePosition);
    // 捕获阶段监听滚动：容器滚动时弹窗跟随输入框移动，不被裁切
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  return (
    <div className={`relative ${containerClassName}`}>
      <textarea
        {...textareaProps}
        ref={textareaRef}
        disabled={disabled}
        value={value}
        className={className}
        role={tagAssistEnabled ? 'combobox' : undefined}
        aria-autocomplete={tagAssistEnabled ? 'list' : undefined}
        aria-expanded={tagAssistEnabled ? isOpen : undefined}
        aria-controls={tagAssistEnabled && isOpen ? listboxId : undefined}
        aria-activedescendant={tagAssistEnabled && isOpen && suggestions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        onChange={(event) => {
          onValueChange(event.target.value);
          if (tagAssistEnabled) refreshSuggestions(event.target.value, event.target.selectionStart);
        }}
        onFocus={(event) => {
          if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
          if (tagAssistEnabled) {
            preloadTagDictionary();
            refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          }
          onFocus?.(event);
        }}
        onBlur={(event) => {
          blurTimerRef.current = window.setTimeout(() => {
            setSuggestions([]);
            setTarget(null);
          }, 120);
          onBlur?.(event);
        }}
        onClick={(event) => {
          if (tagAssistEnabled) refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          onClick?.(event);
        }}
        onKeyUp={onKeyUp}
        onKeyDown={(event) => {
          if (composingRef.current || event.nativeEvent.isComposing) {
            onKeyDown?.(event);
            return;
          }
          if (isOpen && suggestions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex(index => index < 0 ? 0 : (index + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => index < 0 ? suggestions.length - 1 : (index - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
              return;
            }
          }
          if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            setSuggestions([]);
            setTarget(null);
            return;
          }
          onKeyDown?.(event);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
            searchTimerRef.current = null;
          }
          requestIdRef.current++;
          setSuggestions([]);
          setTarget(null);
          setActiveIndex(-1);
          setIsLoading(false);
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          if (tagAssistEnabled) refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          onCompositionEnd?.(event);
        }}
      />

      {tagAssistEnabled && showTranslations && translations.length > 0 && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-900/55" aria-label="提示词中文翻译">
          <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-0.5">
            {translations.map(item => (
              <span
                key={item.id}
                className={`inline-flex max-w-full flex-col rounded-md border px-2 py-1 leading-tight ${item.source === 'dictionary'
                  ? 'border-purple-200/80 bg-purple-50/70 dark:border-purple-800/70 dark:bg-purple-950/25'
                  : item.source === 'ai'
                    ? 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-800/70 dark:bg-emerald-950/25'
                    : 'border-dashed border-gray-300 bg-white/60 dark:border-gray-700 dark:bg-gray-900/50'
                }`}
              >
                <span className="max-w-48 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400" title={item.displayTag}>{item.displayTag}</span>
                <span className={`max-w-48 truncate text-xs font-medium ${item.source === 'dictionary'
                  ? 'text-purple-600 dark:text-purple-300'
                  : item.source === 'ai'
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : 'text-gray-400 dark:text-gray-500'
                }`} title={item.chinese || '词库暂无翻译'}>{item.chinese || '待翻译'}</span>
              </span>
            ))}
          </div>
          {(missingTags.length > 0 || translationError) && (
            <div className="mt-1.5 flex min-h-7 items-center justify-end gap-2 border-t border-gray-200/70 pt-1.5 dark:border-gray-700/70">
              {translationError && <span className="min-w-0 flex-1 truncate text-[10px] text-red-500" title={translationError}>{translationError}</span>}
              {allowAiTranslation && !disabled && missingTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => void translateMissing()}
                  disabled={translationLoading}
                  className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                  title={`使用当前 Agent 模型翻译 ${missingTags.length} 个词库缺失项`}
                >
                  {translationLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                  {translationLoading ? '翻译中' : `翻译缺失项 ${missingTags.length}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {isOpen && createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          style={popupStyle}
          className={`touch-pan-y overflow-y-auto rounded-xl border border-gray-200 bg-white select-none shadow-2xl dark:border-gray-800 dark:bg-gray-900 ${dropUp ? 'mb-1' : 'mt-1'}`}
        >
          {isLoading && suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">正在加载 Tag…</div>
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
              onPointerMove={() => setActiveIndex(index)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono">{suggestion.name}</span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400 mt-0.5">{suggestion.chinese}</span>
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${suggestion.isNovelAI
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>{suggestion.categoryLabel}</span>
              <span className="w-14 shrink-0 text-right text-[10px] text-gray-400">{formatPostCount(suggestion.postCount)}</span>
            </button>
          ))}
        </div>
        ,
        document.body
      )}
    </div>
  );
};
