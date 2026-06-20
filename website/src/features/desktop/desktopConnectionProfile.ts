export interface DesktopConnectionProfile {
  serverUrl: string;
  updatedAt: number;
}

export interface DesktopSidecarProfile {
  serverUrl: string;
  adminToken: string;
  source: string;
  kubernetesProfileId?: string;
}

export interface DesktopSidecarStatus {
  serverUrl: string;
  source: string;
  kubernetesProfileId?: string;
}

export interface DesktopKubernetesProfile {
  id: string;
  displayName: string;
  apiServer: string;
  authType: string;
  credentialStore: string;
  credentialAvailable: boolean;
  selected: boolean;
  status: string;
}

export interface DesktopCmSession {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authType: string;
  status: string;
  updatedAt: number;
  selected: boolean;
  description?: string;
}

export interface DesktopCmSessionInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  user: string;
  description?: string;
}

const desktopConnectionProfileStorageKey = 'kuviewer_desktop_connection_profile';
const desktopConnectionProfileChangedEvent = 'kuviewer-desktop-connection-profile-changed';
const maxServerUrlLength = 220;
const maxCmSessionNameLength = 60;
const maxCmSessionHostLength = 180;
const maxCmSessionUserLength = 80;
const maxCmSessionDescriptionLength = 160;

type TauriInvoke = <Response>(command: string, args?: Record<string, unknown>) => Promise<Response>;

type DesktopWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvoke;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvoke;
  };
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

export async function getDesktopSidecarProfile(): Promise<DesktopSidecarProfile | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const profile = await invoke<Partial<DesktopSidecarProfile> | null>('desktop_sidecar_profile');
  if (!profile || typeof profile.serverUrl !== 'string' || typeof profile.adminToken !== 'string' || typeof profile.source !== 'string') {
    return null;
  }

  const adminToken = profile.adminToken.trim();
  if (!adminToken) {
    return null;
  }

  return {
    serverUrl: normalizeDesktopServerUrl(profile.serverUrl),
    adminToken,
    source: profile.source.trim() || 'unknown',
    kubernetesProfileId:
      typeof profile.kubernetesProfileId === 'string' && profile.kubernetesProfileId.trim() ? profile.kubernetesProfileId.trim() : undefined,
  };
}

export async function getDesktopKubernetesProfiles(): Promise<DesktopKubernetesProfile[]> {
  if (!isDesktopRuntime()) {
    return [];
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return [];
  }

  const profiles = await invoke<unknown[]>('desktop_kubernetes_profiles');
  if (!Array.isArray(profiles)) {
    return [];
  }
  return profiles.map(parseDesktopKubernetesProfile).filter((profile): profile is DesktopKubernetesProfile => Boolean(profile));
}

export async function selectDesktopKubernetesProfile(profileId: string): Promise<DesktopKubernetesProfile | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const profile = await invoke<unknown>('desktop_select_kubernetes_profile', { profileId });
  return parseDesktopKubernetesProfile(profile);
}

export async function deleteDesktopKubernetesProfileCredential(profileId: string): Promise<DesktopKubernetesProfile | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const profile = await invoke<unknown>('desktop_delete_kubernetes_profile_credential', { profileId });
  return parseDesktopKubernetesProfile(profile);
}

export async function getDesktopCmSessions(): Promise<DesktopCmSession[]> {
  if (!isDesktopRuntime()) {
    return [];
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return [];
  }

  const sessions = await invoke<unknown[]>('desktop_cm_sessions');
  if (!Array.isArray(sessions)) {
    return [];
  }
  return sessions.map(parseDesktopCmSession).filter((session): session is DesktopCmSession => Boolean(session));
}

export async function saveDesktopCmSession(input: DesktopCmSessionInput): Promise<DesktopCmSession | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const session = await invoke<unknown>('desktop_save_cm_session', {
    session: normalizeDesktopCmSessionInput(input),
  });
  return parseDesktopCmSession(session);
}

export async function selectDesktopCmSession(sessionId: string): Promise<DesktopCmSession | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const session = await invoke<unknown>('desktop_select_cm_session', { sessionId: normalizeDesktopCmSessionId(sessionId) });
  return parseDesktopCmSession(session);
}

export async function deleteDesktopCmSession(sessionId: string): Promise<DesktopCmSession[]> {
  if (!isDesktopRuntime()) {
    return [];
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return [];
  }

  const sessions = await invoke<unknown[]>('desktop_delete_cm_session', { sessionId: normalizeDesktopCmSessionId(sessionId) });
  if (!Array.isArray(sessions)) {
    return [];
  }
  return sessions.map(parseDesktopCmSession).filter((session): session is DesktopCmSession => Boolean(session));
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

export function normalizeDesktopCmSessionInput(input: DesktopCmSessionInput): DesktopCmSessionInput {
  const name = normalizeBoundedText(input.name, maxCmSessionNameLength, 'desktop_cm_session_name');
  const host = normalizeDesktopCmSessionHost(input.host);
  const user = normalizeDesktopCmSessionUser(input.user);
  const port = normalizeDesktopCmSessionPort(input.port);
  const id = input.id?.trim() ? normalizeDesktopCmSessionId(input.id) : undefined;
  const description = input.description?.trim()
    ? normalizeBoundedText(input.description, maxCmSessionDescriptionLength, 'desktop_cm_session_description')
    : undefined;
  return { id, name, host, port, user, description };
}

export function normalizeDesktopCmSessionHost(value: string) {
  const host = normalizeBoundedText(value, maxCmSessionHostLength, 'desktop_cm_session_host').toLowerCase();
  if (host.includes('://') || host.includes('/') || host.includes('?') || host.includes('#') || host.includes('@') || host.includes(':')) {
    throw new Error('desktop_cm_session_host_invalid');
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw new Error('desktop_cm_session_host_invalid');
  }
  return host;
}

export function normalizeDesktopCmSessionUser(value: string) {
  const user = normalizeBoundedText(value, maxCmSessionUserLength, 'desktop_cm_session_user');
  if (!/^[A-Za-z0-9._-]+$/.test(user)) {
    throw new Error('desktop_cm_session_user_invalid');
  }
  return user;
}

export function normalizeDesktopCmSessionPort(value: number) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('desktop_cm_session_port_invalid');
  }
  return port;
}

export function normalizeDesktopCmSessionId(value: string) {
  const id = value.trim();
  if (!id || id.length > 80 || !/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error('desktop_cm_session_id_invalid');
  }
  return id;
}

function parseDesktopKubernetesProfile(value: unknown): DesktopKubernetesProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const profile = value as Partial<DesktopKubernetesProfile>;
  if (
    typeof profile.id !== 'string' ||
    typeof profile.displayName !== 'string' ||
    typeof profile.apiServer !== 'string' ||
    typeof profile.authType !== 'string' ||
    typeof profile.credentialStore !== 'string' ||
    typeof profile.credentialAvailable !== 'boolean' ||
    typeof profile.selected !== 'boolean' ||
    typeof profile.status !== 'string'
  ) {
    return null;
  }
  try {
    return {
      id: profile.id,
      displayName: profile.displayName,
      apiServer: normalizeDesktopServerUrl(profile.apiServer),
      authType: profile.authType,
      credentialStore: profile.credentialStore,
      credentialAvailable: profile.credentialAvailable,
      selected: profile.selected,
      status: profile.status,
    };
  } catch {
    return null;
  }
}

function parseDesktopCmSession(value: unknown): DesktopCmSession | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const session = value as Partial<DesktopCmSession>;
  if (
    typeof session.id !== 'string' ||
    typeof session.name !== 'string' ||
    typeof session.host !== 'string' ||
    typeof session.port !== 'number' ||
    typeof session.user !== 'string' ||
    typeof session.authType !== 'string' ||
    typeof session.status !== 'string' ||
    typeof session.updatedAt !== 'number' ||
    typeof session.selected !== 'boolean'
  ) {
    return null;
  }
  try {
    return {
      id: normalizeDesktopCmSessionId(session.id),
      name: normalizeBoundedText(session.name, maxCmSessionNameLength, 'desktop_cm_session_name'),
      host: normalizeDesktopCmSessionHost(session.host),
      port: normalizeDesktopCmSessionPort(session.port),
      user: normalizeDesktopCmSessionUser(session.user),
      authType: session.authType.trim() || 'os-credential-store',
      status: session.status.trim() || 'metadata-only',
      updatedAt: session.updatedAt,
      selected: session.selected,
      description:
        typeof session.description === 'string' && session.description.trim()
          ? normalizeBoundedText(session.description, maxCmSessionDescriptionLength, 'desktop_cm_session_description')
          : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeBoundedText(value: string, maxLength: number, errorPrefix: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${errorPrefix}_required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${errorPrefix}_too_long`);
  }
  return trimmed;
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1' || normalizedHostname === '[::1]' || normalizedHostname.endsWith('.localhost');
}

function getTauriInvoke(): TauriInvoke | null {
  const desktopWindow = window as DesktopWindow;
  return desktopWindow.__TAURI__?.core?.invoke || desktopWindow.__TAURI_INTERNALS__?.invoke || null;
}

function dispatchDesktopConnectionProfileChanged() {
  window.dispatchEvent(new Event(desktopConnectionProfileChangedEvent));
}
