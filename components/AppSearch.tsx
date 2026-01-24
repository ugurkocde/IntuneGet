'use client';

import { useState, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/use-debounce';

interface AppSearchProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
}

export function AppSearch({ value, onChange, isLoading = false }: AppSearchProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
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

  const clearSearch = () => {
    setInputValue('');
    onChange('');
  };

  return (
    <div className="relative group">
      {/* Glass background with glow on focus */}
      <div
        className={`relative rounded-xl transition-all duration-300 ${
          isFocused
            ? 'shadow-glow-cyan ring-1 ring-accent-cyan/30'
            : 'ring-1 ring-white/5 hover:ring-white/10'
        }`}
      >
        {/* Search icon with animation */}
        <Search
          className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-200 ${
            isFocused ? 'text-accent-cyan' : 'text-zinc-500'
          }`}
        />

        <Input
          type="text"
          placeholder="Search 10,000+ Winget packages..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="pl-12 pr-12 py-6 bg-bg-surface/80 backdrop-blur-sm border-0 text-white placeholder:text-zinc-500 focus:ring-0 focus:outline-none text-lg rounded-xl"
        />

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
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </Button>
        )}
      </div>

      {/* Character count hint */}
      {inputValue.length > 0 && inputValue.length < 2 && (
        <p className="text-zinc-500 text-sm mt-2 animate-fade-in">
          Type at least <span className="text-accent-cyan">2</span> characters to search
        </p>
      )}
    </div>
  );
}
