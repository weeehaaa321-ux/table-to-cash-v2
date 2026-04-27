"use client";

import { useEffect } from "react";

// Disable the browser's automatic scroll restoration across refreshes.
// The default Chrome/Firefox behavior preserves scroll position on F5,
// which lands staff on mid-page views after a refresh. This is a POS
// app — every refresh should start at the top of the current page.
//
// Kept on <body> so it runs once at app boot regardless of route.
export function ScrollRestore() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, []);
  return null;
}
