// Global window augmentations used by the headless screenshot route.
// The Bun.WebView screenshotter polls this flag to know the chart has painted.

declare global {
  interface Window {
    __chartReady?: boolean;
  }
}

export {};
