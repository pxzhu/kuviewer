import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const specPath = path.join(repoRoot, 'desktop', 'packaging-spec.json');
const spec = JSON.parse(await readFile(specPath, 'utf8'));

const failures = [];

function requireCondition(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

requireCondition(spec.schemaVersion === 1, 'schemaVersion must be 1');
requireCondition(spec.goal === 'desktop-cm-session-prototype', 'goal must describe the desktop CM/SSH session prototype');
requireCondition(
  [
    'packaging-spike',
    'tauri-scaffold',
    'desktop-remote-profile-ux',
    'desktop-local-sidecar-evaluation',
    'desktop-local-sidecar-runtime',
    'desktop-keychain-credential-design',
    'desktop-keychain-profile-runtime',
    'desktop-os-credential-store',
    'desktop-keychain-sidecar-runtime',
    'desktop-native-credential-runtime-smoke',
    'desktop-cm-ssh-sessions',
    'desktop-cm-ssh-credential-check',
    'desktop-cm-ssh-runtime',
    'desktop-cm-runtime-health-details',
    'desktop-download-descope',
    'desktop-cm-advanced-diagnostics',
    'desktop-cm-session-export-import',
    'desktop-cm-diagnostics-filtering',
    'desktop-cm-diagnostics-saved-filters',
    'desktop-cm-connection-profile-polish',
    'desktop-cm-session-clone-polish',
    'desktop-cm-session-groups-favorites',
    'desktop-cm-session-bulk-actions',
    'desktop-cm-session-saved-layouts',
    'desktop-cm-session-layout-import-export',
    'desktop-cm-session-layout-conflict-preview',
    'desktop-cm-session-layout-row-conflicts',
    'desktop-cm-session-layout-conflict-summary',
    'desktop-cm-session-layout-conflict-keyboard',
    'desktop-cm-session-layout-conflict-accessibility',
    'desktop-cm-session-layout-preset-search',
    'desktop-cm-session-layout-preset-rename',
    'desktop-cm-session-layout-preset-duplicate',
    'desktop-cm-session-layout-preset-bulk-management',
    'desktop-cm-session-layout-preset-folder-polish',
    'desktop-cm-session-layout-preset-folder-bulk-move',
    'desktop-cm-session-layout-preset-folder-filter-polish',
    'desktop-cm-session-layout-preset-folder-action-polish',
    'desktop-cm-session-layout-preset-folder-keyboard-polish',
    'desktop-cm-session-layout-preset-folder-accessibility-polish',
    'desktop-cm-session-layout-preset-folder-empty-state-polish',
    'desktop-cm-session-layout-preset-folder-drag-reorder-polish',
    'desktop-cm-session-layout-preset-folder-drag-reorder-keyboard-polish',
    'desktop-cm-session-layout-preset-folder-reorder-focus-polish',
    'desktop-cm-session-layout-preset-folder-reorder-focus-accessibility-polish',
    'desktop-cm-session-layout-preset-folder-reorder-disabled-state-polish',
    'desktop-cm-session-layout-preset-folder-reorder-status-wording-polish',
  ].includes(spec.status),
  'status must be a known desktop packaging milestone'
);
requireCondition(spec.recommendedPackager === 'tauri', 'recommendedPackager must be tauri for the first packaging spike');
requireCondition(spec.fallbackPackager === 'electron', 'fallbackPackager must be electron');

const connectionModes = new Set((Array.isArray(spec.connectionModes) ? spec.connectionModes : []).map((mode) => mode.id));
requireCondition(connectionModes.has('cm-ssh-session'), 'connectionModes must include cm-ssh-session as the primary desktop direction');
requireCondition(connectionModes.has('remote-api'), 'connectionModes must include remote-api');
requireCondition(connectionModes.has('local-sidecar'), 'connectionModes must include local-sidecar as a future evaluation path');
requireCondition(connectionModes.has('local-kubernetes-keychain'), 'connectionModes must include local-kubernetes-keychain as the desktop credential design path');
await validateDesktopProductDirection(spec);

const security = spec.security || {};
requireCondition(security.readOnly === true, 'security.readOnly must be true');
requireCondition(security.noBrowserKubeCredentialEntry === true, 'desktop shell must not ask for browser-side kube credentials');
requireCondition(security.noSecretValues === true, 'desktop shell must keep Secret values hidden');
requireCondition(security.noKubeconfigPersistence === true, 'desktop shell must not persist kubeconfigs');
requireCondition(security.noAdminTokenPersistence === true, 'desktop shell must not persist admin tokens in the spike');

const blockedActions = new Set(Array.isArray(security.noOperationalActions) ? security.noOperationalActions : []);
for (const action of ['exec', 'port-forward', 'restart', 'scale', 'delete', 'apply', 'edit']) {
  requireCondition(blockedActions.has(action), `security.noOperationalActions must include ${action}`);
}

const phases = Array.isArray(spec.phaseOrder) ? spec.phaseOrder : [];
requireCondition(phases[0] === 'packaging-spec', 'phaseOrder must start with packaging-spec');
requireCondition(phases.includes('tauri-scaffold'), 'phaseOrder must include tauri-scaffold');
requireCondition(phases.includes('remote-connection-profile'), 'phaseOrder must include remote-connection-profile');
requireCondition(phases.includes('keychain-credential-design'), 'phaseOrder must include keychain-credential-design');
requireCondition(phases.includes('keychain-profile-runtime'), 'phaseOrder must include keychain-profile-runtime');
requireCondition(phases.includes('os-credential-store'), 'phaseOrder must include os-credential-store');
requireCondition(phases.includes('keychain-sidecar-runtime'), 'phaseOrder must include keychain-sidecar-runtime');
requireCondition(phases.includes('native-credential-runtime-smoke'), 'phaseOrder must include native-credential-runtime-smoke');
requireCondition(phases.includes('desktop-cm-ssh-credential-check'), 'phaseOrder must include desktop-cm-ssh-credential-check');
requireCondition(phases.includes('desktop-cm-ssh-runtime'), 'phaseOrder must include desktop-cm-ssh-runtime');
requireCondition(phases.includes('desktop-cm-runtime-health-details'), 'phaseOrder must include desktop-cm-runtime-health-details');
requireCondition(phases.includes('desktop-download-descope'), 'phaseOrder must include desktop-download-descope');
requireCondition(phases.includes('desktop-cm-advanced-diagnostics'), 'phaseOrder must include desktop-cm-advanced-diagnostics');
requireCondition(phases.includes('desktop-cm-session-export-import'), 'phaseOrder must include desktop-cm-session-export-import');
requireCondition(phases.includes('desktop-cm-diagnostics-filtering'), 'phaseOrder must include desktop-cm-diagnostics-filtering');
requireCondition(phases.includes('desktop-cm-diagnostics-saved-filters'), 'phaseOrder must include desktop-cm-diagnostics-saved-filters');
requireCondition(phases.includes('desktop-cm-connection-profile-polish'), 'phaseOrder must include desktop-cm-connection-profile-polish');
requireCondition(phases.includes('desktop-cm-session-clone-polish'), 'phaseOrder must include desktop-cm-session-clone-polish');
requireCondition(phases.includes('desktop-cm-session-groups-favorites'), 'phaseOrder must include desktop-cm-session-groups-favorites');
requireCondition(phases.includes('desktop-cm-session-bulk-actions'), 'phaseOrder must include desktop-cm-session-bulk-actions');
requireCondition(phases.includes('desktop-cm-session-saved-layouts'), 'phaseOrder must include desktop-cm-session-saved-layouts');
requireCondition(phases.includes('desktop-cm-session-layout-import-export'), 'phaseOrder must include desktop-cm-session-layout-import-export');
requireCondition(phases.includes('desktop-cm-session-layout-conflict-preview'), 'phaseOrder must include desktop-cm-session-layout-conflict-preview');
requireCondition(phases.includes('desktop-cm-session-layout-row-conflicts'), 'phaseOrder must include desktop-cm-session-layout-row-conflicts');
requireCondition(phases.includes('desktop-cm-session-layout-conflict-summary'), 'phaseOrder must include desktop-cm-session-layout-conflict-summary');
requireCondition(phases.includes('desktop-cm-session-layout-conflict-keyboard'), 'phaseOrder must include desktop-cm-session-layout-conflict-keyboard');
requireCondition(phases.includes('desktop-cm-session-layout-conflict-accessibility'), 'phaseOrder must include desktop-cm-session-layout-conflict-accessibility');
requireCondition(phases.includes('desktop-cm-session-layout-preset-search'), 'phaseOrder must include desktop-cm-session-layout-preset-search');
requireCondition(phases.includes('desktop-cm-session-layout-preset-rename'), 'phaseOrder must include desktop-cm-session-layout-preset-rename');
requireCondition(phases.includes('desktop-cm-session-layout-preset-duplicate'), 'phaseOrder must include desktop-cm-session-layout-preset-duplicate');
requireCondition(phases.includes('desktop-cm-session-layout-preset-bulk-management'), 'phaseOrder must include desktop-cm-session-layout-preset-bulk-management');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-polish');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-bulk-move'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-bulk-move');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-filter-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-filter-polish');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-action-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-action-polish');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-keyboard-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-keyboard-polish');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-accessibility-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-accessibility-polish');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-empty-state-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-empty-state-polish');
requireCondition(phases.includes('desktop-cm-session-layout-preset-folder-drag-reorder-polish'), 'phaseOrder must include desktop-cm-session-layout-preset-folder-drag-reorder-polish');
requireCondition(
  phases.includes('desktop-cm-session-layout-preset-folder-drag-reorder-keyboard-polish'),
  'phaseOrder must include desktop-cm-session-layout-preset-folder-drag-reorder-keyboard-polish'
);
requireCondition(
  phases.includes('desktop-cm-session-layout-preset-folder-reorder-focus-polish'),
  'phaseOrder must include desktop-cm-session-layout-preset-folder-reorder-focus-polish'
);
requireCondition(
  phases.includes('desktop-cm-session-layout-preset-folder-reorder-focus-accessibility-polish'),
  'phaseOrder must include desktop-cm-session-layout-preset-folder-reorder-focus-accessibility-polish'
);
requireCondition(
  phases.includes('desktop-cm-session-layout-preset-folder-reorder-disabled-state-polish'),
  'phaseOrder must include desktop-cm-session-layout-preset-folder-reorder-disabled-state-polish'
);
requireCondition(
  phases.includes('desktop-cm-session-layout-preset-folder-reorder-status-wording-polish'),
  'phaseOrder must include desktop-cm-session-layout-preset-folder-reorder-status-wording-polish'
);

await validateBuildPrerequisites(spec);
await validateDesktopDistributionPolicy(spec);
await validateRemoteConnectionProfile(spec);
await validateLocalSidecar(spec);
await validateCredentialStorageDesign(spec);
await validateCmSshSessionManager(spec);

if (
  [
    'tauri-scaffold',
    'desktop-remote-profile-ux',
    'desktop-local-sidecar-evaluation',
    'desktop-local-sidecar-runtime',
    'desktop-keychain-credential-design',
    'desktop-keychain-profile-runtime',
    'desktop-os-credential-store',
    'desktop-keychain-sidecar-runtime',
    'desktop-native-credential-runtime-smoke',
    'desktop-cm-ssh-sessions',
    'desktop-cm-ssh-credential-check',
    'desktop-cm-ssh-runtime',
    'desktop-cm-runtime-health-details',
    'desktop-download-descope',
    'desktop-cm-advanced-diagnostics',
    'desktop-cm-session-export-import',
    'desktop-cm-diagnostics-filtering',
    'desktop-cm-diagnostics-saved-filters',
    'desktop-cm-connection-profile-polish',
    'desktop-cm-session-clone-polish',
    'desktop-cm-session-groups-favorites',
    'desktop-cm-session-bulk-actions',
    'desktop-cm-session-saved-layouts',
    'desktop-cm-session-layout-import-export',
    'desktop-cm-session-layout-conflict-preview',
    'desktop-cm-session-layout-row-conflicts',
    'desktop-cm-session-layout-conflict-summary',
    'desktop-cm-session-layout-conflict-keyboard',
    'desktop-cm-session-layout-conflict-accessibility',
    'desktop-cm-session-layout-preset-search',
    'desktop-cm-session-layout-preset-rename',
    'desktop-cm-session-layout-preset-duplicate',
    'desktop-cm-session-layout-preset-bulk-management',
    'desktop-cm-session-layout-preset-folder-polish',
    'desktop-cm-session-layout-preset-folder-bulk-move',
    'desktop-cm-session-layout-preset-folder-filter-polish',
    'desktop-cm-session-layout-preset-folder-action-polish',
    'desktop-cm-session-layout-preset-folder-keyboard-polish',
    'desktop-cm-session-layout-preset-folder-accessibility-polish',
    'desktop-cm-session-layout-preset-folder-empty-state-polish',
    'desktop-cm-session-layout-preset-folder-drag-reorder-polish',
    'desktop-cm-session-layout-preset-folder-drag-reorder-keyboard-polish',
    'desktop-cm-session-layout-preset-folder-reorder-focus-polish',
    'desktop-cm-session-layout-preset-folder-reorder-focus-accessibility-polish',
    'desktop-cm-session-layout-preset-folder-reorder-disabled-state-polish',
    'desktop-cm-session-layout-preset-folder-reorder-status-wording-polish',
  ].includes(spec.status)
) {
  await validateTauriScaffold(spec.tauri || {});
}

if (failures.length > 0) {
  console.error(`desktop packaging spec check failed for ${specPath}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`desktop packaging spec check passed: ${specPath}`);

async function validateDesktopProductDirection(spec) {
  const direction = spec.desktopProductDirection || {};
  requireCondition(direction.primaryConnectionMode === 'cm-ssh-session', 'desktopProductDirection.primaryConnectionMode must be cm-ssh-session');
  requireCondition(direction.desktopOnly === true, 'desktopProductDirection.desktopOnly must be true');
  requireCondition(direction.webSshFeature === false, 'desktopProductDirection.webSshFeature must be false');
  requireCondition(direction.multipleSessions === true, 'desktopProductDirection.multipleSessions must be true');
  requireCondition(direction.sessionModel === 'vscode-ssh-extension-style', 'desktopProductDirection.sessionModel must be vscode-ssh-extension-style');
  requireCondition(direction.localSidecarPolicy === 'prototype-only-not-product-default', 'desktopProductDirection.localSidecarPolicy must be prototype-only-not-product-default');
  requireCondition(direction.directApiPolicy === 'not-desktop-primary', 'desktopProductDirection.directApiPolicy must be not-desktop-primary');
  requireCondition(direction.credentialStorage === 'os-credential-store', 'desktopProductDirection.credentialStorage must be os-credential-store');
  requireCondition(direction.noBrowserSsh === true, 'desktopProductDirection.noBrowserSsh must be true');
  requireCondition(direction.noOperationalActions === true, 'desktopProductDirection.noOperationalActions must be true');

  const rootReadme = await readTextFile('README.md', 'root README');
  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  const prerequisitesDoc = await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc');
  const handoff = await readTextFile('CODEX_HANDOFF.md', 'Codex handoff');
  for (const [label, text] of [
    ['root README', rootReadme],
    ['desktop README', desktopReadme],
    ['desktop build prerequisites doc', prerequisitesDoc],
    ['Codex handoff', handoff],
  ]) {
    requireCondition(text.includes('CM/SSH'), `${label} must document the CM/SSH desktop direction`);
    requireCondition(text.includes('multiple sessions'), `${label} must document multiple sessions`);
    requireCondition(text.includes('web app must not expose SSH'), `${label} must document that the web app must not expose SSH`);
    requireCondition(text.includes('prototype-only'), `${label} must mark local sidecar/API paths as prototype-only`);
  }
}

async function validateTauriScaffold(tauri) {
  const desktopPackage = await readJsonFile(tauri.packagePath, 'tauri.packagePath');
  const tauriConfig = await readJsonFile(tauri.configPath, 'tauri.configPath');
  const capability = await readJsonFile(tauri.capabilityPath, 'tauri.capabilityPath');
  const cargoToml = await readTextFile(tauri.cargoManifestPath, 'tauri.cargoManifestPath');

  requireCondition(desktopPackage?.scripts?.['tauri:dev']?.includes('tauri dev'), 'desktop package must expose tauri:dev');
  requireCondition(desktopPackage?.scripts?.['tauri:build']?.includes('tauri build'), 'desktop package must expose tauri:build');
  requireCondition(desktopPackage?.scripts?.['icons:generate'] === 'node ../scripts/generate-desktop-icons.mjs', 'desktop package must expose icons:generate');
  requireCondition(desktopPackage?.devDependencies?.['@tauri-apps/cli'], 'desktop package must declare @tauri-apps/cli');

  requireCondition(tauriConfig?.identifier === 'com.kuviewer.desktop', 'tauri config identifier must be com.kuviewer.desktop');
  requireCondition(tauriConfig?.build?.devUrl === tauri.devUrl, 'tauri config devUrl must match packaging spec');
  requireCondition(tauriConfig?.build?.frontendDist === tauri.frontendDist, 'tauri config frontendDist must match packaging spec');
  requireCondition(tauriConfig?.build?.beforeBuildCommand?.includes('../website'), 'tauri config must build the existing website frontend');
  requireCondition(tauriConfig?.build?.beforeBuildCommand?.includes('build-desktop-sidecar.mjs'), 'tauri config must build the desktop sidecar before packaging');
  requireCondition(tauriConfig?.build?.beforeDevCommand?.includes('build-desktop-sidecar.mjs'), 'tauri config must build the desktop sidecar before dev launch');
  requireCondition(tauriConfig?.app?.withGlobalTauri === true, 'tauri config must expose the Tauri invoke bridge for the sidecar profile command');

  requireCondition(tauriConfig?.bundle?.active === false, 'tauri bundle must stay inactive while desktop installer downloads are de-scoped');
  const bundleTargets = Array.isArray(tauriConfig?.bundle?.targets) ? tauriConfig.bundle.targets : [];
  requireCondition(bundleTargets.length === 0, 'tauri bundle targets must stay empty while desktop installer downloads are de-scoped');
  const externalBins = new Set(Array.isArray(tauriConfig?.bundle?.externalBin) ? tauriConfig.bundle.externalBin : []);
  requireCondition(externalBins.has('binaries/kuviewer-sidecar'), 'tauri bundle externalBin must include binaries/kuviewer-sidecar');
  const bundleIcons = new Set(Array.isArray(tauriConfig?.bundle?.icon) ? tauriConfig.bundle.icon : []);
  for (const icon of ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']) {
    requireCondition(bundleIcons.has(icon), `tauri bundle icons must include ${icon}`);
  }

  const mainWindow = Array.isArray(tauriConfig?.app?.windows) ? tauriConfig.app.windows.find((window) => window.label === 'main') : undefined;
  requireCondition(Boolean(mainWindow), 'tauri config must define a main window');
  requireCondition(tauriConfig?.app?.security?.csp?.includes("default-src 'self'"), 'tauri config must define a restrictive CSP');

  requireCondition(capability?.identifier === 'desktop-readonly', 'tauri capability must be desktop-readonly');
  requireCondition(Array.isArray(capability?.permissions) && capability.permissions.includes('core:default'), 'tauri capability must include core:default only');
  requireCondition(!JSON.stringify(capability).includes('shell:'), 'tauri capability must not include shell permissions');
  requireCondition(!JSON.stringify(capability).includes('fs:'), 'tauri capability must not include filesystem permissions');

  requireCondition(cargoToml.includes('tauri = { version = "2"'), 'Cargo.toml must use tauri v2');
  requireCondition(cargoToml.includes('tauri-build = { version = "2"'), 'Cargo.toml must use tauri-build v2');
  requireCondition(cargoToml.includes('tauri-plugin-shell = "2"'), 'Cargo.toml must use tauri-plugin-shell v2 for the Rust-managed sidecar');
  requireCondition(cargoToml.includes('getrandom = "0.2"'), 'Cargo.toml must use getrandom for per-launch sidecar admin tokens');
  requireCondition(cargoToml.includes('serde = { version = "1"'), 'Cargo.toml must use serde for the sidecar profile command response');
}

async function validateBuildPrerequisites(spec) {
  const prerequisiteIds = new Set((Array.isArray(spec.buildPrerequisites) ? spec.buildPrerequisites : []).map((prerequisite) => prerequisite.id));
  for (const id of ['node', 'npm', 'go', 'rust', 'cargo']) {
    requireCondition(prerequisiteIds.has(id), `buildPrerequisites must include ${id}`);
  }
  for (const prerequisite of Array.isArray(spec.buildPrerequisites) ? spec.buildPrerequisites : []) {
    requireCondition(
      Array.isArray(prerequisite.requiredFor) && prerequisite.requiredFor.includes('desktop-shell'),
      `buildPrerequisites.${prerequisite.id} must target desktop-shell`
    );
  }

  const iconSources = Array.isArray(spec.icons?.sourceAssets) ? spec.icons.sourceAssets : [];
  const iconSourcePaths = new Set(iconSources.map((asset) => asset.path));
  for (const iconPath of [
    'website/public/images/brand/kuviewer-icon-yaml-flow.png',
    'website/public/favicon-32x32.png',
    'website/public/favicon-192x192.png',
    'website/public/apple-touch-icon.png',
  ]) {
    requireCondition(iconSourcePaths.has(iconPath), `icons.sourceAssets must include ${iconPath}`);
  }
  const expectedSizes = new Map([
    ['website/public/images/brand/kuviewer-icon-yaml-flow.png', '512x512'],
    ['website/public/favicon-32x32.png', '32x32'],
    ['website/public/favicon-192x192.png', '192x192'],
    ['website/public/apple-touch-icon.png', '180x180'],
  ]);
  for (const asset of iconSources) {
    if (expectedSizes.has(asset.path)) {
      requireCondition(asset.size === expectedSizes.get(asset.path), `icon source ${asset.path} must declare size ${expectedSizes.get(asset.path)}`);
      requireCondition(asset.transparent === true, `icon source ${asset.path} must be marked transparent`);
      const dimensions = await readPngDimensions(asset.path, `icon source ${asset.path}`);
      requireCondition(formatDimensions(dimensions) === expectedSizes.get(asset.path), `icon source ${asset.path} must be ${expectedSizes.get(asset.path)}`);
    }
  }
  requireCondition(spec.icons?.noCroppedCandidateImages === true, 'icons.noCroppedCandidateImages must be true');
  requireCondition(spec.icons?.generationScript === 'scripts/generate-desktop-icons.mjs', 'icons.generationScript must point at scripts/generate-desktop-icons.mjs');
  await readTextFile(spec.icons?.generationScript, 'desktop icon generation script');

  const generatedAssets = Array.isArray(spec.icons?.generatedAssets) ? spec.icons.generatedAssets : [];
  const generatedAssetPaths = new Set(generatedAssets.map((asset) => asset.path));
  for (const iconPath of [
    'desktop/src-tauri/icons/32x32.png',
    'desktop/src-tauri/icons/128x128.png',
    'desktop/src-tauri/icons/128x128@2x.png',
    'desktop/src-tauri/icons/icon.png',
    'desktop/src-tauri/icons/icon.icns',
    'desktop/src-tauri/icons/icon.ico',
  ]) {
    requireCondition(generatedAssetPaths.has(iconPath), `icons.generatedAssets must include ${iconPath}`);
  }

  const expectedGeneratedPngSizes = new Map([
    ['desktop/src-tauri/icons/32x32.png', '32x32'],
    ['desktop/src-tauri/icons/128x128.png', '128x128'],
    ['desktop/src-tauri/icons/128x128@2x.png', '256x256'],
    ['desktop/src-tauri/icons/icon.png', '256x256'],
  ]);
  for (const asset of generatedAssets) {
    if (expectedGeneratedPngSizes.has(asset.path)) {
      requireCondition(asset.format === 'png', `generated icon ${asset.path} must declare png format`);
      requireCondition(asset.size === expectedGeneratedPngSizes.get(asset.path), `generated icon ${asset.path} must declare size ${expectedGeneratedPngSizes.get(asset.path)}`);
      const dimensions = await readPngDimensions(asset.path, `generated icon ${asset.path}`);
      requireCondition(formatDimensions(dimensions) === expectedGeneratedPngSizes.get(asset.path), `generated icon ${asset.path} must be ${expectedGeneratedPngSizes.get(asset.path)}`);
    }
  }
  await validateIcnsFile('desktop/src-tauri/icons/icon.icns', 'generated macOS icon.icns');
  await validateIcoFile('desktop/src-tauri/icons/icon.ico', 'generated Windows icon.ico');

  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  const prerequisitesDoc = await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc');
  const iconReadme = await readTextFile('desktop/icons/README.md', 'desktop icons README');

  requireCondition(desktopReadme.includes('BUILD_PREREQUISITES.md'), 'desktop README must link build prerequisites');
  requireCondition(prerequisitesDoc.includes('Rust and Cargo'), 'desktop build prerequisites doc must mention Rust and Cargo');
  requireCondition(prerequisitesDoc.includes('Go'), 'desktop build prerequisites doc must mention Go');
  requireCondition(prerequisitesDoc.includes('node scripts/generate-desktop-icons.mjs'), 'desktop build prerequisites doc must mention icon generation');
  requireCondition(prerequisitesDoc.includes('No desktop installer download path'), 'desktop build prerequisites doc must state installer downloads are de-scoped');
  requireCondition(iconReadme.includes('icon.icns'), 'desktop icons README must describe icon.icns');
  requireCondition(iconReadme.includes('icon.ico'), 'desktop icons README must describe icon.ico');
}

async function validateDesktopDistributionPolicy(spec) {
  const policy = spec.distributionPolicy || {};
  requireCondition(policy.status === 'download-installer-descope', 'distributionPolicy.status must be download-installer-descope');
  requireCondition(policy.installerDownloads === false, 'distributionPolicy.installerDownloads must be false');
  requireCondition(policy.releaseAssetPublishing === false, 'distributionPolicy.releaseAssetPublishing must be false');
  requireCondition(policy.desktopPackageWorkflow === false, 'distributionPolicy.desktopPackageWorkflow must be false');
  requireCondition(policy.signedInstallerRelease === false, 'distributionPolicy.signedInstallerRelease must be false');
  requireCondition(!('targets' in spec), 'desktop installer targets must not be configured');
  requireCondition(!('releaseAssets' in spec), 'releaseAssets must not be configured');
  requireCondition(!('packageSmokeMatrix' in spec), 'packageSmokeMatrix must not be configured');
  requireCondition(!('signing' in spec), 'signing must not be configured for desktop installer releases');
  requireCondition(!('dryRuns' in spec), 'desktop installer dryRuns must not be tracked');
  requireCondition(!('releaseVersioning' in spec), 'releaseVersioning must not be configured for desktop installer releases');

  for (const filePath of [
    ['.github', 'workflows', ['desktop', 'package'].join('-') + '.yml'].join('/'),
    ['scripts', ['configure', 'desktop', 'signing'].join('-') + '.mjs'].join('/'),
    ['scripts', ['set', 'desktop', 'package', 'version'].join('-') + '.mjs'].join('/'),
  ]) {
    requireCondition(!(await fileExists(filePath)), `${filePath} must not exist while desktop installer downloads are de-scoped`);
  }

  const docs = [
    ['root README', await readTextFile('README.md', 'root README')],
    ['desktop README', await readTextFile('desktop/README.md', 'desktop README')],
    ['desktop build prerequisites doc', await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc')],
    ['Codex handoff', await readTextFile('CODEX_HANDOFF.md', 'Codex handoff')],
  ];
  for (const [label, text] of docs) {
    requireCondition(text.includes('No desktop installer download path'), `${label} must state there is no desktop installer download path`);
    for (const staleMarker of [
      ['publish', 'release', 'assets'].join('_'),
      ['smoke', 'matrix'].join('_'),
      ['desktop', 'package'].join('-'),
      ['signed', 'Release', 'asset'].join(' '),
      ['Signed', 'Release', 'asset'].join(' '),
      ['Kuviewer', '0.1.0', 'aarch64'].join('_'),
      ['Kuviewer', '0.1.0', 'x64'].join('_'),
    ]) {
      requireCondition(!text.includes(staleMarker), `${label} must not reference stale desktop download marker ${staleMarker}`);
    }
  }
}

async function validateRemoteConnectionProfile(spec) {
  const profile = spec.remoteConnectionProfile || {};
  requireCondition(['scaffolded', 'prototype-only'].includes(profile.status), 'remoteConnectionProfile.status must be scaffolded or prototype-only');
  requireCondition(profile.runtimeOnly === true, 'remoteConnectionProfile.runtimeOnly must be true');
  requireCondition(profile.storage === 'localStorage-url-only', 'remoteConnectionProfile.storage must be localStorage-url-only');
  requireCondition(profile.storageKey === 'kuviewer_desktop_connection_profile', 'remoteConnectionProfile.storageKey must match the frontend storage key');
  requireCondition(Array.isArray(profile.allowedProtocols) && profile.allowedProtocols.includes('https') && profile.allowedProtocols.includes('http'), 'remoteConnectionProfile.allowedProtocols must include https and http');
  requireCondition(profile.httpLoopbackOnly === true, 'remoteConnectionProfile.httpLoopbackOnly must be true');
  requireCondition(profile.adminTokenStorage === 'sessionStorage', 'remoteConnectionProfile.adminTokenStorage must be sessionStorage');
  requireCondition(profile.clearsAdminTokenOnChange === true, 'remoteConnectionProfile must clear admin token when the server profile changes');
  requireCondition(profile.noKubeconfigPersistence === true, 'remoteConnectionProfile must not persist kubeconfigs');
  requireCondition(profile.noSecretValues === true, 'remoteConnectionProfile must not store Secret values');
  requireCondition(profile.requiresServerCors === true, 'remoteConnectionProfile must document server CORS requirements');

  const profileModule = await readTextFile('website/src/features/desktop/desktopConnectionProfile.ts', 'desktop connection profile frontend module');
  requireCondition(profileModule.includes('kuviewer_desktop_connection_profile'), 'desktop connection profile module must use the configured storage key');
  requireCondition(profileModule.includes('localStorage'), 'desktop connection profile module may store only URL profile metadata in localStorage');
  requireCondition(profileModule.includes('https:') && profileModule.includes('http:'), 'desktop connection profile module must restrict URLs to http/https');
  requireCondition(profileModule.includes('isLoopbackHostname'), 'desktop connection profile module must restrict plain HTTP to loopback hosts');
  requireCondition(!profileModule.includes('kubeconfig'), 'desktop connection profile module must not handle kubeconfigs');

  const profilePanel = await readTextFile('website/src/components/DesktopConnectionProfilePanel.tsx', 'desktop connection profile UI panel');
  requireCondition(profilePanel.includes('Desktop server profile'), 'desktop connection profile panel must expose the server profile control');
  requireCondition(profilePanel.includes('storeDesktopConnectionProfile'), 'desktop connection profile panel must save through the profile helper');
  requireCondition(profilePanel.includes('clearDesktopConnectionProfile'), 'desktop connection profile panel must clear through the profile helper');
  requireCondition(profilePanel.includes('desktop-use-sidecar-profile'), 'desktop connection profile panel must expose the local sidecar switch action');

  if (profile.status === 'prototype-only') {
    const sourceModeBar = await readTextFile('website/src/components/SourceModeBar.tsx', 'source mode bar');
    requireCondition(!sourceModeBar.includes('DesktopConnectionProfilePanel'), 'prototype-only remote profile UI must not render in SourceModeBar');
    const app = await readTextFile('website/src/app/App.tsx', 'app shell');
    requireCondition(app.includes('clearDesktopConnectionProfile'), 'app shell must clear legacy desktop API profiles in desktop runtime');
    const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
    requireCondition(desktopReadme.includes('Prototype-only Remote API Profile'), 'desktop README must mark the remote API profile as prototype-only');
    return;
  }

  const app = await readTextFile('website/src/app/App.tsx', 'app shell');
  requireCondition(app.includes('handleDesktopConnectionProfileChange'), 'app shell must handle desktop profile changes');
  requireCondition(app.includes('clearAdminToken();'), 'app shell must clear the admin token when the desktop profile changes');
  requireCondition(app.includes('handleUseDesktopSidecar'), 'app shell must handle explicit local sidecar profile switching');

  const topologyApi = await readTextFile('website/src/services/topologyApi.ts', 'topology API service');
  requireCondition(topologyApi.includes('getDesktopConnectionProfile'), 'topology API service must prefer the desktop connection profile');

  const tauriConfig = await readJsonFile(spec.tauri?.configPath, 'tauri.configPath');
  requireCondition(tauriConfig?.app?.security?.csp?.includes('http://localhost:*'), 'tauri CSP must allow localhost HTTP for local Kuviewer servers');

  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  requireCondition(desktopReadme.includes('Remote Server Profile'), 'desktop README must document the remote server profile');
  requireCondition(desktopReadme.includes('KUVIEWER_CORS_ORIGIN'), 'desktop README must document CORS expectations for remote server profiles');
}

async function validateLocalSidecar(spec) {
  const localSidecar = spec.localSidecar || {};
  requireCondition(localSidecar.status === 'runtime-scaffolded', 'localSidecar.status must be runtime-scaffolded');
  requireCondition(localSidecar.enabledInTauriConfig === true, 'localSidecar.enabledInTauriConfig must be true once runtime launch is implemented');
  requireCondition(localSidecar.externalBinEnabled === true, 'localSidecar.externalBinEnabled must be true');
  requireCondition(localSidecar.runtimeLaunch === 'rust-managed', 'localSidecar.runtimeLaunch must be rust-managed');
  requireCondition(localSidecar.javascriptShellPermission === false, 'localSidecar.javascriptShellPermission must be false');
  requireCondition(localSidecar.capabilityChangeDeferred === false, 'localSidecar.capabilityChangeDeferred must be false after runtime launch is implemented');
  requireCondition(localSidecar.requiresShellPluginLater === false, 'localSidecar.requiresShellPluginLater must be false after runtime launch is implemented');
  requireCondition(localSidecar.buildBeforeTauri === true, 'localSidecar.buildBeforeTauri must be true');
  requireCondition(localSidecar.buildScript === 'scripts/build-desktop-sidecar.mjs', 'localSidecar.buildScript must point at build-desktop-sidecar');
  requireCondition(localSidecar.sourcePackage === 'server/cmd/kuviewer-server', 'localSidecar.sourcePackage must be server/cmd/kuviewer-server');
  requireCondition(localSidecar.outputDir === 'desktop/src-tauri/binaries', 'localSidecar.outputDir must be desktop/src-tauri/binaries');
  requireCondition(localSidecar.binaryBaseName === 'kuviewer-sidecar', 'localSidecar.binaryBaseName must be kuviewer-sidecar');
  requireCondition(localSidecar.tauriExternalBinCandidate === 'binaries/kuviewer-sidecar', 'localSidecar.tauriExternalBinCandidate must be binaries/kuviewer-sidecar');
  requireCondition(localSidecar.gitIgnoredOutput === true, 'localSidecar.gitIgnoredOutput must be true');

  const targetMap = new Map((Array.isArray(localSidecar.targets) ? localSidecar.targets : []).map((target) => [target.targetTriple, target]));
  const expectedTargets = [
    ['aarch64-apple-darwin', 'darwin', 'arm64'],
    ['x86_64-apple-darwin', 'darwin', 'amd64'],
    ['x86_64-pc-windows-msvc', 'windows', 'amd64'],
    ['aarch64-pc-windows-msvc', 'windows', 'arm64'],
  ];
  for (const [targetTriple, goos, goarch] of expectedTargets) {
    const target = targetMap.get(targetTriple);
    requireCondition(Boolean(target), `localSidecar.targets must include ${targetTriple}`);
    if (target) {
      requireCondition(target.goos === goos, `localSidecar target ${targetTriple} goos must be ${goos}`);
      requireCondition(target.goarch === goarch, `localSidecar target ${targetTriple} goarch must be ${goarch}`);
    }
  }

  const runtime = localSidecar.runtime || {};
  requireCondition(runtime.launchMode === 'rust-managed-sidecar', 'localSidecar.runtime.launchMode must be rust-managed-sidecar');
  requireCondition(runtime.listenAddr === '127.0.0.1:18086', 'localSidecar.runtime.listenAddr must be 127.0.0.1:18086');
  requireCondition(runtime.adminToken === 'generated-per-launch-memory-only', 'localSidecar.runtime.adminToken must be generated-per-launch-memory-only');
  requireCondition(runtime.adminTokenHandoff === 'tauri-command-session-storage', 'localSidecar.runtime.adminTokenHandoff must be tauri-command-session-storage');
  requireCondition(runtime.serverSource === 'mock-default-env-overridable', 'localSidecar.runtime.serverSource must be mock-default-env-overridable');
  requireCondition(runtime.sourceEnv === 'KUVIEWER_DESKTOP_SIDECAR_SOURCE', 'localSidecar.runtime.sourceEnv must be KUVIEWER_DESKTOP_SIDECAR_SOURCE');
  requireCondition(runtime.disableEnv === 'KUVIEWER_DESKTOP_DISABLE_SIDECAR', 'localSidecar.runtime.disableEnv must be KUVIEWER_DESKTOP_DISABLE_SIDECAR');
  requireCondition(runtime.staticDir === 'disabled-for-sidecar-api', 'localSidecar.runtime.staticDir must be disabled-for-sidecar-api');
  requireCondition(runtime.resourceViewsStore === 'runtime-memory-unless-user-configured-later', 'localSidecar.runtime.resourceViewsStore must be runtime-memory-unless-user-configured-later');

  const profileUx = localSidecar.profileUx || {};
  requireCondition(['scaffolded', 'prototype-hidden'].includes(profileUx.status), 'localSidecar.profileUx.status must be scaffolded or prototype-hidden');
  requireCondition(profileUx.displaysSidecarSource === true, 'localSidecar.profileUx.displaysSidecarSource must be true');
  requireCondition(typeof profileUx.explicitUseSidecarButton === 'boolean', 'localSidecar.profileUx.explicitUseSidecarButton must be boolean');
  requireCondition(profileUx.remoteProfileCanOverrideLocal === true, 'localSidecar.profileUx.remoteProfileCanOverrideLocal must be true');
  requireCondition(profileUx.tokenRequeryOnSwitch === true, 'localSidecar.profileUx.tokenRequeryOnSwitch must be true');
  requireCondition(profileUx.noTokenPropDrilling === true, 'localSidecar.profileUx.noTokenPropDrilling must be true');

  const sidecarSecurity = localSidecar.security || {};
  requireCondition(sidecarSecurity.loopbackOnly === true, 'localSidecar.security.loopbackOnly must be true');
  requireCondition(sidecarSecurity.noBrowserKubeCredentialEntry === true, 'localSidecar.security.noBrowserKubeCredentialEntry must be true');
  requireCondition(sidecarSecurity.noKubeconfigPersistence === true, 'localSidecar.security.noKubeconfigPersistence must be true');
  requireCondition(sidecarSecurity.noAdminTokenPersistence === true, 'localSidecar.security.noAdminTokenPersistence must be true');
  requireCondition(sidecarSecurity.noSecretValues === true, 'localSidecar.security.noSecretValues must be true');
  requireCondition(sidecarSecurity.noOperationalActions === true, 'localSidecar.security.noOperationalActions must be true');
  requireCondition(sidecarSecurity.noCommittedBinaries === true, 'localSidecar.security.noCommittedBinaries must be true');
  requireCondition(sidecarSecurity.noJavascriptShellPermission === true, 'localSidecar.security.noJavascriptShellPermission must be true');

  const sidecarBuildScript = await readTextFile(localSidecar.buildScript, 'desktop sidecar build script');
  for (const marker of [
    'server/cmd/kuviewer-server',
    'desktop/src-tauri/binaries',
    'kuviewer-sidecar',
    'tauriExternalBinCandidate',
    'GOOS',
    'GOARCH',
    'CGO_ENABLED',
    '--target',
    '--dry-run',
    '--list-targets',
    'aarch64-apple-darwin',
    'x86_64-pc-windows-msvc',
  ]) {
    requireCondition(sidecarBuildScript.includes(marker), `desktop sidecar build script must include ${marker}`);
  }

  const tauriConfig = await readJsonFile(spec.tauri?.configPath, 'tauri.configPath');
  const externalBins = new Set(Array.isArray(tauriConfig?.bundle?.externalBin) ? tauriConfig.bundle.externalBin : []);
  requireCondition(externalBins.has('binaries/kuviewer-sidecar'), 'tauri config must enable the Kuviewer sidecar externalBin');
  requireCondition(tauriConfig?.build?.beforeBuildCommand?.includes('build-desktop-sidecar.mjs'), 'tauri config must build the sidecar before packaging');

  const capability = await readJsonFile(spec.tauri?.capabilityPath, 'tauri.capabilityPath');
  requireCondition(!JSON.stringify(capability).includes('shell:'), 'desktop capability must not expose shell permissions to frontend JavaScript');

  const gitignore = await readTextFile('.gitignore', '.gitignore');
  requireCondition(gitignore.includes('desktop/src-tauri/binaries/'), '.gitignore must exclude generated sidecar binaries');

  const ciWorkflow = await readTextFile('.github/workflows/ci.yml', 'ci workflow');
  requireCondition(ciWorkflow.includes('node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --dry-run'), 'ci workflow must dry-run the sidecar build plan');

  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  const prerequisitesDoc = await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc');
  const mainRs = await readTextFile('desktop/src-tauri/src/main.rs', 'desktop Tauri main');
  for (const marker of [
    'desktop_sidecar_profile',
    'tauri_plugin_shell::init',
    'sidecar("kuviewer-sidecar")',
    'KUVIEWER_DESKTOP_SIDECAR_SOURCE',
    'KUVIEWER_DESKTOP_DISABLE_SIDECAR',
    'KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR',
    'KUVIEWER_ADMIN_TOKEN',
    'KUVIEWER_LISTEN_ADDR',
    'getrandom',
    'CommandChild',
    'CloseRequested',
  ]) {
    requireCondition(mainRs.includes(marker), `desktop Tauri main must include ${marker}`);
  }

  const profileModule = await readTextFile('website/src/features/desktop/desktopConnectionProfile.ts', 'desktop connection profile frontend module');
  for (const marker of ['desktop_sidecar_profile', '__TAURI__', 'normalizeDesktopServerUrl', 'adminToken', 'DesktopSidecarStatus']) {
    requireCondition(profileModule.includes(marker), `desktop connection profile module must include ${marker}`);
  }

  const app = await readTextFile('website/src/app/App.tsx', 'app shell');
  if (profileUx.status === 'prototype-hidden') {
    const sourceModeBar = await readTextFile('website/src/components/SourceModeBar.tsx', 'source mode bar');
    requireCondition(!sourceModeBar.includes('desktop-use-sidecar-profile'), 'prototype-hidden sidecar UI must not expose the local sidecar switch');
    requireCondition(!app.includes('handleUseDesktopSidecar'), 'app shell must not expose the local sidecar switch handler in CM/SSH product mode');
  } else {
    for (const marker of ['getDesktopSidecarProfile', 'storeAdminToken', 'storeDesktopConnectionProfile', 'handleUseDesktopSidecar', 'setDesktopSidecarProfile']) {
      requireCondition(app.includes(marker), `app shell must include ${marker}`);
    }
  }

  const profilePanel = await readTextFile('website/src/components/DesktopConnectionProfilePanel.tsx', 'desktop connection profile UI panel');
  if (profileUx.status === 'prototype-hidden') {
    requireCondition(profilePanel.includes('desktop-use-sidecar-profile'), 'prototype sidecar panel source should remain available for reference');
  } else {
    for (const marker of ['sidecarProfile', 'desktop-use-sidecar-profile', '로컬 sidecar 사용']) {
      requireCondition(profilePanel.includes(marker), `desktop connection profile panel must include ${marker}`);
    }
  }

  requireCondition(desktopReadme.includes('Local Sidecar Runtime'), 'desktop README must document local sidecar runtime');
  requireCondition(prerequisitesDoc.includes('node scripts/build-desktop-sidecar.mjs'), 'desktop build prerequisites doc must mention sidecar build script');
  requireCondition(prerequisitesDoc.includes('KUVIEWER_DESKTOP_SIDECAR_SOURCE'), 'desktop build prerequisites doc must mention the sidecar source override');
}

async function validateCredentialStorageDesign(spec) {
  const design = spec.credentialStorageDesign || {};
  const credentialPrototypeHidden = design.status === 'prototype-hidden-after-cm-session-manager';
  requireCondition(
    design.status === 'sidecar-runtime-scaffolded' || credentialPrototypeHidden,
    'credentialStorageDesign.status must be sidecar-runtime-scaffolded or prototype-hidden-after-cm-session-manager'
  );
  requireCondition(design.documentPath === 'desktop/KEYCHAIN_CREDENTIAL_DESIGN.md', 'credentialStorageDesign.documentPath must point at the keychain credential design doc');
  requireCondition(design.firstRuntimeScope === 'bearer-token-only', 'credentialStorageDesign.firstRuntimeScope must be bearer-token-only');
  requireCondition(design.browserCredentialEntry === false, 'credentialStorageDesign.browserCredentialEntry must be false');
  requireCondition(design.browserCredentialPersistence === false, 'credentialStorageDesign.browserCredentialPersistence must be false');
  requireCondition(design.frontendMetadataOnly === true, 'credentialStorageDesign.frontendMetadataOnly must be true');
  requireCondition(design.safeMetadataStorage === 'localStorage-profile-id-display-only', 'credentialStorageDesign.safeMetadataStorage must be localStorage-profile-id-display-only');
  requireCondition(Array.isArray(design.osCredentialStores) && design.osCredentialStores.includes('macos-keychain'), 'credentialStorageDesign.osCredentialStores must include macos-keychain');
  requireCondition(Array.isArray(design.osCredentialStores) && design.osCredentialStores.includes('windows-credential-manager'), 'credentialStorageDesign.osCredentialStores must include windows-credential-manager');
  requireCondition(Array.isArray(design.secretProfileMaterial) && design.secretProfileMaterial.includes('bearer-token'), 'credentialStorageDesign.secretProfileMaterial must include bearer-token');
  requireCondition(design.tokenTransport === 'KUVIEWER_KUBE_TOKEN_FILE', 'credentialStorageDesign.tokenTransport must use KUVIEWER_KUBE_TOKEN_FILE');
  requireCondition(design.avoidBearerTokenEnvForDesktop === true, 'credentialStorageDesign.avoidBearerTokenEnvForDesktop must be true');
  requireCondition(design.tempFilePolicy === '0600-runtime-delete-on-exit', 'credentialStorageDesign.tempFilePolicy must be 0600-runtime-delete-on-exit');
  requireCondition(design.noKubeconfigPersistence === true, 'credentialStorageDesign.noKubeconfigPersistence must be true');
  requireCondition(design.noSecretValues === true, 'credentialStorageDesign.noSecretValues must be true');
  requireCondition(design.noOperationalActions === true, 'credentialStorageDesign.noOperationalActions must be true');

  const runtimePrototype = design.runtimePrototype || {};
  requireCondition(runtimePrototype.metadataCommand === 'desktop_kubernetes_profiles', 'credentialStorageDesign.runtimePrototype.metadataCommand must be desktop_kubernetes_profiles');
  requireCondition(runtimePrototype.selectCommand === 'desktop_select_kubernetes_profile', 'credentialStorageDesign.runtimePrototype.selectCommand must be desktop_select_kubernetes_profile');
  requireCondition(runtimePrototype.deleteCredentialCommand === 'desktop_delete_kubernetes_profile_credential', 'credentialStorageDesign.runtimePrototype.deleteCredentialCommand must be desktop_delete_kubernetes_profile_credential');
  requireCondition(
    runtimePrototype.uiPanel === 'DesktopKubernetesProfilePanel' || (credentialPrototypeHidden && runtimePrototype.uiPanel === 'prototype-hidden'),
    'credentialStorageDesign.runtimePrototype.uiPanel must be DesktopKubernetesProfilePanel or prototype-hidden'
  );
  requireCondition(runtimePrototype.secretReadWriteImplemented === true, 'credentialStorageDesign.runtimePrototype.secretReadWriteImplemented must be true once native OS store helpers exist');
  requireCondition(runtimePrototype.sidecarRestartImplemented === true, 'credentialStorageDesign.runtimePrototype.sidecarRestartImplemented must be true once selecting a stored credential restarts the sidecar');
  requireCondition(runtimePrototype.browserReceivesSecrets === false, 'credentialStorageDesign.runtimePrototype.browserReceivesSecrets must be false');
  requireCondition(runtimePrototype.credentialAvailableField === 'credentialAvailable', 'credentialStorageDesign.runtimePrototype.credentialAvailableField must be credentialAvailable');
  requireCondition(runtimePrototype.activeProfileStatus === 'sidecar-kubernetes-active', 'credentialStorageDesign.runtimePrototype.activeProfileStatus must be sidecar-kubernetes-active');
  requireCondition(runtimePrototype.importTokenFileEnv === 'KUVIEWER_DESKTOP_KUBE_TOKEN_FILE', 'credentialStorageDesign.runtimePrototype.importTokenFileEnv must be KUVIEWER_DESKTOP_KUBE_TOKEN_FILE');
  requireCondition(runtimePrototype.importTokenFileFlagEnv === 'KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE', 'credentialStorageDesign.runtimePrototype.importTokenFileFlagEnv must be KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE');
  requireCondition(runtimePrototype.runtimeTokenFileEnv === 'KUVIEWER_KUBE_TOKEN_FILE', 'credentialStorageDesign.runtimePrototype.runtimeTokenFileEnv must be KUVIEWER_KUBE_TOKEN_FILE');
  requireCondition(runtimePrototype.runtimeTokenFilePolicy === '0600-temp-dir-delete-on-sidecar-stop', 'credentialStorageDesign.runtimePrototype.runtimeTokenFilePolicy must be 0600-temp-dir-delete-on-sidecar-stop');
  const runtimeSmoke = runtimePrototype.runtimeSmoke || {};
  if (credentialPrototypeHidden) {
    requireCondition(runtimeSmoke.status === 'prototype-hidden', 'credentialStorageDesign.runtimePrototype.runtimeSmoke.status must be prototype-hidden');
  } else {
    requireCondition(runtimeSmoke.status === 'automated-stubbed-tauri-bridge', 'credentialStorageDesign.runtimePrototype.runtimeSmoke.status must be automated-stubbed-tauri-bridge');
    requireCondition(runtimeSmoke.script === 'scripts/smoke-desktop-keychain-runtime.mjs', 'credentialStorageDesign.runtimePrototype.runtimeSmoke.script must point at smoke-desktop-keychain-runtime');
    requireCondition(runtimeSmoke.ciWorkflow === '.github/workflows/ci.yml', 'credentialStorageDesign.runtimePrototype.runtimeSmoke.ciWorkflow must point at ci workflow');
    requireCondition(runtimeSmoke.requiresRealCredentialStore === false, 'credentialStorageDesign.runtimePrototype.runtimeSmoke.requiresRealCredentialStore must be false');
    const smokeFlows = new Set(Array.isArray(runtimeSmoke.verifiedFlows) ? runtimeSmoke.verifiedFlows : []);
    requireCondition(smokeFlows.has('select-profile-restarts-sidecar-live'), 'credentialStorageDesign.runtimePrototype.runtimeSmoke.verifiedFlows must include select-profile-restarts-sidecar-live');
    requireCondition(smokeFlows.has('delete-active-credential-clears-live-token'), 'credentialStorageDesign.runtimePrototype.runtimeSmoke.verifiedFlows must include delete-active-credential-clears-live-token');
  }
  const fixtureEnv = new Set(Array.isArray(runtimePrototype.envMetadataFixture) ? runtimePrototype.envMetadataFixture : []);
  for (const envName of ['KUVIEWER_DESKTOP_KUBE_API_SERVER', 'KUVIEWER_DESKTOP_KUBE_PROFILE_ID', 'KUVIEWER_DESKTOP_KUBE_PROFILE_NAME']) {
    requireCondition(fixtureEnv.has(envName), `credentialStorageDesign.runtimePrototype.envMetadataFixture must include ${envName}`);
  }

  const designDoc = await readTextFile(design.documentPath, 'desktop keychain credential design doc');
  for (const marker of [
    'macOS: Keychain',
    'Windows: Credential Manager',
    'KUVIEWER_KUBE_TOKEN_FILE',
    '0600',
    'localStorage',
    'browser-side kubeconfig',
    'No exec',
    'Secret values remain hidden',
    'bearer-token Kubernetes profiles',
    'Runtime Metadata Prototype',
    'desktop_kubernetes_profiles',
    'desktop_select_kubernetes_profile',
    'desktop_delete_kubernetes_profile_credential',
    'KUVIEWER_DESKTOP_KUBE_API_SERVER',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_ID',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_NAME',
    'KUVIEWER_DESKTOP_KUBE_TOKEN_FILE',
    'KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE',
    'sidecar-kubernetes-active',
    '0600-temp-dir-delete-on-sidecar-stop',
  ]) {
    requireCondition(designDoc.includes(marker), `desktop keychain credential design doc must include ${marker}`);
  }
  requireCondition(!designDoc.includes('KUVIEWER_KUBE_BEARER_TOKEN=<'), 'desktop keychain credential design must not recommend bearer token env handoff');

  const mainRs = await readTextFile('desktop/src-tauri/src/main.rs', 'desktop Tauri main');
  for (const marker of [
    'DesktopKubernetesProfileMetadata',
    'desktop_kubernetes_profiles',
    'desktop_select_kubernetes_profile',
    'desktop_delete_kubernetes_profile_credential',
    'DESKTOP_KUBE_CREDENTIAL_SERVICE',
    'write_bearer_token',
    'has_bearer_token',
    'delete_bearer_token',
    'read_bearer_token',
    'restart_desktop_sidecar_for_kubernetes_profile',
    'write_runtime_kubernetes_token_file',
    'cleanup_runtime_files',
    'KUVIEWER_KUBE_TOKEN_FILE',
    'sidecar-kubernetes-active',
    'SecKeychainAddGenericPassword',
    'CredWriteW',
    'KUVIEWER_DESKTOP_KUBE_API_SERVER',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_ID',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_NAME',
    'KUVIEWER_DESKTOP_KUBE_TOKEN_FILE',
    'KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE',
    'runtime-env-metadata-fixture',
  ]) {
    requireCondition(mainRs.includes(marker), `desktop Tauri main must include ${marker}`);
  }
  requireCondition(!mainRs.includes('KUVIEWER_DESKTOP_KUBE_BEARER_TOKEN'), 'desktop Tauri main must not read bearer tokens from desktop env metadata fixture');

  if (!credentialPrototypeHidden) {
    const smokeScript = await readTextFile(runtimeSmoke.script, 'desktop native credential runtime smoke script');
    for (const marker of [
      'desktop_kubernetes_profiles',
      'desktop_select_kubernetes_profile',
      'desktop_sidecar_profile',
      'desktop_delete_kubernetes_profile_credential',
      'sidecar-kubernetes-active',
      'token은 native/runtime file 경로만 사용',
      'kuviewer_admin_token',
      'kuviewer_source_mode',
      'desktop smoke must not store admin token in localStorage',
      'active credential delete must clear sessionStorage admin token',
    ]) {
      requireCondition(smokeScript.includes(marker), `desktop native credential runtime smoke script must include ${marker}`);
    }

    const ciWorkflow = await readTextFile(runtimeSmoke.ciWorkflow, 'ci workflow');
    for (const marker of [
      'Desktop native credential runtime smoke',
      'scripts/smoke-desktop-keychain-runtime.mjs',
      'npx playwright install --with-deps chromium',
      'http://127.0.0.1:4174/',
    ]) {
      requireCondition(ciWorkflow.includes(marker), `ci workflow must include ${marker}`);
    }
  }

  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  const prerequisitesDoc = await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc');
  const handoff = await readTextFile('CODEX_HANDOFF.md', 'Codex handoff');
  for (const [label, text] of [
    ['desktop README', desktopReadme],
    ['desktop build prerequisites doc', prerequisitesDoc],
    ['Codex handoff', handoff],
  ]) {
    requireCondition(text.includes('KEYCHAIN_CREDENTIAL_DESIGN.md'), `${label} must reference KEYCHAIN_CREDENTIAL_DESIGN.md`);
    requireCondition(text.includes('macOS Keychain'), `${label} must mention macOS Keychain`);
    requireCondition(text.includes('Windows Credential Manager'), `${label} must mention Windows Credential Manager`);
    requireCondition(text.includes('desktop_kubernetes_profiles'), `${label} must mention desktop_kubernetes_profiles`);
    requireCondition(text.includes('KUVIEWER_DESKTOP_KUBE_TOKEN_FILE'), `${label} must mention KUVIEWER_DESKTOP_KUBE_TOKEN_FILE`);
    requireCondition(text.includes('smoke-desktop-keychain-runtime.mjs'), `${label} must mention smoke-desktop-keychain-runtime.mjs`);
  }

  const profileModule = await readTextFile('website/src/features/desktop/desktopConnectionProfile.ts', 'desktop connection profile frontend module');
  for (const marker of ['DesktopKubernetesProfile', 'credentialAvailable', 'desktop_kubernetes_profiles', 'desktop_select_kubernetes_profile', 'desktop_delete_kubernetes_profile_credential']) {
    requireCondition(profileModule.includes(marker), `desktop connection profile module must include ${marker}`);
  }
  requireCondition(!profileModule.includes('kubeconfig'), 'desktop frontend profile module must not handle kubeconfig content');

  const profilePanel = await readTextFile('website/src/components/DesktopKubernetesProfilePanel.tsx', 'desktop Kubernetes profile UI panel');
  for (const marker of ['DesktopKubernetesProfilePanel', 'browser secret 저장 없음', 'native credential 있음', 'credential 삭제', 'desktop-kubernetes-profile-panel']) {
    requireCondition(profilePanel.includes(marker), `desktop Kubernetes profile panel must include ${marker}`);
  }

  const sourceModeBar = await readTextFile('website/src/components/SourceModeBar.tsx', 'source mode bar');
  if (credentialPrototypeHidden) {
    requireCondition(!sourceModeBar.includes('DesktopKubernetesProfilePanel'), 'source mode bar must not render DesktopKubernetesProfilePanel in CM/SSH product mode');
  } else {
    requireCondition(sourceModeBar.includes('DesktopKubernetesProfilePanel'), 'source mode bar must render DesktopKubernetesProfilePanel in desktop runtime');
  }

  const app = await readTextFile('website/src/app/App.tsx', 'app shell');
  if (credentialPrototypeHidden) {
    requireCondition(!app.includes('sidecar-kubernetes-active'), 'app shell must not expose keychain sidecar activation in CM/SSH product mode');
  } else {
    for (const marker of ['sidecar-kubernetes-active', 'getDesktopSidecarProfile', 'storeAdminToken', 'storeSourceMode', 'token은 native/runtime file 경로만 사용']) {
      requireCondition(app.includes(marker), `app shell must include ${marker}`);
    }
  }
}

async function validateCmSshSessionManager(spec) {
  const manager = spec.cmSshSessionManager || {};
  requireCondition(
    [
      'runtime-health-details',
      'advanced-diagnostics',
      'session-export-import',
      'diagnostics-filtering',
      'diagnostics-saved-filters',
      'connection-profile-polish',
      'session-clone-polish',
      'session-groups-favorites',
      'session-bulk-actions',
      'session-saved-layouts',
      'session-layout-import-export',
      'session-layout-conflict-preview',
      'session-layout-row-conflicts',
      'session-layout-conflict-summary',
      'session-layout-conflict-keyboard',
      'session-layout-conflict-accessibility',
      'session-layout-preset-search',
      'session-layout-preset-rename',
      'session-layout-preset-duplicate',
      'session-layout-preset-bulk-management',
      'session-layout-preset-folder-polish',
      'session-layout-preset-folder-bulk-move',
      'session-layout-preset-folder-filter-polish',
      'session-layout-preset-folder-action-polish',
      'session-layout-preset-folder-keyboard-polish',
      'session-layout-preset-folder-accessibility-polish',
      'session-layout-preset-folder-empty-state-polish',
      'session-layout-preset-folder-drag-reorder-polish',
      'session-layout-preset-folder-drag-reorder-keyboard-polish',
      'session-layout-preset-folder-reorder-focus-polish',
      'session-layout-preset-folder-reorder-focus-accessibility-polish',
      'session-layout-preset-folder-reorder-disabled-state-polish',
      'session-layout-preset-folder-reorder-status-wording-polish',
    ].includes(manager.status),
    'cmSshSessionManager.status must be a known CM/SSH session manager milestone'
  );
  requireCondition(manager.desktopOnly === true, 'cmSshSessionManager.desktopOnly must be true');
  requireCondition(manager.webExposed === false, 'cmSshSessionManager.webExposed must be false');
  requireCondition(
    manager.storage === 'tauri-state-safe-metadata-with-os-credential-store-and-session-runtime',
    'cmSshSessionManager.storage must be tauri-state-safe-metadata-with-os-credential-store-and-session-runtime'
  );
  requireCondition(manager.secretStorage === 'os-credential-store-private-key', 'cmSshSessionManager.secretStorage must be os-credential-store-private-key');
  requireCondition(manager.defaultPort === 22, 'cmSshSessionManager.defaultPort must be 22');
  requireCondition(manager.actualSshConnection === true, 'cmSshSessionManager.actualSshConnection must be true for credential connection checks');

  const fields = new Set(Array.isArray(manager.safeMetadataFields) ? manager.safeMetadataFields : []);
  for (const field of [
    'id',
    'name',
    'host',
    'port',
    'user',
    'remoteApiHost',
    'remoteApiPort',
    'authType',
    'credentialStore',
    'credentialAvailable',
    'status',
    'runtimeStatus',
    'updatedAt',
    'selected',
    'description',
    'lastCheckStatus',
    'lastCheckAt',
    'lastCheckMessage',
    'diagnosticStage',
    'diagnosticSeverity',
    'diagnosticMessage',
    'diagnosticHint',
  ]) {
    requireCondition(fields.has(field), `cmSshSessionManager.safeMetadataFields must include ${field}`);
  }
  const commands = new Set(Array.isArray(manager.commands) ? manager.commands : []);
  for (const command of [
    'desktop_cm_sessions',
    'desktop_save_cm_session',
    'desktop_select_cm_session',
    'desktop_delete_cm_session',
    'desktop_import_cm_session_private_key',
    'desktop_delete_cm_session_credential',
    'desktop_check_cm_session',
    'desktop_cm_session_runtime',
    'desktop_start_cm_session_runtime',
    'desktop_stop_cm_session_runtime',
    'desktop_check_cm_session_runtime',
  ]) {
    requireCondition(commands.has(command), `cmSshSessionManager.commands must include ${command}`);
  }
  const runtimeFields = new Set(Array.isArray(manager.runtimeSafeProfileFields) ? manager.runtimeSafeProfileFields : []);
  for (const field of [
    'sessionId',
    'sessionName',
    'serverUrl',
    'remoteApiHost',
    'remoteApiPort',
    'localPort',
    'status',
    'startedAt',
    'healthStatus',
    'lastHealthAt',
    'lastHealthMessage',
    'lastError',
    'diagnosticStage',
    'diagnosticSeverity',
    'diagnosticMessage',
    'diagnosticHint',
  ]) {
    requireCondition(runtimeFields.has(field), `cmSshSessionManager.runtimeSafeProfileFields must include ${field}`);
  }
  const diagnosticPolicy = manager.diagnosticPolicy || {};
  const diagnosticStages = new Set(Array.isArray(diagnosticPolicy.stages) ? diagnosticPolicy.stages : []);
  for (const stage of ['metadata', 'credential', 'reachability', 'ssh-auth', 'tunnel', 'health', 'runtime']) {
    requireCondition(diagnosticStages.has(stage), `cmSshSessionManager.diagnosticPolicy.stages must include ${stage}`);
  }
  const diagnosticSeverities = new Set(Array.isArray(diagnosticPolicy.severities) ? diagnosticPolicy.severities : []);
  for (const severity of ['info', 'warning', 'error']) {
    requireCondition(diagnosticSeverities.has(severity), `cmSshSessionManager.diagnosticPolicy.severities must include ${severity}`);
  }
  requireCondition(diagnosticPolicy.safeOnly === true, 'cmSshSessionManager.diagnosticPolicy.safeOnly must be true');
  requireCondition(diagnosticPolicy.noRawStderr === true, 'cmSshSessionManager.diagnosticPolicy.noRawStderr must be true');
  requireCondition(diagnosticPolicy.noPrivateKeyBody === true, 'cmSshSessionManager.diagnosticPolicy.noPrivateKeyBody must be true');
  requireCondition(diagnosticPolicy.noToken === true, 'cmSshSessionManager.diagnosticPolicy.noToken must be true');
  requireCondition(diagnosticPolicy.noKubeconfig === true, 'cmSshSessionManager.diagnosticPolicy.noKubeconfig must be true');
  requireCondition(diagnosticPolicy.noSecretValues === true, 'cmSshSessionManager.diagnosticPolicy.noSecretValues must be true');
  requireCondition(diagnosticPolicy.noCloudCredentials === true, 'cmSshSessionManager.diagnosticPolicy.noCloudCredentials must be true');
  const exportImportPolicy = manager.exportImportPolicy || {};
  requireCondition(exportImportPolicy.desktopOnly === true, 'cmSshSessionManager.exportImportPolicy.desktopOnly must be true');
  requireCondition(exportImportPolicy.schemaVersion === 1, 'cmSshSessionManager.exportImportPolicy.schemaVersion must be 1');
  requireCondition(exportImportPolicy.kind === 'kuviewer.desktop.cmSessions', 'cmSshSessionManager.exportImportPolicy.kind must be kuviewer.desktop.cmSessions');
  requireCondition(exportImportPolicy.maxImportItems === 50, 'cmSshSessionManager.exportImportPolicy.maxImportItems must be 50');
  requireCondition(exportImportPolicy.safeEditableFieldsOnly === true, 'cmSshSessionManager.exportImportPolicy.safeEditableFieldsOnly must be true');
  const exportFields = new Set(Array.isArray(exportImportPolicy.fields) ? exportImportPolicy.fields : []);
  for (const field of ['name', 'host', 'port', 'user', 'remoteApiHost', 'remoteApiPort', 'description']) {
    requireCondition(exportFields.has(field), `cmSshSessionManager.exportImportPolicy.fields must include ${field}`);
  }
  for (const flag of ['noPrivateKeyBody', 'noCredentialPayload', 'noRuntimeProfile', 'noDiagnosticHistory', 'noToken', 'noKubeconfig', 'noSecretValues', 'noEventsOrLogs']) {
    requireCondition(exportImportPolicy[flag] === true, `cmSshSessionManager.exportImportPolicy.${flag} must be true`);
  }
  const diagnosticFiltering = manager.diagnosticFiltering || {};
  requireCondition(diagnosticFiltering.desktopOnly === true, 'cmSshSessionManager.diagnosticFiltering.desktopOnly must be true');
  requireCondition(diagnosticFiltering.uiOnly === true, 'cmSshSessionManager.diagnosticFiltering.uiOnly must be true');
  requireCondition(diagnosticFiltering.persisted === false, 'cmSshSessionManager.diagnosticFiltering.persisted must be false');
  requireCondition(diagnosticFiltering.exported === false, 'cmSshSessionManager.diagnosticFiltering.exported must be false');
  requireCondition(diagnosticFiltering.usesDisplayedDiagnosticSource === true, 'cmSshSessionManager.diagnosticFiltering.usesDisplayedDiagnosticSource must be true');
  const filterFields = new Set(Array.isArray(diagnosticFiltering.fields) ? diagnosticFiltering.fields : []);
  for (const field of ['diagnosticStage', 'diagnosticSeverity']) {
    requireCondition(filterFields.has(field), `cmSshSessionManager.diagnosticFiltering.fields must include ${field}`);
  }
  const diagnosticSavedFilters = manager.diagnosticSavedFilters || {};
  requireCondition(diagnosticSavedFilters.desktopOnly === true, 'cmSshSessionManager.diagnosticSavedFilters.desktopOnly must be true');
  requireCondition(diagnosticSavedFilters.storage === 'localStorage-ui-preference', 'cmSshSessionManager.diagnosticSavedFilters.storage must be localStorage-ui-preference');
  requireCondition(diagnosticSavedFilters.storageKey === 'kuviewer_desktop_cm_diagnostic_filter_presets', 'cmSshSessionManager.diagnosticSavedFilters.storageKey must be kuviewer_desktop_cm_diagnostic_filter_presets');
  requireCondition(diagnosticSavedFilters.maxPresets === 8, 'cmSshSessionManager.diagnosticSavedFilters.maxPresets must be 8');
  requireCondition(diagnosticSavedFilters.maxNameLength === 40, 'cmSshSessionManager.diagnosticSavedFilters.maxNameLength must be 40');
  const savedFilterFields = new Set(Array.isArray(diagnosticSavedFilters.fields) ? diagnosticSavedFilters.fields : []);
  for (const field of ['name', 'diagnosticStage', 'diagnosticSeverity', 'updatedAt']) {
    requireCondition(savedFilterFields.has(field), `cmSshSessionManager.diagnosticSavedFilters.fields must include ${field}`);
  }
  for (const flag of ['noSessionSearch', 'noSessionData', 'noCredentialPayload', 'noRuntimeProfile', 'noDiagnosticHistory', 'noExportImportPayload']) {
    requireCondition(diagnosticSavedFilters[flag] === true, `cmSshSessionManager.diagnosticSavedFilters.${flag} must be true`);
  }
  const connectionProfilePolish = manager.connectionProfilePolish || {};
  requireCondition(connectionProfilePolish.desktopOnly === true, 'cmSshSessionManager.connectionProfilePolish.desktopOnly must be true');
  requireCondition(connectionProfilePolish.uiOnly === true, 'cmSshSessionManager.connectionProfilePolish.uiOnly must be true');
  requireCondition(connectionProfilePolish.noNewStorage === true, 'cmSshSessionManager.connectionProfilePolish.noNewStorage must be true');
  requireCondition(connectionProfilePolish.noExportImportSchemaChange === true, 'cmSshSessionManager.connectionProfilePolish.noExportImportSchemaChange must be true');
  requireCondition(connectionProfilePolish.noCredentialPayload === true, 'cmSshSessionManager.connectionProfilePolish.noCredentialPayload must be true');
  requireCondition(connectionProfilePolish.noRuntimeProfile === true, 'cmSshSessionManager.connectionProfilePolish.noRuntimeProfile must be true');
  const quickApiPresets = Array.isArray(connectionProfilePolish.quickApiPresets) ? connectionProfilePolish.quickApiPresets : [];
  for (const preset of [
    ['127.0.0.1', 18085],
    ['localhost', 18085],
    ['127.0.0.1', 8080],
  ]) {
    requireCondition(
      quickApiPresets.some((candidate) => candidate && candidate.host === preset[0] && candidate.port === preset[1]),
      `cmSshSessionManager.connectionProfilePolish.quickApiPresets must include ${preset[0]}:${preset[1]}`
    );
  }
  const validationFields = new Set(Array.isArray(connectionProfilePolish.frontendValidation) ? connectionProfilePolish.frontendValidation : []);
  for (const field of ['name', 'host', 'user', 'port', 'remoteApiPort']) {
    requireCondition(validationFields.has(field), `cmSshSessionManager.connectionProfilePolish.frontendValidation must include ${field}`);
  }
  const sessionClonePolish = manager.sessionClonePolish || {};
  requireCondition(sessionClonePolish.desktopOnly === true, 'cmSshSessionManager.sessionClonePolish.desktopOnly must be true');
  requireCondition(sessionClonePolish.uiOnly === true, 'cmSshSessionManager.sessionClonePolish.uiOnly must be true');
  requireCondition(sessionClonePolish.requiresExplicitSave === true, 'cmSshSessionManager.sessionClonePolish.requiresExplicitSave must be true');
  requireCondition(sessionClonePolish.noNewStorage === true, 'cmSshSessionManager.sessionClonePolish.noNewStorage must be true');
  requireCondition(sessionClonePolish.noExportImportSchemaChange === true, 'cmSshSessionManager.sessionClonePolish.noExportImportSchemaChange must be true');
  requireCondition(sessionClonePolish.nameConflictPolicy === 'append-copy-suffix', 'cmSshSessionManager.sessionClonePolish.nameConflictPolicy must be append-copy-suffix');
  const cloneFields = new Set(Array.isArray(sessionClonePolish.fields) ? sessionClonePolish.fields : []);
  for (const field of ['name', 'host', 'port', 'user', 'remoteApiHost', 'remoteApiPort', 'description']) {
    requireCondition(cloneFields.has(field), `cmSshSessionManager.sessionClonePolish.fields must include ${field}`);
  }
  for (const flag of ['clearsId', 'noCredentialPayload', 'noCredentialAvailabilityCopy', 'noRuntimeProfile', 'noDiagnosticHistory', 'noToken', 'noKubeconfig', 'noSecretValues']) {
    requireCondition(sessionClonePolish[flag] === true, `cmSshSessionManager.sessionClonePolish.${flag} must be true`);
  }
  const sessionGroupingFavorites = manager.sessionGroupingFavorites || {};
  requireCondition(sessionGroupingFavorites.desktopOnly === true, 'cmSshSessionManager.sessionGroupingFavorites.desktopOnly must be true');
  requireCondition(sessionGroupingFavorites.uiOnly === true, 'cmSshSessionManager.sessionGroupingFavorites.uiOnly must be true');
  requireCondition(sessionGroupingFavorites.storage === 'localStorage-ui-preference', 'cmSshSessionManager.sessionGroupingFavorites.storage must be localStorage-ui-preference');
  requireCondition(sessionGroupingFavorites.storageKey === 'kuviewer_desktop_cm_session_view_preferences', 'cmSshSessionManager.sessionGroupingFavorites.storageKey must be kuviewer_desktop_cm_session_view_preferences');
  requireCondition(sessionGroupingFavorites.defaultGroup === 'General', 'cmSshSessionManager.sessionGroupingFavorites.defaultGroup must be General');
  requireCondition(sessionGroupingFavorites.maxGroupNameLength === 40, 'cmSshSessionManager.sessionGroupingFavorites.maxGroupNameLength must be 40');
  const groupingFields = new Set(Array.isArray(sessionGroupingFavorites.fields) ? sessionGroupingFavorites.fields : []);
  for (const field of ['sessionId', 'group', 'favorite', 'updatedAt']) {
    requireCondition(groupingFields.has(field), `cmSshSessionManager.sessionGroupingFavorites.fields must include ${field}`);
  }
  for (const flag of ['collapseStateStored', 'noTauriSchemaChange', 'noExportImportSchemaChange', 'noCredentialPayload', 'noRuntimeProfile', 'noDiagnosticHistory', 'noToken', 'noKubeconfig', 'noSecretValues', 'noEventsOrLogs']) {
    requireCondition(sessionGroupingFavorites[flag] === true, `cmSshSessionManager.sessionGroupingFavorites.${flag} must be true`);
  }
  const sessionBulkActions = manager.sessionBulkActions || {};
  requireCondition(sessionBulkActions.desktopOnly === true, 'cmSshSessionManager.sessionBulkActions.desktopOnly must be true');
  requireCondition(sessionBulkActions.uiOnly === true, 'cmSshSessionManager.sessionBulkActions.uiOnly must be true');
  requireCondition(sessionBulkActions.selectionStorage === 'memory-only', 'cmSshSessionManager.sessionBulkActions.selectionStorage must be memory-only');
  requireCondition(sessionBulkActions.selectionPersisted === false, 'cmSshSessionManager.sessionBulkActions.selectionPersisted must be false');
  requireCondition(sessionBulkActions.selectionExported === false, 'cmSshSessionManager.sessionBulkActions.selectionExported must be false');
  requireCondition(sessionBulkActions.groupAndFavoriteStorage === 'kuviewer_desktop_cm_session_view_preferences', 'cmSshSessionManager.sessionBulkActions.groupAndFavoriteStorage must be kuviewer_desktop_cm_session_view_preferences');
  requireCondition(sessionBulkActions.deleteConfirmation === 'inline-two-step', 'cmSshSessionManager.sessionBulkActions.deleteConfirmation must be inline-two-step');
  const bulkActions = new Set(Array.isArray(sessionBulkActions.actions) ? sessionBulkActions.actions : []);
  for (const action of ['select-visible', 'select-group-visible', 'selected-export', 'move-group', 'favorite-on', 'favorite-off', 'delete-confirm']) {
    requireCondition(bulkActions.has(action), `cmSshSessionManager.sessionBulkActions.actions must include ${action}`);
  }
  for (const flag of ['noTauriSchemaChange', 'noExportImportSchemaChange', 'noCredentialPayload', 'noRuntimeProfile', 'noDiagnosticHistory', 'noToken', 'noKubeconfig', 'noSecretValues', 'noEventsOrLogs']) {
    requireCondition(sessionBulkActions[flag] === true, `cmSshSessionManager.sessionBulkActions.${flag} must be true`);
  }
  const sessionSavedLayouts = manager.sessionSavedLayouts || {};
  requireCondition(sessionSavedLayouts.desktopOnly === true, 'cmSshSessionManager.sessionSavedLayouts.desktopOnly must be true');
  requireCondition(sessionSavedLayouts.uiOnly === true, 'cmSshSessionManager.sessionSavedLayouts.uiOnly must be true');
  requireCondition(sessionSavedLayouts.storage === 'localStorage-ui-preference', 'cmSshSessionManager.sessionSavedLayouts.storage must be localStorage-ui-preference');
  requireCondition(sessionSavedLayouts.storageKey === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionSavedLayouts.storageKey must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionSavedLayouts.maxPresets === 8, 'cmSshSessionManager.sessionSavedLayouts.maxPresets must be 8');
  requireCondition(sessionSavedLayouts.maxNameLength === 40, 'cmSshSessionManager.sessionSavedLayouts.maxNameLength must be 40');
  requireCondition(sessionSavedLayouts.appliesOnlyExistingSessionIds === true, 'cmSshSessionManager.sessionSavedLayouts.appliesOnlyExistingSessionIds must be true');
  const layoutFields = new Set(Array.isArray(sessionSavedLayouts.fields) ? sessionSavedLayouts.fields : []);
  for (const field of ['name', 'folder', 'viewPreferences', 'updatedAt']) {
    requireCondition(layoutFields.has(field), `cmSshSessionManager.sessionSavedLayouts.fields must include ${field}`);
  }
  const layoutPreferenceFields = new Set(Array.isArray(sessionSavedLayouts.viewPreferenceFields) ? sessionSavedLayouts.viewPreferenceFields : []);
  for (const field of ['sessionId', 'group', 'favorite', 'updatedAt', 'collapsedGroups']) {
    requireCondition(layoutPreferenceFields.has(field), `cmSshSessionManager.sessionSavedLayouts.viewPreferenceFields must include ${field}`);
  }
  for (const flag of ['noSessionSearch', 'noDiagnosticFilters', 'noTauriSchemaChange', 'noExportImportSchemaChange', 'noCredentialPayload', 'noRuntimeProfile', 'noDiagnosticHistory', 'noToken', 'noKubeconfig', 'noSecretValues', 'noEventsOrLogs']) {
    requireCondition(sessionSavedLayouts[flag] === true, `cmSshSessionManager.sessionSavedLayouts.${flag} must be true`);
  }
  const sessionLayoutPresetSearch = manager.sessionLayoutPresetSearch || {};
  requireCondition(sessionLayoutPresetSearch.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetSearch.desktopOnly must be true');
  requireCondition(sessionLayoutPresetSearch.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetSearch.uiOnly must be true');
  requireCondition(sessionLayoutPresetSearch.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetSearch.stateStorage must be memory-only');
  requireCondition(sessionLayoutPresetSearch.persisted === false, 'cmSshSessionManager.sessionLayoutPresetSearch.persisted must be false');
  requireCondition(sessionLayoutPresetSearch.exported === false, 'cmSshSessionManager.sessionLayoutPresetSearch.exported must be false');
  const layoutSearchTargets = new Set(Array.isArray(sessionLayoutPresetSearch.searchTargets) ? sessionLayoutPresetSearch.searchTargets : []);
  for (const target of ['name', 'summary', 'folder', 'groups', 'collapsedGroups', 'favoriteCount', 'sessionCount']) {
    requireCondition(layoutSearchTargets.has(target), `cmSshSessionManager.sessionLayoutPresetSearch.searchTargets must include ${target}`);
  }
  for (const flag of [
    'showsResultCount',
    'showsEmptyState',
    'hasClearAction',
    'filtersVisiblePresetListOnly',
    'doesNotChangeSavedLayoutOrder',
    'doesNotChangeLayoutExport',
    'doesNotChangeLayoutImport',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetSearch[flag] === true, `cmSshSessionManager.sessionLayoutPresetSearch.${flag} must be true`);
  }
  const sessionLayoutPresetRename = manager.sessionLayoutPresetRename || {};
  requireCondition(sessionLayoutPresetRename.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetRename.desktopOnly must be true');
  requireCondition(sessionLayoutPresetRename.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetRename.uiOnly must be true');
  requireCondition(sessionLayoutPresetRename.draftStateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetRename.draftStateStorage must be memory-only');
  requireCondition(sessionLayoutPresetRename.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetRename.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetRename.defaultEmptyName === 'Session layout', 'cmSshSessionManager.sessionLayoutPresetRename.defaultEmptyName must be Session layout');
  requireCondition(sessionLayoutPresetRename.maxNameLength === 40, 'cmSshSessionManager.sessionLayoutPresetRename.maxNameLength must be 40');
  for (const flag of [
    'normalizesName',
    'preservesViewPreferences',
    'preservesSearchQuery',
    'sameNameNoop',
    'duplicateNameRejected',
    'inlineError',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetRename[flag] === true, `cmSshSessionManager.sessionLayoutPresetRename.${flag} must be true`);
  }
  const sessionLayoutPresetDuplicate = manager.sessionLayoutPresetDuplicate || {};
  requireCondition(sessionLayoutPresetDuplicate.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetDuplicate.desktopOnly must be true');
  requireCondition(sessionLayoutPresetDuplicate.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetDuplicate.uiOnly must be true');
  requireCondition(sessionLayoutPresetDuplicate.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetDuplicate.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetDuplicate.nameConflictPolicy === 'append-copy-suffix', 'cmSshSessionManager.sessionLayoutPresetDuplicate.nameConflictPolicy must be append-copy-suffix');
  requireCondition(sessionLayoutPresetDuplicate.maxNameLength === 40, 'cmSshSessionManager.sessionLayoutPresetDuplicate.maxNameLength must be 40');
  requireCondition(sessionLayoutPresetDuplicate.maxPresets === 8, 'cmSshSessionManager.sessionLayoutPresetDuplicate.maxPresets must be 8');
  for (const flag of [
    'insertsCopyAtTop',
    'preservesViewPreferences',
    'preservesSearchQuery',
    'normalizesOrder',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetDuplicate[flag] === true, `cmSshSessionManager.sessionLayoutPresetDuplicate.${flag} must be true`);
  }
  const sessionLayoutPresetBulkManagement = manager.sessionLayoutPresetBulkManagement || {};
  requireCondition(sessionLayoutPresetBulkManagement.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetBulkManagement.desktopOnly must be true');
  requireCondition(sessionLayoutPresetBulkManagement.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetBulkManagement.uiOnly must be true');
  requireCondition(sessionLayoutPresetBulkManagement.selectionStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetBulkManagement.selectionStorage must be memory-only');
  requireCondition(sessionLayoutPresetBulkManagement.selectionPersisted === false, 'cmSshSessionManager.sessionLayoutPresetBulkManagement.selectionPersisted must be false');
  requireCondition(sessionLayoutPresetBulkManagement.selectionExported === false, 'cmSshSessionManager.sessionLayoutPresetBulkManagement.selectionExported must be false');
  requireCondition(sessionLayoutPresetBulkManagement.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetBulkManagement.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetBulkManagement.selectedExportKind === 'kuviewer.desktop.cmSessionLayouts', 'cmSshSessionManager.sessionLayoutPresetBulkManagement.selectedExportKind must be kuviewer.desktop.cmSessionLayouts');
  requireCondition(sessionLayoutPresetBulkManagement.deleteConfirmation === 'inline-two-step', 'cmSshSessionManager.sessionLayoutPresetBulkManagement.deleteConfirmation must be inline-two-step');
  const layoutBulkActions = new Set(Array.isArray(sessionLayoutPresetBulkManagement.actions) ? sessionLayoutPresetBulkManagement.actions : []);
  for (const action of ['select-visible', 'selected-export', 'delete-confirm', 'clear-selection']) {
    requireCondition(layoutBulkActions.has(action), `cmSshSessionManager.sessionLayoutPresetBulkManagement.actions must include ${action}`);
  }
  for (const flag of [
    'preservesSearchQuery',
    'visibleSelectionUsesSearchResults',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetBulkManagement[flag] === true, `cmSshSessionManager.sessionLayoutPresetBulkManagement.${flag} must be true`);
  }
  const sessionLayoutPresetFolders = manager.sessionLayoutPresetFolders || {};
  requireCondition(sessionLayoutPresetFolders.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolders.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolders.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolders.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolders.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolders.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetFolders.folderField === 'folder', 'cmSshSessionManager.sessionLayoutPresetFolders.folderField must be folder');
  requireCondition(sessionLayoutPresetFolders.defaultFolder === 'General', 'cmSshSessionManager.sessionLayoutPresetFolders.defaultFolder must be General');
  requireCondition(sessionLayoutPresetFolders.maxFolderNameLength === 40, 'cmSshSessionManager.sessionLayoutPresetFolders.maxFolderNameLength must be 40');
  requireCondition(sessionLayoutPresetFolders.folderCollapseStorage === 'kuviewer_desktop_cm_session_layout_collapsed_folders', 'cmSshSessionManager.sessionLayoutPresetFolders.folderCollapseStorage must be kuviewer_desktop_cm_session_layout_collapsed_folders');
  requireCondition(sessionLayoutPresetFolders.folderCollapsePersisted === true, 'cmSshSessionManager.sessionLayoutPresetFolders.folderCollapsePersisted must be true');
  requireCondition(sessionLayoutPresetFolders.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolders.folderCollapseExported must be false');
  requireCondition(sessionLayoutPresetFolders.noLayoutExportImportSchemaChange === false, 'cmSshSessionManager.sessionLayoutPresetFolders.noLayoutExportImportSchemaChange must be false for the folder metadata extension');
  for (const flag of [
    'folderMetadataExported',
    'folderMetadataImported',
    'groupedRendering',
    'saveFolderInput',
    'rowFolderEdit',
    'searchTargetsIncludeFolder',
    'bulkSelectionPreserved',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolders[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolders.${flag} must be true`);
  }
  const sessionLayoutPresetFolderBulkMove = manager.sessionLayoutPresetFolderBulkMove || {};
  requireCondition(sessionLayoutPresetFolderBulkMove.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderBulkMove.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderBulkMove.selectionStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.selectionStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderBulkMove.draftStateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.draftStateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderBulkMove.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetFolderBulkMove.folderField === 'folder', 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.folderField must be folder');
  requireCondition(sessionLayoutPresetFolderBulkMove.defaultFolder === 'General', 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.defaultFolder must be General');
  requireCondition(sessionLayoutPresetFolderBulkMove.maxFolderNameLength === 40, 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.maxFolderNameLength must be 40');
  const layoutFolderBulkMoveActions = new Set(Array.isArray(sessionLayoutPresetFolderBulkMove.actions) ? sessionLayoutPresetFolderBulkMove.actions : []);
  requireCondition(layoutFolderBulkMoveActions.has('selected-folder-move'), 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.actions must include selected-folder-move');
  for (const flag of [
    'bulkSelectionPreserved',
    'preservesSearchQuery',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderBulkMove[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderBulkMove.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderBulkMove.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderBulkMove.folderCollapseExported must be false');
  const sessionLayoutPresetFolderFilter = manager.sessionLayoutPresetFolderFilter || {};
  requireCondition(sessionLayoutPresetFolderFilter.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderFilter.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderFilter.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderFilter.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderFilter.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderFilter.stateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderFilter.persisted === false, 'cmSshSessionManager.sessionLayoutPresetFolderFilter.persisted must be false');
  requireCondition(sessionLayoutPresetFolderFilter.exported === false, 'cmSshSessionManager.sessionLayoutPresetFolderFilter.exported must be false');
  requireCondition(sessionLayoutPresetFolderFilter.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderFilter.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetFolderFilter.filterValues === 'existing-folders-plus-all', 'cmSshSessionManager.sessionLayoutPresetFolderFilter.filterValues must be existing-folders-plus-all');
  requireCondition(sessionLayoutPresetFolderFilter.defaultFilter === 'all', 'cmSshSessionManager.sessionLayoutPresetFolderFilter.defaultFilter must be all');
  for (const flag of [
    'combinesWithSearch',
    'updatesVisibleResultCount',
    'hasClearAction',
    'doesNotChangeSavedLayoutOrder',
    'bulkSelectionUsesFilteredResults',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderFilter[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderFilter.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderFilter.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderFilter.folderCollapseExported must be false');
  const sessionLayoutPresetFolderActions = manager.sessionLayoutPresetFolderActions || {};
  requireCondition(sessionLayoutPresetFolderActions.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderActions.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderActions.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderActions.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderActions.selectionStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderActions.selectionStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderActions.draftStateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderActions.draftStateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderActions.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderActions.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  const folderActions = new Set(Array.isArray(sessionLayoutPresetFolderActions.actions) ? sessionLayoutPresetFolderActions.actions : []);
  for (const action of ['select-visible-folder-presets', 'rename-folder']) {
    requireCondition(folderActions.has(action), `cmSshSessionManager.sessionLayoutPresetFolderActions.actions must include ${action}`);
  }
  for (const flag of [
    'renameUpdatesFolderMetadataOnly',
    'renameCanMergeExistingFolders',
    'preservesPresetNames',
    'preservesViewPreferences',
    'preservesSearchQuery',
    'preservesFolderFilter',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderActions[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderActions.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderActions.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderActions.folderCollapseExported must be false');
  const sessionLayoutPresetFolderKeyboard = manager.sessionLayoutPresetFolderKeyboard || {};
  requireCondition(sessionLayoutPresetFolderKeyboard.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderKeyboard.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderKeyboard.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderKeyboard.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderKeyboard.activeFolderStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderKeyboard.activeFolderStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderKeyboard.shortcutStateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderKeyboard.shortcutStateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderKeyboard.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderKeyboard.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  const folderShortcuts = new Set(Array.isArray(sessionLayoutPresetFolderKeyboard.shortcuts) ? sessionLayoutPresetFolderKeyboard.shortcuts : []);
  for (const shortcut of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'S', 'R', 'Escape']) {
    requireCondition(folderShortcuts.has(shortcut), `cmSshSessionManager.sessionLayoutPresetFolderKeyboard.shortcuts must include ${shortcut}`);
  }
  for (const flag of [
    'ignoresEditableControls',
    'supportsActiveFolderAriaCurrent',
    'supportsScreenReaderLiveStatus',
    'enterTogglesCollapse',
    'sSelectsVisibleFolderPresets',
    'rStartsFolderRename',
    'escapeClearsActiveOrRename',
    'renameUpdatesFolderMetadataOnly',
    'preservesPresetNames',
    'preservesViewPreferences',
    'preservesSearchQuery',
    'preservesFolderFilter',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderKeyboard[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderKeyboard.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderKeyboard.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderKeyboard.folderCollapseExported must be false');
  const sessionLayoutPresetFolderAccessibility = manager.sessionLayoutPresetFolderAccessibility || {};
  requireCondition(sessionLayoutPresetFolderAccessibility.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderAccessibility.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderAccessibility.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.stateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderAccessibility.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetFolderAccessibility.listRole === 'list', 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.listRole must be list');
  requireCondition(sessionLayoutPresetFolderAccessibility.rowRole === 'listitem', 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.rowRole must be listitem');
  requireCondition(sessionLayoutPresetFolderAccessibility.labelStrategy === 'sr-only-title-plus-row-labelledby', 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.labelStrategy must be sr-only-title-plus-row-labelledby');
  for (const flag of [
    'activeDescendant',
    'rowAriaCurrent',
    'rowCountDescription',
    'rowActionDescription',
    'toggleControlsItemsRegion',
    'buttonActionLabels',
    'renameEditorGroupLabel',
    'screenReaderLiveStatus',
    'liveStatusIncludesCollapsedState',
    'noVisibleKeyboardInstructionText',
    'preservesKeyboardShortcuts',
    'preservesPresetNames',
    'preservesViewPreferences',
    'preservesSearchQuery',
    'preservesFolderFilter',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderAccessibility[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderAccessibility.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderAccessibility.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderAccessibility.folderCollapseExported must be false');
  const sessionLayoutPresetFolderEmptyState = manager.sessionLayoutPresetFolderEmptyState || {};
  requireCondition(sessionLayoutPresetFolderEmptyState.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderEmptyState.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderEmptyState.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderEmptyState.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderEmptyState.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderEmptyState.stateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderEmptyState.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderEmptyState.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  for (const flag of [
    'initialEmptyState',
    'searchEmptyState',
    'folderFilterEmptyState',
    'folderRowEmptyState',
    'safeContextSummary',
    'preservesSelectedFolderRowWhenFilteredEmpty',
    'preservesSearchQuery',
    'preservesFolderFilter',
    'preservesPresetNames',
    'preservesViewPreferences',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderEmptyState[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderEmptyState.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderEmptyState.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderEmptyState.folderCollapseExported must be false');
  const sessionLayoutPresetFolderDragReorder = manager.sessionLayoutPresetFolderDragReorder || {};
  requireCondition(sessionLayoutPresetFolderDragReorder.desktopOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.desktopOnly must be true');
  requireCondition(sessionLayoutPresetFolderDragReorder.uiOnly === true, 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.uiOnly must be true');
  requireCondition(sessionLayoutPresetFolderDragReorder.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.stateStorage must be memory-only');
  requireCondition(sessionLayoutPresetFolderDragReorder.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutPresetFolderDragReorder.orderStorage === 'existing-preset-array-order', 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.orderStorage must be existing-preset-array-order');
  requireCondition(sessionLayoutPresetFolderDragReorder.addsOrderField === false, 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.addsOrderField must be false');
  for (const flag of [
    'folderDragHandles',
    'folderUpDownButtons',
    'presetDragHandles',
    'presetUpDownButtons',
    'sameFolderPresetReorderOnly',
    'disabledDuringSearch',
    'disabledDuringFolderFilter',
    'preservesPresetNames',
    'preservesFolders',
    'preservesViewPreferences',
    'preservesSelection',
    'preservesCollapseState',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutPresetFolderDragReorder[flag] === true, `cmSshSessionManager.sessionLayoutPresetFolderDragReorder.${flag} must be true`);
  }
  requireCondition(sessionLayoutPresetFolderDragReorder.folderCollapseExported === false, 'cmSshSessionManager.sessionLayoutPresetFolderDragReorder.folderCollapseExported must be false');
  const sessionLayoutPresetFolderDragReorderKeyboard = manager.sessionLayoutPresetFolderDragReorderKeyboard || {};
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.desktopOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.desktopOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.uiOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.uiOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.stateStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.stateStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.keyboardStatusStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.keyboardStatusStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets',
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets'
  );
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.orderStorage === 'existing-preset-array-order',
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.orderStorage must be existing-preset-array-order'
  );
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.addsOrderField === false,
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.addsOrderField must be false'
  );
  const folderListShortcuts = new Set(
    Array.isArray(sessionLayoutPresetFolderDragReorderKeyboard.folderListShortcuts)
      ? sessionLayoutPresetFolderDragReorderKeyboard.folderListShortcuts
      : []
  );
  for (const shortcut of ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+Home', 'Shift+End']) {
    requireCondition(folderListShortcuts.has(shortcut), `cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.folderListShortcuts must include ${shortcut}`);
  }
  const folderHandleShortcuts = new Set(
    Array.isArray(sessionLayoutPresetFolderDragReorderKeyboard.folderHandleShortcuts)
      ? sessionLayoutPresetFolderDragReorderKeyboard.folderHandleShortcuts
      : []
  );
  const presetHandleShortcuts = new Set(
    Array.isArray(sessionLayoutPresetFolderDragReorderKeyboard.presetHandleShortcuts)
      ? sessionLayoutPresetFolderDragReorderKeyboard.presetHandleShortcuts
      : []
  );
  for (const shortcut of ['ArrowUp', 'ArrowDown', 'Home', 'End']) {
    requireCondition(folderHandleShortcuts.has(shortcut), `cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.folderHandleShortcuts must include ${shortcut}`);
    requireCondition(presetHandleShortcuts.has(shortcut), `cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.presetHandleShortcuts must include ${shortcut}`);
  }
  for (const flag of [
    'folderHandleKeyboardReorder',
    'presetHandleKeyboardReorder',
    'homeEndMoveToEdges',
    'sameFolderPresetReorderOnly',
    'disabledDuringSearch',
    'disabledDuringFolderFilter',
    'supportsScreenReaderLiveStatus',
    'noVisibleKeyboardInstructionText',
    'preservesPresetNames',
    'preservesFolders',
    'preservesViewPreferences',
    'preservesSelection',
    'preservesCollapseState',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(
      sessionLayoutPresetFolderDragReorderKeyboard[flag] === true,
      `cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.${flag} must be true`
    );
  }
  requireCondition(
    sessionLayoutPresetFolderDragReorderKeyboard.folderCollapseExported === false,
    'cmSshSessionManager.sessionLayoutPresetFolderDragReorderKeyboard.folderCollapseExported must be false'
  );
  const sessionLayoutPresetFolderReorderFocus = manager.sessionLayoutPresetFolderReorderFocus || {};
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.desktopOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.desktopOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.uiOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.uiOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.stateStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.stateStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.focusTargetStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.focusTargetStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.focusStatusStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.focusStatusStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.orderStorage === 'existing-preset-array-order',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.orderStorage must be existing-preset-array-order'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.addsOrderField === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.addsOrderField must be false'
  );
  for (const flag of [
    'restoresFolderListFocusAfterListShortcut',
    'restoresFolderHandleFocusAfterFolderButton',
    'restoresFolderHandleFocusAfterFolderDragDrop',
    'restoresPresetHandleFocusAfterPresetButton',
    'restoresPresetHandleFocusAfterPresetKeyboard',
    'restoresPresetHandleFocusAfterPresetDragDrop',
    'usesPreventScroll',
    'supportsScreenReaderLiveStatus',
    'disabledDuringSearch',
    'disabledDuringFolderFilter',
    'sameFolderPresetReorderOnly',
    'preservesPresetNames',
    'preservesFolders',
    'preservesViewPreferences',
    'preservesSelection',
    'preservesCollapseState',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(
      sessionLayoutPresetFolderReorderFocus[flag] === true,
      `cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.${flag} must be true`
    );
  }
  requireCondition(
    sessionLayoutPresetFolderReorderFocus.folderCollapseExported === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocus.folderCollapseExported must be false'
  );
  const sessionLayoutPresetFolderReorderFocusAccessibility = manager.sessionLayoutPresetFolderReorderFocusAccessibility || {};
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.desktopOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.desktopOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.uiOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.uiOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.stateStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.stateStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.focusTargetLabelStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.focusTargetLabelStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.orderStorage === 'existing-preset-array-order',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.orderStorage must be existing-preset-array-order'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.addsOrderField === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.addsOrderField must be false'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.liveStatusRole === 'status',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.liveStatusRole must be status'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.liveStatusAtomic === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.liveStatusAtomic must be true'
  );
  for (const flag of [
    'humanReadableFocusStatus',
    'noInternalTestIdInLiveStatus',
    'focusDescriptionLinked',
    'folderListDescribesFocusPolicy',
    'folderDragHandlesDescribeFocusPolicy',
    'presetDragHandlesDescribeFocusPolicy',
    'usesPreventScroll',
    'disabledDuringSearch',
    'disabledDuringFolderFilter',
    'sameFolderPresetReorderOnly',
    'preservesPresetNames',
    'preservesFolders',
    'preservesViewPreferences',
    'preservesSelection',
    'preservesCollapseState',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(
      sessionLayoutPresetFolderReorderFocusAccessibility[flag] === true,
      `cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.${flag} must be true`
    );
  }
  requireCondition(
    sessionLayoutPresetFolderReorderFocusAccessibility.folderCollapseExported === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderFocusAccessibility.folderCollapseExported must be false'
  );
  const sessionLayoutPresetFolderReorderDisabledState = manager.sessionLayoutPresetFolderReorderDisabledState || {};
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.desktopOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.desktopOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.uiOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.uiOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.stateStorage === 'derived-memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.stateStorage must be derived-memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.disabledReasonStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.disabledReasonStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.orderStorage === 'existing-preset-array-order',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.orderStorage must be existing-preset-array-order'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.addsOrderField === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.addsOrderField must be false'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.stateChipRole === 'status',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.stateChipRole must be status'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.stateChipLive === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.stateChipLive must be true'
  );
  const disabledReasonSources = new Set(Array.isArray(sessionLayoutPresetFolderReorderDisabledState.reasonSources) ? sessionLayoutPresetFolderReorderDisabledState.reasonSources : []);
  for (const reasonSource of ['layout-search', 'folder-filter', 'edge-position', 'insufficient-items']) {
    requireCondition(
      disabledReasonSources.has(reasonSource),
      `cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.reasonSources must include ${reasonSource}`
    );
  }
  for (const flag of [
    'folderListDescribesDisabledPolicy',
    'folderDragHandlesDescribeDisabledReason',
    'folderMoveButtonsDescribeDisabledReason',
    'presetDragHandlesDescribeDisabledReason',
    'presetMoveButtonsDescribeDisabledReason',
    'titlesUseSafeReasonText',
    'disabledDuringSearch',
    'disabledDuringFolderFilter',
    'edgeButtonsExplainFirstLast',
    'sameFolderPresetReorderOnly',
    'preservesPresetNames',
    'preservesFolders',
    'preservesViewPreferences',
    'preservesSelection',
    'preservesCollapseState',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(
      sessionLayoutPresetFolderReorderDisabledState[flag] === true,
      `cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.${flag} must be true`
    );
  }
  requireCondition(
    sessionLayoutPresetFolderReorderDisabledState.folderCollapseExported === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderDisabledState.folderCollapseExported must be false'
  );
  const sessionLayoutPresetFolderReorderStatusWording = manager.sessionLayoutPresetFolderReorderStatusWording || {};
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.desktopOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.desktopOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.uiOnly === true,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.uiOnly must be true'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.stateStorage === 'memory-only',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.stateStorage must be memory-only'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.usesExistingLayoutStorage === 'kuviewer_desktop_cm_session_layout_presets',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.usesExistingLayoutStorage must be kuviewer_desktop_cm_session_layout_presets'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.orderStorage === 'existing-preset-array-order',
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.orderStorage must be existing-preset-array-order'
  );
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.addsOrderField === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.addsOrderField must be false'
  );
  const reorderMessagePrefixes = new Set(Array.isArray(sessionLayoutPresetFolderReorderStatusWording.messagePrefixes) ? sessionLayoutPresetFolderReorderStatusWording.messagePrefixes : []);
  for (const prefix of ['Reorder ready', 'Reorder unavailable', 'Reorder unchanged', 'Reorder complete', 'Focus restored']) {
    requireCondition(
      reorderMessagePrefixes.has(prefix),
      `cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.messagePrefixes must include ${prefix}`
    );
  }
  for (const flag of [
    'successIncludesPosition',
    'successIncludesScope',
    'failureIncludesReason',
    'focusStatusUsesPrefix',
    'dragDropHasStatusMessage',
    'disabledReasonsUseSamePrefix',
    'humanReadableOnly',
    'noInternalTestIdInStatus',
    'preservesPresetNames',
    'preservesFolders',
    'preservesViewPreferences',
    'preservesSelection',
    'preservesCollapseState',
    'folderMetadataExported',
    'folderMetadataImported',
    'sameNameGlobalUnique',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(
      sessionLayoutPresetFolderReorderStatusWording[flag] === true,
      `cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.${flag} must be true`
    );
  }
  requireCondition(
    sessionLayoutPresetFolderReorderStatusWording.folderCollapseExported === false,
    'cmSshSessionManager.sessionLayoutPresetFolderReorderStatusWording.folderCollapseExported must be false'
  );
  const sessionLayoutImportExport = manager.sessionLayoutImportExport || {};
  requireCondition(sessionLayoutImportExport.desktopOnly === true, 'cmSshSessionManager.sessionLayoutImportExport.desktopOnly must be true');
  requireCondition(sessionLayoutImportExport.uiOnly === true, 'cmSshSessionManager.sessionLayoutImportExport.uiOnly must be true');
  requireCondition(sessionLayoutImportExport.storage === 'browser-local-file-user-click', 'cmSshSessionManager.sessionLayoutImportExport.storage must be browser-local-file-user-click');
  requireCondition(sessionLayoutImportExport.schemaVersion === 1, 'cmSshSessionManager.sessionLayoutImportExport.schemaVersion must be 1');
  requireCondition(sessionLayoutImportExport.kind === 'kuviewer.desktop.cmSessionLayouts', 'cmSshSessionManager.sessionLayoutImportExport.kind must be kuviewer.desktop.cmSessionLayouts');
  requireCondition(sessionLayoutImportExport.storageKey === 'kuviewer_desktop_cm_session_layout_presets', 'cmSshSessionManager.sessionLayoutImportExport.storageKey must be kuviewer_desktop_cm_session_layout_presets');
  requireCondition(sessionLayoutImportExport.maxImportItems === 8, 'cmSshSessionManager.sessionLayoutImportExport.maxImportItems must be 8');
  const layoutImportExportFields = new Set(Array.isArray(sessionLayoutImportExport.fields) ? sessionLayoutImportExport.fields : []);
  for (const field of ['name', 'folder', 'viewPreferences', 'updatedAt']) {
    requireCondition(layoutImportExportFields.has(field), `cmSshSessionManager.sessionLayoutImportExport.fields must include ${field}`);
  }
  const layoutImportExportPreferenceFields = new Set(Array.isArray(sessionLayoutImportExport.viewPreferenceFields) ? sessionLayoutImportExport.viewPreferenceFields : []);
  for (const field of ['sessionId', 'group', 'favorite', 'updatedAt', 'collapsedGroups']) {
    requireCondition(layoutImportExportPreferenceFields.has(field), `cmSshSessionManager.sessionLayoutImportExport.viewPreferenceFields must include ${field}`);
  }
  for (const flag of [
    'acceptsBundleItemsShape',
    'acceptsPlainArray',
    'updatesSameNamePresetAfterConflictResolution',
    'detectsSameNameConflicts',
    'prunesUnknownSessionIds',
    'skipsEmptyImportedLayouts',
    'noSessionExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutImportExport[flag] === true, `cmSshSessionManager.sessionLayoutImportExport.${flag} must be true`);
  }
  const sessionLayoutConflictPreview = manager.sessionLayoutConflictPreview || {};
  requireCondition(sessionLayoutConflictPreview.desktopOnly === true, 'cmSshSessionManager.sessionLayoutConflictPreview.desktopOnly must be true');
  requireCondition(sessionLayoutConflictPreview.uiOnly === true, 'cmSshSessionManager.sessionLayoutConflictPreview.uiOnly must be true');
  requireCondition(sessionLayoutConflictPreview.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutConflictPreview.stateStorage must be memory-only');
  requireCondition(sessionLayoutConflictPreview.trigger === 'same-name-different-layout-import', 'cmSshSessionManager.sessionLayoutConflictPreview.trigger must be same-name-different-layout-import');
  const conflictActions = new Set(Array.isArray(sessionLayoutConflictPreview.actions) ? sessionLayoutConflictPreview.actions : []);
  for (const action of ['incoming', 'keep-current', 'rename-incoming']) {
    requireCondition(conflictActions.has(action), `cmSshSessionManager.sessionLayoutConflictPreview.actions must include ${action}`);
  }
  for (const flag of [
    'noAutoOverwrite',
    'newLayoutsImportedImmediately',
    'identicalLayoutsSkipped',
    'noLocalStorageUntilAction',
    'noSessionExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutConflictPreview[flag] === true, `cmSshSessionManager.sessionLayoutConflictPreview.${flag} must be true`);
  }
  const sessionLayoutConflictRowActions = manager.sessionLayoutConflictRowActions || {};
  requireCondition(sessionLayoutConflictRowActions.desktopOnly === true, 'cmSshSessionManager.sessionLayoutConflictRowActions.desktopOnly must be true');
  requireCondition(sessionLayoutConflictRowActions.uiOnly === true, 'cmSshSessionManager.sessionLayoutConflictRowActions.uiOnly must be true');
  requireCondition(sessionLayoutConflictRowActions.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutConflictRowActions.stateStorage must be memory-only');
  requireCondition(sessionLayoutConflictRowActions.scope === 'single-conflict-row', 'cmSshSessionManager.sessionLayoutConflictRowActions.scope must be single-conflict-row');
  const rowConflictActions = new Set(Array.isArray(sessionLayoutConflictRowActions.actions) ? sessionLayoutConflictRowActions.actions : []);
  for (const action of ['incoming', 'keep-current', 'rename-incoming']) {
    requireCondition(rowConflictActions.has(action), `cmSshSessionManager.sessionLayoutConflictRowActions.actions must include ${action}`);
  }
  for (const flag of [
    'updatesSingleConflict',
    'remainingPreviewPersists',
    'lastConflictClosesPreview',
    'summaryCountsUpdatePerRow',
    'noSessionExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutConflictRowActions[flag] === true, `cmSshSessionManager.sessionLayoutConflictRowActions.${flag} must be true`);
  }
  const sessionLayoutConflictSummary = manager.sessionLayoutConflictSummary || {};
  requireCondition(sessionLayoutConflictSummary.desktopOnly === true, 'cmSshSessionManager.sessionLayoutConflictSummary.desktopOnly must be true');
  requireCondition(sessionLayoutConflictSummary.uiOnly === true, 'cmSshSessionManager.sessionLayoutConflictSummary.uiOnly must be true');
  requireCondition(sessionLayoutConflictSummary.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutConflictSummary.stateStorage must be memory-only');
  for (const flag of [
    'showsInitialConflictCount',
    'showsRemainingConflictCount',
    'showsResolvedConflictCount',
    'showsResolutionModeCounts',
    'showsImportResultCounts',
    'updatesAfterBulkResolution',
    'updatesAfterRowResolution',
    'lastConflictClosesPreview',
    'finalImportSummaryPersists',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutConflictSummary[flag] === true, `cmSshSessionManager.sessionLayoutConflictSummary.${flag} must be true`);
  }
  const sessionLayoutConflictKeyboard = manager.sessionLayoutConflictKeyboard || {};
  requireCondition(sessionLayoutConflictKeyboard.desktopOnly === true, 'cmSshSessionManager.sessionLayoutConflictKeyboard.desktopOnly must be true');
  requireCondition(sessionLayoutConflictKeyboard.uiOnly === true, 'cmSshSessionManager.sessionLayoutConflictKeyboard.uiOnly must be true');
  requireCondition(sessionLayoutConflictKeyboard.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutConflictKeyboard.stateStorage must be memory-only');
  requireCondition(sessionLayoutConflictKeyboard.activeRowState === 'memory-only', 'cmSshSessionManager.sessionLayoutConflictKeyboard.activeRowState must be memory-only');
  requireCondition(sessionLayoutConflictKeyboard.initialActiveRow === 'first-conflict', 'cmSshSessionManager.sessionLayoutConflictKeyboard.initialActiveRow must be first-conflict');
  requireCondition(sessionLayoutConflictKeyboard.enterAction === 'incoming', 'cmSshSessionManager.sessionLayoutConflictKeyboard.enterAction must be incoming');
  requireCondition(sessionLayoutConflictKeyboard.kAction === 'keep-current', 'cmSshSessionManager.sessionLayoutConflictKeyboard.kAction must be keep-current');
  requireCondition(sessionLayoutConflictKeyboard.rAction === 'rename-incoming', 'cmSshSessionManager.sessionLayoutConflictKeyboard.rAction must be rename-incoming');
  requireCondition(sessionLayoutConflictKeyboard.escapeAction === 'clear-active-row', 'cmSshSessionManager.sessionLayoutConflictKeyboard.escapeAction must be clear-active-row');
  const layoutConflictKeys = new Set(Array.isArray(sessionLayoutConflictKeyboard.keys) ? sessionLayoutConflictKeyboard.keys : []);
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'K', 'R', 'Escape']) {
    requireCondition(layoutConflictKeys.has(key), `cmSshSessionManager.sessionLayoutConflictKeyboard.keys must include ${key}`);
  }
  for (const flag of [
    'activeRowAccessible',
    'ignoresEditableTargets',
    'rowButtonsUpdateActiveRow',
    'resolvedRowMovesToNextRemaining',
    'lastConflictClosesPreview',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutConflictKeyboard[flag] === true, `cmSshSessionManager.sessionLayoutConflictKeyboard.${flag} must be true`);
  }
  const sessionLayoutConflictAccessibility = manager.sessionLayoutConflictAccessibility || {};
  requireCondition(sessionLayoutConflictAccessibility.desktopOnly === true, 'cmSshSessionManager.sessionLayoutConflictAccessibility.desktopOnly must be true');
  requireCondition(sessionLayoutConflictAccessibility.uiOnly === true, 'cmSshSessionManager.sessionLayoutConflictAccessibility.uiOnly must be true');
  requireCondition(sessionLayoutConflictAccessibility.stateStorage === 'memory-only', 'cmSshSessionManager.sessionLayoutConflictAccessibility.stateStorage must be memory-only');
  requireCondition(sessionLayoutConflictAccessibility.rowRole === 'listitem', 'cmSshSessionManager.sessionLayoutConflictAccessibility.rowRole must be listitem');
  for (const flag of [
    'focusOnOpen',
    'escapeReleasesFocusWhenNoActiveRow',
    'previewLabelledByTitle',
    'previewDescribedByHelpAndLiveStatus',
    'liveSummary',
    'rowStableId',
    'rowAriaLabel',
    'rowAriaCurrent',
    'bulkButtonAriaLabels',
    'rowButtonAriaLabels',
    'screenReaderHelpVisibleOnlyToAssistiveTech',
    'noVisibleKeyboardInstructionText',
    'noSessionExportImportSchemaChange',
    'noLayoutExportImportSchemaChange',
    'noTauriSchemaChange',
    'noSessionSearch',
    'noDiagnosticFilters',
    'noEndpointMetadata',
    'noCredentialPayload',
    'noRuntimeProfile',
    'noDiagnosticHistory',
    'noToken',
    'noKubeconfig',
    'noSecretValues',
    'noEventsOrLogs',
  ]) {
    requireCondition(sessionLayoutConflictAccessibility[flag] === true, `cmSshSessionManager.sessionLayoutConflictAccessibility.${flag} must be true`);
  }
  const hiddenPrototypeUi = new Set(Array.isArray(manager.hiddenPrototypeUi) ? manager.hiddenPrototypeUi : []);
  for (const marker of ['DesktopConnectionProfilePanel', 'DesktopKubernetesProfilePanel', 'desktop-use-sidecar-profile']) {
    requireCondition(hiddenPrototypeUi.has(marker), `cmSshSessionManager.hiddenPrototypeUi must include ${marker}`);
  }

  const mainRs = await readTextFile('desktop/src-tauri/src/main.rs', 'desktop Tauri main');
  const desktopCmSessionPanel = await readTextFile('website/src/components/DesktopCmSessionPanel.tsx', 'desktop CM session panel');
  for (const marker of [
    'kuviewer_desktop_cm_session_view_preferences',
    'desktop-cm-session-groups',
    'desktop-cm-session-group-',
    'desktop-cm-session-favorite-',
    'desktop-cm-session-group-input-',
    'desktop-cm-session-bulk-toolbar',
    'desktop-cm-session-bulk-select-visible',
    'desktop-cm-session-bulk-group-apply',
    'desktop-cm-session-bulk-delete',
    'kuviewer_desktop_cm_session_layout_presets',
    'desktop-cm-session-saved-layouts',
    'desktop-cm-session-layout-save',
    'desktop-cm-session-layout-',
    'desktop-cm-session-layout-empty',
    'desktop-cm-session-layout-search-empty',
    'desktop-cm-session-layout-filter-empty',
    'desktop-cm-session-layout-delete-',
    'desktop-cm-session-layout-rename-',
    'desktop-cm-session-layout-rename-input-',
    'desktop-cm-session-layout-rename-save-',
    'desktop-cm-session-layout-rename-cancel-',
    'desktop-cm-session-layout-rename-error',
    'desktop-cm-session-layout-duplicate-',
    'desktop-cm-session-layout-bulk-select-visible',
    'desktop-cm-session-layout-bulk-clear',
    'desktop-cm-session-layout-bulk-toolbar',
    'desktop-cm-session-layout-bulk-select-',
    'desktop-cm-session-layout-bulk-export',
    'desktop-cm-session-layout-bulk-delete',
    'desktop-cm-session-layout-bulk-folder-input',
    'desktop-cm-session-layout-bulk-folder-apply',
    'desktop-cm-session-layout-reorder-state',
    'desktop-cm-session-layout-reorder-focus-status',
    'desktop-cm-session-layout-drag-handle-',
    'desktop-cm-session-layout-reorder-up-',
    'desktop-cm-session-layout-reorder-down-',
    'desktop-cm-session-layout-folder',
    'desktop-cm-session-layout-folder-',
    'desktop-cm-session-layout-folder-toggle-',
    'desktop-cm-session-layout-folder-count-',
    'desktop-cm-session-layout-folder-items-',
    'desktop-cm-session-layout-folder-input-',
    'desktop-cm-session-layout-folder-filter',
    'desktop-cm-session-layout-folder-filter-clear',
    'desktop-cm-session-layout-folder-filter-count',
    'desktop-cm-session-layout-folder-select-',
    'desktop-cm-session-layout-folder-rename-',
    'desktop-cm-session-layout-folder-rename-editor-',
    'desktop-cm-session-layout-folder-rename-input-',
    'desktop-cm-session-layout-folder-rename-save-',
    'desktop-cm-session-layout-folder-rename-cancel-',
    'desktop-cm-session-layout-folder-list-title',
    'desktop-cm-session-layout-folder-keyboard-description',
    'desktop-cm-session-layout-folder-keyboard-live-status',
    'desktop-cm-session-layout-reorder-keyboard-description',
    'desktop-cm-session-layout-reorder-keyboard-status',
    'desktop-cm-session-layout-folder-row-',
    'desktop-cm-session-layout-folder-title-',
    'desktop-cm-session-layout-folder-a11y-count-',
    'desktop-cm-session-layout-folder-actions-',
    'desktop-cm-session-layout-folder-empty-',
    'desktop-cm-session-layout-folder-drag-handle-',
    'desktop-cm-session-layout-folder-reorder-up-',
    'desktop-cm-session-layout-folder-reorder-down-',
    'desktop-cm-session-layout-export',
    'desktop-cm-session-layout-import',
    'desktop-cm-session-layout-conflict-preview',
    'desktop-cm-session-layout-conflict-summary',
    'desktop-cm-session-layout-conflict-summary-progress',
    'desktop-cm-session-layout-conflict-summary-remaining',
    'desktop-cm-session-layout-conflict-summary-resolutions',
    'desktop-cm-session-layout-conflict-summary-import',
    'desktop-cm-session-layout-conflict-title',
    'desktop-cm-session-layout-conflict-description',
    'desktop-cm-session-layout-conflict-live-status',
    'desktop-cm-session-layout-conflict-use-incoming',
    'desktop-cm-session-layout-conflict-keep-current',
    'desktop-cm-session-layout-conflict-rename-incoming',
    'desktop-cm-session-layout-conflict-row-use-incoming-',
    'desktop-cm-session-layout-conflict-row-keep-current-',
    'desktop-cm-session-layout-conflict-row-rename-incoming-',
    'activeSessionLayoutConflictName',
    'sessionLayoutRenameTargetName',
    'sessionLayoutRenameDraftName',
    'sessionLayoutRenameError',
    'handleStartRenameSessionLayoutPreset',
    'handleSaveRenamedSessionLayoutPreset',
    'handleCancelRenameSessionLayoutPreset',
    'handleDuplicateSessionLayoutPreset',
    'buildDesktopCmSessionLayoutDuplicateName',
    'selectedSessionLayoutPresetNames',
    'sessionLayoutBulkDeleteConfirm',
    'sessionLayoutBulkFolderName',
    'handleToggleSessionLayoutPresetSelection',
    'handleSelectVisibleSessionLayoutPresets',
    'handleClearSessionLayoutPresetSelection',
    'handleExportSelectedSessionLayouts',
    'handleDeleteSelectedSessionLayouts',
    'handleMoveSelectedSessionLayoutsToFolder',
    'sessionLayoutPresetFolder',
    'sessionLayoutFolderFilter',
    'sessionLayoutFolderFilterOptions',
    'sessionLayoutFolderFilterActive',
    'sessionLayoutFolderRenameTarget',
    'sessionLayoutFolderRenameDraft',
    'activeSessionLayoutFolderName',
    'sessionLayoutFolderListTitleId',
    'sessionLayoutFolderKeyboardDescriptionId',
    'sessionLayoutFolderKeyboardLiveStatusId',
    'sessionLayoutReorderFocusDescriptionId',
    'sessionLayoutReorderFocusStatusId',
    'sessionLayoutReorderDisabledDescriptionId',
    'sessionLayoutReorderDisabledReasonId',
    'sessionLayoutReorderFilterDisabledReason',
    'sessionLayoutReorderUnavailableReason',
    'sessionLayoutReorderStateLabel',
    'sessionLayoutFolderKeyboardLiveText',
    'sessionLayoutReorderFocusLiveText',
    'sessionLayoutReorderFocusTargetTestId',
    'sessionLayoutReorderFocusTargetLabel',
    'sessionLayoutReorderFocusMessage',
    'requestSessionLayoutReorderFocus',
    'sessionLayoutFolderDragHandleTestId',
    'sessionLayoutPresetDragHandleTestId',
    'sessionLayoutReorderMovementLabel',
    'sessionLayoutReorderPositionLabel',
    'sessionLayoutFolderReorderSuccessMessage',
    'sessionLayoutPresetReorderSuccessMessage',
    'sessionLayoutReorderUnchangedMessage',
    'sessionLayoutFolderReorderDisabledReason',
    'sessionLayoutPresetReorderDisabledReason',
    'sessionLayoutFolderListRef',
    'collapsedSessionLayoutFolders',
    'groupedSessionLayoutPresets',
    'sessionLayoutFolderNames',
    'handleSelectSessionLayoutFolderPresets',
    'handleToggleSessionLayoutFolder',
    'handleUpdateSessionLayoutPresetFolder',
    'handleStartRenameSessionLayoutFolder',
    'handleCancelRenameSessionLayoutFolder',
    'handleSaveRenamedSessionLayoutFolder',
    'handleMoveActiveSessionLayoutFolder',
    'handleMoveActiveSessionLayoutFolderOrder',
    'handleSessionLayoutFolderReorderHandleKeyDown',
    'handleSessionLayoutPresetReorderHandleKeyDown',
    'handleToggleActiveSessionLayoutFolder',
    'handleSelectActiveSessionLayoutFolder',
    'handleRenameActiveSessionLayoutFolder',
    'handleSessionLayoutFolderKeyDown',
    'matchesDesktopCmSessionLayoutFolderFilter',
    'buildDesktopCmSessionLayoutFolderFilterOptions',
    'desktopCmSessionLayoutFolderCollapseStorageKey',
    'handleSessionLayoutConflictKeyDown',
    'handleMoveActiveSessionLayoutConflict',
    'handleResolveActiveSessionLayoutConflict',
    'isDesktopCmKeyboardIgnoredTarget',
    'sessionLayoutConflictPreviewRef',
    'aria-labelledby',
    'aria-describedby',
    'aria-live',
    'aria-atomic',
    'aria-current',
    'aria-activedescendant',
    'aria-controls',
    'aria-keyshortcuts',
    'role="list"',
    'role="listitem"',
    'preventScroll',
    '?.blur()',
    'ArrowUp',
    'ArrowDown',
    'Shift+ArrowUp',
    'Shift+ArrowDown',
    'Shift+Home',
    'Shift+End',
    'Home',
    'End',
    'moveDesktopCmSessionLayoutFolderToIndex',
    'moveDesktopCmSessionLayoutPresetToIndex',
    'sessionLayoutReorderKeyboardMessage',
    'sessionLayoutReorderKeyboardLiveText',
    'setSessionLayoutReorderFocusTargetTestId',
    'setSessionLayoutReorderFocusTargetLabel',
    'Focus restored:',
    'Focus target unavailable after reorder:',
    'layout folder drag handle',
    'layout drag handle',
    'Reorder ready:',
    'Reorder unavailable:',
    'Reorder unchanged:',
    'Reorder complete:',
    'position ${index + 1} of ${total}',
    'kuviewer.desktop.cmSessionLayouts',
  ]) {
    requireCondition(desktopCmSessionPanel.includes(marker), `DesktopCmSessionPanel must include ${marker}`);
  }
  for (const marker of [
    'DesktopCmSessionMetadata',
    'DesktopCmSessionInput',
    'DesktopCmSessionRuntimeProfile',
    'desktop_cm_sessions',
    'desktop_cm_session_runtime',
    'desktop_start_cm_session_runtime',
    'desktop_stop_cm_session_runtime',
    'desktop_check_cm_session_runtime',
    'desktop_save_cm_session',
    'desktop_select_cm_session',
    'desktop_delete_cm_session',
    'desktop_import_cm_session_private_key',
    'desktop_delete_cm_session_credential',
    'desktop_check_cm_session',
    'KUVIEWER_DESKTOP_CM_SESSION_HOST',
    'KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_HOST',
    'KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR',
    'credential-ready',
    'runtime-active',
    'runtime-lost',
    'health_status',
    'MAX_DESKTOP_CM_PRIVATE_KEY_BYTES',
    'os-credential-store',
    'read_desktop_cm_private_key_file',
    'run_ssh_noop_check',
    'start_cm_session_ssh_tunnel',
    'wait_for_cm_runtime_health',
    'check_cm_session_runtime_state',
    'ExitOnForwardFailure=yes',
    'remote_api_host',
    'diagnostic_stage',
    'cm_session_diagnostic_for_check',
    'cm_runtime_diagnostic_for_health',
  ]) {
    requireCondition(mainRs.includes(marker), `desktop Tauri main must include ${marker}`);
  }

  const profileModule = await readTextFile('website/src/features/desktop/desktopConnectionProfile.ts', 'desktop connection profile frontend module');
  for (const marker of [
    'DesktopCmSession',
    'DesktopCmSessionInput',
    'DesktopCmSessionRuntimeProfile',
    'getDesktopCmRuntimeProfile',
    'getDesktopCmSessions',
    'getDesktopCmSessionRuntime',
    'checkDesktopCmSessionRuntime',
    'startDesktopCmSessionRuntime',
    'stopDesktopCmSessionRuntime',
    'saveDesktopCmSession',
    'selectDesktopCmSession',
    'deleteDesktopCmSession',
    'importDesktopCmSessionPrivateKey',
    'deleteDesktopCmSessionCredential',
    'checkDesktopCmSession',
    'normalizeDesktopCmSessionHost',
    'normalizeDesktopCmRemoteApiHost',
    'kuviewer_desktop_cm_runtime_profile',
    'desktop_cm_sessions',
    'desktop_cm_session_runtime',
    'desktop_start_cm_session_runtime',
    'desktop_stop_cm_session_runtime',
    'desktop_check_cm_session_runtime',
    'desktop_save_cm_session',
    'desktop_select_cm_session',
    'desktop_delete_cm_session',
    'desktop_import_cm_session_private_key',
    'desktop_delete_cm_session_credential',
    'desktop_check_cm_session',
    'diagnosticStage',
    'diagnosticSeverity',
    'diagnosticMessage',
    'diagnosticHint',
  ]) {
    requireCondition(profileModule.includes(marker), `desktop frontend profile module must include ${marker}`);
  }

  const sessionPanel = await readTextFile('website/src/components/DesktopCmSessionPanel.tsx', 'desktop CM session panel');
  for (const marker of [
    'Desktop CM/SSH sessions',
    'desktop-cm-session-panel',
    'desktop-cm-session-save',
    'desktop-cm-connection-profile-form',
    'desktop-cm-session-connection-preview',
    'desktop-cm-session-form-ssh-endpoint',
    'desktop-cm-session-form-api-endpoint',
    'desktop-cm-session-form-notes',
    'desktop-cm-session-api-preset-local-18085',
    'desktop-cm-session-api-preset-localhost-18085',
    'desktop-cm-session-api-preset-local-8080',
    'desktop-cm-session-api-default-reset',
    'desktop-cm-session-fill-selected',
    'desktop-cm-session-clone',
    'desktop-cm-session-clone-draft',
    'desktop-cm-session-clone-cancel',
    'buildDesktopCmSessionCloneName',
    'validateDesktopCmSessionForm',
    'secret 저장 없음',
    'credential store 사용',
    'desktop-cm-session-import-key',
    'desktop-cm-session-check',
    'desktop-cm-session-remote-api-host',
    'desktop-cm-session-remote-api-port',
    'desktop-cm-session-start-runtime',
    'desktop-cm-session-stop-runtime',
    'desktop-cm-session-check-runtime',
    'desktop-cm-session-runtime-detail',
    'desktop-cm-session-summary',
    'desktop-cm-session-search',
    'desktop-cm-session-search-count',
    'desktop-cm-session-diagnostic-stage-filter',
    'desktop-cm-session-diagnostic-severity-filter',
    'desktop-cm-session-diagnostic-filter-clear',
    'kuviewer_desktop_cm_diagnostic_filter_presets',
    'desktop-cm-diagnostic-filter-preset-name',
    'desktop-cm-diagnostic-filter-preset-save',
    'desktop-cm-diagnostic-filter-preset-list',
    'desktop-cm-diagnostic-filter-preset-count',
    'desktop-cm-session-delete-credential',
    'Diagnostics',
    'desktop-cm-session-summary-diagnostics',
    'desktop-cm-session-export',
    'desktop-cm-session-import',
    'desktop-cm-session-bulk-toolbar',
    'desktop-cm-session-bulk-select-visible',
    'desktop-cm-session-group-select-',
    'desktop-cm-session-bulk-select-',
    'desktop-cm-session-bulk-export',
    'desktop-cm-session-bulk-group-apply',
    'desktop-cm-session-bulk-favorite-on',
    'desktop-cm-session-bulk-favorite-off',
    'desktop-cm-session-bulk-delete',
    'kuviewer_desktop_cm_session_layout_presets',
    'desktop-cm-session-saved-layouts',
    'desktop-cm-session-layout-name',
    'desktop-cm-session-layout-search',
    'desktop-cm-session-layout-search-count',
    'desktop-cm-session-layout-search-clear',
    'desktop-cm-session-layout-search-empty',
    'desktop-cm-session-layout-save',
    'desktop-cm-session-layout-list',
    'desktop-cm-session-layout-delete-',
    'desktop-cm-session-layout-rename-',
    'desktop-cm-session-layout-rename-input-',
    'desktop-cm-session-layout-rename-save-',
    'desktop-cm-session-layout-rename-cancel-',
    'desktop-cm-session-layout-rename-error',
    'desktop-cm-session-layout-duplicate-',
    'desktop-cm-session-layout-bulk-select-visible',
    'desktop-cm-session-layout-bulk-clear',
    'desktop-cm-session-layout-bulk-toolbar',
    'desktop-cm-session-layout-bulk-select-',
    'desktop-cm-session-layout-bulk-export',
    'desktop-cm-session-layout-bulk-delete',
    'desktop-cm-session-layout-folder',
    'desktop-cm-session-layout-folder-',
    'desktop-cm-session-layout-folder-toggle-',
    'desktop-cm-session-layout-folder-count-',
    'desktop-cm-session-layout-folder-items-',
    'desktop-cm-session-layout-folder-input-',
    'desktop-cm-session-layout-folder-list-title',
    'desktop-cm-session-layout-folder-keyboard-description',
    'desktop-cm-session-layout-folder-keyboard-live-status',
    'desktop-cm-session-layout-folder-row-',
    'desktop-cm-session-layout-folder-title-',
    'desktop-cm-session-layout-folder-a11y-count-',
    'desktop-cm-session-layout-folder-actions-',
    'desktop-cm-session-layout-export',
    'desktop-cm-session-layout-import',
    'desktop-cm-session-layout-import-summary',
    'desktop-cm-session-layout-conflict-preview',
    'desktop-cm-session-layout-conflict-summary',
    'desktop-cm-session-layout-conflict-summary-progress',
    'desktop-cm-session-layout-conflict-summary-remaining',
    'desktop-cm-session-layout-conflict-summary-resolutions',
    'desktop-cm-session-layout-conflict-summary-import',
    'desktop-cm-session-layout-conflict-title',
    'desktop-cm-session-layout-conflict-description',
    'desktop-cm-session-layout-conflict-live-status',
    'desktop-cm-session-layout-conflict-use-incoming',
    'desktop-cm-session-layout-conflict-keep-current',
    'desktop-cm-session-layout-conflict-rename-incoming',
    'desktop-cm-session-layout-conflict-row-use-incoming-',
    'desktop-cm-session-layout-conflict-row-keep-current-',
    'desktop-cm-session-layout-conflict-row-rename-incoming-',
    'activeSessionLayoutConflictName',
    'sessionLayoutRenameTargetName',
    'sessionLayoutRenameDraftName',
    'sessionLayoutRenameError',
    'handleStartRenameSessionLayoutPreset',
    'handleSaveRenamedSessionLayoutPreset',
    'handleCancelRenameSessionLayoutPreset',
    'handleDuplicateSessionLayoutPreset',
    'buildDesktopCmSessionLayoutDuplicateName',
    'selectedSessionLayoutPresetNames',
    'sessionLayoutBulkDeleteConfirm',
    'handleToggleSessionLayoutPresetSelection',
    'handleSelectVisibleSessionLayoutPresets',
    'handleClearSessionLayoutPresetSelection',
    'handleExportSelectedSessionLayouts',
    'handleDeleteSelectedSessionLayouts',
    'sessionLayoutPresetFolder',
    'collapsedSessionLayoutFolders',
    'groupedSessionLayoutPresets',
    'handleToggleSessionLayoutFolder',
    'handleUpdateSessionLayoutPresetFolder',
    'desktopCmSessionLayoutFolderCollapseStorageKey',
    'handleSessionLayoutConflictKeyDown',
    'handleMoveActiveSessionLayoutConflict',
    'handleResolveActiveSessionLayoutConflict',
    'isDesktopCmKeyboardIgnoredTarget',
    'sessionLayoutConflictPreviewRef',
    'aria-labelledby',
    'aria-describedby',
    'aria-live',
    'aria-current',
    'role="list"',
    'role="listitem"',
    'preventScroll',
    '?.blur()',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'kuviewer.desktop.cmSessions',
    'kuviewer.desktop.cmSessionLayouts',
    'sessionLayoutSearchQuery',
    'visibleSessionLayoutPresets',
    'matchesDesktopCmSessionLayoutSearch',
  ]) {
    requireCondition(sessionPanel.includes(marker), `desktop CM session panel must include ${marker}`);
  }

  const sourceModeBar = await readTextFile('website/src/components/SourceModeBar.tsx', 'source mode bar');
  requireCondition(sourceModeBar.includes('DesktopCmSessionPanel'), 'SourceModeBar must render DesktopCmSessionPanel in desktop runtime');
  requireCondition(!sourceModeBar.includes('DesktopConnectionProfilePanel'), 'SourceModeBar must not render DesktopConnectionProfilePanel');
  requireCondition(!sourceModeBar.includes('DesktopKubernetesProfilePanel'), 'SourceModeBar must not render DesktopKubernetesProfilePanel');

  const app = await readTextFile('website/src/app/App.tsx', 'app shell');
  for (const marker of [
    'getDesktopCmSessions',
    'getDesktopCmSessionRuntime',
    'checkDesktopCmSessionRuntime',
    'startDesktopCmSessionRuntime',
    'stopDesktopCmSessionRuntime',
    'desktopCmRuntimeProfile',
    'saveDesktopCmSession',
    'selectDesktopCmSession',
    'deleteDesktopCmSession',
    'importDesktopCmSessionPrivateKey',
    'deleteDesktopCmSessionCredential',
    'checkDesktopCmSession',
    'clearDesktopConnectionProfile',
    'desktopCmSessions',
  ]) {
    requireCondition(app.includes(marker), `app shell must include ${marker}`);
  }
  requireCondition(!app.includes('handleUseDesktopSidecar'), 'app shell must not expose handleUseDesktopSidecar');
  requireCondition(!app.includes('DesktopKubernetesProfile'), 'app shell must not import DesktopKubernetesProfile in CM/SSH product mode');

  const smokeScript = await readTextFile('scripts/smoke-desktop-cm-sessions.mjs', 'desktop CM session smoke script');
  for (const marker of [
    'desktop_cm_sessions',
    'desktop_cm_session_runtime',
    'desktop_start_cm_session_runtime',
    'desktop_stop_cm_session_runtime',
    'desktop_check_cm_session_runtime',
    'desktop_save_cm_session',
    'desktop_select_cm_session',
    'desktop_delete_cm_session',
    'desktop_import_cm_session_private_key',
    'desktop_delete_cm_session_credential',
    'desktop_check_cm_session',
    'desktop-cm-session-panel',
    'web runtime must not expose desktop CM/SSH session UI',
    'desktop CM smoke must not store admin token',
    'desktop CM runtime profile must use localhost tunnel URL',
    'desktop CM runtime lost must clear the session runtime profile',
    'desktop CM smoke must not expose private key bodies',
    'desktop CM session search must match session name metadata',
    'desktop CM diagnostic stage filter must match metadata sessions',
    'desktop CM diagnostic filters must match runtime error diagnostics',
    'desktop CM diagnostic saved filters must apply after reload',
    'desktop CM diagnostic saved filters must not include credentialAvailable',
    'desktop CM diagnostic saved filter update must keep same-name presets unique',
    'desktop CM connection profile preview must reflect safe metadata',
    'desktop CM connection profile quick API preset must update host and port',
    'desktop CM connection profile default reset must restore API defaults',
    'desktop CM selected session fill must copy safe metadata',
    'desktop CM clone draft must copy only safe editable metadata',
    'desktop CM clone must not copy credential availability',
    'desktop CM clone must not copy runtime state',
    'desktop CM clone draft must avoid existing clone names with a copy suffix',
    'desktop CM connection profile validation must block missing name before save',
    'desktop CM connection profile polish must not change export schema',
    'desktop CM session summary must show active runtime status',
    'desktop CM diagnostics must show runtime-lost message',
    'desktop CM session search must match diagnostic message',
    'desktop CM export must not include credentialAvailable',
    'desktop CM bulk select visible must select current results',
    'desktop CM bulk group move must update selected session groups',
    'desktop CM bulk favorite must update selected favorite counts',
    'desktop CM selected export must not include grouping preferences',
    'desktop CM bulk delete must require inline confirmation',
    'desktop CM import must report newly imported sessions',
    'desktop CM session layout save must persist safe layout metadata',
    'desktop CM session layout rename must update only preset name metadata',
    'desktop CM session layout rename draft must stay memory-only',
    'desktop CM session layout duplicate must create a copy with safe layout metadata',
    'desktop CM session layout duplicate must not include session endpoint metadata',
    'desktop CM session layout bulk row select must select one saved layout',
    'desktop CM session layout bulk folder move must update selected folders',
    'desktop CM session layout bulk folder draft must stay memory-only',
    'desktop CM session layout selected export must include only selected layout presets',
    'desktop CM session layout selected export must not include session endpoint metadata',
    'desktop CM session layout bulk selection must stay memory-only',
    'desktop CM session layout folder filter must narrow visible layouts',
    'desktop CM session layout folder filter count must show active folder',
    'desktop CM session layout folder filter must combine with layout search',
    'desktop CM session layout reorder disabled state must explain active search and folder filters',
    'desktop CM session layout folder disabled drag handle must describe filter-blocked reason',
    'desktop CM session layout folder filter must stay memory-only',
    'desktop CM session layout folder filter clear must restore saved layouts',
    'desktop CM session layout folder select must select visible presets in that folder',
    'desktop CM session layout folder rename must update folder metadata',
    'desktop CM session layout folder rename draft must stay memory-only',
    'desktop CM session layout folder rename must keep renamed folders filterable',
    'desktop CM session layout folder list must expose list role',
    'desktop CM session layout folder list must be labelled by sr-only title',
    'desktop CM session layout folder list title must be available to assistive tech',
    'desktop CM session layout folder list must expose keyboard and reorder focus descriptions with live status',
    'desktop CM session layout folder list must be keyboard focusable',
    'desktop CM session layout folder row must expose listitem role',
    'desktop CM session layout folder row must expose stable id',
    'desktop CM session layout folder row must be labelled by folder title',
    'desktop CM session layout folder row must describe count and actions',
    'desktop CM session layout folder title id must expose safe folder name',
    'desktop CM session layout folder actions description must stay safe and specific',
    'desktop CM session layout folder toggle must control folder items region',
    'desktop CM session layout folder toggle must expose action label',
    'desktop CM session layout folder select must expose action label',
    'desktop CM session layout folder rename must expose action label',
    'desktop CM session layout folder Home must activate first folder',
    'desktop CM session layout folder list must expose active descendant after Home',
    'desktop CM session layout folder live status must announce active folder',
    'desktop CM session layout folder End must activate last folder',
    'desktop CM session layout folder list must expose active descendant after End',
    'desktop CM session layout folder Enter must update collapsed aria state',
    'desktop CM session layout folder Enter must restore expanded aria state',
    'desktop CM session layout folder keyboard select must select active visible presets',
    'desktop CM session layout folder active keyboard state must stay memory-only',
    'desktop CM session layout folder rename editor must expose group label',
    'desktop CM session layout folder rename input must expose label',
    'desktop CM session layout folder rename save must expose label',
    'desktop CM session layout folder rename cancel must expose label',
    'desktop CM session layout folder keyboard rename must focus rename input',
    'desktop CM session layout folder keyboard rename must keep renamed folder active',
    'desktop CM session layout folder keyboard rename must update safe folder metadata',
    'desktop CM session layout folder keyboard state and rename draft must stay memory-only',
    'desktop CM session layout bulk select visible must select matching layout results',
    'desktop CM session layout bulk delete must require inline confirmation',
    'desktop CM session layout initial empty state must explain safe save action',
    'desktop CM session layout search empty state must show safe search context',
    'desktop CM session layout folder filter empty state must show safe filter/search context',
    'desktop CM session layout folder row empty state must be visible when selected folder has zero matches',
    'desktop CM session layout folder empty row must keep total count visible',
    'desktop CM session layout folder empty state must stay memory-only',
    'desktop CM session layout folder reorder controls must enable when search and folder filter are clear',
    'desktop CM session layout folder reorder smoke must start with two folders',
    'desktop CM session layout folder drag handle must be enabled when filters are clear',
    'desktop CM session layout folder edge disabled state must describe first-position reason',
    'desktop CM session layout folder button reorder must restore folder drag handle focus after down',
    'desktop CM session layout folder reorder down must move the first folder after the next folder',
    'desktop CM session layout reorder focus status must announce human-readable folder handle restoration',
    'desktop CM session layout folder button reorder must restore folder drag handle focus after up',
    'desktop CM session layout folder reorder up must restore the folder order',
    'desktop CM session layout folder list must expose keyboard reorder shortcuts',
    'desktop CM session layout folder drag handle must expose keyboard reorder shortcuts',
    'desktop CM session layout folder drag handle must describe reorder focus restoration',
    'desktop CM session layout folder keyboard reorder must restore folder list focus after Shift ArrowDown',
    'desktop CM session layout folder keyboard Shift ArrowDown must move active folder down',
    'desktop CM session layout reorder keyboard live status must announce folder move with position',
    'desktop CM session layout reorder focus status must announce human-readable folder list restoration',
    'desktop CM session layout folder keyboard reorder must restore folder list focus after Shift ArrowUp',
    'desktop CM session layout folder keyboard Shift ArrowUp must restore folder order',
    'desktop CM session layout drag, reorder keyboard, and focus state must stay memory-only',
    'desktop CM session layout preset keyboard reorder smoke must start with two presets in one folder',
    'desktop CM session layout preset edge disabled state must describe first-position reason',
    'desktop CM session layout preset drag handle must expose keyboard reorder shortcuts',
    'desktop CM session layout preset drag handle must describe reorder focus restoration',
    'desktop CM session layout preset keyboard reorder must restore preset drag handle focus after ArrowDown',
    'desktop CM session layout preset keyboard ArrowDown must move first preset down',
    'desktop CM session layout reorder keyboard live status must announce preset move with position',
    'desktop CM session layout reorder focus status must announce human-readable preset handle restoration',
    'desktop CM session layout reorder focus status must be an atomic status live region',
    'desktop CM session layout preset keyboard reorder must restore preset drag handle focus after ArrowUp',
    'desktop CM session layout preset keyboard ArrowUp must restore preset order',
    'desktop CM session layout reorder keyboard and focus status must stay memory-only',
    'desktop CM session layout folder count must show saved layout presets',
    'desktop CM session layout save must persist safe folder metadata',
    'desktop CM session layout search must match saved layout folder metadata',
    'desktop CM session layout folder collapse preference must persist separately',
    'desktop CM session layout folder edit must update preset folder metadata',
    'desktop CM session layout duplicate must preserve folder metadata',
    'desktop CM session layout export must preserve folder metadata',
    'desktop CM session layout import must preserve folder metadata',
    'desktop CM session layout apply must restore group and favorite preferences',
    'desktop CM session layout delete must remove saved layout',
    'desktop CM session layout preset must not include session endpoint metadata',
    'desktop CM export must not include saved layout preferences',
    'desktop CM session layout export bundle must include the layout kind',
    'desktop CM session layout export must not include session endpoint metadata',
    'desktop CM session layout import must report layout updates',
    'desktop CM session layout conflict preview must not overwrite same-name layouts before resolution',
    'desktop CM session layout conflict keep current must not overwrite current layout',
    'desktop CM session layout row keep current must resolve only the selected conflict',
    'desktop CM session layout row incoming must update only the selected layout',
    'desktop CM session layout row rename must keep both layouts',
    'desktop CM session layout conflict resolution must keep conflict state memory-only',
    'desktop CM session layout import must prune unknown session ids',
    'desktop CM session export must not include layout import/export metadata',
  ]) {
    requireCondition(smokeScript.includes(marker), `desktop CM session smoke script must include ${marker}`);
  }

  const ciWorkflow = await readTextFile('.github/workflows/ci.yml', 'ci workflow');
  for (const marker of [
    'Desktop CM session runtime smoke',
    'scripts/smoke-desktop-cm-sessions.mjs',
    'npx playwright install --with-deps chromium',
    'http://127.0.0.1:4174/',
  ]) {
    requireCondition(ciWorkflow.includes(marker), `ci workflow must include ${marker}`);
  }

  const rootReadme = await readTextFile('README.md', 'root README');
  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  const prerequisitesDoc = await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc');
  const handoff = await readTextFile('CODEX_HANDOFF.md', 'Codex handoff');
  for (const [label, text] of [
    ['root README', rootReadme],
    ['desktop README', desktopReadme],
    ['desktop build prerequisites doc', prerequisitesDoc],
    ['Codex handoff', handoff],
  ]) {
    requireCondition(text.includes('CM/SSH session manager'), `${label} must document the CM/SSH session manager`);
    requireCondition(text.includes('private key'), `${label} must document private key handling for CM/SSH sessions`);
    requireCondition(text.includes('connection check') || text.includes('연결 확인'), `${label} must document CM/SSH connection checks`);
    requireCondition(text.includes('CM tunnel/runtime') || text.includes('desktop-cm-ssh-runtime'), `${label} must document CM tunnel/runtime`);
    requireCondition(text.includes('runtime health') || text.includes('health/details'), `${label} must document CM runtime health/details`);
    requireCondition(text.includes('safe diagnostic') || text.includes('advanced diagnostics'), `${label} must document safe desktop CM diagnostics`);
    requireCondition(text.includes('diagnostic filtering') || text.includes('diagnostics filtering'), `${label} must document desktop CM diagnostic filtering`);
    requireCondition(text.includes('diagnostic saved filters') || text.includes('saved diagnostic filters'), `${label} must document desktop CM diagnostic saved filters`);
    requireCondition(text.includes('session clone') || text.includes('clone draft') || text.includes('세션 복제'), `${label} must document desktop CM session clone behavior`);
    requireCondition(text.includes('bulk actions') || text.includes('bulk selection'), `${label} must document desktop CM session bulk actions`);
    requireCondition(text.includes('session saved layouts') || text.includes('saved session layouts'), `${label} must document desktop CM session saved layouts`);
    requireCondition(text.includes('layout import/export') || text.includes('session layout import/export'), `${label} must document desktop CM session layout import/export`);
    requireCondition(text.includes('layout conflict preview'), `${label} must document desktop CM session layout conflict preview`);
    requireCondition(text.includes('per-row conflict actions') || text.includes('row conflict actions'), `${label} must document desktop CM session layout per-row conflict actions`);
    requireCondition(text.includes('layout bulk management') || text.includes('layout preset bulk management'), `${label} must document desktop CM session layout bulk management`);
    requireCondition(text.includes('layout folder') || text.includes('preset folder'), `${label} must document desktop CM session layout folders`);
    requireCondition(text.includes('folder bulk move'), `${label} must document desktop CM session layout folder bulk move`);
    requireCondition(text.includes('folder filter'), `${label} must document desktop CM session layout folder filter`);
    requireCondition(text.includes('folder actions') || text.includes('folder action'), `${label} must document desktop CM session layout folder actions`);
    requireCondition(text.includes('folder keyboard'), `${label} must document desktop CM session layout folder keyboard polish`);
    requireCondition(text.includes('folder accessibility'), `${label} must document desktop CM session layout folder accessibility polish`);
    requireCondition(text.includes('folder empty state') || text.includes('folder empty-state'), `${label} must document desktop CM session layout folder empty-state polish`);
    requireCondition(text.includes('folder drag/reorder') || text.includes('folder drag reorder'), `${label} must document desktop CM session layout folder drag/reorder polish`);
    requireCondition(text.includes('drag/reorder keyboard') || text.includes('drag reorder keyboard'), `${label} must document desktop CM session layout folder drag/reorder keyboard polish`);
    requireCondition(text.includes('reorder focus'), `${label} must document desktop CM session layout folder reorder focus polish`);
    requireCondition(text.includes('reorder focus accessibility'), `${label} must document desktop CM session layout folder reorder focus accessibility polish`);
    requireCondition(text.includes('reorder disabled-state') || text.includes('reorder disabled state'), `${label} must document desktop CM session layout folder reorder disabled-state polish`);
    requireCondition(text.includes('reorder status wording'), `${label} must document desktop CM session layout folder reorder status wording polish`);
    requireCondition(text.includes('export/import') || text.includes('session export'), `${label} must document desktop CM session export/import`);
    requireCondition(text.includes('web app must not expose SSH'), `${label} must document that the web app must not expose SSH`);
  }
}

function readCargoPackageVersion(text) {
  const lines = text.split('\n');
  let inPackage = false;
  for (const line of lines) {
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }
    if (inPackage && /^\[/.test(line)) {
      return '';
    }
    if (inPackage) {
      const match = line.match(/^version\s*=\s*"([^"]+)"\s*$/);
      if (match) {
        return match[1];
      }
    }
  }
  return '';
}

async function readJsonFile(relativePath, label) {
  const text = await readTextFile(relativePath, label);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readTextFile(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    failures.push(`${label} must be configured`);
    return '';
  }
  try {
    return await readFile(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    failures.push(`${label} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

async function fileExists(relativePath) {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readBinaryFile(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    failures.push(`${label} must be configured`);
    return undefined;
  }
  try {
    return await readFile(path.join(repoRoot, relativePath));
  } catch (error) {
    failures.push(`${label} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readPngDimensions(relativePath, label) {
  const file = await readBinaryFile(relativePath, label);
  if (!file) {
    return undefined;
  }
  const pngSignature = '89504e470d0a1a0a';
  if (file.length < 24 || file.subarray(0, 8).toString('hex') !== pngSignature) {
    failures.push(`${label} must be a PNG file`);
    return undefined;
  }
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  };
}

function formatDimensions(dimensions) {
  if (!dimensions) {
    return '';
  }
  return `${dimensions.width}x${dimensions.height}`;
}

async function validateIcnsFile(relativePath, label) {
  const file = await readBinaryFile(relativePath, label);
  if (!file) {
    return;
  }
  requireCondition(file.length > 8, `${label} must not be empty`);
  requireCondition(file.subarray(0, 4).toString('ascii') === 'icns', `${label} must have icns signature`);
  requireCondition(file.readUInt32BE(4) === file.length, `${label} length header must match file size`);
}

async function validateIcoFile(relativePath, label) {
  const file = await readBinaryFile(relativePath, label);
  if (!file) {
    return;
  }
  requireCondition(file.length > 22, `${label} must not be empty`);
  requireCondition(file.readUInt16LE(0) === 0, `${label} reserved header must be 0`);
  requireCondition(file.readUInt16LE(2) === 1, `${label} type header must be icon`);
  requireCondition(file.readUInt16LE(4) >= 1, `${label} must contain at least one image`);
}
