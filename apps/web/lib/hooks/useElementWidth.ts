"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Real-time width of the element it's attached to, via `ResizeObserver` —
 * not the browser viewport, which is the wrong signal whenever the element
 * itself sits in a narrower column than the window (a multi-column desktop
 * layout, or a fixed-max-width mockup frame). Shared by `ChartFrame`
 * (thinning X-axis tick density to what the chart's real rendered width
 * can fit) and `PlatformPreview` (scaling its fixed-size canvas mockup to
 * its real container width) — one measuring primitive, not two
 * independent copies, per the Responsive Design Sprint's "extract
 * reusable primitives" requirement.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
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
