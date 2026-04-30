// Runtime detection: Wails injects `window.runtime` when the bundle is
// loaded inside the desktop window. The web build never sets it.
//
// Desktop is single-window (no browser tabs), so callers should switch
// "open detail in a new tab" to in-place SPA navigation.

interface WailsWindow {
  runtime?: unknown;
  go?: unknown;
}

export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as WailsWindow;
  return typeof w.runtime !== "undefined" || typeof w.go !== "undefined";
}
