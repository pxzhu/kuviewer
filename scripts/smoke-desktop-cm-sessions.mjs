import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { waitForHttpReady } from './lib/http-ready.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightUrl = pathToFileURL(path.join(repoRoot, 'website/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const args = parseArgs(process.argv.slice(2));
const baseUrl = args.url || process.env.KUVIEWER_DESKTOP_SMOKE_URL || 'http://127.0.0.1:4174/kuviewer/';

await waitForHttpReady(baseUrl, { timeoutMs: 10_000 });
const browser = await chromium.launch();
try {
  await smokeDesktopRuntime(browser, baseUrl);
  await smokeWebRuntime(browser, baseUrl);
  console.log(JSON.stringify({ ok: true, url: baseUrl, smoke: 'desktop-cm-sessions' }));
} finally {
  await browser.close();
}

async function smokeDesktopRuntime(browserInstance, url) {
  const page = await browserInstance.newPage();
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const layoutView = (favorite) => ({
      sessions: [{ sessionId: 'cm-primary', group: 'General', favorite, updatedAt: 1 }],
      collapsedGroups: [],
    });
    window.localStorage.setItem('kuviewer_desktop_cm_session_layout_presets', JSON.stringify([
      { name: 'Operations', folder: 'General', viewPreferences: layoutView(false), updatedAt: 1 },
      { name: 'Diagnostics', folder: 'General', viewPreferences: layoutView(false), updatedAt: 1 },
      { name: 'Observe', folder: 'Ops', viewPreferences: layoutView(false), updatedAt: 1 },
    ]));
    window.__TAURI__ = {
      core: {
        invoke: async (command) => {
          if (command === 'desktop_cm_sessions') {
            return [{
              id: 'cm-primary',
              name: 'Primary CM',
              host: '10.0.0.5',
              port: 22,
              user: 'ubuntu',
              remoteApiHost: '127.0.0.1',
              remoteApiPort: 18085,
              description: 'Safe smoke metadata',
              authType: 'os-credential-store',
              credentialStore: 'native-smoke-store',
              credentialAvailable: false,
              status: 'metadata-only',
              runtimeStatus: 'stopped',
              updatedAt: Date.now(),
              selected: false,
              lastCheckStatus: 'auth-failed',
              diagnosticStage: 'ssh-auth',
              diagnosticSeverity: 'error',
              diagnosticMessage: 'authentication_failed',
              diagnosticHint: 'Check the stored credential.',
            }];
          }
          if (command === 'desktop_cm_session_runtime') {
            return null;
          }
          throw new Error(`unsupported desktop smoke command: ${command}`);
        },
      },
    };
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByTestId('desktop-cm-session-panel').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('desktop-cm-session-cm-primary').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-diagnostics-cm-primary').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-layout-list').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-layout-folder-general').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-layout-operations').waitFor({ state: 'visible' });

  await page.getByTestId('desktop-cm-session-layout-folder-reorder-down-general').click();
  requireCondition(
    (await page.getByTestId('desktop-cm-session-layout-list').locator(':scope > [role="listitem"]').first().getAttribute('data-testid')) === 'desktop-cm-session-layout-folder-ops',
    'layout folder reorder must update the rendered order',
  );
  await page.getByTestId('desktop-cm-session-layout-reorder-down-operations').click();
  const reorderedLayouts = await page.evaluate(() => JSON.parse(window.localStorage.getItem('kuviewer_desktop_cm_session_layout_presets') || '[]'));
  requireCondition(
    reorderedLayouts.filter((preset) => preset.folder === 'General').map((preset) => preset.name).join(',') === 'Diagnostics,Operations',
    'layout preset reorder must update safe stored metadata',
  );

  await page.getByTestId('desktop-cm-session-layout-folder-toggle-general').click();
  await page.getByTestId('desktop-cm-session-layout-folder-items-general').waitFor({ state: 'hidden' });
  await page.getByTestId('desktop-cm-session-layout-folder-toggle-general').click();
  await page.getByTestId('desktop-cm-session-layout-folder-items-general').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-layout-bulk-select-input-operations').check();
  await page.getByTestId('desktop-cm-session-layout-bulk-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-layout-bulk-clear-toolbar').click();
  await page.getByTestId('desktop-cm-session-layout-bulk-toolbar').waitFor({ state: 'hidden' });
  await page.getByTestId('desktop-cm-session-layout-search').fill('missing-layout');
  await page.getByTestId('desktop-cm-session-layout-search-empty').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-layout-search-clear').click();
  await page.getByTestId('desktop-cm-session-layout-operations').waitFor({ state: 'visible' });

  await page.getByTestId('desktop-cm-session-search').fill('Primary');
  await page.getByTestId('desktop-cm-session-cm-primary').waitFor({ state: 'visible' });
  await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('health');
  await page.getByTestId('desktop-cm-session-cm-primary').waitFor({ state: 'hidden' });
  await page.getByTestId('desktop-cm-session-diagnostic-stage-filter').selectOption('ssh-auth');
  await page.getByTestId('desktop-cm-session-cm-primary').waitFor({ state: 'visible' });

  await page.getByTestId('desktop-cm-session-favorite-cm-primary').click();
  const storedPreferences = await page.evaluate(() => JSON.parse(window.localStorage.getItem('kuviewer_desktop_cm_session_view_preferences') || '{}'));
  requireCondition(storedPreferences.sessions?.[0]?.sessionId === 'cm-primary', 'favorite preference must store only the session view id');
  requireCondition(storedPreferences.sessions?.[0]?.favorite === true, 'favorite preference must be stored as safe UI metadata');

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('desktop-cm-session-export').click(),
  ]).then(([result]) => result);
  const downloadPath = await download.path();
  requireCondition(Boolean(downloadPath), 'desktop session export must produce a file');
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
  requireCondition(exported.kind === 'kuviewer.desktop.cmSessions', 'desktop session export kind is invalid');
  requireCondition(exported.items?.length === 1, 'desktop session export must include the safe session');
  const exportedText = JSON.stringify(exported);
  for (const forbidden of ['privateKey', 'adminToken', 'kubeconfig', 'rawSshStderr', 'events', 'logs', 'diagnosticHistory', 'runtimeProfile']) {
    requireCondition(!exportedText.includes(forbidden), `desktop session export included forbidden field: ${forbidden}`);
  }

  await page.getByTestId('desktop-cm-session-layout-import').setInputFiles({
    name: 'layout-conflict.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: 'kuviewer.desktop.cmSessionLayouts',
      items: [{
        name: 'Operations',
        folder: 'General',
        viewPreferences: {
          sessions: [{ sessionId: 'cm-primary', group: 'General', favorite: true, updatedAt: 2 }],
          collapsedGroups: [],
        },
        updatedAt: 2,
      }],
    })),
  });
  const conflictPreview = page.getByTestId('desktop-cm-session-layout-conflict-preview');
  await conflictPreview.waitFor({ state: 'visible' });
  requireCondition(
    await page.getByTestId('desktop-cm-session-layout-conflict-operations').getAttribute('aria-current') === 'true',
    'first layout conflict must be active',
  );
  await conflictPreview.press('k');
  await conflictPreview.waitFor({ state: 'hidden' });

  requireCondition(runtimeErrors.length === 0, `desktop runtime emitted browser errors: ${runtimeErrors.join(' | ')}`);
  await page.close();
}

async function smokeWebRuntime(browserInstance, url) {
  const page = await browserInstance.newPage();
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  requireCondition(await page.getByTestId('desktop-cm-session-panel').count() === 0, 'web runtime must not expose desktop CM/SSH controls');
  requireCondition(runtimeErrors.length === 0, `web runtime emitted browser errors: ${runtimeErrors.join(' | ')}`);
  await page.close();
}

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

function parseArgs(values) {
  const parsed = { url: '' };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--url') {
      parsed.url = values[index + 1] || '';
      index += 1;
    } else if (values[index].startsWith('--url=')) {
      parsed.url = values[index].slice('--url='.length);
    } else {
      throw new Error(`unknown argument: ${values[index]}`);
    }
  }
  return parsed;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
