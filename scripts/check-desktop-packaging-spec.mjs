import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(await readFile(path.join(repoRoot, 'desktop/packaging-spec.json'), 'utf8'));
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

requireCondition(spec.schemaVersion === 1, 'schemaVersion must be 1');
requireCondition(spec.goal === 'desktop-cm-session-prototype', 'goal must remain the desktop CM session prototype');
requireCondition(spec.status === 'prototype-only', 'desktop status must remain prototype-only');
requireCondition(spec.product?.primaryPath === 'web-server', 'primary product path must be web-server');
requireCondition(spec.product?.desktopInstallerPublished === false, 'desktop installer publishing must stay disabled');
requireCondition(spec.product?.desktopDownloadWorkflow === false, 'desktop download workflow must stay disabled');
requireCondition(spec.product?.webExposesSsh === false, 'web must not expose SSH');
requireCondition(spec.runtime?.framework === 'tauri', 'desktop prototype framework must be Tauri');
requireCondition(spec.runtime?.desktopOnly === true, 'desktop CM controls must stay desktop-only');
requireCondition(spec.runtime?.localSidecarIncluded === false, 'local sidecar must stay excluded');
requireCondition(spec.runtime?.directKubernetesProfileIncluded === false, 'direct Kubernetes profiles must stay excluded');
requireCondition(
  Array.isArray(spec.connectionModes) && spec.connectionModes.length === 1 && spec.connectionModes[0] === 'cm-ssh-session',
  'desktop connection mode must remain CM/SSH only',
);

const security = spec.security || {};
requireCondition(security.readOnly === true, 'desktop prototype must stay read-only');
requireCondition(security.privateKeyStorage === 'os-credential-store', 'private keys must stay in the OS credential store');
requireCondition(security.adminTokenStorage === 'sessionStorage', 'admin token must stay session-only');
requireCondition(security.noSecretValues === true, 'Secret values must stay hidden');
requireCondition(security.noKubeconfigPersistence === true, 'kubeconfigs must not be persisted');
requireCondition(security.noRawSshStderr === true, 'raw SSH stderr must not be returned');

const blockedActions = new Set(Array.isArray(security.noOperationalActions) ? security.noOperationalActions : []);
for (const action of ['exec', 'port-forward', 'restart', 'scale', 'delete', 'apply', 'edit']) {
  requireCondition(blockedActions.has(action), `blocked operational action missing: ${action}`);
}

const forbiddenFields = new Set(spec.exportPolicy?.forbiddenFields || []);
for (const field of ['privateKey', 'credential', 'adminToken', 'kubeconfig', 'cloudCredential', 'secretValue', 'rawSshStderr', 'events', 'logs']) {
  requireCondition(forbiddenFields.has(field), `exportPolicy.forbiddenFields must include ${field}`);
}

for (const relativePath of spec.requiredFiles || []) {
  try {
    await access(path.join(repoRoot, relativePath));
  } catch {
    failures.push(`required file is missing: ${relativePath}`);
  }
}

const sourceModeBar = await readFile(path.join(repoRoot, 'website/src/components/SourceModeBar.tsx'), 'utf8');
requireCondition(sourceModeBar.includes('desktopConnectionAvailable'), 'SourceModeBar must keep an explicit desktop runtime guard');
requireCondition(sourceModeBar.includes('DesktopCmSessionPanel'), 'desktop session panel integration is missing');
const desktopCmSessionPanel = await readFile(path.join(repoRoot, 'website/src/components/DesktopCmSessionPanel.tsx'), 'utf8');
for (const componentName of ['DesktopCmLayoutConflictPanel', 'DesktopCmSessionList', 'DesktopCmSessionBulkToolbar']) {
  requireCondition(desktopCmSessionPanel.includes(componentName), `desktop session panel must use ${componentName}`);
}

const tauriMain = await readFile(path.join(repoRoot, 'desktop/src-tauri/src/main.rs'), 'utf8');
for (const forbiddenCommand of ['desktop_sidecar_profile', 'desktop_kubernetes_profiles', 'desktop_select_kubernetes_profile']) {
  requireCondition(!tauriMain.includes(forbiddenCommand), `removed native command returned: ${forbiddenCommand}`);
}
const cargoLock = await readFile(path.join(repoRoot, 'desktop/src-tauri/Cargo.lock'), 'utf8');
requireCondition(cargoLock.includes('name = "kuviewer-desktop"'), 'Cargo.lock must include the desktop package');
requireCondition(!cargoLock.includes('name = "tauri-plugin-shell"'), 'removed sidecar shell dependency returned to Cargo.lock');

const docs = await Promise.all([
  'README.md',
  'desktop/README.md',
  'desktop/BUILD_PREREQUISITES.md',
  'CODEX_HANDOFF.md',
].map(async (relativePath) => ({ relativePath, text: await readFile(path.join(repoRoot, relativePath), 'utf8') })));
for (const { relativePath, text } of docs) {
  requireCondition(/prototype/i.test(text), `${relativePath} must document prototype scope`);
  requireCondition(/web app must not expose SSH|web.*must not expose SSH|웹.*SSH/i.test(text), `${relativePath} must document the web SSH boundary`);
  requireCondition(/installer|download/i.test(text), `${relativePath} must document installer/download scope`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('desktop packaging spec: ok');
}
