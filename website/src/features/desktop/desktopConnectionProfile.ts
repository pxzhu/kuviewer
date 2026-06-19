export interface DesktopConnectionProfile {
  serverUrl: string;
  updatedAt: number;
}

const desktopConnectionProfileStorageKey = 'kuviewer_desktop_connection_profile';
const desktopConnectionProfileChangedEvent = 'kuviewer-desktop-connection-profile-changed';
const maxServerUrlLength = 220;

type DesktopWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function isDesktopRuntime() {
  if (typeof window === 'undefined') {
    return false;
  }

  const desktopWindow = window as DesktopWindow;
  return Boolean(desktopWindow.__TAURI__ || desktopWindow.__TAURI_INTERNALS__) || window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost';
}

export function getDesktopConnectionProfile(): DesktopConnectionProfile | null {
  if (!isDesktopRuntime()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(desktopConnectionProfileStorageKey);
    if (!rawValue) {
      return null;
    }
    const parsedValue = JSON.parse(rawValue) as Partial<DesktopConnectionProfile>;
    if (typeof parsedValue.serverUrl !== 'string' || typeof parsedValue.updatedAt !== 'number') {
      clearDesktopConnectionProfile();
      return null;
    }
    const normalizedServerUrl = normalizeDesktopServerUrl(parsedValue.serverUrl);
    return {
      serverUrl: normalizedServerUrl,
      updatedAt: parsedValue.updatedAt,
    };
  } catch {
    clearDesktopConnectionProfile();
    return null;
  }
}

export function storeDesktopConnectionProfile(serverUrl: string): DesktopConnectionProfile {
  const profile = {
    serverUrl: normalizeDesktopServerUrl(serverUrl),
    updatedAt: Date.now(),
  };
  window.localStorage.setItem(desktopConnectionProfileStorageKey, JSON.stringify(profile));
  dispatchDesktopConnectionProfileChanged();
  return profile;
}

export function clearDesktopConnectionProfile() {
  window.localStorage.removeItem(desktopConnectionProfileStorageKey);
  dispatchDesktopConnectionProfileChanged();
}

export function subscribeDesktopConnectionProfile(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === desktopConnectionProfileStorageKey) {
      listener();
    }
  };
  const handleLocalChange = () => listener();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(desktopConnectionProfileChangedEvent, handleLocalChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(desktopConnectionProfileChangedEvent, handleLocalChange);
  };
}

export function normalizeDesktopServerUrl(value: string) {
  const input = value.trim();
  if (!input) {
    throw new Error('desktop_server_url_required');
  }
  if (input.length > maxServerUrlLength) {
    throw new Error('desktop_server_url_too_long');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new Error('desktop_server_url_invalid');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('desktop_server_url_protocol');
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error('desktop_server_url_insecure_http');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('desktop_server_url_credentials');
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error('desktop_server_url_query');
  }

  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
  return `${parsedUrl.origin}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`;
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1' || normalizedHostname === '[::1]' || normalizedHostname.endsWith('.localhost');
}

function dispatchDesktopConnectionProfileChanged() {
  window.dispatchEvent(new Event(desktopConnectionProfileChangedEvent));
}
