'use client';

import { useEffect, useCallback, useState } from 'react';

export function useNearViewport<T extends HTMLElement>(margin = '400px') {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((element: T | null) => setNode(element), []);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: margin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin, node]);
  return { ref, near };
}
