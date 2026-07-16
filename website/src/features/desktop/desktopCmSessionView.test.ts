import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesktopCmSessionGroups,
  getDesktopCmSessionPreference,
  matchesCmDiagnosticFilters,
  matchesCmSessionSearch,
  normalizeDesktopCmSessionViewPreferences,
} from './desktopCmSessionView.ts';

test('desktop CM view preferences normalize safe grouping metadata', () => {
  const normalized = normalizeDesktopCmSessionViewPreferences({
    sessions: [
      { sessionId: ' cm-a ', group: '  Production   East ', favorite: true, updatedAt: 10 },
      { sessionId: 'cm-a', group: 'ignored duplicate', favorite: false },
      { sessionId: 'cm-b', group: '', favorite: false, updatedAt: 20 },
      { sessionId: '', group: 'invalid' },
    ],
    collapsedGroups: [' Production   East ', '', 'Production East'],
  });

  assert.deepEqual(normalized.sessions, [
    { sessionId: 'cm-a', group: 'Production East', favorite: true, updatedAt: 10 },
    { sessionId: 'cm-b', group: 'General', favorite: false, updatedAt: 20 },
  ]);
  assert.deepEqual(normalized.collapsedGroups, ['Production East', 'General']);
});

test('desktop CM groups keep General first and favorites first', () => {
  const sessions = [
    { id: 'a', name: 'alpha' },
    { id: 'b', name: 'beta' },
    { id: 'c', name: 'gamma' },
  ] as never;
  const preferences = normalizeDesktopCmSessionViewPreferences({
    sessions: [
      { sessionId: 'a', group: 'Ops', favorite: false, updatedAt: 1 },
      { sessionId: 'b', group: 'Ops', favorite: true, updatedAt: 2 },
    ],
    collapsedGroups: ['Ops'],
  });
  const preferenceMap = new Map(preferences.sessions.map((item) => [item.sessionId, item]));
  const groups = buildDesktopCmSessionGroups(sessions, sessions, preferenceMap, preferences.collapsedGroups);

  assert.deepEqual(groups.map((group) => group.group), ['General', 'Ops']);
  assert.deepEqual(groups[1].sessions.map((session) => session.id), ['b', 'a']);
  assert.equal(groups[1].favoriteCount, 1);
  assert.equal(groups[1].collapsed, true);
});

test('desktop CM diagnostics filters and search use safe metadata', () => {
  const session = {
    id: 'cm-a',
    name: 'Primary CM',
    host: '10.0.0.5',
    port: 22,
    user: 'ubuntu',
    remoteApiHost: '127.0.0.1',
    remoteApiPort: 18085,
    status: 'saved',
    runtimeStatus: 'stopped',
    lastCheckStatus: 'auth-failed',
    credentialAvailable: false,
    diagnosticStage: 'ssh-auth',
    diagnosticSeverity: 'error',
    diagnosticMessage: 'authentication_failed',
    diagnosticHint: 'Check the stored credential.',
  } as never;
  const preference = getDesktopCmSessionPreference('cm-a', new Map());

  assert.equal(matchesCmDiagnosticFilters(session, 'ssh-auth', 'error'), true);
  assert.equal(matchesCmDiagnosticFilters(session, 'health', 'error'), false);
  assert.equal(matchesCmSessionSearch(session, '인증 실패', session, preference), true);
  assert.equal(matchesCmSessionSearch(session, 'private key body', session, preference), false);
});
