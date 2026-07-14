import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { normalizeTagQuery, preloadTagDictionary, searchTagDictionary, TagSuggestion } from '../services/tagDictionary';

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
}

const findCompletionTarget = (value: string, caret: number): CompletionTarget | null => {
  const beforeCaret = value.slice(0, caret);
  const delimiterIndex = Math.max(
    beforeCaret.lastIndexOf(','),
    beforeCaret.lastIndexOf('\n'),
    beforeCaret.lastIndexOf('|')
  );
  let replaceStart = delimiterIndex + 1;

  const lastScopeMarker = beforeCaret.lastIndexOf('::');
  if (lastScopeMarker >= replaceStart) replaceStart = lastScopeMarker + 2;

  while (replaceStart < caret && /[\s{\[]/.test(value[replaceStart])) replaceStart++;
  if (value.slice(replaceStart, replaceStart + 7).toLowerCase() === 'artist:') replaceStart += 7;

  let replaceEnd = caret;
  while (replaceEnd > replaceStart && /[}\]]/.test(value[replaceEnd - 1])) replaceEnd--;
  const closingLength = caret - replaceEnd;
  const query = normalizeTagQuery(value.slice(replaceStart, replaceEnd));

  if (!query || query.length > 100 || query.includes('::')) return null;
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
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [target, setTarget] = useState<CompletionTarget | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const listboxId = useId();

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
  }, []);

  const refreshSuggestions = useCallback(async (nextValue = value, caret = textareaRef.current?.selectionStart ?? 0) => {
    if (disabled || composingRef.current) return;
    const nextTarget = findCompletionTarget(nextValue, caret);
    setTarget(nextTarget);
    setActiveIndex(0);
    const requestId = ++requestIdRef.current;

    if (!nextTarget) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const results = await searchTagDictionary(nextTarget.query);
      if (requestId === requestIdRef.current) setSuggestions(results);
    } catch (error) {
      if (requestId === requestIdRef.current) setSuggestions([]);
      console.warn('Tag autocomplete search failed:', error);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [disabled, value]);

  const selectSuggestion = (suggestion: TagSuggestion) => {
    if (!target) return;
    const nextValue = value.slice(0, target.replaceStart)
      + suggestion.name
      + value.slice(target.replaceEnd);
    const nextCaret = target.replaceStart + suggestion.name.length + target.closingLength;
    onValueChange(nextValue);
    setSuggestions([]);
    setTarget(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const isOpen = Boolean(target && (suggestions.length > 0 || isLoading));

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

  return (
    <div className={`relative ${containerClassName}`}>
      <textarea
        {...textareaProps}
        ref={textareaRef}
        disabled={disabled}
        value={value}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && suggestions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        onChange={(event) => {
          onValueChange(event.target.value);
          void refreshSuggestions(event.target.value, event.target.selectionStart);
        }}
        onFocus={(event) => {
          if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
          preloadTagDictionary();
          void refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
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
          void refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          onClick?.(event);
        }}
        onKeyUp={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
            void refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          }
          onKeyUp?.(event);
        }}
        onKeyDown={(event) => {
          if (isOpen && suggestions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex(index => (index + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => (index - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
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
          setSuggestions([]);
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          void refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
          onCompositionEnd?.(event);
        }}
      />

      {isOpen && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-[150] mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
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
              onPointerDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
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
      )}
    </div>
  );
};
