const storageKey = 'kuviewer_admin_token';

export function getStoredAdminToken() {
  return window.localStorage.getItem(storageKey) || '';
}

export function storeAdminToken(token: string) {
  window.localStorage.setItem(storageKey, token.trim());
}

export function clearAdminToken() {
  window.localStorage.removeItem(storageKey);
}

export function isValidAdminToken(token: string) {
  return token.trim().length > 0;
}
