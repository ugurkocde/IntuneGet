'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, TrendingUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/use-debounce';

const TRENDING_SEARCHES = [
  'Google Chrome',
  'Visual Studio Code',
  '7-Zip',
  'Firefox',
  'Notepad++',
  'VLC',
  'Git',
  'Node.js',
];

interface AppSearchProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
}

export function AppSearch({ value, onChange, isLoading = false }: AppSearchProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedValue = useDebounce(inputValue, 300);

  // Sync debounced value with parent
  useEffect(() => {
    onChange(debouncedValue);
  }, [debouncedValue, onChange]);

  // Sync external value changes
  useEffect(() => {
    if (value !== inputValue && value === '') {
      setInputValue('');
    }
  }, [value]);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clearSearch = () => {
    setInputValue('');
    onChange('');
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    onChange(suggestion);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (!inputValue) {
      setShowSuggestions(true);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Delay hiding to allow click events on suggestions
    setTimeout(() => setShowSuggestions(false), 150);
  };

  return (
    <div className="relative">
      <div
        className={`relative rounded-xl border transition-all duration-200 ${
          isFocused
            ? 'border-accent-cyan/40 bg-bg-elevated shadow-soft-md'
            : 'border-overlay/10 bg-bg-elevated/95 hover:border-black/20'
        }`}
      >
        <Search
          className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-200 ${
            isFocused ? 'text-accent-cyan' : 'text-text-muted'
          }`}
        />

        <Input
          ref={inputRef}
          type="text"
          placeholder="Search Winget applications..."
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (e.target.value) {
              setShowSuggestions(false);
            } else {
              setShowSuggestions(true);
            }
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="h-12 md:h-14 pl-12 pr-12 bg-transparent border-0 text-text-primary placeholder:text-text-muted focus-visible:ring-0 focus-visible:outline-none text-base md:text-lg rounded-xl"
        />

        {!isFocused && !inputValue && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-1 pointer-events-none">
            <kbd className="px-1.5 py-0.5 text-[10px] text-text-secondary bg-bg-surface border border-overlay/10 rounded font-mono">
              {typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}
            </kbd>
            <kbd className="px-1.5 py-0.5 text-[10px] text-text-secondary bg-bg-surface border border-overlay/10 rounded font-mono">
              K
            </kbd>
          </div>
        )}

        {isLoading && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2">
            <Loader2 className="w-5 h-5 text-accent-cyan animate-spin" />
          </div>
        )}

        {inputValue && !isLoading && (
          <Button
            variant="ghost"
            size="icon"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary hover:bg-overlay/5"
          >
            <X className="w-5 h-5" />
          </Button>
        )}
      </div>

      {showSuggestions && !inputValue && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl border border-overlay/10 bg-bg-elevated shadow-soft-lg p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-accent-cyan" />
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-[0.08em]">Popular searches</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TRENDING_SEARCHES.map((suggestion) => (
              <button
                key={suggestion}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSuggestionClick(suggestion)}
                className="px-3 py-1.5 text-sm text-text-secondary bg-bg-surface hover:bg-overlay/5 hover:text-text-primary rounded-lg border border-overlay/10 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {inputValue.length > 0 && inputValue.length < 2 && (
        <p className="text-text-muted text-xs mt-2 animate-fade-in">
          Type at least <span className="text-accent-cyan">2</span> characters to search
        </p>
      )}
    </div>
  );
}
