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
    <div className="relative group">
      {/* Glass background with glow on focus */}
      <div
        className={`relative rounded-xl transition-all duration-300 ${
          isFocused
            ? 'shadow-glow-cyan ring-1 ring-accent-cyan/30'
            : 'ring-1 ring-black/5 hover:ring-black/10'
        }`}
      >
        {/* Search icon with animation */}
        <Search
          className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-200 ${
            isFocused ? 'text-accent-cyan' : 'text-text-muted'
          }`}
        />

        <Input
          ref={inputRef}
          type="text"
          placeholder="Search curated Winget packages..."
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
          className="pl-12 pr-12 py-6 bg-bg-surface/80 backdrop-blur-sm border-0 text-text-primary placeholder:text-text-muted focus:ring-0 focus:outline-none text-lg rounded-xl"
        />

        {/* Keyboard shortcut hint */}
        {!isFocused && !inputValue && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-1 pointer-events-none">
            <kbd className="px-1.5 py-0.5 text-xs text-text-muted bg-bg-elevated border border-black/10 rounded font-mono">
              {typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}
            </kbd>
            <kbd className="px-1.5 py-0.5 text-xs text-text-muted bg-bg-elevated border border-black/10 rounded font-mono">
              K
            </kbd>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2">
            <Loader2 className="w-5 h-5 text-accent-cyan animate-spin" />
          </div>
        )}

        {/* Clear button */}
        {inputValue && !isLoading && (
          <Button
            variant="ghost"
            size="icon"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary hover:bg-black/10"
          >
            <X className="w-5 h-5" />
          </Button>
        )}
      </div>

      {/* Search suggestions dropdown */}
      {showSuggestions && !inputValue && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 glass-light rounded-xl border border-black/5 shadow-lg p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Popular searches</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TRENDING_SEARCHES.map((suggestion) => (
              <button
                key={suggestion}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSuggestionClick(suggestion)}
                className="px-3 py-1.5 text-sm text-text-secondary bg-bg-elevated hover:bg-black/10 hover:text-text-primary rounded-lg border border-black/5 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Character count hint */}
      {inputValue.length > 0 && inputValue.length < 2 && (
        <p className="text-text-muted text-sm mt-2 animate-fade-in">
          Type at least <span className="text-accent-cyan">2</span> characters to search
        </p>
      )}
    </div>
  );
}
