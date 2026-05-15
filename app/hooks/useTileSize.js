'use client';

import { useState, useRef, useEffect } from 'react';

export function useTileSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

export function fitItems(availableHeight, itemHeight, reservedHeight = 0) {
  const usable = availableHeight - reservedHeight;
  return Math.max(1, Math.floor(usable / itemHeight));
}
