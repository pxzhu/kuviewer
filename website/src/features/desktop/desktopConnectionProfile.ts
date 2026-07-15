import { isDesktopRuntime } from './desktopRuntime';

export { isDesktopRuntime } from './desktopRuntime';

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
  remoteApiHost: string;
  remoteApiPort: number;
  authType: string;
  credentialStore: string;
  credentialAvailable: boolean;
  status: string;
  runtimeStatus: string;
  updatedAt: number;
  selected: boolean;
  description?: string;
  lastCheckStatus: string;
  lastCheckAt?: number;
  lastCheckMessage?: string;
  diagnosticStage?: string;
  diagnosticSeverity?: string;
  diagnosticMessage?: string;
  diagnosticHint?: string;
}

export interface DesktopCmSessionInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  user: string;
  remoteApiHost?: string;
  remoteApiPort?: number;
  description?: string;
}

export interface DesktopCmSessionExportItem {
  name: string;
  host: string;
  port: number;
  user: string;
  remoteApiHost: string;
  remoteApiPort: number;
  description?: string;
}

export interface DesktopCmSessionExportBundle {
  schemaVersion: 1;
  kind: 'kuviewer.desktop.cmSessions';
  exportedAt: number;
  items: DesktopCmSessionExportItem[];
}

export interface DesktopCmSessionRuntimeProfile {
  sessionId: string;
  sessionName: string;
  serverUrl: string;
  remoteApiHost: string;
  remoteApiPort: number;
  localPort: number;
  status: string;
  startedAt: number;
  healthStatus: string;
  lastHealthAt?: number;
  lastHealthMessage?: string;
  lastError?: string;
  diagnosticStage?: string;
  diagnosticSeverity?: string;
  diagnosticMessage?: string;
  diagnosticHint?: string;
}

const desktopConnectionProfileStorageKey = 'kuviewer_desktop_connection_profile';
const desktopConnectionProfileChangedEvent = 'kuviewer-desktop-connection-profile-changed';
const desktopCmRuntimeProfileStorageKey = 'kuviewer_desktop_cm_runtime_profile';
const desktopCmRuntimeProfileChangedEvent = 'kuviewer-desktop-cm-runtime-profile-changed';
const maxServerUrlLength = 220;
const maxCmSessionNameLength = 60;
const maxCmSessionHostLength = 180;
const maxCmSessionUserLength = 80;
const maxCmSessionDescriptionLength = 160;
const maxCmSessionKeyFilePathLength = 1024;
export const desktopCmDefaultRemoteApiHost = '127.0.0.1';
export const desktopCmDefaultRemoteApiPort = 18085;

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

export function getDesktopCmRuntimeProfile(): DesktopCmSessionRuntimeProfile | null {
  if (!isDesktopRuntime()) {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(desktopCmRuntimeProfileStorageKey);
    if (!rawValue) {
      return null;
    }
    const parsedValue = JSON.parse(rawValue) as Partial<DesktopCmSessionRuntimeProfile>;
    const runtimeProfile = parseDesktopCmSessionRuntimeProfile(parsedValue);
    if (!runtimeProfile) {
      clearDesktopCmRuntimeProfile();
      return null;
    }
    return runtimeProfile;
  } catch {
    clearDesktopCmRuntimeProfile();
    return null;
  }
}

export function storeDesktopCmRuntimeProfile(profile: DesktopCmSessionRuntimeProfile) {
  const runtimeProfile = parseDesktopCmSessionRuntimeProfile(profile);
  if (!runtimeProfile) {
    throw new Error('desktop_cm_runtime_profile_invalid');
  }
  window.sessionStorage.setItem(desktopCmRuntimeProfileStorageKey, JSON.stringify(runtimeProfile));
  dispatchDesktopCmRuntimeProfileChanged();
  return runtimeProfile;
}

export function clearDesktopCmRuntimeProfile() {
  window.sessionStorage.removeItem(desktopCmRuntimeProfileStorageKey);
  dispatchDesktopCmRuntimeProfileChanged();
}

export function subscribeDesktopCmRuntimeProfile(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === desktopCmRuntimeProfileStorageKey) {
      listener();
    }
  };
  const handleLocalChange = () => listener();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(desktopCmRuntimeProfileChangedEvent, handleLocalChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(desktopCmRuntimeProfileChangedEvent, handleLocalChange);
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

export async function importDesktopCmSessionPrivateKey(sessionId: string, keyFilePath: string): Promise<DesktopCmSession | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const session = await invoke<unknown>('desktop_import_cm_session_private_key', {
    sessionId: normalizeDesktopCmSessionId(sessionId),
    keyFilePath: normalizeDesktopCmPrivateKeyPath(keyFilePath),
  });
  return parseDesktopCmSession(session);
}

export async function deleteDesktopCmSessionCredential(sessionId: string): Promise<DesktopCmSession | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const session = await invoke<unknown>('desktop_delete_cm_session_credential', { sessionId: normalizeDesktopCmSessionId(sessionId) });
  return parseDesktopCmSession(session);
}

export async function checkDesktopCmSession(sessionId: string): Promise<DesktopCmSession | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const session = await invoke<unknown>('desktop_check_cm_session', { sessionId: normalizeDesktopCmSessionId(sessionId) });
  return parseDesktopCmSession(session);
}

export async function getDesktopCmSessionRuntime(): Promise<DesktopCmSessionRuntimeProfile | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const profile = await invoke<unknown>('desktop_cm_session_runtime');
  return parseDesktopCmSessionRuntimeProfile(profile);
}

export async function startDesktopCmSessionRuntime(sessionId: string): Promise<DesktopCmSessionRuntimeProfile | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const profile = await invoke<unknown>('desktop_start_cm_session_runtime', { sessionId: normalizeDesktopCmSessionId(sessionId) });
  return parseDesktopCmSessionRuntimeProfile(profile);
}

export async function checkDesktopCmSessionRuntime(): Promise<DesktopCmSessionRuntimeProfile | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const profile = await invoke<unknown>('desktop_check_cm_session_runtime');
  return parseDesktopCmSessionRuntimeProfile(profile);
}

export async function stopDesktopCmSessionRuntime(): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return;
  }

  await invoke<unknown>('desktop_stop_cm_session_runtime');
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
  const remoteApiHost = input.remoteApiHost?.trim()
    ? normalizeDesktopCmRemoteApiHost(input.remoteApiHost)
    : desktopCmDefaultRemoteApiHost;
  const remoteApiPort = normalizeDesktopCmRemoteApiPort(input.remoteApiPort ?? desktopCmDefaultRemoteApiPort);
  const id = input.id?.trim() ? normalizeDesktopCmSessionId(input.id) : undefined;
  const description = input.description?.trim()
    ? normalizeBoundedText(input.description, maxCmSessionDescriptionLength, 'desktop_cm_session_description')
    : undefined;
  return { id, name, host, port, user, remoteApiHost, remoteApiPort, description };
}

export function createDesktopCmSessionExportBundle(sessions: DesktopCmSession[]): DesktopCmSessionExportBundle {
  return {
    schemaVersion: 1,
    kind: 'kuviewer.desktop.cmSessions',
    exportedAt: Date.now(),
    items: sessions.map(toDesktopCmSessionExportItem),
  };
}

export function parseDesktopCmSessionImportBundle(value: unknown, maxItems = 50): {
  items: DesktopCmSessionExportItem[];
  invalid: number;
  skipped: number;
} {
  let rawItems: unknown[];
  if (Array.isArray(value)) {
    rawItems = value;
  } else if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    rawItems = (value as { items: unknown[] }).items;
  } else {
    return { items: [], invalid: 1, skipped: 0 };
  }

  const items: DesktopCmSessionExportItem[] = [];
  let invalid = 0;
  let skipped = 0;
  const seenKeys = new Set<string>();
  for (const rawItem of rawItems) {
    if (items.length >= maxItems) {
      skipped += 1;
      continue;
    }
    const item = parseDesktopCmSessionExportItem(rawItem);
    if (!item) {
      invalid += 1;
      continue;
    }
    const itemKey = desktopCmSessionEndpointKey(item);
    if (seenKeys.has(itemKey)) {
      skipped += 1;
      continue;
    }
    seenKeys.add(itemKey);
    items.push(item);
  }
  return { items, invalid, skipped };
}

export function desktopCmSessionEndpointKey(session: Pick<DesktopCmSessionInput, 'name' | 'host' | 'port' | 'user' | 'remoteApiHost' | 'remoteApiPort'>) {
  const normalized = normalizeDesktopCmSessionInput({
    name: session.name,
    host: session.host,
    port: session.port,
    user: session.user,
    remoteApiHost: session.remoteApiHost,
    remoteApiPort: session.remoteApiPort,
  });
  return [
    normalized.name.toLowerCase(),
    normalized.host,
    normalized.port,
    normalized.user,
    normalized.remoteApiHost,
    normalized.remoteApiPort,
  ].join('|');
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

export function normalizeDesktopCmRemoteApiHost(value: string) {
  const host = normalizeBoundedText(value, maxCmSessionHostLength, 'desktop_cm_session_remote_api_host').toLowerCase();
  if (host.includes('://') || host.includes('/') || host.includes('?') || host.includes('#') || host.includes('@') || host.includes(':')) {
    throw new Error('desktop_cm_session_remote_api_host_invalid');
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw new Error('desktop_cm_session_remote_api_host_invalid');
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

export function normalizeDesktopCmRemoteApiPort(value: number) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('desktop_cm_session_remote_api_port_invalid');
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

export function normalizeDesktopCmPrivateKeyPath(value: string) {
  return normalizeBoundedText(value, maxCmSessionKeyFilePathLength, 'desktop_cm_private_key_path');
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
      remoteApiHost:
        typeof session.remoteApiHost === 'string' && session.remoteApiHost.trim()
          ? normalizeDesktopCmRemoteApiHost(session.remoteApiHost)
          : desktopCmDefaultRemoteApiHost,
      remoteApiPort:
        typeof session.remoteApiPort === 'number'
          ? normalizeDesktopCmRemoteApiPort(session.remoteApiPort)
          : desktopCmDefaultRemoteApiPort,
      authType: session.authType.trim() || 'os-credential-store',
      credentialStore: typeof session.credentialStore === 'string' && session.credentialStore.trim() ? session.credentialStore.trim() : 'os-credential-store',
      credentialAvailable: typeof session.credentialAvailable === 'boolean' ? session.credentialAvailable : false,
      status: session.status.trim() || 'metadata-only',
      runtimeStatus: typeof session.runtimeStatus === 'string' && session.runtimeStatus.trim() ? session.runtimeStatus.trim() : 'stopped',
      updatedAt: session.updatedAt,
      selected: session.selected,
      description:
        typeof session.description === 'string' && session.description.trim()
          ? normalizeBoundedText(session.description, maxCmSessionDescriptionLength, 'desktop_cm_session_description')
          : undefined,
      lastCheckStatus: typeof session.lastCheckStatus === 'string' && session.lastCheckStatus.trim() ? session.lastCheckStatus.trim() : 'not-checked',
      lastCheckAt: typeof session.lastCheckAt === 'number' ? session.lastCheckAt : undefined,
      lastCheckMessage:
        typeof session.lastCheckMessage === 'string' && session.lastCheckMessage.trim()
          ? normalizeBoundedText(session.lastCheckMessage, 120, 'desktop_cm_session_last_check_message')
          : undefined,
      diagnosticStage:
        typeof session.diagnosticStage === 'string' && session.diagnosticStage.trim()
          ? normalizeBoundedText(session.diagnosticStage, 40, 'desktop_cm_session_diagnostic_stage')
          : undefined,
      diagnosticSeverity:
        typeof session.diagnosticSeverity === 'string' && session.diagnosticSeverity.trim()
          ? normalizeBoundedText(session.diagnosticSeverity, 20, 'desktop_cm_session_diagnostic_severity')
          : undefined,
      diagnosticMessage:
        typeof session.diagnosticMessage === 'string' && session.diagnosticMessage.trim()
          ? normalizeBoundedText(session.diagnosticMessage, 160, 'desktop_cm_session_diagnostic_message')
          : undefined,
      diagnosticHint:
        typeof session.diagnosticHint === 'string' && session.diagnosticHint.trim()
          ? normalizeBoundedText(session.diagnosticHint, 220, 'desktop_cm_session_diagnostic_hint')
          : undefined,
    };
  } catch {
    return null;
  }
}

function toDesktopCmSessionExportItem(session: DesktopCmSession): DesktopCmSessionExportItem {
  const normalized = normalizeDesktopCmSessionInput(session);
  return {
    name: normalized.name,
    host: normalized.host,
    port: normalized.port,
    user: normalized.user,
    remoteApiHost: normalized.remoteApiHost || desktopCmDefaultRemoteApiHost,
    remoteApiPort: normalized.remoteApiPort || desktopCmDefaultRemoteApiPort,
    description: normalized.description,
  };
}

function parseDesktopCmSessionExportItem(value: unknown): DesktopCmSessionExportItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  try {
    const item = normalizeDesktopCmSessionInput(value as Partial<DesktopCmSessionInput> as DesktopCmSessionInput);
    return {
      name: item.name,
      host: item.host,
      port: item.port,
      user: item.user,
      remoteApiHost: item.remoteApiHost || desktopCmDefaultRemoteApiHost,
      remoteApiPort: item.remoteApiPort || desktopCmDefaultRemoteApiPort,
      description: item.description,
    };
  } catch {
    return null;
  }
}

function parseDesktopCmSessionRuntimeProfile(value: unknown): DesktopCmSessionRuntimeProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const profile = value as Partial<DesktopCmSessionRuntimeProfile>;
  if (
    typeof profile.sessionId !== 'string' ||
    typeof profile.sessionName !== 'string' ||
    typeof profile.serverUrl !== 'string' ||
    typeof profile.remoteApiHost !== 'string' ||
    typeof profile.remoteApiPort !== 'number' ||
    typeof profile.localPort !== 'number' ||
    typeof profile.status !== 'string' ||
    typeof profile.startedAt !== 'number'
  ) {
    return null;
  }
  try {
    return {
      sessionId: normalizeDesktopCmSessionId(profile.sessionId),
      sessionName: normalizeBoundedText(profile.sessionName, maxCmSessionNameLength, 'desktop_cm_session_name'),
      serverUrl: normalizeDesktopServerUrl(profile.serverUrl),
      remoteApiHost: normalizeDesktopCmRemoteApiHost(profile.remoteApiHost),
      remoteApiPort: normalizeDesktopCmRemoteApiPort(profile.remoteApiPort),
      localPort: normalizeDesktopCmRemoteApiPort(profile.localPort),
      status: profile.status.trim() || 'runtime-active',
      startedAt: profile.startedAt,
      healthStatus: typeof profile.healthStatus === 'string' && profile.healthStatus.trim() ? normalizeBoundedText(profile.healthStatus, 40, 'desktop_cm_runtime_health_status') : 'unknown',
      lastHealthAt: typeof profile.lastHealthAt === 'number' ? profile.lastHealthAt : undefined,
      lastHealthMessage:
        typeof profile.lastHealthMessage === 'string' && profile.lastHealthMessage.trim()
          ? normalizeBoundedText(profile.lastHealthMessage, 120, 'desktop_cm_runtime_last_health_message')
          : undefined,
      lastError:
        typeof profile.lastError === 'string' && profile.lastError.trim()
          ? normalizeBoundedText(profile.lastError, 120, 'desktop_cm_runtime_last_error')
          : undefined,
      diagnosticStage:
        typeof profile.diagnosticStage === 'string' && profile.diagnosticStage.trim()
          ? normalizeBoundedText(profile.diagnosticStage, 40, 'desktop_cm_runtime_diagnostic_stage')
          : undefined,
      diagnosticSeverity:
        typeof profile.diagnosticSeverity === 'string' && profile.diagnosticSeverity.trim()
          ? normalizeBoundedText(profile.diagnosticSeverity, 20, 'desktop_cm_runtime_diagnostic_severity')
          : undefined,
      diagnosticMessage:
        typeof profile.diagnosticMessage === 'string' && profile.diagnosticMessage.trim()
          ? normalizeBoundedText(profile.diagnosticMessage, 160, 'desktop_cm_runtime_diagnostic_message')
          : undefined,
      diagnosticHint:
        typeof profile.diagnosticHint === 'string' && profile.diagnosticHint.trim()
          ? normalizeBoundedText(profile.diagnosticHint, 220, 'desktop_cm_runtime_diagnostic_hint')
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

function dispatchDesktopCmRuntimeProfileChanged() {
  window.dispatchEvent(new Event(desktopCmRuntimeProfileChangedEvent));
}
