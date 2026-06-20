import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      window.sessionStorage.removeItem('kuviewer_source_mode');
      window.__kuviewerCmSessions = [];
      window.__kuviewerDesktopInvocations = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            window.__kuviewerDesktopInvocations.push({ command, args });
            if (command === 'desktop_cm_sessions') {
              return window.__kuviewerCmSessions;
            }
            if (command === 'desktop_save_cm_session') {
              const now = Date.now();
              const session = {
                id: args.session.id || `prod-cm-${now}`,
                name: args.session.name,
                host: args.session.host,
                port: args.session.port,
                user: args.session.user,
                description: args.session.description,
                authType: 'os-credential-store',
                credentialStore: 'native-smoke-store',
                credentialAvailable: false,
                status: 'metadata-only',
                updatedAt: now,
                selected: false,
                lastCheckStatus: 'not-checked',
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
                  updatedAt: Date.now(),
                  lastCheckStatus: 'credential-ready',
                  lastCheckAt: Date.now(),
                  lastCheckMessage: 'private-key-imported',
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
                  updatedAt: Date.now(),
                  lastCheckStatus: 'reachable',
                  lastCheckAt: Date.now(),
                  lastCheckMessage: session.credentialAvailable ? 'ssh-check-succeeded' : 'tcp-reachable',
                };
                return checked;
              });
              if (!checked) {
                throw new Error('desktop_cm_session_not_found');
              }
              return checked;
            }
            if (command === 'desktop_delete_cm_session_credential') {
              let updated = null;
              window.__kuviewerCmSessions = window.__kuviewerCmSessions.map((session) => {
                if (session.id !== args.sessionId) {
                  return session;
                }
                updated = {
                  ...session,
                  credentialAvailable: false,
                  status: 'credential-deleted',
                  updatedAt: Date.now(),
                  lastCheckStatus: 'credential-deleted',
                  lastCheckAt: Date.now(),
                  lastCheckMessage: 'credential-deleted',
                };
                return updated;
              });
              if (!updated) {
                throw new Error('desktop_cm_session_not_found');
              }
              return updated;
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
    await page.getByTestId('desktop-cm-session-description').fill('readonly entry');
    await page.getByTestId('desktop-cm-session-save').click();
    await page.getByTestId(/^desktop-cm-session-prod-cm-/).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: /Prod CM/ }).click();
    await page.getByText('Prod CM 선택됨 · credential 필요').waitFor({ state: 'visible', timeout: 10_000 });

    const sessionId = await page.evaluate(() => window.__kuviewerCmSessions[0]?.id);
    requireCondition(typeof sessionId === 'string' && sessionId.startsWith('prod-cm-'), 'saved CM session id must be generated');
    await page.getByTestId(`desktop-cm-session-key-path-${sessionId}`).fill('/tmp/kuviewer-smoke-id_ed25519');
    await page.getByTestId(`desktop-cm-session-import-key-${sessionId}`).click();
    await page.getByText('Prod CM credential 저장됨').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-check-${sessionId}`).click();
    await page.getByText('Prod CM 확인 · 연결 가능').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-delete-credential-${sessionId}`).click();
    await page.getByTestId(`desktop-cm-session-delete-credential-${sessionId}`).click();
    await page.getByText('Prod CM credential 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(`desktop-cm-session-delete-${sessionId}`).click();
    await page.getByTestId(`desktop-cm-session-delete-${sessionId}`).click();
    await page.getByText('CM/SSH session 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });

    const state = await page.evaluate(() => ({
      localToken: window.localStorage.getItem('kuviewer_admin_token'),
      legacyProfile: window.localStorage.getItem('kuviewer_desktop_connection_profile'),
      sessionToken: window.sessionStorage.getItem('kuviewer_admin_token'),
      sessions: window.__kuviewerCmSessions,
      invocations: window.__kuviewerDesktopInvocations,
      oldSidecarPanel: Boolean(document.querySelector('[data-testid="desktop-use-sidecar-profile"]')),
      oldKubernetesPanel: Boolean(document.querySelector('[data-testid="desktop-kubernetes-profile-panel"]')),
    }));
    const invocationsJson = JSON.stringify(state.invocations);

    requireCondition(state.localToken === null, 'desktop CM smoke must not store admin token in localStorage');
    requireCondition(state.legacyProfile === null, 'desktop CM smoke must clear the legacy desktop API profile');
    requireCondition(state.sessionToken === null, 'desktop CM smoke must not store admin token in sessionStorage');
    requireCondition(Array.isArray(state.sessions) && state.sessions.length === 0, 'desktop CM delete must remove the saved session');
    requireCondition(!invocationsJson.includes('BEGIN OPENSSH PRIVATE KEY'), 'desktop CM smoke must not expose private key bodies to browser state');
    requireCondition(state.oldSidecarPanel === false, 'desktop product UI must not show the local sidecar switch');
    requireCondition(state.oldKubernetesPanel === false, 'desktop product UI must not show the keychain Kubernetes prototype panel');
    requireCommandOrder(state.invocations, [
      'desktop_cm_sessions',
      'desktop_save_cm_session',
      'desktop_select_cm_session',
      'desktop_import_cm_session_private_key',
      'desktop_check_cm_session',
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
