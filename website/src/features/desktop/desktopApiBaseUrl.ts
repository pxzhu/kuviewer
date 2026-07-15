import { isDesktopRuntime } from './desktopRuntime';

const desktopConnectionProfileStorageKey = 'kuviewer_desktop_connection_profile';
const desktopCmRuntimeProfileStorageKey = 'kuviewer_desktop_cm_runtime_profile';
const maxServerUrlLength = 220;

export function getDesktopApiBaseUrl() {
  if (!isDesktopRuntime()) {
    return '';
  }
  return readStoredServerUrl(window.sessionStorage, desktopCmRuntimeProfileStorageKey)
    || readStoredServerUrl(window.localStorage, desktopConnectionProfileStorageKey);
}

function readStoredServerUrl(storage: Storage, key: string) {
  try {
    const rawValue = storage.getItem(key);
    if (!rawValue) {
      return '';
    }
    const value = JSON.parse(rawValue) as Record<string, unknown>;
    return typeof value.serverUrl === 'string' ? safeDesktopServerUrl(value.serverUrl) : '';
  } catch {
    return '';
  }
}

function safeDesktopServerUrl(value: string) {
  const input = value.trim();
  if (!input || input.length > maxServerUrlLength) {
    return '';
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    return '';
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return '';
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    return '';
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    return '';
  }
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
  return `${parsedUrl.origin}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`;
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === 'localhost'
    || normalizedHostname === '127.0.0.1'
    || normalizedHostname === '::1'
    || normalizedHostname === '[::1]'
    || normalizedHostname.endsWith('.localhost');
}
