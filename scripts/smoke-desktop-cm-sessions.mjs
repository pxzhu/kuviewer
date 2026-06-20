import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const playwrightUrl = pathToFileURL(path.join(repoRoot, 'website', 'node_modules', 'playwright', 'index.mjs')).href;
const { chromium } = await import(playwrightUrl);

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.url || process.env.KUVIEWER_DESKTOP_SMOKE_URL || 'http://127.0.0.1:4174/kuviewer/';

await waitForPreview(baseUrl);

const browser = await chromium.launch();

try {
  await smokeDesktopRuntime(browser, baseUrl);
  await smokeWebRuntime(browser, baseUrl);
  console.log(JSON.stringify({ ok: true, url: baseUrl, smoke: 'desktop-cm-sessions' }, null, 2));
} finally {
  await browser.close();
}

async function smokeDesktopRuntime(browser, url) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.localStorage.removeItem('kuviewer_admin_token');
      window.localStorage.removeItem('kuviewer_desktop_connection_profile');
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
              const existingSession = args.session.id
                ? window.__kuviewerCmSessions.find((item) => item.id === args.session.id)
                : null;
              const session = {
                id: args.session.id || `prod-cm-${now}`,
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
    await page.getByTestId('desktop-cm-session-name').fill('Prod CM');
    await page.getByTestId('desktop-cm-session-host').fill('cm.example.internal');
    await page.getByTestId('desktop-cm-session-port').fill('22');
    await page.getByTestId('desktop-cm-session-user').fill('ubuntu');
    await page.getByTestId('desktop-cm-session-remote-api-host').fill('127.0.0.1');
    await page.getByTestId('desktop-cm-session-remote-api-port').fill('18085');
    await page.getByTestId('desktop-cm-session-description').fill('readonly entry');
    await page.getByTestId('desktop-cm-session-save').click();
    await page.getByTestId(/^desktop-cm-session-prod-cm-/).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('desktop-cm-session-search-count').waitFor({ state: 'visible', timeout: 10_000 });
    let sessionSearchCount = await page.getByTestId('desktop-cm-session-search-count').textContent();
    requireCondition(sessionSearchCount?.includes('1 / 전체 1'), 'desktop CM session search count must include visible and total session counts');
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
    await page.getByTestId('desktop-cm-session-summary-diagnostics').waitFor({ state: 'visible', timeout: 10_000 });
    let diagnosticMessage = await page.getByTestId('desktop-cm-session-summary-diagnostics-message').textContent();
    let diagnosticStage = await page.getByTestId('desktop-cm-session-summary-diagnostics-stage').textContent();
    requireCondition(diagnosticStage?.includes('metadata'), 'desktop CM diagnostics must start at metadata stage');
    requireCondition(diagnosticMessage?.includes('not-checked'), 'desktop CM diagnostics must show not-checked message');

    const sessionId = await page.evaluate(() => window.__kuviewerCmSessions[0]?.id);
    requireCondition(typeof sessionId === 'string' && sessionId.startsWith('prod-cm-'), 'saved CM session id must be generated');
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
    const exportedJson = JSON.stringify(exportedBundle);
    requireCondition(!exportedJson.includes('credentialAvailable'), 'desktop CM export must not include credentialAvailable');
    for (const forbiddenField of [
      'id',
      'credentialStore',
      'authType',
      'runtimeStatus',
      'lastCheckStatus',
      'diagnosticStage',
      'serverUrl',
      'adminToken',
      'private-key-imported',
      'BEGIN OPENSSH PRIVATE KEY',
    ]) {
      requireCondition(!exportedJson.includes(forbiddenField), `desktop CM export must not include ${forbiddenField}`);
    }

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
