"use client";

import { useEffect } from "react";

/**
 * Locks `document.body` scrolling only while `isLocked` is true, restoring
 * every touched style exactly on unlock or unmount — never a permanent
 * change, no global CSS. `position: fixed` (not just `overflow: hidden`)
 * is required for this to actually hold on iOS Safari, which otherwise
 * still allows background rubber-band scrolling under a fixed overlay;
 * saving/restoring scrollY keeps the page from visibly jumping when the
 * fixed position is removed.
 *
 * Shared by every modal on the landing page (CalendlyModal, ContactModal)
 * so this exact behavior is implemented once, not duplicated per modal.
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) {
      return;
    }

    const scrollY = window.scrollY;
    const { style } = document.body;
    const previous = {
      position: style.position,
      top: style.top,
      width: style.width,
      overflow: style.overflow,
    };

    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.width = "100%";
    style.overflow = "hidden";

    return () => {
      style.position = previous.position;
      style.top = previous.top;
      style.width = previous.width;
      style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isLocked]);
}
