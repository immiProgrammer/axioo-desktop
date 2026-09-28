// Must stay in sync with TOP_TITLEBAR_HEIGHT_WIN in custom-electron-titlebar:
// the library re-applies setTitleBarOverlay() with that height on every focus
// and theme change, so anything else fights it and desyncs the caption buttons.
export const CAPTION_HEIGHT = 30;

// The tab strip shares the caption row: it starts after the toolbar buttons and
// stops before the native window controls, so tabs never push the site down.
export const TAB_STRIP_HEIGHT = CAPTION_HEIGHT;

export const CONTENT_TOP = CAPTION_HEIGHT;
