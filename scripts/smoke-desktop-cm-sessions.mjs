import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const playwrightUrl = pathToFileURL(path.join(repoRoot, 'website', 'node_modules', 'playwright', 'index.mjs')).href;
const { chromium } = await import(playwrightUrl);

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.url || process.env.KUVIEWER_DESKTOP_SMOKE_URL || 'http://127.0.0.1:4174/kuviewer/';
const desktopSmokeOutputDir =
  args.output || process.env.KUVIEWER_DESKTOP_SMOKE_OUTPUT || path.join(repoRoot, 'website', 'artifacts', 'visual-smoke', 'desktop-cm-sessions');
const desktopSmokeScreenshotFileNames = ['desktop-cm-focus-visible-help-tooltip.png'];
const desktopSmokeScreenshotMetadataFileNames = ['desktop-cm-focus-visible-help-tooltip.metadata.json'];
const desktopSmokeArtifactHygieneFileNames = ['desktop-cm-artifact-hygiene-sentinel.keep'];

await waitForPreview(baseUrl);

const browser = await chromium.launch();

try {
  await smokeDesktopRuntime(browser, baseUrl);
  await smokeWebRuntime(browser, baseUrl);
  console.log(JSON.stringify({ ok: true, url: baseUrl, smoke: 'desktop-cm-sessions', screenshots: desktopSmokeOutputDir }, null, 2));
} finally {
  await browser.close();
}

function parseRgbColor(value) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value || '');
  if (!match) {
    return null;
  }
  return match.slice(1, 4).map((part) => Number(part) / 255);
}

function relativeLuminance(rgb) {
  return rgb
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(foreground, background) {
  const fg = parseRgbColor(foreground);
  const bg = parseRgbColor(background);
  if (!fg || !bg) {
    return 0;
  }
  const light = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const dark = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (light + 0.05) / (dark + 0.05);
}

async function smokeDesktopRuntime(browser, url) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.localStorage.removeItem('kuviewer_admin_token');
      window.localStorage.removeItem('kuviewer_desktop_connection_profile');
      if (window.localStorage.getItem('kuviewer_desktop_cm_diagnostic_filter_presets_smoke_keep') !== '1') {
        window.localStorage.removeItem('kuviewer_desktop_cm_diagnostic_filter_presets');
      }
      if (window.localStorage.getItem('kuviewer_desktop_cm_session_view_preferences_smoke_keep') !== '1') {
        window.localStorage.removeItem('kuviewer_desktop_cm_session_view_preferences');
      }
      if (window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets_smoke_keep') !== '1') {
        window.localStorage.removeItem('kuviewer_desktop_cm_session_layout_presets');
      }
      window.sessionStorage.removeItem('kuviewer_admin_token');
      window.sessionStorage.removeItem('kuviewer_desktop_cm_runtime_profile');
      window.sessionStorage.removeItem('kuviewer_source_mode');
      window.__kuviewerCmSessions = [];
      window.__kuviewerCmRuntimeProfile = null;
      window.__kuviewerCmRuntimeLost = false;
      window.__kuviewerDesktopInvocations = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            window.__kuviewerDesktopInvocations.push({ command, args });
            if (command === 'desktop_cm_sessions') {
              return window.__kuviewerCmSessions;
            }
            if (command === 'desktop_cm_session_runtime') {
              return window.__kuviewerCmRuntimeProfile;
            }
            if (command === 'desktop_save_cm_session') {
              const now = Date.now();
              const stableId = [
                args.session.name,
                args.session.host,
                args.session.port,
                args.session.user,
                args.session.remoteApiHost || '127.0.0.1',
                args.session.remoteApiPort || 18085,
              ]
                .join('-')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 80);
              const existingSession = args.session.id
                ? window.__kuviewerCmSessions.find((item) => item.id === args.session.id)
                : null;
              const session = {
                id: args.session.id || stableId || `cm-session-${now}`,
                name: args.session.name,
                host: args.session.host,
                port: args.session.port,
                user: args.session.user,
                remoteApiHost: args.session.remoteApiHost || '127.0.0.1',
                remoteApiPort: args.session.remoteApiPort || 18085,
                description: args.session.description,
                authType: 'os-credential-store',
                credentialStore: 'native-smoke-store',
                credentialAvailable: existingSession?.credentialAvailable || false,
                status: existingSession?.credentialAvailable ? 'credential-ready' : 'metadata-only',
                runtimeStatus: existingSession?.runtimeStatus || 'stopped',
                updatedAt: now,
                selected: existingSession?.selected || false,
                lastCheckStatus: existingSession?.lastCheckStatus || 'not-checked',
                lastCheckAt: existingSession?.lastCheckAt,
                lastCheckMessage: existingSession?.lastCheckMessage,
                diagnosticStage: existingSession?.diagnosticStage || 'metadata',
                diagnosticSeverity: existingSession?.diagnosticSeverity || 'info',
                diagnosticMessage: existingSession?.diagnosticMessage || 'not-checked',
                diagnosticHint: existingSession?.diagnosticHint || 'Run connection check to verify SSH reachability.',
              };
              window.__kuviewerCmSessions = [session, ...window.__kuviewerCmSessions.filter((item) => item.id !== session.id)];
              return session;
            }
            if (command === 'desktop_select_cm_session') {
              let selected = null;
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => {
                const nextSession = {
                  ...session,
                  selected: session.id === args.sessionId,
                  status: session.credentialAvailable ? 'credential-ready' : 'metadata-only',
                  runtimeStatus: 'stopped',
                };
                if (nextSession.selected) {
                  selected = nextSession;
                }
                return nextSession;
              });
              if (!selected) {
                throw new Error('desktop_cm_session_not_found');
              }
              return selected;
            }
            if (command === 'desktop_delete_cm_session') {
              if (window.__kuviewerCmRuntimeProfile?.sessionId === args.sessionId) {
                window.__kuviewerCmRuntimeProfile = null;
              }
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.filter((session) => session.id !== args.sessionId);
              return window.__kuviewerCmSessions;
            }
            if (command === 'desktop_import_cm_session_private_key') {
              let imported = null;
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => {
                if (session.id !== args.sessionId) {
                  return session;
                }
                imported = {
                  ...session,
                  credentialAvailable: true,
                  status: 'credential-ready',
                  runtimeStatus: 'stopped',
                  updatedAt: Date.now(),
                  lastCheckStatus: 'credential-ready',
                  lastCheckAt: Date.now(),
                  lastCheckMessage: 'private-key-imported',
                  diagnosticStage: 'credential',
                  diagnosticSeverity: 'info',
                  diagnosticMessage: 'private-key-imported',
                  diagnosticHint: 'Run connection check to verify SSH auth and reachability.',
                };
                return imported;
              });
              if (!imported) {
                throw new Error('desktop_cm_session_not_found');
              }
              return imported;
            }
            if (command === 'desktop_check_cm_session') {
              let checked = null;
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => {
                if (session.id !== args.sessionId) {
                  return session;
                }
                checked = {
                  ...session,
                  status: session.credentialAvailable ? 'reachable' : 'reachable',
                  runtimeStatus: session.runtimeStatus || 'stopped',
                  updatedAt: Date.now(),
                  lastCheckStatus: 'reachable',
                  lastCheckAt: Date.now(),
                  lastCheckMessage: session.credentialAvailable ? 'ssh-check-succeeded' : 'tcp-reachable',
                  diagnosticStage: session.credentialAvailable ? 'ssh-auth' : 'reachability',
                  diagnosticSeverity: 'info',
                  diagnosticMessage: session.credentialAvailable ? 'ssh-check-succeeded' : 'tcp-reachable',
                  diagnosticHint: session.credentialAvailable
                    ? 'SSH auth check completed. Runtime can be started.'
                    : 'TCP/SSH banner responded. Import a private key to verify SSH auth.',
                };
                return checked;
              });
              if (!checked) {
                throw new Error('desktop_cm_session_not_found');
              }
              return checked;
            }
            if (command === 'desktop_delete_cm_session_credential') {
              if (window.__kuviewerCmRuntimeProfile?.sessionId === args.sessionId) {
                window.__kuviewerCmRuntimeProfile = null;
              }
              let updated = null;
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => {
                if (session.id !== args.sessionId) {
                  return session;
                }
                updated = {
                  ...session,
                  credentialAvailable: false,
                  status: 'credential-deleted',
                  runtimeStatus: 'stopped',
                  updatedAt: Date.now(),
                  lastCheckStatus: 'credential-deleted',
                  lastCheckAt: Date.now(),
                  lastCheckMessage: 'credential-deleted',
                  diagnosticStage: 'credential',
                  diagnosticSeverity: 'warning',
                  diagnosticMessage: 'credential-deleted',
                  diagnosticHint: 'Import a private key credential before starting runtime.',
                };
                return updated;
              });
              if (!updated) {
                throw new Error('desktop_cm_session_not_found');
              }
              return updated;
            }
            if (command === 'desktop_start_cm_session_runtime') {
              const session = window.__kuviewerCmSessions.find((item) => item.id === args.sessionId);
              if (!session) {
                throw new Error('desktop_cm_session_not_found');
              }
              if (!session.credentialAvailable) {
                throw new Error('desktop_cm_runtime_credential_missing');
              }
              const now = Date.now();
              window.__kuviewerCmRuntimeProfile = {
                sessionId: session.id,
                sessionName: session.name,
                serverUrl: 'http://127.0.0.1:18123',
                remoteApiHost: session.remoteApiHost,
                remoteApiPort: session.remoteApiPort,
                localPort: 18123,
                status: 'runtime-active',
                startedAt: now,
                healthStatus: 'healthy',
                lastHealthAt: now,
                lastHealthMessage: 'healthz-ok',
                diagnosticStage: 'health',
                diagnosticSeverity: 'info',
                diagnosticMessage: 'healthz-ok',
                diagnosticHint: 'Localhost tunnel and remote Kuviewer API health are healthy.',
              };
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((item) => ({
                ...item,
                selected: item.id === session.id,
                status: item.id === session.id ? 'runtime-active' : item.status,
                runtimeStatus: item.id === session.id ? 'runtime-active' : 'stopped',
                diagnosticStage: item.id === session.id ? 'health' : item.diagnosticStage,
                diagnosticSeverity: item.id === session.id ? 'info' : item.diagnosticSeverity,
                diagnosticMessage: item.id === session.id ? 'healthz-ok' : item.diagnosticMessage,
                diagnosticHint: item.id === session.id ? 'Localhost tunnel and remote Kuviewer API health are healthy.' : item.diagnosticHint,
              }));
              return window.__kuviewerCmRuntimeProfile;
            }
            if (command === 'desktop_check_cm_session_runtime') {
              if (!window.__kuviewerCmRuntimeProfile) {
                return null;
              }
              if (window.__kuviewerCmRuntimeLost) {
                const lostSessionId = window.__kuviewerCmRuntimeProfile.sessionId;
                window.__kuviewerCmRuntimeProfile = null;
                window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => ({
                  ...session,
                  status: session.id === lostSessionId ? 'runtime-lost' : session.status,
                  runtimeStatus: session.id === lostSessionId ? 'runtime-lost' : session.runtimeStatus,
                  diagnosticStage: session.id === lostSessionId ? 'runtime' : session.diagnosticStage,
                  diagnosticSeverity: session.id === lostSessionId ? 'error' : session.diagnosticSeverity,
                  diagnosticMessage: session.id === lostSessionId ? 'runtime-lost' : session.diagnosticMessage,
                  diagnosticHint: session.id === lostSessionId ? 'SSH tunnel process exited. Start the runtime again.' : session.diagnosticHint,
                }));
                return null;
              }
              window.__kuviewerCmRuntimeProfile = {
                ...window.__kuviewerCmRuntimeProfile,
                healthStatus: 'healthy',
                lastHealthAt: Date.now(),
                lastHealthMessage: 'healthz-ok',
                diagnosticStage: 'health',
                diagnosticSeverity: 'info',
                diagnosticMessage: 'healthz-ok',
                diagnosticHint: 'Localhost tunnel and remote Kuviewer API health are healthy.',
              };
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => ({
                ...session,
                diagnosticStage: session.id === window.__kuviewerCmRuntimeProfile.sessionId ? 'health' : session.diagnosticStage,
                diagnosticSeverity: session.id === window.__kuviewerCmRuntimeProfile.sessionId ? 'info' : session.diagnosticSeverity,
                diagnosticMessage: session.id === window.__kuviewerCmRuntimeProfile.sessionId ? 'healthz-ok' : session.diagnosticMessage,
                diagnosticHint: session.id === window.__kuviewerCmRuntimeProfile.sessionId ? 'Localhost tunnel and remote Kuviewer API health are healthy.' : session.diagnosticHint,
              }));
              return window.__kuviewerCmRuntimeProfile;
            }
            if (command === 'desktop_stop_cm_session_runtime') {
              const stoppedSessionId = window.__kuviewerCmRuntimeProfile?.sessionId;
              window.__kuviewerCmRuntimeProfile = null;
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => ({
                ...session,
                status: session.id === stoppedSessionId && session.credentialAvailable ? 'credential-ready' : session.status,
                runtimeStatus: session.id === stoppedSessionId ? 'stopped' : session.runtimeStatus,
                diagnosticStage: session.id === stoppedSessionId ? 'runtime' : session.diagnosticStage,
                diagnosticSeverity: session.id === stoppedSessionId ? 'info' : session.diagnosticSeverity,
                diagnosticMessage: session.id === stoppedSessionId ? 'runtime-stopped' : session.diagnosticMessage,
                diagnosticHint: session.id === stoppedSessionId ? 'Start runtime again when needed.' : session.diagnosticHint,
              }));
              return null;
            }
            throw new Error(`unexpected_tauri_command:${command}`);
          },
        },
      };
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('desktop-cm-session-panel').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-save').click();
    await page.getByText('name 필요').waitFor({ state: 'visible', timeout: 10_000 });
    const validationErrorText = await page.getByTestId('desktop-cm-session-panel').textContent();
    requireCondition(validationErrorText?.includes('name 필요'), 'desktop CM connection profile validation must block missing name before save');
    let connectionPreview = await page.getByTestId('desktop-cm-session-connection-preview').textContent();
    requireCondition(connectionPreview?.includes('user@host:22'), 'desktop CM connection profile preview must reflect safe metadata');
    await page.getByTestId('desktop-cm-session-name').fill('Prod CM');
    await page.getByTestId('desktop-cm-session-host').fill('cm.example.internal');
    await page.getByTestId('desktop-cm-session-port').fill('22');
    await page.getByTestId('desktop-cm-session-user').fill('ubuntu');
    await page.getByTestId('desktop-cm-session-api-preset-localhost-18085').click();
    let apiHostValue = await page.getByTestId('desktop-cm-session-remote-api-host').inputValue();
    let apiPortValue = await page.getByTestId('desktop-cm-session-remote-api-port').inputValue();
    requireCondition(apiHostValue === 'localhost' && apiPortValue === '18085', 'desktop CM connection profile quick API preset must update host and port');
    await page.getByTestId('desktop-cm-session-api-preset-local-8080').click();
    apiHostValue = await page.getByTestId('desktop-cm-session-remote-api-host').inputValue();
    apiPortValue = await page.getByTestId('desktop-cm-session-remote-api-port').inputValue();
    requireCondition(apiHostValue === '127.0.0.1' && apiPortValue === '8080', 'desktop CM connection profile quick API preset must update host and port');
    await page.getByTestId('desktop-cm-session-api-default-reset').click();
    apiHostValue = await page.getByTestId('desktop-cm-session-remote-api-host').inputValue();
    apiPortValue = await page.getByTestId('desktop-cm-session-remote-api-port').inputValue();
    requireCondition(apiHostValue === '127.0.0.1' && apiPortValue === '18085', 'desktop CM connection profile default reset must restore API defaults');
    connectionPreview = await page.getByTestId('desktop-cm-session-connection-preview').textContent();
    requireCondition(connectionPreview?.includes('ubuntu@cm.example.internal:22') && connectionPreview.includes('127.0.0.1:18085'), 'desktop CM connection profile preview must reflect safe metadata');
    await page.getByTestId('desktop-cm-session-remote-api-host').fill('127.0.0.1');
    await page.getByTestId('desktop-cm-session-remote-api-port').fill('18085');
    await page.getByTestId('desktop-cm-session-description').fill('readonly entry');
    await page.getByTestId('desktop-cm-session-save').click();
    await page.getByTestId(/^desktop-cm-session-prod-cm-/).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-search-count').waitFor({ state: 'visible', timeout: 10_000 });
    let sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM session search count must include visible and total session counts');
    const sessionId = await page.evaluate(() => window.__kuviewerCmSessions[0]?.id);
    requireCondition(typeof sessionId === 'string' && sessionId.startsWith('prod-cm-'), 'saved CM session id must be generated');
    await page.getByTestId('desktop-cm-session-group-general').waitFor({ state: 'visible', timeout: 10_000 });
    let groupCount = await page.getByTestId('desktop-cm-session-group-count-general').textContent();
    requireCondition(groupCount?.includes('1 / 1'), 'desktop CM sessions must default into the General group');
    await page.getByTestId(`desktop-cm-session-group-input-${sessionId}`).fill('Production');
    await page.getByTestId(`desktop-cm-session-group-input-${sessionId}`).press('Enter');
    await page.getByTestId('desktop-cm-session-group-production').waitFor({ state: 'visible', timeout: 10_000 });
    groupCount = await page.getByTestId('desktop-cm-session-group-count-production').textContent();
    requireCondition(groupCount?.includes('1 / 1'), 'desktop CM session group move must update group counts');
    await page.getByTestId(`desktop-cm-session-favorite-${sessionId}`).click();
    const favoriteCount = await page.getByTestId('desktop-cm-session-group-favorites-production').textContent();
    requireCondition(favoriteCount?.includes('favorite 1'), 'desktop CM favorite toggle must update group favorite count');
    let sessionViewPreferenceStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_view_preferences') || '');
    requireCondition(sessionViewPreferenceStorage.includes('Production'), 'desktop CM session view preferences must persist safe group metadata');
    requireCondition(sessionViewPreferenceStorage.includes('"favorite":true'), 'desktop CM session view preferences must persist favorite metadata');
    for (const forbiddenField of ['credentialAvailable', 'runtimeStatus', 'diagnosticMessage', 'serverUrl', 'adminToken', 'BEGIN OPENSSH PRIVATE KEY']) {
      requireCondition(!sessionViewPreferenceStorage.includes(forbiddenField), `desktop CM session view preferences must not include ${forbiddenField}`);
    }
    await page.getByTestId('desktop-cm-session-search').fill('favorite');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM session search must match favorite preference metadata');
    await page.getByTestId('desktop-cm-session-search-clear').click();
    await page.getByTestId('desktop-cm-session-group-toggle-production').click();
    await page.getByTestId('desktop-cm-session-group-items-production').waitFor({ state: 'hidden', timeout: 10_000 });
    sessionViewPreferenceStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_view_preferences') || '');
    requireCondition(sessionViewPreferenceStorage.includes('collapsedGroups'), 'desktop CM session view preferences must persist collapsed group UI state');
    await page.getByTestId('desktop-cm-session-layout-empty').waitFor({ state: 'visible', timeout: 10_000 });
    const initialLayoutEmptyText = await page.getByTestId('desktop-cm-session-layout-empty').textContent();
    requireCondition(initialLayoutEmptyText?.includes('저장된 session layout 없음') && initialLayoutEmptyText.includes('현재 layout 저장'), 'desktop CM session layout initial empty state must explain safe save action');
    await page.getByTestId('desktop-cm-session-layout-folder').fill('Runbooks');
    await page.getByTestId('desktop-cm-session-layout-name').fill('Ops View');
    await page.getByTestId('desktop-cm-session-layout-save').click();
    await page.getByTestId('desktop-cm-session-layout-folder-runbooks').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-ops-view').waitFor({ state: 'visible', timeout: 10_000 });
    const sessionLayoutFolderCount = await page.getByTestId('desktop-cm-session-layout-folder-count-runbooks').textContent();
    requireCondition(sessionLayoutFolderCount?.includes('1 / 1'), 'desktop CM session layout folder count must show saved layout presets');
    let sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('Ops View'), 'desktop CM session layout save must persist safe layout metadata');
    requireCondition(sessionLayoutStorage.includes('"folder":"Runbooks"'), 'desktop CM session layout save must persist safe folder metadata');
    requireCondition(sessionLayoutStorage.includes('collapsedGroups'), 'desktop CM session layout save must persist collapsed group preferences');
    requireCondition(sessionLayoutStorage.includes('"favorite":true'), 'desktop CM session layout save must persist favorite preferences');
    requireCondition(!sessionLayoutStorage.includes('cm.example.internal'), 'desktop CM session layout preset must not include session endpoint metadata');
    for (const forbiddenField of ['host', 'remoteApiHost', 'credentialAvailable', 'runtimeStatus', 'diagnosticMessage', 'serverUrl', 'adminToken', 'BEGIN OPENSSH PRIVATE KEY']) {
      requireCondition(!sessionLayoutStorage.includes(forbiddenField), `desktop CM session layout preset must not include ${forbiddenField}`);
    }
    let sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 1'), 'desktop CM session layout search count must show all saved layouts by default');
    await page.getByTestId('desktop-cm-session-layout-search').fill('runbooks');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 1'), 'desktop CM session layout search must match saved layout folder metadata');
    await page.getByTestId('desktop-cm-session-layout-search-clear').click();
    await page.getByTestId('desktop-cm-session-layout-folder-toggle-runbooks').click();
    await page.getByTestId('desktop-cm-session-layout-folder-items-runbooks').waitFor({ state: 'hidden', timeout: 10_000 });
    let sessionLayoutCollapsedFolderStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_collapsed_folders') || '');
    requireCondition(sessionLayoutCollapsedFolderStorage.includes('Runbooks'), 'desktop CM session layout folder collapse preference must persist separately');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('collapsed_folders'), 'desktop CM session layout folder collapse preference must stay out of layout presets');
    await page.getByTestId('desktop-cm-session-layout-folder-toggle-runbooks').click();
    await page.getByTestId('desktop-cm-session-layout-folder-items-runbooks').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-folder-input-ops-view').fill('Primary');
    await page.getByTestId('desktop-cm-session-layout-folder-input-ops-view').press('Enter');
    await page.getByTestId('desktop-cm-session-layout-folder-primary').waitFor({ state: 'visible', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('"folder":"Primary"'), 'desktop CM session layout folder edit must update preset folder metadata');
    await page.getByTestId('desktop-cm-session-layout-search').fill('production');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 1'), 'desktop CM session layout search must match saved layout group metadata');
    await page.getByTestId('desktop-cm-session-layout-search').fill('no-layout-match');
    await page.getByTestId('desktop-cm-session-layout-search-empty').waitFor({ state: 'visible', timeout: 10_000 });
    const searchEmptyText = await page.getByTestId('desktop-cm-session-layout-search-empty').textContent();
    requireCondition(searchEmptyText?.includes('no-layout-match') && searchEmptyText.includes('folder=all'), 'desktop CM session layout search empty state must show safe search context');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('0 / 전체 1'), 'desktop CM session layout search must show empty state for no matches');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('no-layout-match') && !sessionLayoutStorage.includes('sessionLayoutSearch'), 'desktop CM session layout search query must stay memory-only');
    await page.getByTestId('desktop-cm-session-layout-search-clear').click();
    await page.getByTestId('desktop-cm-session-layout-ops-view').waitFor({ state: 'visible', timeout: 10_000 });
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 1'), 'desktop CM session layout search clear must restore saved layouts');
    await page.getByTestId('desktop-cm-session-layout-rename-ops-view').click();
    await page.getByTestId('desktop-cm-session-layout-rename-input-ops-view').fill('Ops Primary');
    await page.getByTestId('desktop-cm-session-layout-rename-save-ops-view').click();
    await page.getByTestId('desktop-cm-session-layout-ops-primary').waitFor({ state: 'visible', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('Ops Primary'), 'desktop CM session layout rename must update only preset name metadata');
    requireCondition(sessionLayoutStorage.includes('collapsedGroups') && sessionLayoutStorage.includes('"favorite":true'), 'desktop CM session layout rename must preserve saved layout preferences');
    requireCondition(
      !sessionLayoutStorage.includes('sessionLayoutRenameTargetName') &&
        !sessionLayoutStorage.includes('sessionLayoutRenameDraftName') &&
        !sessionLayoutStorage.includes('layout 이름 중복'),
      'desktop CM session layout rename draft must stay memory-only'
    );
    await page.getByTestId('desktop-cm-session-layout-search').fill('primary');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 1'), 'desktop CM session layout search must match renamed layout metadata');
    await page.getByTestId('desktop-cm-session-layout-search-clear').click();
    await page.getByTestId('desktop-cm-session-layout-rename-ops-primary').click();
    await page.getByTestId('desktop-cm-session-layout-rename-input-ops-primary').fill('Ops View');
    await page.getByTestId('desktop-cm-session-layout-rename-save-ops-primary').click();
    await page.getByTestId('desktop-cm-session-layout-ops-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-duplicate-ops-view').click();
    await page.getByTestId('desktop-cm-session-layout-ops-view-copy').waitFor({ state: 'visible', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('Ops View copy'), 'desktop CM session layout duplicate must create a copy with safe layout metadata');
    requireCondition(sessionLayoutStorage.includes('"folder":"Primary"'), 'desktop CM session layout duplicate must preserve folder metadata');
    requireCondition(sessionLayoutStorage.includes('collapsedGroups') && sessionLayoutStorage.includes('"favorite":true'), 'desktop CM session layout duplicate must preserve saved layout preferences');
    requireCondition(!sessionLayoutStorage.includes('cm.example.internal'), 'desktop CM session layout duplicate must not include session endpoint metadata');
    for (const forbiddenField of ['host', 'remoteApiHost', 'credentialAvailable', 'runtimeStatus', 'diagnosticMessage', 'serverUrl', 'adminToken', 'BEGIN OPENSSH PRIVATE KEY']) {
      requireCondition(!sessionLayoutStorage.includes(forbiddenField), `desktop CM session layout duplicate must not include ${forbiddenField}`);
    }
    const primaryPresetOrderBefore = await page.evaluate(() =>
      [...document.querySelectorAll('#desktop-cm-session-layout-folder-items-primary > span[data-testid^="desktop-cm-session-layout-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-', '') || '')
        .filter(Boolean)
    );
    requireCondition(primaryPresetOrderBefore.length === 2, 'desktop CM session layout preset keyboard reorder smoke must start with two presets in one folder');
    const firstPrimaryPresetSlug = primaryPresetOrderBefore[0];
    const firstPrimaryPresetReorderUpDisabled = await page.getByTestId(`desktop-cm-session-layout-reorder-up-${firstPrimaryPresetSlug}`).getAttribute('disabled');
    const firstPrimaryPresetReorderUpTitle = await page.getByTestId(`desktop-cm-session-layout-reorder-up-${firstPrimaryPresetSlug}`).getAttribute('title');
    const firstPrimaryPresetReorderUpDescription = await page.getByTestId(`desktop-cm-session-layout-reorder-up-${firstPrimaryPresetSlug}`).getAttribute('aria-describedby');
    requireCondition(
      firstPrimaryPresetReorderUpDisabled !== null &&
        firstPrimaryPresetReorderUpTitle?.includes('already first') &&
        firstPrimaryPresetReorderUpDescription?.includes('desktop-cm-session-layout-reorder-disabled-description') &&
        firstPrimaryPresetReorderUpDescription.includes('desktop-cm-session-layout-reorder-disabled-reason'),
      'desktop CM session layout preset edge disabled state must describe first-position reason'
    );
    const presetDragHandleShortcuts = await page.getByTestId(`desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`).getAttribute('aria-keyshortcuts');
    requireCondition(
      presetDragHandleShortcuts?.includes('ArrowDown') && presetDragHandleShortcuts.includes('Home') && presetDragHandleShortcuts.includes('End'),
      'desktop CM session layout preset drag handle must expose keyboard reorder shortcuts'
    );
    const presetDragHandleDescription = await page.getByTestId(`desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`).getAttribute('aria-describedby');
    requireCondition(
      presetDragHandleDescription?.includes('desktop-cm-session-layout-reorder-focus-description') &&
        presetDragHandleDescription.includes('desktop-cm-session-layout-reorder-focus-status'),
      'desktop CM session layout preset drag handle must describe reorder focus restoration'
    );
    await page.getByTestId(`desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`).focus();
    await page.keyboard.press('ArrowDown');
    await requireTestIdFocused(
      page,
      `desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`,
      'desktop CM session layout preset keyboard reorder must restore preset drag handle focus after ArrowDown'
    );
    let primaryPresetOrderAfter = await page.evaluate(() =>
      [...document.querySelectorAll('#desktop-cm-session-layout-folder-items-primary > span[data-testid^="desktop-cm-session-layout-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-', '') || '')
        .filter(Boolean)
    );
    requireCondition(primaryPresetOrderAfter[1] === firstPrimaryPresetSlug, 'desktop CM session layout preset keyboard ArrowDown must move first preset down');
    let layoutReorderKeyboardStatus = await page.getByTestId('desktop-cm-session-layout-reorder-keyboard-status').textContent();
    requireCondition(
      layoutReorderKeyboardStatus?.includes('Reorder complete') &&
        layoutReorderKeyboardStatus.includes('moved down') &&
        layoutReorderKeyboardStatus.includes('position 2 of 2'),
      'desktop CM session layout reorder keyboard live status must announce preset move with position'
    );
    await requireTestIdTextIncludes(page, 'desktop-cm-session-layout-reorder-focus-status', 'layout drag handle');
    let layoutReorderFocusStatus = await page.getByTestId('desktop-cm-session-layout-reorder-focus-status').textContent();
    await page.getByTestId('desktop-cm-session-layout-reorder-history').waitFor({ state: 'visible', timeout: 10_000 });
    let layoutReorderHistoryText = await page.getByTestId('desktop-cm-session-layout-reorder-history').textContent();
    let layoutReorderHistoryLatest = await page.getByTestId('desktop-cm-session-layout-reorder-history-latest').textContent();
    requireCondition(
      layoutReorderHistoryText?.includes('Preset') &&
        layoutReorderHistoryText.includes('Reorder complete') &&
        layoutReorderHistoryText.includes('position 2 of 2') &&
        layoutReorderHistoryLatest?.includes('Focus restored'),
      'desktop CM session layout reorder history must include preset status and newest summary'
    );
    requireCondition(
      layoutReorderFocusStatus?.includes('layout drag handle') &&
        !layoutReorderFocusStatus.includes(`desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`),
      'desktop CM session layout reorder focus status must announce human-readable preset handle restoration'
    );
    requireCondition(
      layoutReorderHistoryText?.includes('Focus restored') &&
        !layoutReorderHistoryText.includes(`desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`),
      'desktop CM session layout reorder history must include focus restoration'
    );
    const layoutReorderHistoryLatestAge = await page.getByTestId('desktop-cm-session-layout-reorder-history-latest-age').textContent();
    const layoutReorderHistoryAge = await page.getByTestId('desktop-cm-session-layout-reorder-history-age').first().textContent();
    const layoutReorderHistoryTime = page.getByTestId('desktop-cm-session-layout-reorder-history-time').first();
    const layoutReorderHistoryDateTime = await layoutReorderHistoryTime.getAttribute('dateTime');
    const layoutReorderHistoryTitle = await layoutReorderHistoryTime.getAttribute('title');
    const layoutReorderHistoryAria = await layoutReorderHistoryTime.getAttribute('aria-label');
    requireCondition(
      (layoutReorderHistoryLatestAge?.includes('just now') || /\d+s ago/.test(layoutReorderHistoryLatestAge || '')) &&
        (layoutReorderHistoryAge?.includes('just now') || /\d+s ago/.test(layoutReorderHistoryAge || '')) &&
        Boolean(layoutReorderHistoryDateTime && /^\d{4}-\d{2}-\d{2}T/.test(layoutReorderHistoryDateTime)) &&
        Boolean(layoutReorderHistoryTitle && layoutReorderHistoryTitle !== 'timestamp unknown') &&
        Boolean(layoutReorderHistoryAria?.includes('Recorded')),
      'desktop CM session layout reorder history timestamp must expose relative age and exact time'
    );
    const layoutReorderHistoryRegion = page.getByTestId('desktop-cm-session-layout-reorder-history');
    const layoutReorderHistoryRole = await layoutReorderHistoryRegion.getAttribute('role');
    const layoutReorderHistoryLabelledBy = await layoutReorderHistoryRegion.getAttribute('aria-labelledby');
    const layoutReorderHistoryDescribedBy = await layoutReorderHistoryRegion.getAttribute('aria-describedby');
    const layoutReorderHistoryDescription = await page.getByTestId('desktop-cm-session-layout-reorder-history-description').textContent();
    const layoutReorderHistoryA11ySummary = page.getByTestId('desktop-cm-session-layout-reorder-history-accessibility-summary');
    const layoutReorderHistoryA11ySummaryText = await layoutReorderHistoryA11ySummary.textContent();
    const layoutReorderHistoryA11ySummaryRole = await layoutReorderHistoryA11ySummary.getAttribute('role');
    const layoutReorderHistoryA11ySummaryLive = await layoutReorderHistoryA11ySummary.getAttribute('aria-live');
    const layoutReorderHistoryA11ySummaryAtomic = await layoutReorderHistoryA11ySummary.getAttribute('aria-atomic');
    const layoutReorderHistoryListLabel = await page.getByTestId('desktop-cm-session-layout-reorder-history-list').getAttribute('aria-label');
    const layoutReorderHistoryRowAria = await page.getByTestId('desktop-cm-session-layout-reorder-history-item-focus').first().getAttribute('aria-label');
    requireCondition(
      layoutReorderHistoryRole === 'region' &&
        layoutReorderHistoryLabelledBy === 'desktop-cm-session-layout-reorder-history-title' &&
        Boolean(layoutReorderHistoryDescribedBy?.includes('desktop-cm-session-layout-reorder-history-description')) &&
        Boolean(layoutReorderHistoryDescribedBy?.includes('desktop-cm-session-layout-reorder-history-accessibility-summary')) &&
        Boolean(layoutReorderHistoryDescription?.includes('newest first')) &&
        layoutReorderHistoryA11ySummaryRole === 'status' &&
        layoutReorderHistoryA11ySummaryLive === 'polite' &&
        layoutReorderHistoryA11ySummaryAtomic === 'true' &&
        Boolean(layoutReorderHistoryA11ySummaryText?.includes('Showing')) &&
        layoutReorderHistoryListLabel === 'Saved layout reorder status history entries, newest first' &&
        Boolean(layoutReorderHistoryRowAria?.includes('Focus reorder status:')) &&
        Boolean(layoutReorderHistoryRowAria?.includes('Recorded')),
      'desktop CM session layout reorder history timestamp accessibility must expose region description and row timestamp label'
    );
    await page.setViewportSize({ width: 360, height: 740 });
    await layoutReorderHistoryRegion.scrollIntoViewIfNeeded();
    const layoutReorderHistoryResponsiveMetrics = await page.evaluate(() => {
      const getByTestId = (testId) => document.querySelector(`[data-testid="${testId}"]`);
      const region = getByTestId('desktop-cm-session-layout-reorder-history');
      const toolbar = getByTestId('desktop-cm-session-layout-reorder-history-toolbar');
      const latest = getByTestId('desktop-cm-session-layout-reorder-history-latest');
      const message = getByTestId('desktop-cm-session-layout-reorder-history-message');
      const meta = getByTestId('desktop-cm-session-layout-reorder-history-meta');
      const time = getByTestId('desktop-cm-session-layout-reorder-history-time');
      const scopeFilter = getByTestId('desktop-cm-session-layout-reorder-history-scope-filter');
      const statusFilter = getByTestId('desktop-cm-session-layout-reorder-history-status-filter');
      if (!region || !toolbar || !latest || !message || !meta || !time || !scopeFilter || !statusFilter) {
        return { ok: false };
      }
      const regionRect = region.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const messageStyle = window.getComputedStyle(message);
      const latestStyle = window.getComputedStyle(latest);
      const metaStyle = window.getComputedStyle(meta);
      const scopeRect = scopeFilter.getBoundingClientRect();
      const statusRect = statusFilter.getBoundingClientRect();
      return {
        ok: true,
        regionNoOverflow: region.scrollWidth <= Math.ceil(region.clientWidth) + 1,
        toolbarNoOverflow: toolbar.scrollWidth <= Math.ceil(toolbar.clientWidth) + 1,
        toolbarFitsRegion: toolbarRect.width <= regionRect.width + 1,
        scopeFilterWide: scopeRect.width >= regionRect.width * 0.82,
        statusFilterWide: statusRect.width >= regionRect.width * 0.82,
        latestWraps: latestStyle.whiteSpace !== 'nowrap',
        messageWraps: messageStyle.whiteSpace !== 'nowrap',
        metaWraps: metaStyle.flexWrap === 'wrap',
        timeFitsRegion: time.getBoundingClientRect().width <= regionRect.width,
      };
    });
    requireCondition(
      layoutReorderHistoryResponsiveMetrics.ok === true &&
        layoutReorderHistoryResponsiveMetrics.regionNoOverflow === true &&
        layoutReorderHistoryResponsiveMetrics.toolbarNoOverflow === true &&
        layoutReorderHistoryResponsiveMetrics.toolbarFitsRegion === true &&
        layoutReorderHistoryResponsiveMetrics.scopeFilterWide === true &&
        layoutReorderHistoryResponsiveMetrics.statusFilterWide === true &&
        layoutReorderHistoryResponsiveMetrics.latestWraps === true &&
        layoutReorderHistoryResponsiveMetrics.messageWraps === true &&
        layoutReorderHistoryResponsiveMetrics.metaWraps === true &&
        layoutReorderHistoryResponsiveMetrics.timeFitsRegion === true,
      'desktop CM session layout reorder history timestamp responsive layout must avoid mobile horizontal overflow'
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    const layoutReorderHistoryComfortableDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    const layoutReorderHistoryComfortablePressed = await page.getByTestId('desktop-cm-session-layout-reorder-history-density-comfortable').getAttribute('aria-pressed');
    const layoutReorderHistoryCompactPressedBefore = await page.getByTestId('desktop-cm-session-layout-reorder-history-density-compact').getAttribute('aria-pressed');
    const layoutReorderHistoryComfortableMetrics = await page.getByTestId('desktop-cm-session-layout-reorder-history-item-focus').first().evaluate((element) => {
      const time = element.querySelector('[data-testid="desktop-cm-session-layout-reorder-history-time"]');
      return {
        height: element.getBoundingClientRect().height,
        timeFontSize: time ? Number.parseFloat(window.getComputedStyle(time).fontSize) : 0,
      };
    });
    await page.getByTestId('desktop-cm-session-layout-reorder-history-density-compact').click();
    const layoutReorderHistoryCompactDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    const layoutReorderHistoryCompactPressed = await page.getByTestId('desktop-cm-session-layout-reorder-history-density-compact').getAttribute('aria-pressed');
    const layoutReorderHistoryComfortablePressedAfterCompact = await page.getByTestId('desktop-cm-session-layout-reorder-history-density-comfortable').getAttribute('aria-pressed');
    const layoutReorderHistoryCompactMetrics = await page.getByTestId('desktop-cm-session-layout-reorder-history-item-focus').first().evaluate((element) => {
      const time = element.querySelector('[data-testid="desktop-cm-session-layout-reorder-history-time"]');
      return {
        height: element.getBoundingClientRect().height,
        timeFontSize: time ? Number.parseFloat(window.getComputedStyle(time).fontSize) : 0,
      };
    });
    await page.getByTestId('desktop-cm-session-layout-reorder-history-density-comfortable').click();
    const layoutReorderHistoryRestoredDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    const layoutReorderHistoryRestoredPressed = await page.getByTestId('desktop-cm-session-layout-reorder-history-density-comfortable').getAttribute('aria-pressed');
    requireCondition(
      layoutReorderHistoryComfortableDensity === 'comfortable' &&
        layoutReorderHistoryComfortablePressed === 'true' &&
        layoutReorderHistoryCompactPressedBefore === 'false' &&
        layoutReorderHistoryCompactDensity === 'compact' &&
        layoutReorderHistoryCompactPressed === 'true' &&
        layoutReorderHistoryComfortablePressedAfterCompact === 'false' &&
        layoutReorderHistoryCompactMetrics.height < layoutReorderHistoryComfortableMetrics.height &&
        layoutReorderHistoryCompactMetrics.timeFontSize < layoutReorderHistoryComfortableMetrics.timeFontSize &&
        layoutReorderHistoryRestoredDensity === 'comfortable' &&
        layoutReorderHistoryRestoredPressed === 'true',
      'desktop CM session layout reorder history timestamp density must toggle compact rows without persistence'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').click();
    let layoutReorderHistoryScopeValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-scope-filter').inputValue();
    let layoutReorderHistoryStatusValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').inputValue();
    let layoutReorderHistoryPresetDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    let layoutReorderHistoryPresetActive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').getAttribute('aria-pressed');
    let layoutReorderHistoryPresetCount = await page.getByTestId('desktop-cm-session-layout-reorder-history-count').textContent();
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-focus-compact').click();
    const layoutReorderHistoryFocusScopeValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-scope-filter').inputValue();
    const layoutReorderHistoryFocusStatusValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').inputValue();
    const layoutReorderHistoryFocusDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    const layoutReorderHistoryFocusPresetActive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-focus-compact').getAttribute('aria-pressed');
    const layoutReorderHistoryFocusPresetCount = await page.getByTestId('desktop-cm-session-layout-reorder-history-count').textContent();
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-all-comfortable').click();
    const layoutReorderHistoryAllScopeValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-scope-filter').inputValue();
    const layoutReorderHistoryAllStatusValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').inputValue();
    const layoutReorderHistoryAllDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    const layoutReorderHistoryAllPresetActive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-all-comfortable').getAttribute('aria-pressed');
    const layoutReorderHistoryPresetGroupDescription = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-presets').getAttribute('aria-describedby');
    const layoutReorderHistoryPresetDescription = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-description').textContent();
    const layoutReorderHistoryPresetSummary = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-summary').textContent();
    const layoutReorderHistoryPresetSummaryRole = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-summary').getAttribute('role');
    const layoutReorderHistoryPresetSummaryLive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-summary').getAttribute('aria-live');
    const layoutReorderHistoryPresetSummaryAtomic = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-summary').getAttribute('aria-atomic');
    const layoutReorderHistoryPresetKeyboardDescription = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-description').textContent();
    const layoutReorderHistoryPresetShortcutHint = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-shortcut-hint').textContent();
    const layoutReorderHistoryPresetDiscoverabilityHintVisible = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').isVisible();
    const layoutReorderHistoryPresetDiscoverabilityHintTitle = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('title');
    const layoutReorderHistoryPresetDiscoverabilityHintLabel = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('aria-label');
    const layoutReorderHistoryPresetDiscoverabilityHintType = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('type');
    const layoutReorderHistoryPresetDiscoverabilityHintShortcuts = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('aria-keyshortcuts');
    const layoutReorderHistoryPresetDiscoverabilityHintDescribedBy = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('aria-describedby');
    const layoutReorderHistoryPresetDiscoverabilityHintFocusVisible = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('data-focus-visible');
    const layoutReorderHistoryPresetDiscoverabilityHintFocusVisibleVisual = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .getAttribute('data-focus-visible-visual');
    const layoutReorderHistoryPresetDiscoverabilityHintVisualRegression = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .getAttribute('data-visual-regression');
    const layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionToken = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .getAttribute('data-visual-regression-token');
    const layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionIdleState = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .getAttribute('data-visual-regression-state');
    const layoutReorderHistoryPresetDiscoverabilityHintClass = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').getAttribute('class');
    const layoutReorderHistoryPresetHelpIdleStyles = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          boxShadow: style.boxShadow,
          color: style.color,
          height: Math.round(box.height),
          transform: style.transform,
          width: Math.round(box.width),
        };
      });
    const layoutReorderHistoryPresetHelpTooltipRole = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').getAttribute('role');
    const layoutReorderHistoryPresetHelpTooltipText = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').textContent();
    const layoutReorderHistoryPresetHelpTooltipPlacement = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').getAttribute('data-placement');
    const layoutReorderHistoryPresetHelpTooltipContrast = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').getAttribute('data-contrast');
    const layoutReorderHistoryPresetHelpTooltipContrastMinRatio = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip')
      .getAttribute('data-contrast-min-ratio');
    const layoutReorderHistoryPresetHelpTooltipContrastDescription = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-contrast-description')
      .textContent();
    const layoutReorderHistoryPresetHelpTooltipFocusVisibleDescription = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-focus-visible-description')
      .textContent();
    const layoutReorderHistoryPresetHelpTooltipClass = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').getAttribute('class');
    const layoutReorderHistoryPresetHelpTooltipStyles = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          color: style.color,
        };
      });
    const layoutReorderHistoryPresetHelpTooltipContrastRatio = contrastRatio(
      layoutReorderHistoryPresetHelpTooltipStyles.color,
      layoutReorderHistoryPresetHelpTooltipStyles.backgroundColor,
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').hover();
    const layoutReorderHistoryPresetHelpTooltipVisibleOnHover = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').isVisible();
    const layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionHoverState = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .getAttribute('data-visual-regression-state');
    const layoutReorderHistoryPresetHelpHoverStyles = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          boxShadow: style.boxShadow,
          color: style.color,
          transform: style.transform,
        };
      });
    const originalViewportSize = page.viewportSize() || { width: 1280, height: 720 };
    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').scrollIntoViewIfNeeded();
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').hover();
    const layoutReorderHistoryPresetHelpTooltipNarrowBox = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').boundingBox();
    const layoutReorderHistoryPresetHelpTooltipNarrowViewport = page.viewportSize();
    const layoutReorderHistoryPresetHelpTooltipFitsNarrowViewport =
      Boolean(layoutReorderHistoryPresetHelpTooltipNarrowBox && layoutReorderHistoryPresetHelpTooltipNarrowViewport) &&
      layoutReorderHistoryPresetHelpTooltipNarrowBox.x >= 8 &&
      layoutReorderHistoryPresetHelpTooltipNarrowBox.x + layoutReorderHistoryPresetHelpTooltipNarrowBox.width <=
        (layoutReorderHistoryPresetHelpTooltipNarrowViewport?.width || 0) - 8;
    await page.setViewportSize(originalViewportSize);
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.getByTestId('desktop-cm-session-layout-reorder-history-density-compact').focus();
    await page.keyboard.press('Tab');
    await requireTestIdFocused(
      page,
      'desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint',
      'desktop CM session layout reorder history timestamp filter preset help focus-visible keyboard smoke must tab to help button'
    );
    await page
      .waitForFunction(() => {
        const element = document.querySelector('[data-testid="desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint"]');
        if (!element?.matches(':focus-visible')) {
          return false;
        }
        const style = window.getComputedStyle(element);
        return (
          style.backgroundColor === 'rgb(248, 252, 255)' &&
          style.borderTopColor === 'rgb(15, 79, 104)' &&
          style.color === 'rgb(15, 79, 104)' &&
          style.boxShadow !== 'none' &&
          (style.transform !== 'none' || !['', 'none', '1'].includes(style.scale))
        );
      }, null, { timeout: 1500 })
      .catch(() => undefined);
    const layoutReorderHistoryPresetHelpKeyboardFocusStyles = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          boxShadow: style.boxShadow,
          color: style.color,
          focusVisible: element.matches(':focus-visible'),
          height: Math.round(box.height),
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          scale: style.scale,
          transform: style.transform,
          width: Math.round(box.width),
        };
      });
    const layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionFocusState = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .getAttribute('data-visual-regression-state');
    const layoutReorderHistoryPresetHelpTooltipVisibleAfterKeyboardTab = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip')
      .isVisible();
    const layoutReorderHistoryPresetHelpButtonBox = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint')
      .boundingBox();
    const layoutReorderHistoryPresetHelpTooltipFocusedBox = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip')
      .boundingBox();
    const layoutReorderHistoryPresetHelpScreenshotClip = buildScreenshotClip(
      [layoutReorderHistoryPresetHelpButtonBox, layoutReorderHistoryPresetHelpTooltipFocusedBox],
      page.viewportSize(),
      8,
    );
    const layoutReorderHistoryPresetHelpScreenshotPath = path.join(
      desktopSmokeOutputDir,
      'desktop-cm-focus-visible-help-tooltip.png',
    );
    const layoutReorderHistoryPresetHelpScreenshotMetadataPath = path.join(
      desktopSmokeOutputDir,
      'desktop-cm-focus-visible-help-tooltip.metadata.json',
    );
    const desktopSmokeArtifactHygieneSentinelPath = path.join(
      desktopSmokeOutputDir,
      'desktop-cm-artifact-hygiene-sentinel.keep',
    );
    await mkdir(desktopSmokeOutputDir, { recursive: true });
    await writeFile(
      desktopSmokeArtifactHygieneSentinelPath,
      'kuviewer desktop smoke artifact hygiene sentinel\n',
      'utf8',
    );
    const desktopSmokeArtifactFileNamesBeforeKnownCleanup = await listDesktopSmokeArtifactFileNames(desktopSmokeOutputDir);
    const cleanedDesktopSmokeScreenshotPaths = await cleanDesktopSmokeScreenshotArtifacts(desktopSmokeOutputDir);
    const layoutReorderHistoryPresetHelpScreenshotExistsAfterCleanup = await fileExists(layoutReorderHistoryPresetHelpScreenshotPath);
    const layoutReorderHistoryPresetHelpScreenshotMetadataExistsAfterCleanup = await fileExists(
      layoutReorderHistoryPresetHelpScreenshotMetadataPath,
    );
    const desktopSmokeArtifactHygieneSentinelExistsAfterInitialCleanup = await fileExists(
      desktopSmokeArtifactHygieneSentinelPath,
    );
    await page.screenshot({
      animations: 'disabled',
      clip: layoutReorderHistoryPresetHelpScreenshotClip,
      path: layoutReorderHistoryPresetHelpScreenshotPath,
    });
    const layoutReorderHistoryPresetHelpScreenshot = await readPngMetadata(layoutReorderHistoryPresetHelpScreenshotPath);
    const layoutReorderHistoryPresetHelpScreenshotMetadata = buildScreenshotMetadata({
      clip: layoutReorderHistoryPresetHelpScreenshotClip,
      fileName: path.basename(layoutReorderHistoryPresetHelpScreenshotPath),
      image: layoutReorderHistoryPresetHelpScreenshot,
      marker: 'desktop-cm-session-layout-reorder-history-filter-preset-help-focus-visible',
      token: 'solid-highlight-v1',
    });
    await writeFile(
      layoutReorderHistoryPresetHelpScreenshotMetadataPath,
      `${JSON.stringify(layoutReorderHistoryPresetHelpScreenshotMetadata, null, 2)}\n`,
      'utf8',
    );
    const layoutReorderHistoryPresetHelpScreenshotMetadataReadback = JSON.parse(
      await readFile(layoutReorderHistoryPresetHelpScreenshotMetadataPath, 'utf8'),
    );
    const layoutReorderHistoryPresetHelpScreenshotMetadataText = JSON.stringify(
      layoutReorderHistoryPresetHelpScreenshotMetadataReadback,
    );
    const layoutReorderHistoryPresetHelpKeyboardFocusStatus = await page
      .getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status')
      .textContent();
    const sessionLayoutStorageAfterPresetHints = await page.evaluate(() => localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    const sessionLayoutStorageVisualRegressionLeakCount = await page.evaluate(() => {
      const needle = /visual-regression|solid-highlight-v1|desktop-cm-session-layout-reorder-history-filter-preset-help-focus-visible/i;
      return [...Object.entries(localStorage), ...Object.entries(sessionStorage)].filter(([key, value]) => needle.test(`${key} ${value}`)).length;
    });
    const layoutReorderHistoryPresetKeyboardStatusRole = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status').getAttribute('role');
    const layoutReorderHistoryPresetKeyboardStatusLive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status').getAttribute('aria-live');
    const layoutReorderHistoryPresetKeyboardStatusAtomic = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status').getAttribute('aria-atomic');
    const layoutReorderHistoryCompletePresetLabel = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').getAttribute('aria-label');
    const layoutReorderHistoryCompletePresetTitle = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').getAttribute('title');
    const layoutReorderHistoryCompletePresetShortcuts = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').getAttribute('aria-keyshortcuts');
    const layoutReorderHistoryFocusPresetLabel = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-focus-compact').getAttribute('aria-label');
    requireCondition(
      layoutReorderHistoryScopeValue === 'all' &&
        layoutReorderHistoryStatusValue === 'reorder-complete' &&
        layoutReorderHistoryPresetDensity === 'compact' &&
        layoutReorderHistoryPresetActive === 'true' &&
        layoutReorderHistoryPresetCount?.includes('1 / 전체 2') &&
        layoutReorderHistoryFocusScopeValue === 'focus' &&
        layoutReorderHistoryFocusStatusValue === 'focus-restored' &&
        layoutReorderHistoryFocusDensity === 'compact' &&
        layoutReorderHistoryFocusPresetActive === 'true' &&
        layoutReorderHistoryFocusPresetCount?.includes('1 / 전체 2') &&
        layoutReorderHistoryAllScopeValue === 'all' &&
        layoutReorderHistoryAllStatusValue === 'all' &&
        layoutReorderHistoryAllDensity === 'comfortable' &&
        layoutReorderHistoryAllPresetActive === 'true',
      'desktop CM session layout reorder history timestamp filter presets must apply scope status and density without persistence'
    );
    requireCondition(
      layoutReorderHistoryPresetGroupDescription?.includes('desktop-cm-session-layout-reorder-history-filter-preset-description') &&
        layoutReorderHistoryPresetGroupDescription.includes('desktop-cm-session-layout-reorder-history-filter-preset-summary') &&
        layoutReorderHistoryPresetDescription?.includes('safe scope, status, and density') &&
        layoutReorderHistoryPresetDescription.includes('browser memory only') &&
        layoutReorderHistoryPresetSummary?.includes('Active reorder history preset All') &&
        layoutReorderHistoryPresetSummary.includes('All scopes') &&
        layoutReorderHistoryPresetSummary.includes('Comfortable density') &&
        layoutReorderHistoryPresetSummaryRole === 'status' &&
        layoutReorderHistoryPresetSummaryLive === 'polite' &&
        layoutReorderHistoryPresetSummaryAtomic === 'true' &&
        layoutReorderHistoryPresetKeyboardDescription?.includes('arrow keys') &&
        layoutReorderHistoryPresetKeyboardDescription.includes('Home') &&
        layoutReorderHistoryPresetKeyboardDescription.includes('End') &&
        layoutReorderHistoryPresetKeyboardDescription.includes('Enter or Space') &&
        layoutReorderHistoryPresetShortcutHint?.includes('Shortcut hint') &&
        layoutReorderHistoryPresetShortcutHint.includes('Arrow keys') &&
        layoutReorderHistoryPresetShortcutHint.includes('Enter or Space') &&
        layoutReorderHistoryPresetKeyboardStatusRole === 'status' &&
        layoutReorderHistoryPresetKeyboardStatusLive === 'polite' &&
        layoutReorderHistoryPresetKeyboardStatusAtomic === 'true' &&
        layoutReorderHistoryCompletePresetLabel?.includes('Apply Complete reorder history preset') &&
        layoutReorderHistoryCompletePresetLabel.includes('2 of 4') &&
        layoutReorderHistoryCompletePresetLabel.includes('Reorder complete') &&
        layoutReorderHistoryCompletePresetLabel.includes('Compact density') &&
        layoutReorderHistoryCompletePresetLabel.includes('Arrow keys move') &&
        layoutReorderHistoryCompletePresetTitle?.includes('Shortcuts: Arrow keys, Home, End, Enter, Space') &&
        layoutReorderHistoryCompletePresetShortcuts?.includes('ArrowLeft') &&
        layoutReorderHistoryCompletePresetShortcuts.includes('ArrowRight') &&
        layoutReorderHistoryCompletePresetShortcuts.includes('Home') &&
        layoutReorderHistoryCompletePresetShortcuts.includes('End') &&
        layoutReorderHistoryCompletePresetShortcuts.includes('Enter') &&
        layoutReorderHistoryCompletePresetShortcuts.includes('Space') &&
        layoutReorderHistoryFocusPresetLabel?.includes('Apply Focus reorder history preset') &&
        layoutReorderHistoryFocusPresetLabel.includes('3 of 4') &&
        layoutReorderHistoryFocusPresetLabel.includes('Focus restored') &&
        layoutReorderHistoryFocusPresetLabel.includes('Compact density'),
      'desktop CM session layout reorder history timestamp filter preset accessibility must expose help summary and button labels'
    );
    requireCondition(
      layoutReorderHistoryPresetGroupDescription?.includes('desktop-cm-session-layout-reorder-history-filter-preset-shortcut-hint') &&
        layoutReorderHistoryPresetGroupDescription.includes('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint') &&
        layoutReorderHistoryPresetGroupDescription.includes('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip') &&
        layoutReorderHistoryPresetGroupDescription.includes('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-contrast-description') &&
        layoutReorderHistoryPresetGroupDescription.includes('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-focus-visible-description') &&
        layoutReorderHistoryPresetShortcutHint?.includes('Shortcut hint') &&
        layoutReorderHistoryPresetShortcutHint.includes('Home and End') &&
        layoutReorderHistoryCompletePresetLabel?.includes('Arrow keys move') &&
        layoutReorderHistoryCompletePresetTitle?.includes('Shortcuts: Arrow keys, Home, End, Enter, Space') &&
        layoutReorderHistoryCompletePresetShortcuts === 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter Space',
      'desktop CM session layout reorder history timestamp filter preset shortcut hints must expose hidden hint title and aria-keyshortcuts without persistence'
    );
    requireCondition(
      layoutReorderHistoryPresetDiscoverabilityHintVisible &&
        layoutReorderHistoryPresetDiscoverabilityHintType === 'button' &&
        layoutReorderHistoryPresetDiscoverabilityHintShortcuts === 'Enter Space' &&
        layoutReorderHistoryPresetDiscoverabilityHintTitle?.includes('Preset help for All') &&
        layoutReorderHistoryPresetDiscoverabilityHintTitle.includes('arrow keys move between presets') &&
        layoutReorderHistoryPresetDiscoverabilityHintTitle.includes('help button focuses the active preset') &&
        layoutReorderHistoryPresetDiscoverabilityHintTitle.includes('UI-only') &&
        layoutReorderHistoryPresetDiscoverabilityHintLabel === layoutReorderHistoryPresetDiscoverabilityHintTitle &&
        layoutReorderHistoryPresetDiscoverabilityHintDescribedBy?.includes('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-focus-visible-description') &&
        layoutReorderHistoryPresetDiscoverabilityHintFocusVisible === 'high-safe-ring' &&
        layoutReorderHistoryPresetDiscoverabilityHintFocusVisibleVisual === 'solid-highlight' &&
        layoutReorderHistoryPresetDiscoverabilityHintVisualRegression === 'desktop-cm-session-layout-reorder-history-filter-preset-help-focus-visible' &&
        layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionToken === 'solid-highlight-v1' &&
        layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionIdleState === 'idle' &&
        layoutReorderHistoryPresetDiscoverabilityHintClass?.includes('ku-focus-visible-solid-highlight') &&
        layoutReorderHistoryPresetDiscoverabilityHintClass.includes('focus-visible:outline-[#0f4f68]') &&
        layoutReorderHistoryPresetDiscoverabilityHintClass.includes('focus-visible:ring-2') &&
        layoutReorderHistoryPresetDiscoverabilityHintClass.includes('focus-visible:ring-[#8bd3f7]') &&
        layoutReorderHistoryPresetDiscoverabilityHintClass.includes('focus-visible:ring-offset-[#f8fcff]') &&
        layoutReorderHistoryPresetHelpTooltipFocusVisibleDescription?.includes('Focus-visible note') &&
        layoutReorderHistoryPresetHelpTooltipFocusVisibleDescription.includes('high-contrast outline, ring, and offset') &&
        layoutReorderHistoryPresetHelpTooltipFocusVisibleDescription.includes('UI-only and not stored') &&
        !sessionLayoutStorageAfterPresetHints.includes('Preset help') &&
        !sessionLayoutStorageAfterPresetHints.includes('arrow keys move between presets') &&
        !sessionLayoutStorageAfterPresetHints.includes('Focus-visible note'),
      'desktop CM session layout reorder history timestamp filter preset discoverability smoke must expose accessible UI-only visible help with high-contrast focus-visible ring without persistence'
    );
    requireCondition(
      layoutReorderHistoryPresetHelpKeyboardFocusStyles.focusVisible &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.outlineStyle !== 'none' &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.outlineWidth !== '0px' &&
        !['transparent', 'rgba(0, 0, 0, 0)'].includes(layoutReorderHistoryPresetHelpKeyboardFocusStyles.outlineColor) &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.backgroundColor === 'rgb(248, 252, 255)' &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.borderColor === 'rgb(15, 79, 104)' &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.color === 'rgb(15, 79, 104)' &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.boxShadow !== 'none' &&
        (layoutReorderHistoryPresetHelpKeyboardFocusStyles.transform !== 'none' ||
          !['', 'none', '1'].includes(layoutReorderHistoryPresetHelpKeyboardFocusStyles.scale)) &&
        layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionFocusState === 'focus-visible' &&
        layoutReorderHistoryPresetHelpTooltipVisibleAfterKeyboardTab &&
        layoutReorderHistoryPresetHelpKeyboardFocusStatus?.includes('Preset help focused') &&
        layoutReorderHistoryPresetHelpKeyboardFocusStatus.includes('focus the active reorder history preset') &&
        !sessionLayoutStorageAfterPresetHints.includes('focus-visible keyboard smoke') &&
        !sessionLayoutStorageAfterPresetHints.includes('solid-highlight'),
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual polish must verify Tab focus color scale and tooltip without persistence'
    );
    requireCondition(
      layoutReorderHistoryPresetDiscoverabilityHintVisualRegressionHoverState === 'idle' &&
        layoutReorderHistoryPresetHelpIdleStyles.width === 28 &&
        layoutReorderHistoryPresetHelpIdleStyles.height === 28 &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.width >= layoutReorderHistoryPresetHelpIdleStyles.width &&
        layoutReorderHistoryPresetHelpKeyboardFocusStyles.height >= layoutReorderHistoryPresetHelpIdleStyles.height &&
        layoutReorderHistoryPresetHelpIdleStyles.backgroundColor !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.backgroundColor &&
        layoutReorderHistoryPresetHelpIdleStyles.borderColor !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.borderColor &&
        layoutReorderHistoryPresetHelpIdleStyles.color !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.color &&
        layoutReorderHistoryPresetHelpIdleStyles.boxShadow !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.boxShadow &&
        layoutReorderHistoryPresetHelpIdleStyles.transform !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.transform &&
        layoutReorderHistoryPresetHelpHoverStyles.transform !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.transform &&
        layoutReorderHistoryPresetHelpHoverStyles.boxShadow !== layoutReorderHistoryPresetHelpKeyboardFocusStyles.boxShadow &&
        sessionLayoutStorageVisualRegressionLeakCount === 0,
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual regression polish must compare idle hover focus states without storage'
    );
    requireCondition(
      Boolean(layoutReorderHistoryPresetHelpButtonBox) &&
        Boolean(layoutReorderHistoryPresetHelpTooltipFocusedBox) &&
        layoutReorderHistoryPresetHelpScreenshot.isPng &&
        layoutReorderHistoryPresetHelpScreenshot.byteLength > 1500 &&
        layoutReorderHistoryPresetHelpScreenshot.width >= layoutReorderHistoryPresetHelpKeyboardFocusStyles.width &&
        layoutReorderHistoryPresetHelpScreenshot.height >= layoutReorderHistoryPresetHelpKeyboardFocusStyles.height &&
        layoutReorderHistoryPresetHelpScreenshot.width === Math.round(layoutReorderHistoryPresetHelpScreenshotClip.width) &&
        layoutReorderHistoryPresetHelpScreenshot.height === Math.round(layoutReorderHistoryPresetHelpScreenshotClip.height) &&
        layoutReorderHistoryPresetHelpScreenshotClip.width > layoutReorderHistoryPresetHelpIdleStyles.width &&
        layoutReorderHistoryPresetHelpScreenshotClip.height > layoutReorderHistoryPresetHelpIdleStyles.height,
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual regression screenshot polish must capture focused help and tooltip PNG artifact without persistence'
    );
    requireCondition(
      cleanedDesktopSmokeScreenshotPaths.includes(layoutReorderHistoryPresetHelpScreenshotPath) &&
        cleanedDesktopSmokeScreenshotPaths.includes(layoutReorderHistoryPresetHelpScreenshotMetadataPath) &&
        !layoutReorderHistoryPresetHelpScreenshotExistsAfterCleanup &&
        !layoutReorderHistoryPresetHelpScreenshotMetadataExistsAfterCleanup &&
        desktopSmokeScreenshotFileNames.includes('desktop-cm-focus-visible-help-tooltip.png') &&
        desktopSmokeScreenshotMetadataFileNames.includes('desktop-cm-focus-visible-help-tooltip.metadata.json') &&
        layoutReorderHistoryPresetHelpScreenshot.isPng,
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual regression screenshot cleanup polish must remove stale focused help PNG before capture without persistence'
    );
    requireCondition(
      layoutReorderHistoryPresetHelpScreenshotMetadataReadback.schemaVersion === 1 &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.kind === 'kuviewer.desktopCm.visualRegressionScreenshot' &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.fileName === 'desktop-cm-focus-visible-help-tooltip.png' &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.marker === 'desktop-cm-session-layout-reorder-history-filter-preset-help-focus-visible' &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.token === 'solid-highlight-v1' &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.byteLength === layoutReorderHistoryPresetHelpScreenshot.byteLength &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.width === layoutReorderHistoryPresetHelpScreenshot.width &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.height === layoutReorderHistoryPresetHelpScreenshot.height &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.clipWidth === Math.round(layoutReorderHistoryPresetHelpScreenshotClip.width) &&
        layoutReorderHistoryPresetHelpScreenshotMetadataReadback.clipHeight === Math.round(layoutReorderHistoryPresetHelpScreenshotClip.height) &&
        typeof layoutReorderHistoryPresetHelpScreenshotMetadataReadback.capturedAt === 'string' &&
        !/(https?:|admin_token|access_token|refresh_token|bearer|credential|private|secret|kubeconfig|BEGIN )/i.test(
          layoutReorderHistoryPresetHelpScreenshotMetadataText,
        ),
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual regression screenshot metadata polish must write safe artifact sidecar without secrets'
    );
    const finalCleanedDesktopSmokeScreenshotPaths = await cleanDesktopSmokeScreenshotArtifacts(desktopSmokeOutputDir);
    const layoutReorderHistoryPresetHelpScreenshotExistsAfterFinalCleanup = await fileExists(
      layoutReorderHistoryPresetHelpScreenshotPath,
    );
    const layoutReorderHistoryPresetHelpScreenshotMetadataExistsAfterFinalCleanup = await fileExists(
      layoutReorderHistoryPresetHelpScreenshotMetadataPath,
    );
    const desktopSmokeArtifactHygieneSentinelExistsAfterFinalKnownCleanup = await fileExists(
      desktopSmokeArtifactHygieneSentinelPath,
    );
    const desktopSmokeArtifactFileNamesAfterFinalKnownCleanup = await listDesktopSmokeArtifactFileNames(desktopSmokeOutputDir);
    const cleanedDesktopSmokeArtifactHygienePaths = await cleanDesktopSmokeArtifactHygieneSentinels(desktopSmokeOutputDir);
    const desktopSmokeArtifactFileNamesAfterHygieneCleanup = await listDesktopSmokeArtifactFileNames(desktopSmokeOutputDir);
    requireCondition(
      finalCleanedDesktopSmokeScreenshotPaths.includes(layoutReorderHistoryPresetHelpScreenshotPath) &&
        finalCleanedDesktopSmokeScreenshotPaths.includes(layoutReorderHistoryPresetHelpScreenshotMetadataPath) &&
        !layoutReorderHistoryPresetHelpScreenshotExistsAfterFinalCleanup &&
        !layoutReorderHistoryPresetHelpScreenshotMetadataExistsAfterFinalCleanup,
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual regression screenshot metadata cleanup polish must remove focused help PNG and safe sidecar after verification without persistence'
    );
    requireCondition(
      desktopSmokeArtifactFileNamesBeforeKnownCleanup.includes('desktop-cm-artifact-hygiene-sentinel.keep') &&
        desktopSmokeArtifactHygieneSentinelExistsAfterInitialCleanup &&
        desktopSmokeArtifactHygieneSentinelExistsAfterFinalKnownCleanup &&
        cleanedDesktopSmokeArtifactHygienePaths.includes(desktopSmokeArtifactHygieneSentinelPath) &&
        desktopSmokeArtifactFileNamesAfterFinalKnownCleanup.length === 1 &&
        desktopSmokeArtifactFileNamesAfterFinalKnownCleanup[0] === 'desktop-cm-artifact-hygiene-sentinel.keep' &&
        desktopSmokeArtifactFileNamesAfterHygieneCleanup.length === 0 &&
        desktopSmokeArtifactHygieneFileNames.includes('desktop-cm-artifact-hygiene-sentinel.keep'),
      'desktop CM session layout reorder history timestamp filter preset help focus-visible visual regression screenshot artifact directory hygiene polish must preserve sentinel during known cleanup and leave output directory empty after explicit hygiene cleanup'
    );
    requireCondition(
      layoutReorderHistoryPresetHelpTooltipRole === 'tooltip' &&
        layoutReorderHistoryPresetDiscoverabilityHintDescribedBy?.includes('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip') &&
        layoutReorderHistoryPresetDiscoverabilityHintDescribedBy.includes('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-contrast-description') &&
        layoutReorderHistoryPresetHelpTooltipVisibleOnHover &&
        layoutReorderHistoryPresetHelpTooltipPlacement === 'bottom-inline-safe' &&
        layoutReorderHistoryPresetHelpTooltipContrast === 'high-safe' &&
        layoutReorderHistoryPresetHelpTooltipContrastMinRatio === '7' &&
        layoutReorderHistoryPresetHelpTooltipClass?.includes('max-w-[calc(100vw-2rem)]') &&
        layoutReorderHistoryPresetHelpTooltipClass.includes('bg-[#f8fcff]') &&
        layoutReorderHistoryPresetHelpTooltipClass.includes('text-[#102a3a]') &&
        layoutReorderHistoryPresetHelpTooltipClass.includes('border-[#2a6f97]') &&
        layoutReorderHistoryPresetHelpTooltipClass.includes('before:') &&
        layoutReorderHistoryPresetHelpTooltipFitsNarrowViewport &&
        layoutReorderHistoryPresetHelpTooltipStyles.backgroundColor === 'rgb(248, 252, 255)' &&
        layoutReorderHistoryPresetHelpTooltipStyles.borderColor === 'rgb(42, 111, 151)' &&
        layoutReorderHistoryPresetHelpTooltipContrastRatio >= 7 &&
        layoutReorderHistoryPresetHelpTooltipContrastDescription?.includes('Contrast note') &&
        layoutReorderHistoryPresetHelpTooltipContrastDescription.includes('at least 7:1 contrast') &&
        layoutReorderHistoryPresetHelpTooltipContrastDescription.includes('UI-only and not stored') &&
        layoutReorderHistoryPresetHelpTooltipText?.includes('Tooltip: All is active') &&
        layoutReorderHistoryPresetHelpTooltipText.includes('Hover or focus this help button') &&
        layoutReorderHistoryPresetHelpTooltipText.includes('UI-only and not stored') &&
        !sessionLayoutStorageAfterPresetHints.includes('Tooltip:') &&
        !sessionLayoutStorageAfterPresetHints.includes('Hover or focus this help button') &&
        !sessionLayoutStorageAfterPresetHints.includes('Contrast note'),
      'desktop CM session layout reorder history timestamp filter preset help tooltip must expose accessible high-contrast viewport-safe hover tooltip without persistence'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint').focus();
    const layoutReorderHistoryPresetHelpTooltipVisibleOnFocus = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip').isVisible();
    const layoutReorderHistoryPresetHelpFocusStatus = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status').textContent();
    requireCondition(
      layoutReorderHistoryPresetHelpTooltipVisibleOnFocus,
      'desktop CM session layout reorder history timestamp filter preset help tooltip must remain visible on focus'
    );
    requireCondition(
      layoutReorderHistoryPresetHelpFocusStatus?.includes('Preset help focused') &&
        layoutReorderHistoryPresetHelpFocusStatus.includes('focus the active reorder history preset'),
      'desktop CM session layout reorder history timestamp filter preset help focus must announce focus action'
    );
    await page.keyboard.press('Enter');
    await requireTestIdFocused(
      page,
      'desktop-cm-session-layout-reorder-history-filter-preset-all-comfortable',
      'desktop CM session layout reorder history timestamp filter preset help focus must move focus to active preset'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-all-comfortable').focus();
    await page.keyboard.press('ArrowRight');
    await requireTestIdFocused(
      page,
      'desktop-cm-session-layout-reorder-history-filter-preset-complete-compact',
      'desktop CM session layout reorder history filter preset ArrowRight must move focus to next preset'
    );
    let layoutReorderHistoryAllPresetTabIndex = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-all-comfortable').getAttribute('tabindex');
    let layoutReorderHistoryCompletePresetTabIndex = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').getAttribute('tabindex');
    let layoutReorderHistoryPresetKeyboardStatus = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status').textContent();
    await page.keyboard.press('Space');
    layoutReorderHistoryScopeValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-scope-filter').inputValue();
    layoutReorderHistoryStatusValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').inputValue();
    layoutReorderHistoryPresetDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    layoutReorderHistoryPresetActive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-complete-compact').getAttribute('aria-pressed');
    await page.keyboard.press('End');
    await requireTestIdFocused(
      page,
      'desktop-cm-session-layout-reorder-history-filter-preset-blocked-compact',
      'desktop CM session layout reorder history filter preset End must move focus to last preset'
    );
    await page.keyboard.press('Home');
    await requireTestIdFocused(
      page,
      'desktop-cm-session-layout-reorder-history-filter-preset-all-comfortable',
      'desktop CM session layout reorder history filter preset Home must move focus to first preset'
    );
    await page.keyboard.press('ArrowLeft');
    await requireTestIdFocused(
      page,
      'desktop-cm-session-layout-reorder-history-filter-preset-blocked-compact',
      'desktop CM session layout reorder history filter preset ArrowLeft must wrap focus to last preset'
    );
    await page.keyboard.press('Enter');
    const layoutReorderHistoryBlockedScopeValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-scope-filter').inputValue();
    const layoutReorderHistoryBlockedStatusValue = await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').inputValue();
    const layoutReorderHistoryBlockedDensity = await page.getByTestId('desktop-cm-session-layout-reorder-history').getAttribute('data-density');
    const layoutReorderHistoryBlockedPresetActive = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-blocked-compact').getAttribute('aria-pressed');
    const layoutReorderHistoryBlockedPresetTabIndex = await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-preset-blocked-compact').getAttribute('tabindex');
    requireCondition(
      layoutReorderHistoryAllPresetTabIndex === '-1' &&
        layoutReorderHistoryCompletePresetTabIndex === '0' &&
        layoutReorderHistoryPresetKeyboardStatus?.includes('Focus Complete reorder history preset, 2 of 4') &&
        layoutReorderHistoryScopeValue === 'all' &&
        layoutReorderHistoryStatusValue === 'reorder-complete' &&
        layoutReorderHistoryPresetDensity === 'compact' &&
        layoutReorderHistoryPresetActive === 'true' &&
        layoutReorderHistoryBlockedScopeValue === 'all' &&
        layoutReorderHistoryBlockedStatusValue === 'reorder-unavailable' &&
        layoutReorderHistoryBlockedDensity === 'compact' &&
        layoutReorderHistoryBlockedPresetActive === 'true' &&
        layoutReorderHistoryBlockedPresetTabIndex === '0',
      'desktop CM session layout reorder history timestamp filter preset keyboard shortcuts must move focus and apply presets without persistence'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').selectOption('reorder-complete');
    layoutReorderHistoryText = await page.getByTestId('desktop-cm-session-layout-reorder-history').textContent();
    layoutReorderHistoryLatest = await page.getByTestId('desktop-cm-session-layout-reorder-history-latest').textContent();
    let layoutReorderHistoryCount = await page.getByTestId('desktop-cm-session-layout-reorder-history-count').textContent();
    requireCondition(
      layoutReorderHistoryText?.includes('Preset') &&
        layoutReorderHistoryLatest?.includes('Reorder complete') &&
        layoutReorderHistoryCount?.includes('1 / 전체 2'),
      'desktop CM session layout reorder history status filter must show matching complete status only'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-scope-filter').selectOption('focus');
    await page.getByTestId('desktop-cm-session-layout-reorder-history-empty').waitFor({ state: 'visible', timeout: 10_000 });
    layoutReorderHistoryCount = await page.getByTestId('desktop-cm-session-layout-reorder-history-count').textContent();
    requireCondition(layoutReorderHistoryCount?.includes('0 / 전체 2'), 'desktop CM session layout reorder history filter empty state must keep total count');
    await page.getByTestId('desktop-cm-session-layout-reorder-history-status-filter').selectOption('focus-restored');
    layoutReorderHistoryText = await page.getByTestId('desktop-cm-session-layout-reorder-history').textContent();
    layoutReorderHistoryCount = await page.getByTestId('desktop-cm-session-layout-reorder-history-count').textContent();
    requireCondition(
      layoutReorderHistoryText?.includes('Focus') && layoutReorderHistoryText.includes('Focus restored') && layoutReorderHistoryCount?.includes('1 / 전체 2'),
      'desktop CM session layout reorder history scope filter must show focus status only'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-filter-clear').click();
    layoutReorderHistoryCount = await page.getByTestId('desktop-cm-session-layout-reorder-history-count').textContent();
    requireCondition(layoutReorderHistoryCount?.includes('2 / 전체 2'), 'desktop CM session layout reorder history filter clear must restore all visible entries');
    await page.getByTestId(`desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`).focus();
    const layoutReorderFocusRole = await page.getByTestId('desktop-cm-session-layout-reorder-focus-status').getAttribute('role');
    const layoutReorderFocusAtomic = await page.getByTestId('desktop-cm-session-layout-reorder-focus-status').getAttribute('aria-atomic');
    requireCondition(
      layoutReorderFocusRole === 'status' && layoutReorderFocusAtomic === 'true',
      'desktop CM session layout reorder focus status must be an atomic status live region'
    );
    await page.keyboard.press('ArrowUp');
    await requireTestIdFocused(
      page,
      `desktop-cm-session-layout-drag-handle-${firstPrimaryPresetSlug}`,
      'desktop CM session layout preset keyboard reorder must restore preset drag handle focus after ArrowUp'
    );
    primaryPresetOrderAfter = await page.evaluate(() =>
      [...document.querySelectorAll('#desktop-cm-session-layout-folder-items-primary > span[data-testid^="desktop-cm-session-layout-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-', '') || '')
        .filter(Boolean)
    );
    requireCondition(primaryPresetOrderAfter[0] === firstPrimaryPresetSlug, 'desktop CM session layout preset keyboard ArrowUp must restore preset order');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(
      !sessionLayoutStorage.includes('sessionLayoutReorderKeyboardMessage') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderFocusTargetTestId') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderFocusTargetLabel') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistory') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryScopeFilter') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryStatusFilter') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryNow') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryDensity') &&
        !sessionLayoutStorage.includes('activeSessionLayoutReorderHistoryFilterPreset') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryFilterPreset') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryFilterPresetSummary') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryFilterPresetDescription') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryFilterPresetFocusId') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryFilterPresetKeyboardMessage'),
      'desktop CM session layout reorder keyboard and focus status must stay memory-only'
    );
    await page.getByTestId('desktop-cm-session-layout-reorder-history-clear').click();
    await page.getByTestId('desktop-cm-session-layout-reorder-history').waitFor({ state: 'hidden', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(
      !sessionLayoutStorage.includes('sessionLayoutReorderHistory'),
      'desktop CM session layout reorder history clear must remove memory-only history'
    );
    await page.getByTestId('desktop-cm-session-layout-bulk-select-input-ops-view-copy').check();
    await page.getByTestId('desktop-cm-session-layout-bulk-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
    let layoutBulkCount = await page.getByTestId('desktop-cm-session-layout-bulk-count').textContent();
    requireCondition(layoutBulkCount?.includes('선택 1개'), 'desktop CM session layout bulk row select must select one saved layout');
    await page.getByTestId('desktop-cm-session-layout-bulk-folder-input').fill('Archive');
    await page.getByTestId('desktop-cm-session-layout-bulk-folder-apply').click();
    await page.getByTestId('desktop-cm-session-layout-folder-archive').waitFor({ state: 'visible', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('"folder":"Archive"'), 'desktop CM session layout bulk folder move must update selected folders');
    requireCondition(!sessionLayoutStorage.includes('sessionLayoutBulkFolderName'), 'desktop CM session layout bulk folder draft must stay memory-only');
    const selectedLayoutDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('desktop-cm-session-layout-bulk-export').click();
    const selectedLayoutDownload = await selectedLayoutDownloadPromise;
    const selectedLayoutExportPath = await selectedLayoutDownload.path();
    requireCondition(typeof selectedLayoutExportPath === 'string', 'desktop CM session layout selected export must create a downloadable JSON file');
    const selectedLayoutExportBundle = JSON.parse(await readFile(selectedLayoutExportPath, 'utf8'));
    requireCondition(
      selectedLayoutExportBundle.kind === 'kuviewer.desktop.cmSessionLayouts' &&
        Array.isArray(selectedLayoutExportBundle.items) &&
        selectedLayoutExportBundle.items.length === 1 &&
        selectedLayoutExportBundle.items[0].name === 'Ops View copy' &&
        selectedLayoutExportBundle.items[0].folder === 'Archive',
      'desktop CM session layout selected export must include only selected layout presets'
    );
    const selectedLayoutExportJson = JSON.stringify(selectedLayoutExportBundle);
    requireCondition(!selectedLayoutExportJson.includes('cm.example.internal'), 'desktop CM session layout selected export must not include session endpoint metadata');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(
      !sessionLayoutStorage.includes('selectedSessionLayoutPresetNames') && !sessionLayoutStorage.includes('sessionLayoutBulkDeleteConfirm'),
      'desktop CM session layout bulk selection must stay memory-only'
    );
    await page.getByTestId('desktop-cm-session-layout-folder-filter').selectOption('Archive');
    await page.getByTestId('desktop-cm-session-layout-folder-archive').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-folder-primary').waitFor({ state: 'hidden', timeout: 10_000 });
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 2'), 'desktop CM session layout folder filter must narrow visible layouts');
    const sessionLayoutFolderFilterCount = await page.getByTestId('desktop-cm-session-layout-folder-filter-count').textContent();
    requireCondition(sessionLayoutFolderFilterCount?.includes('Archive'), 'desktop CM session layout folder filter count must show active folder');
    await page.getByTestId('desktop-cm-session-layout-search').fill('no-archive-match');
    await page.getByTestId('desktop-cm-session-layout-filter-empty').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-folder-empty-archive').waitFor({ state: 'visible', timeout: 10_000 });
    const archiveEmptyText = await page.getByTestId('desktop-cm-session-layout-filter-empty').textContent();
    const archiveFolderEmptyText = await page.getByTestId('desktop-cm-session-layout-folder-empty-archive').textContent();
    const archiveFolderEmptyCount = await page.getByTestId('desktop-cm-session-layout-folder-count-archive').textContent();
    requireCondition(archiveEmptyText?.includes('Archive folder') && archiveEmptyText.includes('no-archive-match'), 'desktop CM session layout folder filter empty state must show safe filter/search context');
    requireCondition(archiveFolderEmptyText?.includes('일치하는 saved layout 없음'), 'desktop CM session layout folder row empty state must be visible when selected folder has zero matches');
    requireCondition(archiveFolderEmptyCount?.includes('0 / 1'), 'desktop CM session layout folder empty row must keep total count visible');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('no-archive-match') && !sessionLayoutStorage.includes('folder-empty'), 'desktop CM session layout folder empty state must stay memory-only');
    await page.getByTestId('desktop-cm-session-layout-search').fill('copy');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 2'), 'desktop CM session layout folder filter must combine with layout search');
    let layoutReorderState = await page.getByTestId('desktop-cm-session-layout-reorder-state').textContent();
    const layoutReorderStateTitle = await page.getByTestId('desktop-cm-session-layout-reorder-state').getAttribute('title');
    const layoutReorderStateRole = await page.getByTestId('desktop-cm-session-layout-reorder-state').getAttribute('role');
    requireCondition(
      layoutReorderState?.includes('순서 변경 비활성') &&
        layoutReorderStateRole === 'status' &&
        layoutReorderStateTitle?.includes('layout search and folder filter'),
      'desktop CM session layout reorder disabled state must explain active search and folder filters'
    );
    const archiveFolderDragHandleDisabled = await page.getByTestId('desktop-cm-session-layout-folder-drag-handle-archive').getAttribute('disabled');
    const archiveFolderDragHandleTitle = await page.getByTestId('desktop-cm-session-layout-folder-drag-handle-archive').getAttribute('title');
    const archiveFolderDragHandleDescription = await page.getByTestId('desktop-cm-session-layout-folder-drag-handle-archive').getAttribute('aria-describedby');
    requireCondition(
      archiveFolderDragHandleDisabled !== null &&
        archiveFolderDragHandleTitle?.includes('layout search and folder filter') &&
        archiveFolderDragHandleDescription?.includes('desktop-cm-session-layout-reorder-disabled-description') &&
        archiveFolderDragHandleDescription.includes('desktop-cm-session-layout-reorder-disabled-reason'),
      'desktop CM session layout folder disabled drag handle must describe filter-blocked reason'
    );
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('sessionLayoutFolderFilter') && !sessionLayoutStorage.includes('Archive folder filter'), 'desktop CM session layout folder filter must stay memory-only');
    await page.getByTestId('desktop-cm-session-layout-search-clear').click();
    await page.getByTestId('desktop-cm-session-layout-folder-filter-clear').click();
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('2 / 전체 2'), 'desktop CM session layout folder filter clear must restore saved layouts');
    layoutReorderState = await page.getByTestId('desktop-cm-session-layout-reorder-state').textContent();
    requireCondition(layoutReorderState?.includes('순서 변경 가능'), 'desktop CM session layout folder reorder controls must enable when search and folder filter are clear');
    const layoutFolderOrderBefore = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="desktop-cm-session-layout-list"] > div[data-testid^="desktop-cm-session-layout-folder-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-folder-', '') || '')
        .filter(Boolean)
    );
    requireCondition(layoutFolderOrderBefore.length === 2, 'desktop CM session layout folder reorder smoke must start with two folders');
    const firstLayoutFolderSlug = layoutFolderOrderBefore[0];
    const firstLayoutFolderDragHandle = await page.getByTestId(`desktop-cm-session-layout-folder-drag-handle-${firstLayoutFolderSlug}`).getAttribute('draggable');
    requireCondition(firstLayoutFolderDragHandle === 'true', 'desktop CM session layout folder drag handle must be enabled when filters are clear');
    const firstLayoutFolderReorderUpDisabled = await page.getByTestId(`desktop-cm-session-layout-folder-reorder-up-${firstLayoutFolderSlug}`).getAttribute('disabled');
    const firstLayoutFolderReorderUpTitle = await page.getByTestId(`desktop-cm-session-layout-folder-reorder-up-${firstLayoutFolderSlug}`).getAttribute('title');
    const firstLayoutFolderReorderUpDescription = await page.getByTestId(`desktop-cm-session-layout-folder-reorder-up-${firstLayoutFolderSlug}`).getAttribute('aria-describedby');
    requireCondition(
      firstLayoutFolderReorderUpDisabled !== null &&
        firstLayoutFolderReorderUpTitle?.includes('already first') &&
        firstLayoutFolderReorderUpDescription?.includes('desktop-cm-session-layout-reorder-disabled-description') &&
        firstLayoutFolderReorderUpDescription.includes('desktop-cm-session-layout-reorder-disabled-reason'),
      'desktop CM session layout folder edge disabled state must describe first-position reason'
    );
    await page.getByTestId(`desktop-cm-session-layout-folder-reorder-down-${firstLayoutFolderSlug}`).click();
    await requireTestIdFocused(
      page,
      `desktop-cm-session-layout-folder-drag-handle-${firstLayoutFolderSlug}`,
      'desktop CM session layout folder button reorder must restore folder drag handle focus after down'
    );
    let layoutFolderOrderAfter = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="desktop-cm-session-layout-list"] > div[data-testid^="desktop-cm-session-layout-folder-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-folder-', '') || '')
        .filter(Boolean)
    );
    requireCondition(layoutFolderOrderAfter[1] === firstLayoutFolderSlug, 'desktop CM session layout folder reorder down must move the first folder after the next folder');
    await requireTestIdTextIncludes(page, 'desktop-cm-session-layout-reorder-focus-status', 'layout folder drag handle');
    layoutReorderFocusStatus = await page.getByTestId('desktop-cm-session-layout-reorder-focus-status').textContent();
    requireCondition(
      layoutReorderFocusStatus?.includes('layout folder drag handle') &&
        !layoutReorderFocusStatus.includes(`desktop-cm-session-layout-folder-drag-handle-${firstLayoutFolderSlug}`),
      'desktop CM session layout reorder focus status must announce human-readable folder handle restoration'
    );
    await page.getByTestId(`desktop-cm-session-layout-folder-reorder-up-${firstLayoutFolderSlug}`).click();
    await requireTestIdFocused(
      page,
      `desktop-cm-session-layout-folder-drag-handle-${firstLayoutFolderSlug}`,
      'desktop CM session layout folder button reorder must restore folder drag handle focus after up'
    );
    layoutFolderOrderAfter = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="desktop-cm-session-layout-list"] > div[data-testid^="desktop-cm-session-layout-folder-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-folder-', '') || '')
        .filter(Boolean)
    );
    requireCondition(layoutFolderOrderAfter[0] === firstLayoutFolderSlug, 'desktop CM session layout folder reorder up must restore the folder order');
    const layoutFolderListShortcuts = await page.getByTestId('desktop-cm-session-layout-list').getAttribute('aria-keyshortcuts');
    requireCondition(
      layoutFolderListShortcuts?.includes('Shift+ArrowDown') && layoutFolderListShortcuts.includes('Shift+ArrowUp'),
      'desktop CM session layout folder list must expose keyboard reorder shortcuts'
    );
    const firstLayoutFolderHandleShortcuts = await page.getByTestId(`desktop-cm-session-layout-folder-drag-handle-${firstLayoutFolderSlug}`).getAttribute('aria-keyshortcuts');
    requireCondition(
      firstLayoutFolderHandleShortcuts?.includes('ArrowDown') && firstLayoutFolderHandleShortcuts.includes('Home') && firstLayoutFolderHandleShortcuts.includes('End'),
      'desktop CM session layout folder drag handle must expose keyboard reorder shortcuts'
    );
    const firstLayoutFolderHandleDescription = await page.getByTestId(`desktop-cm-session-layout-folder-drag-handle-${firstLayoutFolderSlug}`).getAttribute('aria-describedby');
    requireCondition(
      firstLayoutFolderHandleDescription?.includes('desktop-cm-session-layout-reorder-focus-description') &&
        firstLayoutFolderHandleDescription.includes('desktop-cm-session-layout-reorder-focus-status'),
      'desktop CM session layout folder drag handle must describe reorder focus restoration'
    );
    await page.getByTestId('desktop-cm-session-layout-list').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await requireTestIdFocused(page, 'desktop-cm-session-layout-list', 'desktop CM session layout folder keyboard reorder must restore folder list focus after Shift ArrowDown');
    layoutFolderOrderAfter = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="desktop-cm-session-layout-list"] > div[data-testid^="desktop-cm-session-layout-folder-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-folder-', '') || '')
        .filter(Boolean)
    );
    requireCondition(layoutFolderOrderAfter[1] === firstLayoutFolderSlug, 'desktop CM session layout folder keyboard Shift ArrowDown must move active folder down');
    layoutReorderKeyboardStatus = await page.getByTestId('desktop-cm-session-layout-reorder-keyboard-status').textContent();
    requireCondition(
      layoutReorderKeyboardStatus?.includes('Reorder complete') &&
        layoutReorderKeyboardStatus.includes('moved down') &&
        layoutReorderKeyboardStatus.includes('position 2 of 2'),
      'desktop CM session layout reorder keyboard live status must announce folder move with position'
    );
    layoutReorderHistoryText = await page.getByTestId('desktop-cm-session-layout-reorder-history').textContent();
    requireCondition(
      layoutReorderHistoryText?.includes('Folder') &&
        layoutReorderHistoryText.includes('Reorder complete') &&
        layoutReorderHistoryText.includes('position 2 of 2'),
      'desktop CM session layout reorder history must include folder status'
    );
    await requireTestIdTextIncludes(page, 'desktop-cm-session-layout-reorder-focus-status', 'saved layout folder list');
    layoutReorderFocusStatus = await page.getByTestId('desktop-cm-session-layout-reorder-focus-status').textContent();
    requireCondition(
      layoutReorderFocusStatus?.includes('saved layout folder list') && !layoutReorderFocusStatus.includes('desktop-cm-session-layout-list'),
      'desktop CM session layout reorder focus status must announce human-readable folder list restoration'
    );
    await page.keyboard.press('Shift+ArrowUp');
    await requireTestIdFocused(page, 'desktop-cm-session-layout-list', 'desktop CM session layout folder keyboard reorder must restore folder list focus after Shift ArrowUp');
    layoutFolderOrderAfter = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="desktop-cm-session-layout-list"] > div[data-testid^="desktop-cm-session-layout-folder-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-folder-', '') || '')
        .filter(Boolean)
    );
    requireCondition(layoutFolderOrderAfter[0] === firstLayoutFolderSlug, 'desktop CM session layout folder keyboard Shift ArrowUp must restore folder order');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(
      !sessionLayoutStorage.includes('draggingSessionLayoutFolderName') &&
        !sessionLayoutStorage.includes('draggingSessionLayoutPresetName') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderKeyboardMessage') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderFocusTargetTestId') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderFocusTargetLabel') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistory') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryScopeFilter') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryStatusFilter') &&
        !sessionLayoutStorage.includes('sessionLayoutReorderHistoryNow'),
      'desktop CM session layout drag, reorder keyboard, and focus state must stay memory-only'
    );
    await page.getByTestId('desktop-cm-session-layout-bulk-clear-toolbar').click();
    await page.getByTestId('desktop-cm-session-layout-folder-select-primary').click();
    await page.getByTestId('desktop-cm-session-layout-bulk-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
    layoutBulkCount = await page.getByTestId('desktop-cm-session-layout-bulk-count').textContent();
    requireCondition(layoutBulkCount?.includes('선택 1개') && layoutBulkCount.includes('현재 결과 1개'), 'desktop CM session layout folder select must select visible presets in that folder');
    await page.getByTestId('desktop-cm-session-layout-bulk-clear-toolbar').click();
    await page.getByTestId('desktop-cm-session-layout-folder-rename-primary').click();
    await page.getByTestId('desktop-cm-session-layout-folder-rename-input-primary').fill('Team Layouts');
    await page.getByTestId('desktop-cm-session-layout-folder-rename-save-primary').click();
    await page.getByTestId('desktop-cm-session-layout-folder-team-layouts').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-folder-primary').waitFor({ state: 'hidden', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('"folder":"Team Layouts"'), 'desktop CM session layout folder rename must update folder metadata');
    requireCondition(!sessionLayoutStorage.includes('sessionLayoutFolderRenameTarget') && !sessionLayoutStorage.includes('sessionLayoutFolderRenameDraft'), 'desktop CM session layout folder rename draft must stay memory-only');
    await page.getByTestId('desktop-cm-session-layout-folder-filter').selectOption('Team Layouts');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 2'), 'desktop CM session layout folder rename must keep renamed folders filterable');
    await page.getByTestId('desktop-cm-session-layout-folder-filter-clear').click();
    const layoutFolderListRole = await page.getByTestId('desktop-cm-session-layout-list').getAttribute('role');
    requireCondition(layoutFolderListRole === 'list', 'desktop CM session layout folder list must expose list role');
    const layoutFolderListLabelledBy = await page.getByTestId('desktop-cm-session-layout-list').getAttribute('aria-labelledby');
    requireCondition(layoutFolderListLabelledBy === 'desktop-cm-session-layout-folder-list-title', 'desktop CM session layout folder list must be labelled by sr-only title');
    const layoutFolderListTitle = await page.getByTestId('desktop-cm-session-layout-folder-list-title').textContent();
    requireCondition(layoutFolderListTitle?.includes('Saved session layout folders'), 'desktop CM session layout folder list title must be available to assistive tech');
    const layoutFolderListDescribedBy = await page.getByTestId('desktop-cm-session-layout-list').getAttribute('aria-describedby');
    requireCondition(
      layoutFolderListDescribedBy?.includes('desktop-cm-session-layout-folder-keyboard-description') &&
        layoutFolderListDescribedBy.includes('desktop-cm-session-layout-folder-keyboard-live-status') &&
        layoutFolderListDescribedBy.includes('desktop-cm-session-layout-reorder-focus-description') &&
        layoutFolderListDescribedBy.includes('desktop-cm-session-layout-reorder-focus-status'),
      'desktop CM session layout folder list must expose keyboard and reorder focus descriptions with live status'
    );
    await page.getByTestId('desktop-cm-session-layout-list').focus();
    await requireTestIdFocused(page, 'desktop-cm-session-layout-list', 'desktop CM session layout folder list must be keyboard focusable');
    const layoutFolderSlugs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="desktop-cm-session-layout-list"] > div[data-testid^="desktop-cm-session-layout-folder-"]')]
        .map((element) => element.getAttribute('data-testid')?.replace('desktop-cm-session-layout-folder-', '') || '')
        .filter(Boolean)
    );
    requireCondition(layoutFolderSlugs.length === 2 && layoutFolderSlugs.includes('team-layouts') && layoutFolderSlugs.includes('archive'), 'desktop CM session layout folder keyboard smoke must have two target folders');
    const archiveFolderRole = await page.getByTestId('desktop-cm-session-layout-folder-archive').getAttribute('role');
    const archiveFolderId = await page.getByTestId('desktop-cm-session-layout-folder-archive').getAttribute('id');
    const archiveFolderLabelledBy = await page.getByTestId('desktop-cm-session-layout-folder-archive').getAttribute('aria-labelledby');
    const archiveFolderDescribedBy = await page.getByTestId('desktop-cm-session-layout-folder-archive').getAttribute('aria-describedby');
    requireCondition(archiveFolderRole === 'listitem', 'desktop CM session layout folder row must expose listitem role');
    requireCondition(archiveFolderId === 'desktop-cm-session-layout-folder-row-archive', 'desktop CM session layout folder row must expose stable id');
    requireCondition(archiveFolderLabelledBy === 'desktop-cm-session-layout-folder-title-archive', 'desktop CM session layout folder row must be labelled by folder title');
    requireCondition(
      archiveFolderDescribedBy?.includes('desktop-cm-session-layout-folder-a11y-count-archive') &&
        archiveFolderDescribedBy.includes('desktop-cm-session-layout-folder-actions-archive'),
      'desktop CM session layout folder row must describe count and actions'
    );
    const archiveFolderTitle = await page.getByTestId('desktop-cm-session-layout-folder-archive').locator('#desktop-cm-session-layout-folder-title-archive').textContent();
    const archiveFolderActionsText = await page.getByTestId('desktop-cm-session-layout-folder-actions-archive').textContent();
    requireCondition(archiveFolderTitle === 'Archive', 'desktop CM session layout folder title id must expose safe folder name');
    requireCondition(archiveFolderActionsText?.includes('visible presets') && archiveFolderActionsText.includes('rename this folder'), 'desktop CM session layout folder actions description must stay safe and specific');
    const archiveToggleControls = await page.getByTestId('desktop-cm-session-layout-folder-toggle-archive').getAttribute('aria-controls');
    const archiveItemsId = await page.getByTestId('desktop-cm-session-layout-folder-items-archive').getAttribute('id');
    const archiveToggleLabel = await page.getByTestId('desktop-cm-session-layout-folder-toggle-archive').getAttribute('aria-label');
    const archiveSelectLabel = await page.getByTestId('desktop-cm-session-layout-folder-select-archive').getAttribute('aria-label');
    const archiveRenameLabel = await page.getByTestId('desktop-cm-session-layout-folder-rename-archive').getAttribute('aria-label');
    requireCondition(archiveToggleControls === archiveItemsId, 'desktop CM session layout folder toggle must control folder items region');
    requireCondition(archiveToggleLabel?.includes('Archive') && archiveToggleLabel.includes('collapse'), 'desktop CM session layout folder toggle must expose action label');
    requireCondition(archiveSelectLabel === 'Select visible layouts in Archive', 'desktop CM session layout folder select must expose action label');
    requireCondition(archiveRenameLabel === 'Rename Archive layout folder', 'desktop CM session layout folder rename must expose action label');
    await page.keyboard.press('Home');
    await requireLayoutFolderActive(page, layoutFolderSlugs[0], true, 'desktop CM session layout folder Home must activate first folder');
    let layoutFolderActiveDescendant = await page.getByTestId('desktop-cm-session-layout-list').getAttribute('aria-activedescendant');
    requireCondition(layoutFolderActiveDescendant === `desktop-cm-session-layout-folder-row-${layoutFolderSlugs[0]}`, 'desktop CM session layout folder list must expose active descendant after Home');
    let layoutFolderLiveStatus = await page.getByTestId('desktop-cm-session-layout-folder-keyboard-live-status').textContent();
    requireCondition(layoutFolderLiveStatus?.includes('visible presets') && layoutFolderLiveStatus.includes('expanded') && layoutFolderLiveStatus.includes('1 of 2'), 'desktop CM session layout folder live status must announce active folder');
    await page.keyboard.press('End');
    await requireLayoutFolderActive(page, layoutFolderSlugs[layoutFolderSlugs.length - 1], true, 'desktop CM session layout folder End must activate last folder');
    layoutFolderActiveDescendant = await page.getByTestId('desktop-cm-session-layout-list').getAttribute('aria-activedescendant');
    requireCondition(layoutFolderActiveDescendant === `desktop-cm-session-layout-folder-row-${layoutFolderSlugs[layoutFolderSlugs.length - 1]}`, 'desktop CM session layout folder list must expose active descendant after End');
    await page.getByTestId('desktop-cm-session-layout-folder-archive').click();
    await page.getByTestId('desktop-cm-session-layout-list').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('desktop-cm-session-layout-folder-items-archive').waitFor({ state: 'hidden', timeout: 10_000 });
    let archiveToggleExpanded = await page.getByTestId('desktop-cm-session-layout-folder-toggle-archive').getAttribute('aria-expanded');
    layoutFolderLiveStatus = await page.getByTestId('desktop-cm-session-layout-folder-keyboard-live-status').textContent();
    requireCondition(archiveToggleExpanded === 'false' && layoutFolderLiveStatus?.includes('collapsed'), 'desktop CM session layout folder Enter must update collapsed aria state');
    await page.keyboard.press('Enter');
    await page.getByTestId('desktop-cm-session-layout-folder-items-archive').waitFor({ state: 'visible', timeout: 10_000 });
    archiveToggleExpanded = await page.getByTestId('desktop-cm-session-layout-folder-toggle-archive').getAttribute('aria-expanded');
    requireCondition(archiveToggleExpanded === 'true', 'desktop CM session layout folder Enter must restore expanded aria state');
    await page.keyboard.press('s');
    await page.getByTestId('desktop-cm-session-layout-bulk-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
    layoutBulkCount = await page.getByTestId('desktop-cm-session-layout-bulk-count').textContent();
    requireCondition(layoutBulkCount?.includes('선택 1개') && layoutBulkCount.includes('현재 결과 1개'), 'desktop CM session layout folder keyboard select must select active visible presets');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('activeSessionLayoutFolderName'), 'desktop CM session layout folder active keyboard state must stay memory-only');
    await page.getByTestId('desktop-cm-session-layout-bulk-clear-toolbar').click();
    await page.getByTestId('desktop-cm-session-layout-list').focus();
    await page.keyboard.press('r');
    await page.getByTestId('desktop-cm-session-layout-folder-rename-input-archive').waitFor({ state: 'visible', timeout: 10_000 });
    const archiveRenameEditorRole = await page.getByTestId('desktop-cm-session-layout-folder-rename-editor-archive').getAttribute('role');
    const archiveRenameEditorLabel = await page.getByTestId('desktop-cm-session-layout-folder-rename-editor-archive').getAttribute('aria-label');
    const archiveRenameInputLabel = await page.getByTestId('desktop-cm-session-layout-folder-rename-input-archive').getAttribute('aria-label');
    const archiveRenameSaveLabel = await page.getByTestId('desktop-cm-session-layout-folder-rename-save-archive').getAttribute('aria-label');
    const archiveRenameCancelLabel = await page.getByTestId('desktop-cm-session-layout-folder-rename-cancel-archive').getAttribute('aria-label');
    requireCondition(archiveRenameEditorRole === 'group' && archiveRenameEditorLabel === 'Rename Archive layout folder', 'desktop CM session layout folder rename editor must expose group label');
    requireCondition(archiveRenameInputLabel === 'New name for Archive layout folder', 'desktop CM session layout folder rename input must expose label');
    requireCondition(archiveRenameSaveLabel === 'Save Archive layout folder name', 'desktop CM session layout folder rename save must expose label');
    requireCondition(archiveRenameCancelLabel === 'Cancel Archive layout folder rename', 'desktop CM session layout folder rename cancel must expose label');
    await requireTestIdFocused(page, 'desktop-cm-session-layout-folder-rename-input-archive', 'desktop CM session layout folder keyboard rename must focus rename input');
    await page.getByTestId('desktop-cm-session-layout-folder-rename-input-archive').fill('Keyboard Archive');
    await page.keyboard.press('Enter');
    await page.getByTestId('desktop-cm-session-layout-folder-keyboard-archive').waitFor({ state: 'visible', timeout: 10_000 });
    await requireLayoutFolderActive(page, 'keyboard-archive', true, 'desktop CM session layout folder keyboard rename must keep renamed folder active');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('"folder":"Keyboard Archive"'), 'desktop CM session layout folder keyboard rename must update safe folder metadata');
    requireCondition(
      !sessionLayoutStorage.includes('sessionLayoutFolderKeyboard') && !sessionLayoutStorage.includes('sessionLayoutFolderRenameDraft'),
      'desktop CM session layout folder keyboard state and rename draft must stay memory-only'
    );
    await page.getByTestId('desktop-cm-session-layout-search').fill('copy');
    sessionLayoutSearchCount = await page.getByTestId('desktop-cm-session-layout-search-count').textContent();
    requireCondition(sessionLayoutSearchCount?.includes('1 / 전체 2'), 'desktop CM session layout search must match duplicated layout metadata');
    await page.getByTestId('desktop-cm-session-layout-bulk-select-visible').click();
    layoutBulkCount = await page.getByTestId('desktop-cm-session-layout-bulk-count').textContent();
    requireCondition(layoutBulkCount?.includes('선택 1개') && layoutBulkCount.includes('현재 결과 1개'), 'desktop CM session layout bulk select visible must select matching layout results');
    await page.getByTestId('desktop-cm-session-layout-search-clear').click();
    await page.getByTestId('desktop-cm-session-layout-bulk-delete').click();
    const layoutBulkDeleteConfirmText = await page.getByTestId('desktop-cm-session-layout-bulk-delete').textContent();
    requireCondition(layoutBulkDeleteConfirmText?.includes('확인'), 'desktop CM session layout bulk delete must require inline confirmation');
    await page.getByTestId('desktop-cm-session-layout-bulk-delete').click();
    await page.getByTestId('desktop-cm-session-layout-ops-view-copy').waitFor({ state: 'hidden', timeout: 10_000 });
    const layoutDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('desktop-cm-session-layout-export').click();
    const layoutDownload = await layoutDownloadPromise;
    const layoutExportPath = await layoutDownload.path();
    requireCondition(typeof layoutExportPath === 'string', 'desktop CM session layout export must create a downloadable JSON file');
    const layoutExportBundle = JSON.parse(await readFile(layoutExportPath, 'utf8'));
    requireCondition(layoutExportBundle.schemaVersion === 1, 'desktop CM session layout export bundle must include schemaVersion 1');
    requireCondition(layoutExportBundle.kind === 'kuviewer.desktop.cmSessionLayouts', 'desktop CM session layout export bundle must include the layout kind');
    requireCondition(Array.isArray(layoutExportBundle.items) && layoutExportBundle.items.length === 1, 'desktop CM session layout export must include saved layout presets only');
    requireCondition(layoutExportBundle.items[0].folder === 'Team Layouts', 'desktop CM session layout export must preserve folder metadata');
    const layoutExportJson = JSON.stringify(layoutExportBundle);
    requireCondition(!layoutExportJson.includes('kuviewer_desktop_cm_session_layout_collapsed_folders'), 'desktop CM session layout export must not include folder collapse preferences');
    requireCondition(!layoutExportJson.includes('cm.example.internal'), 'desktop CM session layout export must not include session endpoint metadata');
    for (const forbiddenField of ['host', 'remoteApiHost', 'credentialAvailable', 'runtimeStatus', 'diagnosticMessage', 'serverUrl', 'adminToken', 'BEGIN OPENSSH PRIVATE KEY']) {
      requireCondition(!layoutExportJson.includes(forbiddenField), `desktop CM session layout export must not include ${forbiddenField}`);
    }
    await page.getByTestId('desktop-cm-session-group-toggle-production').click();
    await page.getByTestId('desktop-cm-session-group-items-production').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-group-input-${sessionId}`).fill('Temporary');
    await page.getByTestId(`desktop-cm-session-group-input-${sessionId}`).press('Enter');
    await page.getByTestId('desktop-cm-session-group-temporary').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-favorite-${sessionId}`).click();
    await page.getByTestId('desktop-cm-session-layout-ops-view').getByRole('button', { name: /^Ops View .*sessions/ }).click();
    await page.getByTestId('desktop-cm-session-group-production').waitFor({ state: 'visible', timeout: 10_000 });
    const restoredFavoriteCount = await page.getByTestId('desktop-cm-session-group-favorites-production').textContent();
    requireCondition(restoredFavoriteCount?.includes('favorite 1'), 'desktop CM session layout apply must restore group and favorite preferences');
    await page.getByTestId('desktop-cm-session-group-items-production').waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-group-toggle-production').click();
    await page.getByTestId('desktop-cm-session-group-items-production').waitFor({ state: 'visible', timeout: 10_000 });
    const layoutImportDir = await mkdtemp(path.join(os.tmpdir(), 'kuviewer-cm-layout-import-'));
    const layoutImportPath = path.join(layoutImportDir, 'cm-session-layouts.json');
    await writeFile(layoutImportPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'kuviewer.desktop.cmSessionLayouts',
      exportedAt: Date.now(),
      items: [
        {
          name: 'Ops View',
          folder: 'Incoming',
          viewPreferences: {
            sessions: [{ sessionId, group: 'Imported', favorite: true, updatedAt: Date.now() }],
            collapsedGroups: [],
          },
          updatedAt: Date.now(),
          host: 'cm.example.internal',
          diagnosticMessage: 'should-not-persist',
        },
        {
          name: 'Review View',
          folder: 'Reviews',
          viewPreferences: {
            sessions: [
              { sessionId, group: 'Review', favorite: false, updatedAt: Date.now() },
              { sessionId: 'missing-session-id', group: 'Ghost', favorite: true, updatedAt: Date.now() },
            ],
            collapsedGroups: ['Review'],
          },
          updatedAt: Date.now(),
        },
        {
          name: 'Ghost View',
          viewPreferences: {
            sessions: [{ sessionId: 'missing-session-id', group: 'Ghost', favorite: true, updatedAt: Date.now() }],
            collapsedGroups: ['Ghost'],
          },
          updatedAt: Date.now(),
        },
      ],
    }));
    await page.getByTestId('desktop-cm-session-layout-import').setInputFiles(layoutImportPath);
    await page.getByTestId('desktop-cm-session-layout-import-summary').waitFor({ state: 'visible', timeout: 10_000 });
    let layoutImportSummary = await page.getByTestId('desktop-cm-session-layout-import-summary').textContent();
    requireCondition(layoutImportSummary?.includes('new 1') && layoutImportSummary.includes('updated 0') && layoutImportSummary.includes('invalid 1'), 'desktop CM session layout import must report layout updates');
    await page.getByTestId('desktop-cm-session-layout-folder-reviews').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-review-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-conflict-ops-view').waitFor({ state: 'visible', timeout: 10_000 });
    await requireTestIdFocused(page, 'desktop-cm-session-layout-conflict-preview', 'desktop CM session layout conflict preview must receive focus on open');
    const conflictPreviewLabelledBy = await page.getByTestId('desktop-cm-session-layout-conflict-preview').getAttribute('aria-labelledby');
    const conflictPreviewDescribedBy = await page.getByTestId('desktop-cm-session-layout-conflict-preview').getAttribute('aria-describedby');
    requireCondition(conflictPreviewLabelledBy === 'desktop-cm-session-layout-conflict-title', 'desktop CM session layout conflict preview must be labelled by its title');
    requireCondition(
      conflictPreviewDescribedBy?.includes('desktop-cm-session-layout-conflict-description') &&
        conflictPreviewDescribedBy.includes('desktop-cm-session-layout-conflict-live-status'),
      'desktop CM session layout conflict preview must describe keyboard and live summary regions'
    );
    const conflictLiveStatus = await page.getByTestId('desktop-cm-session-layout-conflict-live-status').textContent();
    requireCondition(conflictLiveStatus?.includes('0 of 1 resolved') && conflictLiveStatus.includes('1 remaining'), 'desktop CM session layout conflict live status must announce initial progress');
    const conflictRowRole = await page.getByTestId('desktop-cm-session-layout-conflict-ops-view').getAttribute('role');
    const conflictRowId = await page.getByTestId('desktop-cm-session-layout-conflict-ops-view').getAttribute('id');
    const conflictRowLabel = await page.getByTestId('desktop-cm-session-layout-conflict-ops-view').getAttribute('aria-label');
    requireCondition(conflictRowRole === 'listitem', 'desktop CM session layout conflict row must expose listitem role');
    requireCondition(conflictRowId === 'desktop-cm-session-layout-conflict-row-ops-view', 'desktop CM session layout conflict row must expose stable id');
    requireCondition(conflictRowLabel?.includes('Ops View') && conflictRowLabel.includes('Current layout') && conflictRowLabel.includes('Incoming layout'), 'desktop CM session layout conflict row must expose safe aria label');
    const conflictIncomingButtonLabel = await page.getByTestId('desktop-cm-session-layout-conflict-row-use-incoming-ops-view').getAttribute('aria-label');
    requireCondition(conflictIncomingButtonLabel === 'Use incoming layout for Ops View', 'desktop CM session layout conflict row button must expose specific aria label');
    await requireConflictActive(page, 'ops-view', true, 'desktop CM session layout conflict preview must activate the first conflict row on open');
    let layoutConflictSummaryProgress = await page.getByTestId('desktop-cm-session-layout-conflict-summary-progress').textContent();
    let layoutConflictSummaryRemaining = await page.getByTestId('desktop-cm-session-layout-conflict-summary-remaining').textContent();
    let layoutConflictSummaryResolutions = await page.getByTestId('desktop-cm-session-layout-conflict-summary-resolutions').textContent();
    let layoutConflictSummaryImport = await page.getByTestId('desktop-cm-session-layout-conflict-summary-import').textContent();
    requireCondition(layoutConflictSummaryProgress?.includes('충돌 1개 중 0개 해결'), 'desktop CM session layout conflict summary must show initial conflict progress');
    requireCondition(layoutConflictSummaryRemaining?.includes('남은 1개'), 'desktop CM session layout conflict summary must show initial remaining conflicts');
    requireCondition(
      layoutConflictSummaryResolutions?.includes('incoming 반영 0') && layoutConflictSummaryResolutions.includes('현재 유지 0') && layoutConflictSummaryResolutions.includes('rename 0'),
      'desktop CM session layout conflict summary must show initial resolution counts'
    );
    requireCondition(
      layoutConflictSummaryImport?.includes('new 1') && layoutConflictSummaryImport.includes('updated 0') && layoutConflictSummaryImport.includes('invalid 1'),
      'desktop CM session layout conflict summary must show import counts'
    );
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('Review View'), 'desktop CM session layout import must persist new layout presets');
    requireCondition(sessionLayoutStorage.includes('"folder":"Reviews"'), 'desktop CM session layout import must preserve folder metadata');
    requireCondition(!sessionLayoutStorage.includes('Imported'), 'desktop CM session layout conflict preview must not overwrite same-name layouts before resolution');
    requireCondition(!sessionLayoutStorage.includes('incomingResolved') && !sessionLayoutStorage.includes('currentResolved') && !sessionLayoutStorage.includes('renamedResolved'), 'desktop CM session layout conflict summary must not persist resolution counters');
    requireCondition(!sessionLayoutStorage.includes('conflict-preview'), 'desktop CM session layout conflict preview must not persist conflict state');
    requireCondition(!sessionLayoutStorage.includes('missing-session-id') && !sessionLayoutStorage.includes('Ghost'), 'desktop CM session layout import must prune unknown session ids');
    requireCondition(!sessionLayoutStorage.includes('cm.example.internal') && !sessionLayoutStorage.includes('should-not-persist'), 'desktop CM session layout import must not persist endpoint or diagnostic metadata');
    await page.getByTestId('desktop-cm-session-layout-conflict-keep-current').click();
    layoutImportSummary = await page.getByTestId('desktop-cm-session-layout-import-summary').textContent();
    requireCondition(layoutImportSummary?.includes('skipped 1'), 'desktop CM session layout conflict keep current must count same-name conflicts as skipped');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('Imported'), 'desktop CM session layout conflict keep current must not overwrite current layout');
    const layoutMultiConflictPath = path.join(layoutImportDir, 'cm-session-layouts-multi-conflict.json');
    await writeFile(layoutMultiConflictPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'kuviewer.desktop.cmSessionLayouts',
      exportedAt: Date.now(),
      items: [
        {
          name: 'Ops View',
          viewPreferences: {
            sessions: [{ sessionId, group: 'Imported', favorite: true, updatedAt: Date.now() }],
            collapsedGroups: [],
          },
          updatedAt: Date.now(),
        },
        {
          name: 'Review View',
          viewPreferences: {
            sessions: [{ sessionId, group: 'Review Incoming', favorite: true, updatedAt: Date.now() }],
            collapsedGroups: [],
          },
          updatedAt: Date.now(),
        },
      ],
    }));
    await page.getByTestId('desktop-cm-session-layout-import').setInputFiles(layoutMultiConflictPath);
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-conflict-ops-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-conflict-review-view').waitFor({ state: 'visible', timeout: 10_000 });
    await requireConflictActive(page, 'ops-view', true, 'desktop CM multi layout conflict preview must activate the first row');
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').focus();
    await page.keyboard.press('ArrowDown');
    await requireConflictActive(page, 'review-view', true, 'desktop CM layout conflict ArrowDown must activate the next row');
    await page.keyboard.press('Home');
    await requireConflictActive(page, 'ops-view', true, 'desktop CM layout conflict Home must activate the first row');
    await page.keyboard.press('End');
    await requireConflictActive(page, 'review-view', true, 'desktop CM layout conflict End must activate the last row');
    layoutConflictSummaryProgress = await page.getByTestId('desktop-cm-session-layout-conflict-summary-progress').textContent();
    layoutConflictSummaryRemaining = await page.getByTestId('desktop-cm-session-layout-conflict-summary-remaining').textContent();
    requireCondition(layoutConflictSummaryProgress?.includes('충돌 2개 중 0개 해결'), 'desktop CM multi layout conflict summary must show initial progress');
    requireCondition(layoutConflictSummaryRemaining?.includes('남은 2개'), 'desktop CM multi layout conflict summary must show initial remaining count');
    await page.keyboard.press('k');
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-conflict-review-view').waitFor({ state: 'hidden', timeout: 10_000 });
    await requireConflictActive(page, 'ops-view', true, 'desktop CM layout conflict keyboard resolution must move active row to the next remaining conflict');
    const conflictLiveStatusAfterKeyboardResolve = await page.getByTestId('desktop-cm-session-layout-conflict-live-status').textContent();
    requireCondition(conflictLiveStatusAfterKeyboardResolve?.includes('1 of 2 resolved') && conflictLiveStatusAfterKeyboardResolve.includes('1 remaining'), 'desktop CM session layout conflict live status must update after keyboard resolution');
    layoutConflictSummaryProgress = await page.getByTestId('desktop-cm-session-layout-conflict-summary-progress').textContent();
    layoutConflictSummaryRemaining = await page.getByTestId('desktop-cm-session-layout-conflict-summary-remaining').textContent();
    layoutConflictSummaryResolutions = await page.getByTestId('desktop-cm-session-layout-conflict-summary-resolutions').textContent();
    layoutConflictSummaryImport = await page.getByTestId('desktop-cm-session-layout-conflict-summary-import').textContent();
    requireCondition(layoutConflictSummaryProgress?.includes('충돌 2개 중 1개 해결'), 'desktop CM row keep current must update conflict summary progress');
    requireCondition(layoutConflictSummaryRemaining?.includes('남은 1개'), 'desktop CM row keep current must update remaining conflict count');
    requireCondition(layoutConflictSummaryResolutions?.includes('현재 유지 1'), 'desktop CM row keep current must update current resolution count');
    requireCondition(layoutConflictSummaryImport?.includes('skipped 1'), 'desktop CM row keep current must update skipped import count');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('Review Incoming'), 'desktop CM session layout row keep current must resolve only the selected conflict');
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').focus();
    await page.keyboard.press('Enter');
    layoutImportSummary = await page.getByTestId('desktop-cm-session-layout-import-summary').textContent();
    requireCondition(layoutImportSummary?.includes('updated 1'), 'desktop CM session layout row incoming must update only the selected layout');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('Imported'), 'desktop CM session layout conflict incoming must persist incoming layout after explicit choice');
    const layoutRenameImportPath = path.join(layoutImportDir, 'cm-session-layouts-rename.json');
    await writeFile(layoutRenameImportPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'kuviewer.desktop.cmSessionLayouts',
      exportedAt: Date.now(),
      items: [
        {
          name: 'Ops View',
          viewPreferences: {
            sessions: [{ sessionId, group: 'Renamed', favorite: false, updatedAt: Date.now() }],
            collapsedGroups: [],
          },
          updatedAt: Date.now(),
        },
      ],
    }));
    await page.getByTestId('desktop-cm-session-layout-import').setInputFiles(layoutRenameImportPath);
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').waitFor({ state: 'visible', timeout: 10_000 });
    await requireConflictActive(page, 'ops-view', true, 'desktop CM rename conflict preview must activate first row');
    layoutConflictSummaryProgress = await page.getByTestId('desktop-cm-session-layout-conflict-summary-progress').textContent();
    layoutConflictSummaryRemaining = await page.getByTestId('desktop-cm-session-layout-conflict-summary-remaining').textContent();
    requireCondition(layoutConflictSummaryProgress?.includes('충돌 1개 중 0개 해결'), 'desktop CM rename conflict summary must reset progress for a new import');
    requireCondition(layoutConflictSummaryRemaining?.includes('남은 1개'), 'desktop CM rename conflict summary must reset remaining count for a new import');
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').focus();
    await page.keyboard.press('Escape');
    await requireConflictActive(page, 'ops-view', false, 'desktop CM layout conflict Escape must clear active row');
    await page.keyboard.press('Escape');
    await requireTestIdNotFocused(page, 'desktop-cm-session-layout-conflict-preview', 'desktop CM layout conflict second Escape must release preview focus');
    await page.getByTestId('desktop-cm-session-layout-conflict-preview').focus();
    await page.keyboard.press('ArrowDown');
    await requireConflictActive(page, 'ops-view', true, 'desktop CM layout conflict ArrowDown must restore row activation after Escape');
    await page.keyboard.press('r');
    await page.getByTestId('desktop-cm-session-layout-ops-view-import').waitFor({ state: 'visible', timeout: 10_000 });
    layoutImportSummary = await page.getByTestId('desktop-cm-session-layout-import-summary').textContent();
    requireCondition(layoutImportSummary?.includes('new 1'), 'desktop CM session layout row rename must update final import summary');
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(sessionLayoutStorage.includes('Ops View import') && sessionLayoutStorage.includes('Renamed'), 'desktop CM session layout row rename must keep both layouts');
    requireCondition(!sessionLayoutStorage.includes('incomingResolved') && !sessionLayoutStorage.includes('currentResolved') && !sessionLayoutStorage.includes('renamedResolved'), 'desktop CM session layout conflict summary counters must stay memory-only after rename');
    requireCondition(!sessionLayoutStorage.includes('conflict-preview'), 'desktop CM session layout conflict resolution must keep conflict state memory-only');
    await rm(layoutImportDir, { force: true, recursive: true });
    await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('metadata');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM diagnostic stage filter must match metadata sessions');
    await page.getByTestId('desktop-cm-session-diagnostic-severity-filter').selectOption('error');
    await page.getByTestId('desktop-cm-session-search-empty').waitFor({ state: 'visible', timeout: 10_000 });
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('0 / 전체 1'), 'desktop CM diagnostic severity filter must hide non-error sessions');
    await page.getByTestId('desktop-cm-session-diagnostic-filter-clear').click();
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM diagnostic filter clear must restore visible sessions');
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-name').fill('Meta Info');
    await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('metadata');
    await page.getByTestId('desktop-cm-session-diagnostic-severity-filter').selectOption('info');
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-save').click();
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-meta-info').waitFor({ state: 'visible', timeout: 10_000 });
    let diagnosticPresetCount = await page.getByTestId('desktop-cm-diagnostic-filter-preset-count').textContent();
    requireCondition(diagnosticPresetCount?.includes('1 / 8'), 'desktop CM diagnostic saved filter count must update after save');
    let diagnosticFilterStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_diagnostic_filter_presets') || '');
    requireCondition(diagnosticFilterStorage.includes('Meta Info'), 'desktop CM diagnostic saved filters must persist safe preset metadata');
    requireCondition(!diagnosticFilterStorage.includes('credentialAvailable'), 'desktop CM diagnostic saved filters must not include credentialAvailable');
    for (const forbiddenField of ['runtimeStatus', 'diagnosticMessage', 'diagnosticHint', 'serverUrl', 'adminToken', 'BEGIN OPENSSH PRIVATE KEY']) {
      requireCondition(!diagnosticFilterStorage.includes(forbiddenField), `desktop CM diagnostic saved filters must not include ${forbiddenField}`);
    }
    await page.evaluate(() => {
      window.localStorage.setItem('kuviewer_desktop_cm_diagnostic_filter_presets_smoke_keep', '1');
      window.localStorage.setItem('kuviewer_desktop_cm_session_view_preferences_smoke_keep', '1');
      window.localStorage.setItem('kuviewer_desktop_cm_session_layout_presets_smoke_keep', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('desktop-cm-session-panel').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-name').fill('Prod CM');
    await page.getByTestId('desktop-cm-session-host').fill('cm.example.internal');
    await page.getByTestId('desktop-cm-session-port').fill('22');
    await page.getByTestId('desktop-cm-session-user').fill('ubuntu');
    await page.getByTestId('desktop-cm-session-remote-api-host').fill('127.0.0.1');
    await page.getByTestId('desktop-cm-session-remote-api-port').fill('18085');
    await page.getByTestId('desktop-cm-session-description').fill('readonly entry');
    await page.getByTestId('desktop-cm-session-save').click();
    await page.getByTestId(/^desktop-cm-session-prod-cm-/).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-meta-info').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-layout-ops-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-group-production').waitFor({ state: 'visible', timeout: 10_000 });
    const reloadedFavoriteCount = await page.getByTestId('desktop-cm-session-group-favorites-production').textContent();
    requireCondition(reloadedFavoriteCount?.includes('favorite 1'), 'desktop CM group/favorite preferences must apply after reload');
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-meta-info').getByRole('button', { name: /Meta Info metadata \/ info/ }).click();
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM diagnostic saved filters must apply after reload');
    await page.getByTestId('desktop-cm-session-search').fill('prod');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM session search must match session name metadata');
    await page.getByTestId('desktop-cm-session-search').fill('no-match');
    await page.getByTestId('desktop-cm-session-search-empty').waitFor({ state: 'visible', timeout: 10_000 });
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('0 / 전체 1'), 'desktop CM session search must show no-result counts');
    await page.getByTestId('desktop-cm-session-search-clear').click();
    await page.getByTestId(/^desktop-cm-session-prod-cm-/).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: /Prod CM/ }).click();
    await page.getByText('Prod CM 선택됨 · credential 필요').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-summary').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-summary-name').waitFor({ state: 'visible', timeout: 10_000 });
    let summaryText = await page.getByTestId('desktop-cm-session-summary').textContent();
    requireCondition(summaryText?.includes('Prod CM'), 'desktop CM session summary must show the selected session name');
    requireCondition(summaryText?.includes('credential 필요'), 'desktop CM session summary must show credential availability');
    requireCondition(summaryText?.includes('runtime stopped'), 'desktop CM session summary must show stopped runtime status');
    await page.getByTestId('desktop-cm-session-name').fill('Scratch');
    await page.getByTestId('desktop-cm-session-host').fill('scratch.internal');
    await page.getByTestId('desktop-cm-session-fill-selected').click();
    const selectedFillState = {
      name: await page.getByTestId('desktop-cm-session-name').inputValue(),
      host: await page.getByTestId('desktop-cm-session-host').inputValue(),
      user: await page.getByTestId('desktop-cm-session-user').inputValue(),
      apiHost: await page.getByTestId('desktop-cm-session-remote-api-host').inputValue(),
      apiPort: await page.getByTestId('desktop-cm-session-remote-api-port').inputValue(),
    };
    requireCondition(
      selectedFillState.name === 'Prod CM' &&
        selectedFillState.host === 'cm.example.internal' &&
        selectedFillState.user === 'ubuntu' &&
        selectedFillState.apiHost === '127.0.0.1' &&
        selectedFillState.apiPort === '18085',
      'desktop CM selected session fill must copy safe metadata'
    );
    await page.getByTestId('desktop-cm-session-summary-diagnostics').waitFor({ state: 'visible', timeout: 10_000 });
    let diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    let diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('metadata'), 'desktop CM diagnostics must start at metadata stage');
    requireCondition(diagnosticMessage?.includes('not-checked'), 'desktop CM diagnostics must show not-checked message');

    await page.getByTestId(`desktop-cm-session-key-path-${sessionId}`).fill('/tmp/kuviewer-smoke-id_ed25519');
    await page.getByTestId(`desktop-cm-session-import-key-${sessionId}`).click();
    await page.getByText('Prod CM credential 저장됨').waitFor({ state: 'visible', timeout: 10_000 });
    summaryText = await page.getByTestId('desktop-cm-session-summary').textContent();
    requireCondition(summaryText?.includes('credential ready'), 'desktop CM session summary must update credential availability');
    diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('credential'), 'desktop CM diagnostics must show credential stage after private key import');
    requireCondition(diagnosticMessage?.includes('private-key-imported'), 'desktop CM diagnostics must show safe credential import message');
    await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('credential');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM diagnostic stage filter must match credential diagnostics');
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-name').fill('Meta Info');
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-save').click();
    diagnosticPresetCount = await page.getByTestId('desktop-cm-diagnostic-filter-preset-count').textContent();
    requireCondition(diagnosticPresetCount?.includes('1 / 8'), 'desktop CM diagnostic saved filter update must keep same-name presets unique');
    await page.getByTestId('desktop-cm-session-diagnostic-filter-clear').click();
    await page.getByTestId('desktop-cm-diagnostic-filter-preset-meta-info').getByRole('button', { name: /Meta Info credential \/ info/ }).click();
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM updated diagnostic saved filter must apply credential diagnostics');
    await page.getByTestId('desktop-cm-session-diagnostic-filter-clear').click();
    await page.getByTestId(`desktop-cm-session-check-${sessionId}`).click();
    await page.getByText('Prod CM 확인 · 연결 가능').waitFor({ state: 'visible', timeout: 10_000 });
    diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('ssh auth'), 'desktop CM diagnostics must show ssh-auth stage after credential check');
    requireCondition(diagnosticMessage?.includes('ssh-check-succeeded'), 'desktop CM diagnostics must show safe SSH check result');
    await page.getByTestId('desktop-cm-session-search').fill('ssh-check-succeeded');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM session search must match diagnostic message');
    await page.getByTestId('desktop-cm-session-search-clear').click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('desktop-cm-session-export').click();
    const download = await downloadPromise;
    const exportedPath = await download.path();
    requireCondition(typeof exportedPath === 'string', 'desktop CM export must create a downloadable JSON file');
    const exportedBundle = JSON.parse(await readFile(exportedPath, 'utf8'));
    requireCondition(exportedBundle.schemaVersion === 1, 'desktop CM export bundle must include schemaVersion 1');
    requireCondition(exportedBundle.kind === 'kuviewer.desktop.cmSessions', 'desktop CM export bundle must include the CM sessions kind');
    requireCondition(Array.isArray(exportedBundle.items) && exportedBundle.items.length === 1, 'desktop CM export must include saved session metadata');
    const exportedItemKeys = Object.keys(exportedBundle.items[0]).sort();
    requireCondition(
      JSON.stringify(exportedItemKeys) === JSON.stringify(['description', 'host', 'name', 'port', 'remoteApiHost', 'remoteApiPort', 'user']),
      'desktop CM connection profile polish must not change export schema'
    );
    const exportedJson = JSON.stringify(exportedBundle);
    requireCondition(!exportedJson.includes('credentialAvailable'), 'desktop CM export must not include credentialAvailable');
    for (const forbiddenField of [
      'id',
      'credentialStore',
      'authType',
      'runtimeStatus',
      'lastCheckStatus',
      'diagnosticStage',
      'Meta Info',
      'Ops View',
      'Production',
      'favorite',
      'kuviewer_desktop_cm_session_view_preferences',
      'kuviewer_desktop_cm_session_layout_presets',
      'kuviewer.desktop.cmSessionLayouts',
      'serverUrl',
      'adminToken',
      'private-key-imported',
      'BEGIN OPENSSH PRIVATE KEY',
    ]) {
      requireCondition(!exportedJson.includes(forbiddenField), `desktop CM export must not include ${forbiddenField}`);
    }
    requireCondition(!exportedJson.includes('viewPreferences'), 'desktop CM export must not include saved layout preferences');
    requireCondition(!exportedJson.includes('cmSessionLayouts'), 'desktop CM session export must not include layout import/export metadata');

    const importDir = await mkdtemp(path.join(os.tmpdir(), 'kuviewer-cm-import-'));
    const importPath = path.join(importDir, 'cm-sessions.json');
    await writeFile(importPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'kuviewer.desktop.cmSessions',
      exportedAt: Date.now(),
      items: [
        {
          name: 'Prod CM',
          host: 'cm.example.internal',
          port: 22,
          user: 'ubuntu',
          remoteApiHost: '127.0.0.1',
          remoteApiPort: 18085,
          description: 'updated readonly entry',
        },
        {
          name: 'Staging CM',
          host: 'staging-cm.example.internal',
          port: 2222,
          user: 'deploy',
          remoteApiHost: '127.0.0.1',
          remoteApiPort: 18085,
          description: 'imported readonly entry',
        },
        {
          name: '',
          host: 'invalid.example.internal',
          port: 22,
          user: 'deploy',
        },
        {
          name: 'Staging CM',
          host: 'staging-cm.example.internal',
          port: 2222,
          user: 'deploy',
          remoteApiHost: '127.0.0.1',
          remoteApiPort: 18085,
        },
      ],
    }));
    await page.getByTestId('desktop-cm-session-import').setInputFiles(importPath);
    await page.getByTestId('desktop-cm-session-import-summary').waitFor({ state: 'visible', timeout: 10_000 });
    const importSummary = await page.getByTestId('desktop-cm-session-import-summary').textContent();
    requireCondition(importSummary?.includes('new 1'), 'desktop CM import must report newly imported sessions');
    requireCondition(importSummary?.includes('updated 1'), 'desktop CM import must report updated sessions');
    requireCondition(importSummary?.includes('skipped 1'), 'desktop CM import must report skipped duplicate sessions');
    requireCondition(importSummary?.includes('invalid 1'), 'desktop CM import must report invalid sessions');
    const importedState = await page.evaluate(() => ({
      sessions: window.__kuviewerCmSessions,
      invocations: window.__kuviewerDesktopInvocations,
    }));
    requireCondition(importedState.sessions.length === 2, 'desktop CM import must add one session and update the existing matching session');
    const importedProd = importedState.sessions.find((session) => session.name === 'Prod CM');
    const importedStaging = importedState.sessions.find((session) => session.name === 'Staging CM');
    requireCondition(importedProd?.description === 'updated readonly entry', 'desktop CM import must update the matching existing session');
    requireCondition(importedStaging?.credentialAvailable === false, 'desktop CM import must not import credentials for new sessions');
    requireCondition(!JSON.stringify(importedState.invocations).includes('BEGIN OPENSSH PRIVATE KEY'), 'desktop CM import must not expose private key bodies');
    await rm(importDir, { force: true, recursive: true });

    await page.getByTestId('desktop-cm-session-bulk-select-visible').click();
    await page.getByTestId('desktop-cm-session-bulk-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
    let bulkCount = await page.getByTestId('desktop-cm-session-bulk-count').textContent();
    requireCondition(bulkCount?.includes('선택 2개'), 'desktop CM bulk select visible must select current results');
    await page.getByTestId('desktop-cm-session-bulk-group-input').fill('Operations');
    await page.getByTestId('desktop-cm-session-bulk-group-apply').click();
    await page.getByTestId('desktop-cm-session-group-operations').waitFor({ state: 'visible', timeout: 10_000 });
    groupCount = await page.getByTestId('desktop-cm-session-group-count-operations').textContent();
    requireCondition(groupCount?.includes('2 / 2'), 'desktop CM bulk group move must update selected session groups');
    await page.getByTestId('desktop-cm-session-bulk-favorite-on').click();
    const operationsFavoriteCount = await page.getByTestId('desktop-cm-session-group-favorites-operations').textContent();
    requireCondition(operationsFavoriteCount?.includes('favorite 2'), 'desktop CM bulk favorite must update selected favorite counts');
    const selectedDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('desktop-cm-session-bulk-export').click();
    const selectedDownload = await selectedDownloadPromise;
    const selectedExportPath = await selectedDownload.path();
    requireCondition(typeof selectedExportPath === 'string', 'desktop CM selected export must create a downloadable JSON file');
    const selectedExportBundle = JSON.parse(await readFile(selectedExportPath, 'utf8'));
    requireCondition(Array.isArray(selectedExportBundle.items) && selectedExportBundle.items.length === 2, 'desktop CM selected export must include selected sessions only');
    const selectedExportJson = JSON.stringify(selectedExportBundle);
    for (const forbiddenField of [
      'Operations',
      'favorite',
      'kuviewer_desktop_cm_session_view_preferences',
      'kuviewer_desktop_cm_session_layout_presets',
      'kuviewer.desktop.cmSessionLayouts',
      'Ops View',
      'viewPreferences',
      'credentialAvailable',
      'diagnosticMessage',
      'serverUrl',
      'adminToken',
    ]) {
      requireCondition(!selectedExportJson.includes(forbiddenField), `desktop CM selected export must not include ${forbiddenField}`);
    }
    requireCondition(!selectedExportJson.includes('kuviewer_desktop_cm_session_view_preferences'), 'desktop CM selected export must not include grouping preferences');
    await page.getByTestId('desktop-cm-session-bulk-clear-toolbar').click();
    await page.getByTestId('desktop-cm-session-bulk-toolbar').waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-group-select-input-operations').check();
    bulkCount = await page.getByTestId('desktop-cm-session-bulk-count').textContent();
    requireCondition(bulkCount?.includes('선택 2개'), 'desktop CM group bulk checkbox must select visible group sessions');
    await page.getByTestId('desktop-cm-session-bulk-clear').click();
    const editCancelButtonVisible = await page.getByTestId('desktop-cm-session-edit-cancel').isVisible().catch(() => false);
    if (editCancelButtonVisible) {
      await page.getByTestId('desktop-cm-session-edit-cancel').click();
    }
    await page.getByTestId('desktop-cm-session-name').fill('Bulk Delete CM');
    await page.getByTestId('desktop-cm-session-host').fill('bulk-delete.example.internal');
    await page.getByTestId('desktop-cm-session-port').fill('22');
    await page.getByTestId('desktop-cm-session-user').fill('ubuntu');
    await page.getByTestId('desktop-cm-session-remote-api-host').fill('127.0.0.1');
    await page.getByTestId('desktop-cm-session-remote-api-port').fill('18085');
    await page.getByTestId('desktop-cm-session-description').fill('temporary bulk delete entry');
    await page.getByTestId('desktop-cm-session-save').click();
    const bulkDeleteSessionId = await page.evaluate(() => window.__kuviewerCmSessions.find((session) => session.name === 'Bulk Delete CM')?.id);
    requireCondition(typeof bulkDeleteSessionId === 'string', 'desktop CM bulk delete setup must create a temporary session');
    await page.getByTestId(`desktop-cm-session-bulk-select-input-${bulkDeleteSessionId}`).check();
    await page.getByTestId('desktop-cm-session-bulk-delete').click();
    let bulkDeleteState = await page.evaluate(() => window.__kuviewerCmSessions.length);
    requireCondition(bulkDeleteState === 3, `desktop CM bulk delete must require inline confirmation; got ${bulkDeleteState}`);
    await page.getByTestId('desktop-cm-session-bulk-delete').click();
    await page.getByText('CM/SSH session 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });
    bulkDeleteState = await page.evaluate(() => window.__kuviewerCmSessions.length);
    requireCondition(bulkDeleteState === 2, 'desktop CM bulk delete confirmation must remove selected sessions');
    await page.getByTestId('desktop-cm-session-layout-delete-ops-view').click();
    await page.getByTestId('desktop-cm-session-layout-delete-review-view').click();
    await page.getByTestId('desktop-cm-session-layout-delete-ops-view-import').click();
    await page.getByTestId('desktop-cm-session-layout-empty').waitFor({ state: 'visible', timeout: 10_000 });
    sessionLayoutStorage = await page.evaluate(() => window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '');
    requireCondition(!sessionLayoutStorage.includes('Ops View'), 'desktop CM session layout delete must remove saved layout');

    await page.getByTestId(`desktop-cm-session-start-runtime-${sessionId}`).click();
    await page.getByText('Prod CM runtime 시작됨').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByText(/runtime active · Prod CM/).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-summary-health').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-summary-runtime-url').waitFor({ state: 'visible', timeout: 10_000 });
    summaryText = await page.getByTestId('desktop-cm-session-summary').textContent();
    requireCondition(summaryText?.includes('runtime active'), 'desktop CM session summary must show active runtime status');
    requireCondition(summaryText?.includes('health 정상'), 'desktop CM session summary must show runtime health');
    diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('health'), 'desktop CM diagnostics must show health stage after runtime start');
    requireCondition(diagnosticMessage?.includes('healthz-ok'), 'desktop CM diagnostics must show safe health message');
    await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('health');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 2'), 'desktop CM diagnostic stage filter must prefer active runtime diagnostics');
    await page.getByTestId('desktop-cm-session-diagnostic-filter-clear').click();
    const runtimeState = await page.evaluate(() => ({
      profile: JSON.parse(window.sessionStorage.getItem('kuviewer_desktop_cm_runtime_profile') || 'null'),
      sourceMode: window.sessionStorage.getItem('kuviewer_source_mode'),
    }));
    requireCondition(runtimeState.profile?.serverUrl === 'http://127.0.0.1:18123', 'desktop CM runtime profile must use localhost tunnel URL');
    requireCondition(runtimeState.profile?.remoteApiHost === '127.0.0.1', 'desktop CM runtime profile must include remote API host metadata');
    requireCondition(runtimeState.profile?.healthStatus === 'healthy', 'desktop CM runtime profile must include health status metadata');
    requireCondition(runtimeState.sourceMode === 'live', 'desktop CM runtime start must switch source mode to live');

    await page.getByTestId(`desktop-cm-session-clone-${sessionId}`).click();
    await page.getByTestId('desktop-cm-session-clone-draft').waitFor({ state: 'visible', timeout: 10_000 });
    const cloneDraftState = {
      name: await page.getByTestId('desktop-cm-session-name').inputValue(),
      host: await page.getByTestId('desktop-cm-session-host').inputValue(),
      port: await page.getByTestId('desktop-cm-session-port').inputValue(),
      user: await page.getByTestId('desktop-cm-session-user').inputValue(),
      apiHost: await page.getByTestId('desktop-cm-session-remote-api-host').inputValue(),
      apiPort: await page.getByTestId('desktop-cm-session-remote-api-port').inputValue(),
      description: await page.getByTestId('desktop-cm-session-description').inputValue(),
      draftText: await page.getByTestId('desktop-cm-session-clone-draft').textContent(),
    };
    requireCondition(
      cloneDraftState.name === 'Prod CM copy' &&
        cloneDraftState.host === 'cm.example.internal' &&
        cloneDraftState.port === '22' &&
        cloneDraftState.user === 'ubuntu' &&
        cloneDraftState.apiHost === '127.0.0.1' &&
        cloneDraftState.apiPort === '18085' &&
        cloneDraftState.description === 'updated readonly entry',
      'desktop CM clone draft must copy only safe editable metadata'
    );
    requireCondition(cloneDraftState.draftText?.includes('credential/runtime 제외'), 'desktop CM clone draft must warn that credentials and runtime are excluded');
    await page.getByTestId('desktop-cm-session-save').click();
    await page.getByTestId('desktop-cm-session-clone-draft').waitFor({ state: 'hidden', timeout: 10_000 });
    const clonedSessionState = await page.evaluate(() => {
      const cloned = window.__kuviewerCmSessions.find((session) => session.name === 'Prod CM copy');
      return {
        count: window.__kuviewerCmSessions.length,
        cloned,
        runtimeProfile: window.__kuviewerCmRuntimeProfile,
        exportedDiagnosticFilters: window.localStorage.getItem('kuviewer_desktop_cm_diagnostic_filter_presets') || '',
      };
    });
    requireCondition(clonedSessionState.count === 3, 'desktop CM clone save must create one additional session after explicit save');
    requireCondition(clonedSessionState.cloned?.credentialAvailable === false, 'desktop CM clone must not copy credential availability');
    requireCondition(clonedSessionState.cloned?.runtimeStatus === 'stopped', 'desktop CM clone must not copy runtime state');
    requireCondition(clonedSessionState.cloned?.lastCheckStatus === 'not-checked', 'desktop CM clone must not copy diagnostic history');
    requireCondition(clonedSessionState.runtimeProfile?.sessionId === sessionId, 'desktop CM clone must not replace the active runtime profile');
    requireCondition(!JSON.stringify(clonedSessionState.cloned).includes('healthz-ok'), 'desktop CM clone must not copy runtime diagnostics');
    requireCondition(!clonedSessionState.exportedDiagnosticFilters.includes('Prod CM copy'), 'desktop CM clone must not write session data into diagnostic saved filters');
    await page.getByTestId(`desktop-cm-session-clone-${sessionId}`).click();
    await page.getByTestId('desktop-cm-session-clone-draft').waitFor({ state: 'visible', timeout: 10_000 });
    const secondCloneDraftName = await page.getByTestId('desktop-cm-session-name').inputValue();
    requireCondition(secondCloneDraftName === 'Prod CM copy 2', 'desktop CM clone draft must avoid existing clone names with a copy suffix');
    await page.getByTestId('desktop-cm-session-clone-cancel').click();
    await page.getByTestId('desktop-cm-session-clone-draft').waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-delete-${clonedSessionState.cloned.id}`).click();
    await page.getByTestId(`desktop-cm-session-delete-${clonedSessionState.cloned.id}`).click();
    await page.getByText('CM/SSH session 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });

    await page.getByTestId(`desktop-cm-session-runtime-detail-${sessionId}`).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-check-runtime-${sessionId}`).click();
    await page.getByText('Prod CM health · 정상').waitFor({ state: 'visible', timeout: 10_000 });
    diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    requireCondition(diagnosticMessage?.includes('healthz-ok'), 'desktop CM diagnostics must stay fresh after runtime health recheck');
    await page.getByTestId(`desktop-cm-session-stop-runtime-${sessionId}`).click();
    await page.getByText('CM/SSH runtime 중지됨').waitFor({ state: 'visible', timeout: 10_000 });
    diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('runtime'), 'desktop CM diagnostics must show runtime stage after stop');
    requireCondition(diagnosticMessage?.includes('runtime-stopped'), 'desktop CM diagnostics must show runtime-stopped message');
    const stoppedRuntimeProfile = await page.evaluate(() => window.sessionStorage.getItem('kuviewer_desktop_cm_runtime_profile'));
    requireCondition(stoppedRuntimeProfile === null, 'desktop CM runtime stop must clear the session runtime profile');
    await page.getByTestId(`desktop-cm-session-start-runtime-${sessionId}`).click();
    await page.getByText('Prod CM runtime 시작됨').waitFor({ state: 'visible', timeout: 10_000 });
    await page.evaluate(() => {
      window.__kuviewerCmRuntimeLost = true;
    });
    await page.getByTestId(`desktop-cm-session-check-runtime-${sessionId}`).click();
    await page.getByText('CM/SSH runtime 끊김').waitFor({ state: 'visible', timeout: 10_000 });
    summaryText = await page.getByTestId('desktop-cm-session-summary').textContent();
    requireCondition(summaryText?.includes('runtime 끊김'), 'desktop CM session summary must show lost runtime status');
    diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('runtime'), 'desktop CM diagnostics must show runtime stage after lost runtime');
    requireCondition(diagnosticMessage?.includes('runtime-lost'), 'desktop CM diagnostics must show runtime-lost message');
    await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('runtime');
    await page.getByTestId('desktop-cm-session-diagnostic-severity-filter').selectOption('error');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 2'), 'desktop CM diagnostic filters must match runtime error diagnostics');
    await page.getByTestId('desktop-cm-session-diagnostic-filter-clear').click();
    await page.getByTestId('desktop-cm-session-search').fill('runtime-lost');
    sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 2'), 'desktop CM session search must match runtime diagnostic message');
    await page.getByTestId('desktop-cm-session-search-clear').click();
    const lostRuntimeProfile = await page.evaluate(() => window.sessionStorage.getItem('kuviewer_desktop_cm_runtime_profile'));
    requireCondition(lostRuntimeProfile === null, 'desktop CM runtime lost must clear the session runtime profile');
    await page.getByTestId(`desktop-cm-session-delete-credential-${sessionId}`).click();
    await page.getByTestId(`desktop-cm-session-delete-credential-${sessionId}`).click();
    await page.getByText('Prod CM credential 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });
    const stagingSessionId = await page.evaluate(() => window.__kuviewerCmSessions.find((session) => session.name === 'Staging CM')?.id);
    requireCondition(typeof stagingSessionId === 'string', 'desktop CM import must create a deletable staging session');
    await page.getByTestId(`desktop-cm-session-delete-${stagingSessionId}`).click();
    await page.getByTestId(`desktop-cm-session-delete-${stagingSessionId}`).click();
    await page.getByText('CM/SSH session 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-delete-${sessionId}`).click();
    await page.getByTestId(`desktop-cm-session-delete-${sessionId}`).click();
    await page.getByText('CM/SSH session 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });

    const state = await page.evaluate(() => ({
      localToken: window.localStorage.getItem('kuviewer_admin_token'),
      legacyProfile: window.localStorage.getItem('kuviewer_desktop_connection_profile'),
      sessionToken: window.sessionStorage.getItem('kuviewer_admin_token'),
      runtimeProfile: window.sessionStorage.getItem('kuviewer_desktop_cm_runtime_profile'),
      sessions: window.__kuviewerCmSessions,
      invocations: window.__kuviewerDesktopInvocations,
      oldSidecarPanel: Boolean(document.querySelector('[data-testid="desktop-use-sidecar-profile"]')),
      oldKubernetesPanel: Boolean(document.querySelector('[data-testid="desktop-kubernetes-profile-panel"]')),
    }));
    const invocationsJson = JSON.stringify(state.invocations);

    requireCondition(state.localToken === null, 'desktop CM smoke must not store admin token in localStorage');
    requireCondition(state.legacyProfile === null, 'desktop CM smoke must clear the legacy desktop API profile');
    requireCondition(state.sessionToken === null, 'desktop CM smoke must not store admin token in sessionStorage');
    requireCondition(state.runtimeProfile === null, 'desktop CM smoke must clear runtime profile after stop');
    requireCondition(Array.isArray(state.sessions) && state.sessions.length === 0, 'desktop CM delete must remove the saved session');
    requireCondition(!invocationsJson.includes('BEGIN OPENSSH PRIVATE KEY'), 'desktop CM smoke must not expose private key bodies to browser state');
    requireCondition(state.oldSidecarPanel === false, 'desktop product UI must not show the local sidecar switch');
    requireCondition(state.oldKubernetesPanel === false, 'desktop product UI must not show the keychain Kubernetes prototype panel');
    await page.evaluate(() => {
      window.localStorage.removeItem('kuviewer_desktop_cm_diagnostic_filter_presets');
      window.localStorage.removeItem('kuviewer_desktop_cm_diagnostic_filter_presets_smoke_keep');
      window.localStorage.removeItem('kuviewer_desktop_cm_session_view_preferences');
      window.localStorage.removeItem('kuviewer_desktop_cm_session_view_preferences_smoke_keep');
      window.localStorage.removeItem('kuviewer_desktop_cm_session_layout_presets');
      window.localStorage.removeItem('kuviewer_desktop_cm_session_layout_presets_smoke_keep');
    });
    requireCommandOrder(state.invocations, [
      'desktop_cm_sessions',
      'desktop_cm_session_runtime',
      'desktop_save_cm_session',
      'desktop_select_cm_session',
      'desktop_import_cm_session_private_key',
      'desktop_check_cm_session',
      'desktop_start_cm_session_runtime',
      'desktop_check_cm_session_runtime',
      'desktop_stop_cm_session_runtime',
      'desktop_start_cm_session_runtime',
      'desktop_check_cm_session_runtime',
      'desktop_delete_cm_session_credential',
      'desktop_delete_cm_session',
    ]);
  } finally {
    await page.close();
  }
}

async function smokeWebRuntime(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('source-mode-upload').waitFor({ state: 'visible', timeout: 10_000 });
    const visible = await page.getByTestId('desktop-cm-session-panel').isVisible().catch(() => false);
    requireCondition(visible === false, 'web runtime must not expose desktop CM/SSH session UI');
  } finally {
    await page.close();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--url') {
      parsed.url = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--output') {
      parsed.output = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

async function waitForPreview(url) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`preview_not_ready:${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error('preview_not_ready');
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildScreenshotClip(boxes, viewport, padding = 0) {
  const visibleBoxes = boxes.filter(Boolean);
  requireCondition(visibleBoxes.length > 0, 'desktop CM session visual regression screenshot must have visible target boxes');
  const left = Math.min(...visibleBoxes.map((box) => box.x));
  const top = Math.min(...visibleBoxes.map((box) => box.y));
  const right = Math.max(...visibleBoxes.map((box) => box.x + box.width));
  const bottom = Math.max(...visibleBoxes.map((box) => box.y + box.height));
  const viewportWidth = viewport?.width || Math.ceil(right + padding);
  const viewportHeight = viewport?.height || Math.ceil(bottom + padding);
  const x = Math.max(0, Math.floor(left - padding));
  const y = Math.max(0, Math.floor(top - padding));
  const maxRight = Math.min(viewportWidth, Math.ceil(right + padding));
  const maxBottom = Math.min(viewportHeight, Math.ceil(bottom + padding));
  return {
    x,
    y,
    width: Math.max(1, maxRight - x),
    height: Math.max(1, maxBottom - y),
  };
}

async function cleanDesktopSmokeScreenshotArtifacts(outputDir) {
  await mkdir(outputDir, { recursive: true });
  const artifactPaths = [...desktopSmokeScreenshotFileNames, ...desktopSmokeScreenshotMetadataFileNames].map((fileName) => path.join(outputDir, fileName));
  await Promise.all(artifactPaths.map((filePath) => rm(filePath, { force: true })));
  return artifactPaths;
}

async function cleanDesktopSmokeArtifactHygieneSentinels(outputDir) {
  await mkdir(outputDir, { recursive: true });
  const artifactPaths = desktopSmokeArtifactHygieneFileNames.map((fileName) => path.join(outputDir, fileName));
  await Promise.all(artifactPaths.map((filePath) => rm(filePath, { force: true })));
  return artifactPaths;
}

async function listDesktopSmokeArtifactFileNames(outputDir) {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function buildScreenshotMetadata({ clip, fileName, image, marker, token }) {
  return {
    schemaVersion: 1,
    kind: 'kuviewer.desktopCm.visualRegressionScreenshot',
    fileName,
    marker,
    token,
    capturedAt: new Date().toISOString(),
    byteLength: image.byteLength,
    width: image.width,
    height: image.height,
    clipWidth: Math.round(clip.width),
    clipHeight: Math.round(clip.height),
  };
}

async function readPngMetadata(filePath) {
  const buffer = await readFile(filePath);
  const isPng =
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  return {
    byteLength: buffer.length,
    height: isPng ? buffer.readUInt32BE(20) : 0,
    isPng,
    width: isPng ? buffer.readUInt32BE(16) : 0,
  };
}

async function requireConflictActive(page, slug, expected, message) {
  const ariaCurrent = await page.getByTestId(`desktop-cm-session-layout-conflict-${slug}`).getAttribute('aria-current');
  requireCondition((ariaCurrent === 'true') === expected, message);
}

async function requireLayoutFolderActive(page, slug, expected, message) {
  const ariaCurrent = await page.getByTestId(`desktop-cm-session-layout-folder-${slug}`).getAttribute('aria-current');
  requireCondition((ariaCurrent === 'true') === expected, message);
}

async function requireTestIdFocused(page, testId, message) {
  await page.waitForFunction((expectedTestId) => document.activeElement?.getAttribute('data-testid') === expectedTestId, testId, { timeout: 5_000 }).catch(() => null);
  const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || '');
  requireCondition(focusedTestId === testId, message);
}

async function requireTestIdTextIncludes(page, testId, expectedText) {
  await page.waitForFunction(
    ([expectedTestId, text]) => document.querySelector(`[data-testid="${expectedTestId}"]`)?.textContent?.includes(text),
    [testId, expectedText],
    { timeout: 5_000 },
  );
}

async function requireTestIdNotFocused(page, testId, message) {
  await page.waitForFunction((expectedTestId) => document.activeElement?.getAttribute('data-testid') !== expectedTestId, testId, { timeout: 5_000 }).catch(() => null);
  const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || '');
  requireCondition(focusedTestId !== testId, message);
}

function requireCommandOrder(invocations, expectedOrder) {
  const commands = invocations.map((item) => item.command);
  let cursor = 0;
  for (const command of commands) {
    if (command === expectedOrder[cursor]) {
      cursor += 1;
      if (cursor === expectedOrder.length) {
        return;
      }
    }
  }
  throw new Error(`expected command order ${expectedOrder.join(' -> ')}, saw ${commands.join(' -> ')}`);
}
