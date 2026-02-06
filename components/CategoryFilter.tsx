'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Tag, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Category {
  category: string;
  count: number;
}

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
  isLoading?: boolean;
}

// Display names for categories (maps internal names to friendly names)
const categoryDisplayNames: Record<string, string> = {
  browser: 'Browsers',
  development: 'Development',
  productivity: 'Productivity',
  utilities: 'Utilities',
  communication: 'Communication',
  media: 'Media',
  gaming: 'Gaming',
  security: 'Security',
  runtime: 'Runtimes',
  other: 'Other',
};

export function CategoryFilter({
  categories,
  selectedCategory,
  onSelectCategory,
  isLoading,
}: CategoryFilterProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const container = scrollRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 1
      );
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [categories]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
      // Check scroll after animation
      setTimeout(checkScroll, 300);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="w-4 h-4 text-text-muted animate-spin" />
        <span className="text-text-muted text-sm">Loading categories...</span>
      </div>
    );
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="sticky top-0 z-20 bg-bg-base/95 backdrop-blur-md py-3 -mx-1 px-1">
      <div className="relative group">
        {/* Left scroll button */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-bg-surface/90 backdrop-blur-sm border border-black/10 rounded-full shadow-lg hover:bg-bg-elevated transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-text-secondary" />
          </button>
        )}

        {/* Category pills container */}
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1 px-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {/* All categories pill */}
          <CategoryPill
            label="All"
            count={categories.reduce((sum, c) => sum + c.count, 0)}
            isSelected={selectedCategory === null}
            onClick={() => onSelectCategory(null)}
          />

          {/* Category pills */}
          {categories.map((cat) => (
            <CategoryPill
              key={cat.category}
              label={categoryDisplayNames[cat.category] || cat.category}
              count={cat.count}
              isSelected={selectedCategory === cat.category}
              onClick={() => onSelectCategory(cat.category)}
            />
          ))}
        </div>

        {/* Right scroll button */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-bg-surface/90 backdrop-blur-sm border border-black/10 rounded-full shadow-lg hover:bg-bg-elevated transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-text-secondary" />
          </button>
        )}
      </div>
    </div>
  );
}

interface CategoryPillProps {
  label: string;
  count: number;
  isSelected: boolean;
  onClick: () => void;
}

function CategoryPill({ label, count, isSelected, onClick }: CategoryPillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0',
        isSelected
          ? 'bg-gradient-to-r from-accent-cyan to-accent-violet text-text-primary shadow-glow-cyan'
          : 'bg-bg-elevated border border-black/5 text-text-secondary hover:text-text-primary hover:border-black/10'
      )}
    >
      {label === 'All' && <Tag className="w-3 h-3" />}
      <span>{label}</span>
      <span
        className={cn(
          'text-xs px-1.5 py-0.5 rounded-full',
          isSelected ? 'bg-black/20 text-text-primary' : 'bg-black/5 text-text-muted'
        )}
      >
        {count}
      </span>
    </button>
  );
}

// Small badge component for showing category on cards
interface CategoryBadgeProps {
  category: string;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const displayName = categoryDisplayNames[category] || category;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-cyan/10 text-accent-cyan',
        className
      )}
    >
      {displayName}
    </span>
  );
}
