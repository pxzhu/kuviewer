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
    ['runtime-health-details', 'advanced-diagnostics', 'session-export-import', 'diagnostics-filtering'].includes(manager.status),
    'cmSshSessionManager.status must be runtime-health-details, advanced-diagnostics, session-export-import, or diagnostics-filtering'
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
  const hiddenPrototypeUi = new Set(Array.isArray(manager.hiddenPrototypeUi) ? manager.hiddenPrototypeUi : []);
  for (const marker of ['DesktopConnectionProfilePanel', 'DesktopKubernetesProfilePanel', 'desktop-use-sidecar-profile']) {
    requireCondition(hiddenPrototypeUi.has(marker), `cmSshSessionManager.hiddenPrototypeUi must include ${marker}`);
  }

  const mainRs = await readTextFile('desktop/src-tauri/src/main.rs', 'desktop Tauri main');
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
    'desktop-cm-session-delete-credential',
    'Diagnostics',
    'desktop-cm-session-summary-diagnostics',
    'desktop-cm-session-export',
    'desktop-cm-session-import',
    'kuviewer.desktop.cmSessions',
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
    'desktop CM session summary must show active runtime status',
    'desktop CM diagnostics must show runtime-lost message',
    'desktop CM session search must match diagnostic message',
    'desktop CM export must not include credentialAvailable',
    'desktop CM import must report newly imported sessions',
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
