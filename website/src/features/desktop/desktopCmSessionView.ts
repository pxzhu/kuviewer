import type { DesktopCmSession, DesktopCmSessionRuntimeProfile } from './desktopConnectionProfile';

export const cmDiagnosticStageFilterOptions = ['all', 'metadata', 'credential', 'reachability', 'ssh-auth', 'tunnel', 'health', 'runtime'] as const;
export const cmDiagnosticSeverityFilterOptions = ['all', 'info', 'warning', 'error'] as const;
export const desktopCmSessionViewPreferenceStorageKey = 'kuviewer_desktop_cm_session_view_preferences';
export const maxDesktopCmSessionGroupNameLength = 40;
export const defaultDesktopCmSessionGroup = 'General';

export type CmDiagnosticStageFilter = (typeof cmDiagnosticStageFilterOptions)[number];
export type CmDiagnosticSeverityFilter = (typeof cmDiagnosticSeverityFilterOptions)[number];

export interface DesktopCmSessionViewPreference {
  sessionId: string;
  group: string;
  favorite: boolean;
  updatedAt: number;
}

export interface DesktopCmSessionViewPreferences {
  sessions: DesktopCmSessionViewPreference[];
  collapsedGroups: string[];
}

export interface DesktopCmSessionGroup {
  group: string;
  slug: string;
  sessions: DesktopCmSession[];
  totalCount: number;
  favoriteCount: number;
  collapsed: boolean;
}

export function readDesktopCmSessionViewPreferences(): DesktopCmSessionViewPreferences {
  if (typeof window === 'undefined') {
    return { sessions: [], collapsedGroups: [] };
  }
  try {
    const rawValue = window.localStorage.getItem(desktopCmSessionViewPreferenceStorageKey);
    if (!rawValue) {
      return { sessions: [], collapsedGroups: [] };
    }
    return normalizeDesktopCmSessionViewPreferences(JSON.parse(rawValue));
  } catch {
    window.localStorage.removeItem(desktopCmSessionViewPreferenceStorageKey);
    return { sessions: [], collapsedGroups: [] };
  }
}

export function writeDesktopCmSessionViewPreferences(preferences: DesktopCmSessionViewPreferences) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(desktopCmSessionViewPreferenceStorageKey, JSON.stringify(normalizeDesktopCmSessionViewPreferences(preferences)));
  } catch {
    // Session grouping is a non-critical UI preference.
  }
}

export function normalizeDesktopCmSessionViewPreferences(value: unknown): DesktopCmSessionViewPreferences {
  if (!value || typeof value !== 'object') {
    return { sessions: [], collapsedGroups: [] };
  }
  const candidate = value as Partial<DesktopCmSessionViewPreferences>;
  const seenSessionIds = new Set<string>();
  const sessions: DesktopCmSessionViewPreference[] = [];
  if (Array.isArray(candidate.sessions)) {
    for (const item of candidate.sessions) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const preference = item as Partial<DesktopCmSessionViewPreference>;
      if (typeof preference.sessionId !== 'string' || !preference.sessionId.trim()) {
        continue;
      }
      const sessionId = preference.sessionId.trim().slice(0, 120);
      if (seenSessionIds.has(sessionId)) {
        continue;
      }
      seenSessionIds.add(sessionId);
      sessions.push({
        sessionId,
        group: normalizeDesktopCmSessionGroupName(preference.group || ''),
        favorite: preference.favorite === true,
        updatedAt: typeof preference.updatedAt === 'number' && Number.isFinite(preference.updatedAt) ? preference.updatedAt : Date.now(),
      });
    }
  }
  const collapsedGroups = Array.isArray(candidate.collapsedGroups)
    ? [...new Set(candidate.collapsedGroups.filter((group): group is string => typeof group === 'string').map(normalizeDesktopCmSessionGroupName))]
    : [];
  return { sessions, collapsedGroups };
}

export function pruneDesktopCmSessionViewPreferences(preferences: DesktopCmSessionViewPreferences, sessions: DesktopCmSession[]) {
  const validSessionIds = new Set(sessions.map((session) => session.id));
  return normalizeDesktopCmSessionViewPreferences({
    sessions: preferences.sessions.filter((preference) => validSessionIds.has(preference.sessionId)),
    collapsedGroups: preferences.collapsedGroups,
  });
}

export function desktopCmSessionViewPreferencesEqual(left: DesktopCmSessionViewPreferences, right: DesktopCmSessionViewPreferences) {
  return JSON.stringify(normalizeDesktopCmSessionViewPreferences(left)) === JSON.stringify(normalizeDesktopCmSessionViewPreferences(right));
}

export function getDesktopCmSessionPreference(sessionId: string, preferences: Map<string, DesktopCmSessionViewPreference>) {
  return preferences.get(sessionId) || { sessionId, group: defaultDesktopCmSessionGroup, favorite: false, updatedAt: 0 };
}

export function setDesktopCmSessionGroupPreference(preferences: DesktopCmSessionViewPreferences, sessionId: string, group: string) {
  const current = getDesktopCmSessionPreference(sessionId, new Map(preferences.sessions.map((preference) => [preference.sessionId, preference])));
  return upsertDesktopCmSessionViewPreference(preferences, { ...current, group: normalizeDesktopCmSessionGroupName(group), updatedAt: Date.now() });
}

export function setDesktopCmSessionGroupPreferences(preferences: DesktopCmSessionViewPreferences, sessionIds: string[], group: string) {
  return sessionIds.reduce((current, sessionId) => setDesktopCmSessionGroupPreference(current, sessionId, group), preferences);
}

export function toggleDesktopCmSessionFavoritePreference(preferences: DesktopCmSessionViewPreferences, sessionId: string) {
  const current = getDesktopCmSessionPreference(sessionId, new Map(preferences.sessions.map((preference) => [preference.sessionId, preference])));
  return upsertDesktopCmSessionViewPreference(preferences, { ...current, favorite: !current.favorite, updatedAt: Date.now() });
}

export function setDesktopCmSessionFavoritePreferences(preferences: DesktopCmSessionViewPreferences, sessionIds: string[], favorite: boolean) {
  return sessionIds.reduce((currentPreferences, sessionId) => {
    const current = getDesktopCmSessionPreference(sessionId, new Map(currentPreferences.sessions.map((preference) => [preference.sessionId, preference])));
    return upsertDesktopCmSessionViewPreference(currentPreferences, { ...current, favorite, updatedAt: Date.now() });
  }, preferences);
}

export function toggleDesktopCmSessionGroupCollapsed(preferences: DesktopCmSessionViewPreferences, group: string) {
  const normalizedGroup = normalizeDesktopCmSessionGroupName(group);
  const collapsedGroups = new Set(preferences.collapsedGroups.map(normalizeDesktopCmSessionGroupName));
  if (collapsedGroups.has(normalizedGroup)) {
    collapsedGroups.delete(normalizedGroup);
  } else {
    collapsedGroups.add(normalizedGroup);
  }
  return normalizeDesktopCmSessionViewPreferences({ sessions: preferences.sessions, collapsedGroups: [...collapsedGroups] });
}

export function normalizeDesktopCmSessionGroupName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxDesktopCmSessionGroupNameLength);
  return normalized || defaultDesktopCmSessionGroup;
}

export function buildDesktopCmSessionGroups(
  allSessions: DesktopCmSession[],
  visibleSessions: DesktopCmSession[],
  preferences: Map<string, DesktopCmSessionViewPreference>,
  collapsedGroups: string[],
): DesktopCmSessionGroup[] {
  const collapsedGroupSet = new Set(collapsedGroups.map(normalizeDesktopCmSessionGroupName));
  const allGroupCounts = new Map<string, { totalCount: number; favoriteCount: number }>();
  for (const session of allSessions) {
    const preference = getDesktopCmSessionPreference(session.id, preferences);
    const counts = allGroupCounts.get(preference.group) || { totalCount: 0, favoriteCount: 0 };
    counts.totalCount += 1;
    counts.favoriteCount += preference.favorite ? 1 : 0;
    allGroupCounts.set(preference.group, counts);
  }
  const visibleGroupSessions = new Map<string, DesktopCmSession[]>();
  for (const session of visibleSessions) {
    const preference = getDesktopCmSessionPreference(session.id, preferences);
    visibleGroupSessions.set(preference.group, [...(visibleGroupSessions.get(preference.group) || []), session]);
  }
  return [...visibleGroupSessions.entries()]
    .map(([group, groupSessions]) => ({
      group,
      slug: slugifyTestId(group),
      sessions: sortDesktopCmSessionsForGroup(groupSessions, preferences),
      totalCount: allGroupCounts.get(group)?.totalCount || groupSessions.length,
      favoriteCount: allGroupCounts.get(group)?.favoriteCount || 0,
      collapsed: collapsedGroupSet.has(group),
    }))
    .sort((left, right) => compareDesktopCmSessionGroupNames(left.group, right.group));
}

export function getDisplayedCmDiagnostic(session: DesktopCmSession, runtimeProfile: DesktopCmSessionRuntimeProfile | null, activeRuntimeSessionId: string) {
  return activeRuntimeSessionId === session.id && runtimeProfile ? runtimeProfile : session;
}

export function matchesCmDiagnosticFilters(
  diagnostic: Pick<DesktopCmSession, 'diagnosticStage' | 'diagnosticSeverity'> | Pick<DesktopCmSessionRuntimeProfile, 'diagnosticStage' | 'diagnosticSeverity'>,
  stageFilter: CmDiagnosticStageFilter,
  severityFilter: CmDiagnosticSeverityFilter,
) {
  const stage = diagnostic.diagnosticStage || 'metadata';
  const severity = diagnostic.diagnosticSeverity || 'info';
  return (stageFilter === 'all' || stage === stageFilter) && (severityFilter === 'all' || severity === severityFilter);
}

export function matchesCmSessionSearch(
  session: DesktopCmSession,
  normalizedQuery: string,
  diagnostic: Pick<DesktopCmSession, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint'> | Pick<DesktopCmSessionRuntimeProfile, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint'>,
  preference: DesktopCmSessionViewPreference,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    session.name, session.host, session.port, session.user, session.remoteApiHost, session.remoteApiPort,
    session.status, session.runtimeStatus, session.description || '',
    session.credentialAvailable ? 'credential ready' : 'credential missing',
    formatCmSessionCheckStatus(session.lastCheckStatus), formatRuntimeStatus(session.runtimeStatus),
    preference.group, preference.favorite ? 'favorite 즐겨찾기' : '',
    diagnostic.diagnosticStage || '', diagnostic.diagnosticSeverity || '', diagnostic.diagnosticMessage || '', diagnostic.diagnosticHint || '',
  ].join(' ').toLowerCase().includes(normalizedQuery);
}

function upsertDesktopCmSessionViewPreference(preferences: DesktopCmSessionViewPreferences, nextPreference: DesktopCmSessionViewPreference) {
  const normalizedPreference = normalizeDesktopCmSessionViewPreferences({ sessions: [nextPreference], collapsedGroups: [] }).sessions[0];
  if (!normalizedPreference) {
    return preferences;
  }
  const withoutCurrent = preferences.sessions.filter((preference) => preference.sessionId !== normalizedPreference.sessionId);
  const nextSessions = normalizedPreference.group === defaultDesktopCmSessionGroup && !normalizedPreference.favorite
    ? withoutCurrent
    : [normalizedPreference, ...withoutCurrent];
  return normalizeDesktopCmSessionViewPreferences({ sessions: nextSessions, collapsedGroups: preferences.collapsedGroups });
}

function sortDesktopCmSessionsForGroup(sessions: DesktopCmSession[], preferences: Map<string, DesktopCmSessionViewPreference>) {
  return [...sessions].sort((left, right) => Number(getDesktopCmSessionPreference(right.id, preferences).favorite) - Number(getDesktopCmSessionPreference(left.id, preferences).favorite));
}

function compareDesktopCmSessionGroupNames(left: string, right: string) {
  if (left === defaultDesktopCmSessionGroup && right !== defaultDesktopCmSessionGroup) return -1;
  if (right === defaultDesktopCmSessionGroup && left !== defaultDesktopCmSessionGroup) return 1;
  return left.localeCompare(right);
}

function slugifyTestId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

function formatCmSessionCheckStatus(status: string) {
  const labels: Record<string, string> = {
    reachable: '연결 가능',
    'auth-failed': '인증 실패',
    timeout: '시간 초과',
    unreachable: '연결 불가',
    'not-ssh': 'SSH 아님',
    'ssh-binary-missing': 'ssh 없음',
    'credential-ready': 'credential 준비됨',
    'credential-deleted': 'credential 삭제됨',
    'credential-missing': 'credential 없음',
    'not-checked': '확인 안 됨',
  };
  return labels[status] || status || '확인 안 됨';
}

function formatRuntimeStatus(status: string) {
  const labels: Record<string, string> = {
    'runtime-active': 'runtime active',
    'runtime-unhealthy': 'runtime health 실패',
    'runtime-lost': 'runtime 끊김',
    stopped: 'runtime stopped',
  };
  return labels[status] || status || 'runtime stopped';
}
