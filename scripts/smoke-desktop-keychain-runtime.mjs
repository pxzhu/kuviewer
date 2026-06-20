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
const page = await browser.newPage();

try {
  await page.addInitScript(() => {
    window.localStorage.removeItem('kuviewer_admin_token');
    window.localStorage.removeItem('kuviewer_desktop_connection_profile');
    window.sessionStorage.removeItem('kuviewer_admin_token');
    window.sessionStorage.removeItem('kuviewer_source_mode');
    window.__kuviewerSelected = false;
    window.__kuviewerDesktopInvocations = [];
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          window.__kuviewerDesktopInvocations.push({ command, args });
          if (command === 'desktop_sidecar_profile') {
            return {
              serverUrl: 'http://127.0.0.1:18086',
              adminToken: window.__kuviewerSelected ? 'smoke-sidecar-token' : 'smoke-mock-token',
              source: window.__kuviewerSelected ? 'kubernetes' : 'mock',
              kubernetesProfileId: window.__kuviewerSelected ? 'env-bearer-profile' : undefined,
            };
          }
          if (command === 'desktop_kubernetes_profiles') {
            return [
              {
                id: 'env-bearer-profile',
                displayName: 'Environment bearer profile',
                apiServer: 'https://cluster.example.invalid',
                authType: 'bearer-token',
                credentialStore: 'native-smoke-store',
                credentialAvailable: true,
                selected: false,
                status: 'stored-secret-available',
              },
            ];
          }
          if (command === 'desktop_select_kubernetes_profile') {
            window.__kuviewerSelected = true;
            return {
              id: args.profileId,
              displayName: 'Environment bearer profile',
              apiServer: 'https://cluster.example.invalid',
              authType: 'bearer-token',
              credentialStore: 'native-smoke-store',
              credentialAvailable: true,
              selected: true,
              status: 'sidecar-kubernetes-active',
            };
          }
          if (command === 'desktop_delete_kubernetes_profile_credential') {
            window.__kuviewerSelected = false;
            return {
              id: args.profileId,
              displayName: 'Environment bearer profile',
              apiServer: 'https://cluster.example.invalid',
              authType: 'bearer-token',
              credentialStore: 'native-smoke-store',
              credentialAvailable: false,
              selected: false,
              status: 'credential-deleted',
            };
          }
          throw new Error(`unexpected_tauri_command:${command}`);
        },
      },
    };
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('desktop-kubernetes-profile-panel').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('desktop-kubernetes-profile-env-bearer-profile')
    .getByRole('button', { name: 'Environment bearer profile' })
    .click();
  await page.getByText('Environment bearer profile 연결됨 · token은 native/runtime file 경로만 사용')
    .waitFor({ state: 'visible', timeout: 10_000 });

  const selectedState = await page.evaluate(() => ({
    localToken: window.localStorage.getItem('kuviewer_admin_token'),
    sessionToken: window.sessionStorage.getItem('kuviewer_admin_token'),
    sourceMode: window.sessionStorage.getItem('kuviewer_source_mode'),
    invocations: window.__kuviewerDesktopInvocations,
  }));

  requireCondition(selectedState.localToken === null, 'desktop smoke must not store admin token in localStorage');
  requireCondition(selectedState.sessionToken === 'smoke-sidecar-token', 'profile select must store the sidecar token in sessionStorage');
  requireCondition(selectedState.sourceMode === 'live', 'profile select must switch source mode to live');
  requireCommandOrder(selectedState.invocations, [
    'desktop_sidecar_profile',
    'desktop_kubernetes_profiles',
    'desktop_select_kubernetes_profile',
    'desktop_sidecar_profile',
  ]);

  await page.getByTestId('desktop-kubernetes-profile-delete-env-bearer-profile').click();
  await page.getByText('Environment bearer profile credential 삭제됨').waitFor({ state: 'visible', timeout: 10_000 });

  const deletedState = await page.evaluate(() => ({
    localToken: window.localStorage.getItem('kuviewer_admin_token'),
    sessionToken: window.sessionStorage.getItem('kuviewer_admin_token'),
    invocations: window.__kuviewerDesktopInvocations,
  }));

  requireCondition(deletedState.localToken === null, 'active credential delete must keep localStorage admin token empty');
  requireCondition(deletedState.sessionToken === null, 'active credential delete must clear sessionStorage admin token');
  requireCommandOrder(deletedState.invocations, [
    'desktop_select_kubernetes_profile',
    'desktop_sidecar_profile',
    'desktop_delete_kubernetes_profile_credential',
    'desktop_sidecar_profile',
  ]);

  console.log(JSON.stringify({
    ok: true,
    url: baseUrl,
    selectedCommands: selectedState.invocations.map((item) => item.command),
    deletedCommands: deletedState.invocations.map((item) => item.command),
  }, null, 2));
} finally {
  await browser.close();
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
