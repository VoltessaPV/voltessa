"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Real-time width of the chart's own rendered container — not the browser
 * viewport. A multi-column desktop layout can put a chart in a much
 * narrower column than the window itself, so viewport width alone would be
 * the wrong signal for "should X-axis tick density drop" (Responsive
 * Design Sprint). Backed by `ResizeObserver` so it stays correct as the
 * card reflows across every breakpoint, not just at initial mount.
 */
export function useChartWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
