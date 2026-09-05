'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';

interface VirtualAppListProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  grid: boolean;
  onVisibleItemsChange?: (items: T[]) => void;
}

// Virtualize rows, not cells, so cards keep their responsive grid sizing. Keep
// the focused row and adjacent rows mounted for continuous keyboard navigation.
export function VirtualAppList<T>({ items, itemKey, renderItem, grid, onVisibleItemsChange }: VirtualAppListProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const count = Math.ceil(items.length / columns);
  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => grid ? 260 : 112,
    overscan: 3,
    initialRect: { width: 0, height: 800 },
    scrollMargin,
    getItemKey: index => itemKey(items[index * columns]),
    rangeExtractor: range => {
      const indexes = defaultRangeExtractor(range);
      if (focusedRow !== null && focusedRow < count) {
        for (let i = Math.max(0, focusedRow - 1); i <= Math.min(count - 1, focusedRow + 1); i++) indexes.push(i);
      }
      return [...new Set(indexes)].sort((a, b) => a - b);
    },
  });
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      setColumns(grid ? window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1 : 1);
      setScrollMargin(node.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(document.body);
    // Changes above the grid (filters, banners) also change its scroll offset.
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [grid]);
  useEffect(() => { virtualizer.measure(); }, [columns, grid, virtualizer]);

  const rows = virtualizer.getVirtualItems();
  const visibleKey = rows.map(row => row.index).join(',');
  useEffect(() => {
    if (!onVisibleItemsChange) return;
    const indexes = visibleKey ? visibleKey.split(',').map(Number) : [];
    onVisibleItemsChange(indexes.flatMap(index => items.slice(index * columns, (index + 1) * columns)));
  }, [visibleKey, columns, items, onVisibleItemsChange]);

  return (
    <div ref={container} style={{ height: virtualizer.getTotalSize(), position: 'relative', overflowAnchor: 'none' }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedRow(null); }}>
      {rows.map(row => (
        <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
          onFocusCapture={() => setFocusedRow(row.index)}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start - scrollMargin}px)`, paddingBottom: grid ? 16 : 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 16 }}>
            {items.slice(row.index * columns, (row.index + 1) * columns).map(item => <div key={itemKey(item)}>{renderItem(item)}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}
