'use client';

import { useState, useRef, useEffect } from 'react';

export function useTileSize() {
  const ref = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

export function fitItems(availableHeight: number, itemHeight: number, reservedHeight = 0): number {
  const usable = availableHeight - reservedHeight;
  return Math.max(1, Math.floor(usable / itemHeight));
}
