type DesktopWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function isDesktopRuntime() {
  if (typeof window === 'undefined') {
    return false;
  }

  const desktopWindow = window as DesktopWindow;
  return Boolean(desktopWindow.__TAURI__ || desktopWindow.__TAURI_INTERNALS__)
    || window.location.protocol === 'tauri:'
    || window.location.hostname === 'tauri.localhost';
}
