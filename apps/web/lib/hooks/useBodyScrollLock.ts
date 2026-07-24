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
 * `globals.css` sets `scroll-behavior: smooth` on `<html>` (for the Navbar's
 * anchor links). While locked, `<body>` leaving normal flow makes the
 * browser re-clamp `<html>`'s scrollTop to the new (smaller) scrollable
 * range — and with smooth scrolling active, that re-clamp animates instead
 * of applying instantly, visibly sliding the page down. The restore below
 * would be smooth-animated too, and can lose a race with any other scroll
 * adjustment that happens to land at the same time (e.g. focus returning to
 * the trigger element), settling at the wrong position instead of the exact
 * one being restored. Neutralizing `scroll-behavior` for the lock's
 * lifetime keeps every scroll adjustment — the browser's and ours — instant.
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
    const html = document.documentElement;
    const previous = {
      position: style.position,
      top: style.top,
      width: style.width,
      overflow: style.overflow,
    };
    const previousScrollBehavior = html.style.scrollBehavior;

    html.style.scrollBehavior = "auto";
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
      html.style.scrollBehavior = previousScrollBehavior;
    };
  }, [isLocked]);
}
