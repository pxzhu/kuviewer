const storageKey = 'kuviewer_admin_token';

export function getStoredAdminToken() {
  window.localStorage.removeItem(storageKey);
  return window.sessionStorage.getItem(storageKey) || '';
}

export function storeAdminToken(token: string) {
  window.localStorage.removeItem(storageKey);
  window.sessionStorage.setItem(storageKey, token.trim());
}

export function clearAdminToken() {
  window.sessionStorage.removeItem(storageKey);
  window.localStorage.removeItem(storageKey);
}

export function isValidAdminToken(token: string) {
  return token.trim().length > 0;
}
