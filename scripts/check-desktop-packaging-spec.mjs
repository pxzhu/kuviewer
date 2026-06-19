import { readFile } from 'node:fs/promises';
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
requireCondition(spec.goal === 'installable-read-only-desktop-cluster-explorer', 'goal must describe the installable read-only desktop explorer');
requireCondition(
  [
    'packaging-spike',
    'tauri-scaffold',
    'macos-dmg-dry-run',
    'windows-exe-dry-run',
    'desktop-remote-profile-ux',
    'desktop-release-versioning',
    'desktop-signing-notarization',
    'desktop-local-sidecar-evaluation',
    'desktop-local-sidecar-runtime',
    'desktop-keychain-credential-design',
    'desktop-keychain-profile-runtime',
  ].includes(spec.status),
  'status must be a known desktop packaging milestone'
);
requireCondition(spec.recommendedPackager === 'tauri', 'recommendedPackager must be tauri for the first packaging spike');
requireCondition(spec.fallbackPackager === 'electron', 'fallbackPackager must be electron');

const targets = Array.isArray(spec.targets) ? spec.targets : [];
const targetArtifacts = new Set(targets.map((target) => `${target.platform}:${target.artifact}`));
requireCondition(targetArtifacts.has('macos:dmg'), 'targets must include macos:dmg');
requireCondition(targetArtifacts.has('windows:exe'), 'targets must include windows:exe');

const connectionModes = new Set((Array.isArray(spec.connectionModes) ? spec.connectionModes : []).map((mode) => mode.id));
requireCondition(connectionModes.has('remote-api'), 'connectionModes must include remote-api');
requireCondition(connectionModes.has('local-sidecar'), 'connectionModes must include local-sidecar as a future evaluation path');
requireCondition(connectionModes.has('local-kubernetes-keychain'), 'connectionModes must include local-kubernetes-keychain as the desktop credential design path');

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
requireCondition(phases.includes('release-versioning'), 'phaseOrder must include release-versioning');
requireCondition(phases.includes('keychain-credential-design'), 'phaseOrder must include keychain-credential-design');
requireCondition(phases.includes('keychain-profile-runtime'), 'phaseOrder must include keychain-profile-runtime');
requireCondition(phases.includes('macos-dmg-build'), 'phaseOrder must include macos-dmg-build');
requireCondition(phases.includes('windows-exe-build'), 'phaseOrder must include windows-exe-build');

await validateBuildPrerequisites(spec);
await validateRemoteConnectionProfile(spec);
await validateReleaseVersioning(spec);
await validateLocalSidecar(spec);
await validateCredentialStorageDesign(spec);
validateDryRuns(spec);

if (
  [
    'tauri-scaffold',
    'macos-dmg-dry-run',
    'windows-exe-dry-run',
    'desktop-remote-profile-ux',
    'desktop-release-versioning',
    'desktop-signing-notarization',
    'desktop-local-sidecar-evaluation',
    'desktop-local-sidecar-runtime',
    'desktop-keychain-credential-design',
    'desktop-keychain-profile-runtime',
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

  const bundleTargets = new Set(Array.isArray(tauriConfig?.bundle?.targets) ? tauriConfig.bundle.targets : []);
  requireCondition(bundleTargets.has('dmg'), 'tauri bundle targets must include dmg');
  requireCondition(bundleTargets.has('nsis'), 'tauri bundle targets must include nsis for Windows exe installers');
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
  for (const id of ['node', 'npm', 'rust', 'cargo', 'xcode-command-line-tools', 'windows-runner']) {
    requireCondition(prerequisiteIds.has(id), `buildPrerequisites must include ${id}`);
  }

  const macPrerequisites = new Set(
    (Array.isArray(spec.buildPrerequisites) ? spec.buildPrerequisites : [])
      .filter((prerequisite) => Array.isArray(prerequisite.requiredFor) && prerequisite.requiredFor.includes('macos'))
      .map((prerequisite) => prerequisite.id)
  );
  const windowsPrerequisites = new Set(
    (Array.isArray(spec.buildPrerequisites) ? spec.buildPrerequisites : [])
      .filter((prerequisite) => Array.isArray(prerequisite.requiredFor) && prerequisite.requiredFor.includes('windows'))
      .map((prerequisite) => prerequisite.id)
  );
  for (const id of ['node', 'npm', 'rust', 'cargo', 'xcode-command-line-tools']) {
    requireCondition(macPrerequisites.has(id), `macos buildPrerequisites must include ${id}`);
  }
  for (const id of ['node', 'npm', 'rust', 'cargo', 'windows-runner']) {
    requireCondition(windowsPrerequisites.has(id), `windows buildPrerequisites must include ${id}`);
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

  const signing = spec.signing || {};
  requireCondition(signing.status === 'ci-enabled', 'signing.status must be ci-enabled once the signed workflow path exists');
  requireCondition(signing.noCertificatesInRepo === true, 'signing.noCertificatesInRepo must be true');
  requireCondition(signing.noPrivateKeysInRepo === true, 'signing.noPrivateKeysInRepo must be true');
  requireCondition(signing.workflowPath === '.github/workflows/desktop-package.yml', 'signing.workflowPath must point at desktop-package workflow');
  requireCondition(signing.signingConfigScript === 'scripts/configure-desktop-signing.mjs', 'signing.signingConfigScript must point at configure-desktop-signing');
  requireCondition(signing.manualOnly === true, 'signing.manualOnly must be true');
  requireCondition(signing.unsignedBuildDefault === true, 'signing.unsignedBuildDefault must be true');
  requireCondition(signing.signedBuildRequiresSecrets === true, 'signing.signedBuildRequiresSecrets must be true');
  requireCondition(typeof signing.macos === 'string' && signing.macos.includes('temporary GitHub runner keychain'), 'signing.macos must reference temporary runner keychain handling');
  requireCondition(signing.macosMode === 'temporary-keychain-p12', 'signing.macosMode must be temporary-keychain-p12');
  requireCondition(signing.macosNotarizationMode === 'apple-id-env', 'signing.macosNotarizationMode must be apple-id-env');
  requireCondition(typeof signing.windows === 'string' && signing.windows.includes('CurrentUser certificate store'), 'signing.windows must reference CurrentUser certificate store handling');
  requireCondition(signing.windowsMode === 'current-user-pfx-thumbprint', 'signing.windowsMode must be current-user-pfx-thumbprint');
  requireCondition(signing.windowsTimestampUrlDefault === 'http://timestamp.digicert.com', 'signing.windowsTimestampUrlDefault must be http://timestamp.digicert.com');
  for (const secretName of ['APPLE_CERTIFICATE_BASE64', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) {
    requireCondition(Array.isArray(signing.macosSecretNames) && signing.macosSecretNames.includes(secretName), `signing.macosSecretNames must include ${secretName}`);
  }
  for (const secretName of ['WINDOWS_CERTIFICATE_BASE64', 'WINDOWS_CERTIFICATE_PASSWORD']) {
    requireCondition(Array.isArray(signing.windowsSecretNames) && signing.windowsSecretNames.includes(secretName), `signing.windowsSecretNames must include ${secretName}`);
  }

  const workflow = await readTextFile(signing.workflowPath, 'desktop package workflow');
  requireCondition(workflow.includes('workflow_dispatch'), 'desktop package workflow must be manual');
  requireCondition(workflow.includes('macos-latest'), 'desktop package workflow must include a macOS job');
  requireCondition(workflow.includes('windows-latest'), 'desktop package workflow must include a Windows job');
  requireCondition(workflow.includes('npm run tauri:build -- --bundles dmg'), 'desktop package workflow must build dmg bundles');
  requireCondition(workflow.includes('npm run tauri:build -- --bundles nsis'), 'desktop package workflow must build nsis bundles');
  requireCondition(workflow.includes('${{ secrets.APPLE_CERTIFICATE_BASE64 }}'), 'desktop package workflow must read macOS signing secrets by name');
  requireCondition(workflow.includes('${{ secrets.WINDOWS_CERTIFICATE_BASE64 }}'), 'desktop package workflow must read Windows signing secrets by name');
  for (const marker of [
    'Import macOS signing certificate',
    'Configure macOS signing',
    'Build signed and notarized macOS dmg',
    'Clean macOS signing keychain',
    'security create-keychain',
    'security import',
    'APPLE_ID',
    'APPLE_PASSWORD',
    'APPLE_TEAM_ID',
    'Import Windows signing certificate',
    'Configure Windows signing',
    'Build signed Windows exe',
    'Clean Windows signing certificate',
    'Import-PfxCertificate',
    'WINDOWS_CERTIFICATE_THUMBPRINT',
    'scripts/configure-desktop-signing.mjs --macos',
    'scripts/configure-desktop-signing.mjs --windows',
  ]) {
    requireCondition(workflow.includes(marker), `desktop package workflow must include ${marker}`);
  }

  const signingConfigScript = await readTextFile(signing.signingConfigScript, 'desktop signing config script');
  for (const marker of [
    'APPLE_SIGNING_IDENTITY',
    'WINDOWS_CERTIFICATE_THUMBPRINT',
    'WINDOWS_TIMESTAMP_URL',
    'WINDOWS_DIGEST_ALGORITHM',
    'certificateThumbprint',
    'signingIdentity',
    '--macos',
    '--windows',
    '--dry-run',
  ]) {
    requireCondition(signingConfigScript.includes(marker), `desktop signing config script must include ${marker}`);
  }

  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  const prerequisitesDoc = await readTextFile('desktop/BUILD_PREREQUISITES.md', 'desktop build prerequisites doc');
  const iconReadme = await readTextFile('desktop/icons/README.md', 'desktop icons README');

  requireCondition(desktopReadme.includes('BUILD_PREREQUISITES.md'), 'desktop README must link build prerequisites');
  requireCondition(prerequisitesDoc.includes('Rust and Cargo'), 'desktop build prerequisites doc must mention Rust and Cargo');
  requireCondition(prerequisitesDoc.includes('Xcode Command Line Tools'), 'desktop build prerequisites doc must mention Xcode Command Line Tools');
  requireCondition(prerequisitesDoc.includes('Windows host or CI runner'), 'desktop build prerequisites doc must mention Windows host or CI runner');
  requireCondition(prerequisitesDoc.includes('Do not commit certificates'), 'desktop build prerequisites doc must state signing material is not committed');
  requireCondition(prerequisitesDoc.includes('node scripts/generate-desktop-icons.mjs'), 'desktop build prerequisites doc must mention icon generation');
  requireCondition(prerequisitesDoc.includes('node scripts/set-desktop-package-version.mjs'), 'desktop build prerequisites doc must mention release versioning');
  requireCondition(prerequisitesDoc.includes('node scripts/configure-desktop-signing.mjs'), 'desktop build prerequisites doc must mention signing config');
  requireCondition(iconReadme.includes('icon.icns'), 'desktop icons README must describe icon.icns');
  requireCondition(iconReadme.includes('icon.ico'), 'desktop icons README must describe icon.ico');
}

async function validateRemoteConnectionProfile(spec) {
  const profile = spec.remoteConnectionProfile || {};
  requireCondition(profile.status === 'scaffolded', 'remoteConnectionProfile.status must be scaffolded');
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

async function validateReleaseVersioning(spec) {
  const releaseVersioning = spec.releaseVersioning || {};
  requireCondition(releaseVersioning.status === 'scaffolded', 'releaseVersioning.status must be scaffolded');
  requireCondition(releaseVersioning.versionScript === 'scripts/set-desktop-package-version.mjs', 'releaseVersioning.versionScript must point at set-desktop-package-version');
  requireCondition(releaseVersioning.workflowInput === 'package_version', 'releaseVersioning.workflowInput must be package_version');
  requireCondition(releaseVersioning.tagPrefix === 'v', 'releaseVersioning.tagPrefix must be v');
  requireCondition(releaseVersioning.fallbackVersion === '0.1.0', 'releaseVersioning.fallbackVersion must stay 0.1.0 until desktop packages are intentionally bumped');
  requireCondition(releaseVersioning.artifactNamePattern === 'kuviewer-{platform}-{artifact}-{version}', 'releaseVersioning artifactNamePattern must include version');
  requireCondition(releaseVersioning.ciWorkspaceOnly === true, 'releaseVersioning.ciWorkspaceOnly must be true');
  requireCondition(releaseVersioning.noCredentialPersistence === true, 'releaseVersioning.noCredentialPersistence must be true');

  const sourceFiles = new Set(Array.isArray(releaseVersioning.sourceFiles) ? releaseVersioning.sourceFiles : []);
  for (const sourceFile of ['desktop/package.json', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/tauri.conf.json']) {
    requireCondition(sourceFiles.has(sourceFile), `releaseVersioning.sourceFiles must include ${sourceFile}`);
  }

  const versionScript = await readTextFile(releaseVersioning.versionScript, 'desktop package version script');
  for (const marker of [
    'KUVIEWER_DESKTOP_VERSION',
    'GITHUB_REF_NAME',
    'GITHUB_OUTPUT',
    'desktop/package.json',
    'desktop/src-tauri/Cargo.toml',
    'desktop/src-tauri/tauri.conf.json',
    '--check',
    '--dry-run',
  ]) {
    requireCondition(versionScript.includes(marker), `desktop package version script must include ${marker}`);
  }

  const fallbackVersion = releaseVersioning.fallbackVersion;
  const desktopPackage = await readJsonFile('desktop/package.json', 'desktop package.json');
  const tauriConfig = await readJsonFile('desktop/src-tauri/tauri.conf.json', 'desktop tauri config');
  const cargoToml = await readTextFile('desktop/src-tauri/Cargo.toml', 'desktop Cargo.toml');
  requireCondition(desktopPackage?.version === fallbackVersion, `desktop package.json version must default to ${fallbackVersion}`);
  requireCondition(tauriConfig?.version === fallbackVersion, `tauri config version must default to ${fallbackVersion}`);
  requireCondition(readCargoPackageVersion(cargoToml) === fallbackVersion, `Cargo.toml package version must default to ${fallbackVersion}`);

  const workflow = await readTextFile(spec.signing?.workflowPath, 'desktop package workflow');
  for (const marker of [
    'package_version',
    'scripts/set-desktop-package-version.mjs',
    'KUVIEWER_DESKTOP_VERSION',
    '--github-output',
    '${{ steps.desktop-version.outputs.version }}',
    'kuviewer-macos-dmg-${{ steps.desktop-version.outputs.version }}',
    'kuviewer-windows-exe-${{ steps.desktop-version.outputs.version }}',
  ]) {
    requireCondition(workflow.includes(marker), `desktop package workflow must include ${marker}`);
  }

  const desktopReadme = await readTextFile('desktop/README.md', 'desktop README');
  requireCondition(desktopReadme.includes('Release Versioning'), 'desktop README must document release versioning');
  requireCondition(desktopReadme.includes('package_version'), 'desktop README must document package_version input');
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
  requireCondition(profileUx.status === 'scaffolded', 'localSidecar.profileUx.status must be scaffolded');
  requireCondition(profileUx.displaysSidecarSource === true, 'localSidecar.profileUx.displaysSidecarSource must be true');
  requireCondition(profileUx.explicitUseSidecarButton === true, 'localSidecar.profileUx.explicitUseSidecarButton must be true');
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
  for (const marker of ['getDesktopSidecarProfile', 'storeAdminToken', 'storeDesktopConnectionProfile', 'handleUseDesktopSidecar', 'setDesktopSidecarProfile']) {
    requireCondition(app.includes(marker), `app shell must include ${marker}`);
  }

  const profilePanel = await readTextFile('website/src/components/DesktopConnectionProfilePanel.tsx', 'desktop connection profile UI panel');
  for (const marker of ['sidecarProfile', 'desktop-use-sidecar-profile', '로컬 sidecar 사용']) {
    requireCondition(profilePanel.includes(marker), `desktop connection profile panel must include ${marker}`);
  }

  requireCondition(desktopReadme.includes('Local Sidecar Runtime'), 'desktop README must document local sidecar runtime');
  requireCondition(prerequisitesDoc.includes('node scripts/build-desktop-sidecar.mjs'), 'desktop build prerequisites doc must mention sidecar build script');
  requireCondition(prerequisitesDoc.includes('KUVIEWER_DESKTOP_SIDECAR_SOURCE'), 'desktop build prerequisites doc must mention the sidecar source override');
}

async function validateCredentialStorageDesign(spec) {
  const design = spec.credentialStorageDesign || {};
  requireCondition(design.status === 'runtime-metadata-prototype', 'credentialStorageDesign.status must be runtime-metadata-prototype');
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
  requireCondition(runtimePrototype.uiPanel === 'DesktopKubernetesProfilePanel', 'credentialStorageDesign.runtimePrototype.uiPanel must be DesktopKubernetesProfilePanel');
  requireCondition(runtimePrototype.secretReadWriteImplemented === false, 'credentialStorageDesign.runtimePrototype.secretReadWriteImplemented must stay false until OS credential read/write exists');
  requireCondition(runtimePrototype.sidecarRestartImplemented === false, 'credentialStorageDesign.runtimePrototype.sidecarRestartImplemented must stay false until selecting a profile restarts the sidecar');
  requireCondition(runtimePrototype.browserReceivesSecrets === false, 'credentialStorageDesign.runtimePrototype.browserReceivesSecrets must be false');
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
    'KUVIEWER_DESKTOP_KUBE_API_SERVER',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_ID',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_NAME',
  ]) {
    requireCondition(designDoc.includes(marker), `desktop keychain credential design doc must include ${marker}`);
  }
  requireCondition(!designDoc.includes('KUVIEWER_KUBE_BEARER_TOKEN=<'), 'desktop keychain credential design must not recommend bearer token env handoff');

  const mainRs = await readTextFile('desktop/src-tauri/src/main.rs', 'desktop Tauri main');
  for (const marker of [
    'DesktopKubernetesProfileMetadata',
    'desktop_kubernetes_profiles',
    'desktop_select_kubernetes_profile',
    'KUVIEWER_DESKTOP_KUBE_API_SERVER',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_ID',
    'KUVIEWER_DESKTOP_KUBE_PROFILE_NAME',
    'runtime-env-metadata-fixture',
  ]) {
    requireCondition(mainRs.includes(marker), `desktop Tauri main must include ${marker}`);
  }
  requireCondition(!mainRs.includes('KUVIEWER_DESKTOP_KUBE_BEARER_TOKEN'), 'desktop Tauri main must not read bearer tokens from desktop env metadata fixture');

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
  }

  const profileModule = await readTextFile('website/src/features/desktop/desktopConnectionProfile.ts', 'desktop connection profile frontend module');
  for (const marker of ['DesktopKubernetesProfile', 'desktop_kubernetes_profiles', 'desktop_select_kubernetes_profile']) {
    requireCondition(profileModule.includes(marker), `desktop connection profile module must include ${marker}`);
  }
  requireCondition(!profileModule.includes('kubeconfig'), 'desktop frontend profile module must not handle kubeconfig content');

  const profilePanel = await readTextFile('website/src/components/DesktopKubernetesProfilePanel.tsx', 'desktop Kubernetes profile UI panel');
  for (const marker of ['DesktopKubernetesProfilePanel', 'browser secret 저장 없음', 'desktop-kubernetes-profile-panel']) {
    requireCondition(profilePanel.includes(marker), `desktop Kubernetes profile panel must include ${marker}`);
  }

  const sourceModeBar = await readTextFile('website/src/components/SourceModeBar.tsx', 'source mode bar');
  requireCondition(sourceModeBar.includes('DesktopKubernetesProfilePanel'), 'source mode bar must render DesktopKubernetesProfilePanel in desktop runtime');
}

function validateDryRuns(spec) {
  if (!['macos-dmg-dry-run', 'windows-exe-dry-run'].includes(spec.status)) {
    return;
  }
  const dryRuns = Array.isArray(spec.dryRuns) ? spec.dryRuns : [];
  const macosDryRun = dryRuns.find((dryRun) => dryRun.id === 'macos-dmg-unsigned-2026-06-19');
  requireCondition(Boolean(macosDryRun), 'dryRuns must include macos-dmg-unsigned-2026-06-19');
  if (macosDryRun) {
    requireCondition(macosDryRun.platform === 'macos', 'macOS dry-run platform must be macos');
    requireCondition(macosDryRun.artifact === 'dmg', 'macOS dry-run artifact must be dmg');
    requireCondition(macosDryRun.signed === false, 'macOS dry-run must be unsigned');
    requireCondition(macosDryRun.workflow === 'desktop-package', 'macOS dry-run workflow must be desktop-package');
    requireCondition(macosDryRun.workflowRunId === 27800527207, 'macOS dry-run workflowRunId must match the verified run');
    requireCondition(macosDryRun.workflowRunUrl === 'https://github.com/pxzhu/kuviewer/actions/runs/27800527207', 'macOS dry-run workflowRunUrl must match the verified run');
    requireCondition(macosDryRun.ref === 'main', 'macOS dry-run ref must be main');
    requireCondition(macosDryRun.commit === 'd525971d7415a6053eb8f45d92f5a3573654e3cd', 'macOS dry-run commit must match the verified commit');
    requireCondition(macosDryRun.conclusion === 'success', 'macOS dry-run conclusion must be success');
    requireCondition(macosDryRun.outputFile === 'Kuviewer_0.1.0_aarch64.dmg', 'macOS dry-run output file must match the generated dmg');
    requireCondition(macosDryRun.artifactName === 'kuviewer-macos-dmg', 'macOS dry-run artifact name must be kuviewer-macos-dmg');
    requireCondition(macosDryRun.artifactId === 7740045761, 'macOS dry-run artifact id must match the uploaded artifact');
    requireCondition(macosDryRun.artifactSizeBytes === 7125256, 'macOS dry-run artifact size must match the uploaded artifact');
    requireCondition(macosDryRun.artifactZipSha256 === '3a663ab3e3cba2bd12e14cf692cf699f5ee862f15f4cb80d4840ff98dad173ec', 'macOS dry-run artifact digest must match the uploaded artifact');
  }

  if (spec.status !== 'windows-exe-dry-run') {
    return;
  }

  const windowsDryRun = dryRuns.find((dryRun) => dryRun.id === 'windows-exe-unsigned-2026-06-19');
  requireCondition(Boolean(windowsDryRun), 'dryRuns must include windows-exe-unsigned-2026-06-19');
  if (!windowsDryRun) {
    return;
  }
  requireCondition(windowsDryRun.platform === 'windows', 'Windows dry-run platform must be windows');
  requireCondition(windowsDryRun.artifact === 'exe', 'Windows dry-run artifact must be exe');
  requireCondition(windowsDryRun.signed === false, 'Windows dry-run must be unsigned');
  requireCondition(windowsDryRun.workflow === 'desktop-package', 'Windows dry-run workflow must be desktop-package');
  requireCondition(windowsDryRun.workflowRunId === 27803179419, 'Windows dry-run workflowRunId must match the verified run');
  requireCondition(windowsDryRun.workflowRunUrl === 'https://github.com/pxzhu/kuviewer/actions/runs/27803179419', 'Windows dry-run workflowRunUrl must match the verified run');
  requireCondition(windowsDryRun.ref === 'main', 'Windows dry-run ref must be main');
  requireCondition(windowsDryRun.commit === 'b754c549ee2a2766c7f2d32257e4ee66a426aeb2', 'Windows dry-run commit must match the verified commit');
  requireCondition(windowsDryRun.conclusion === 'success', 'Windows dry-run conclusion must be success');
  requireCondition(windowsDryRun.outputFile === 'Kuviewer_0.1.0_x64-setup.exe', 'Windows dry-run output file must match the generated exe');
  requireCondition(windowsDryRun.artifactName === 'kuviewer-windows-exe', 'Windows dry-run artifact name must be kuviewer-windows-exe');
  requireCondition(windowsDryRun.artifactId === 7741029893, 'Windows dry-run artifact id must match the uploaded artifact');
  requireCondition(windowsDryRun.artifactSizeBytes === 5777828, 'Windows dry-run artifact size must match the uploaded artifact');
  requireCondition(windowsDryRun.artifactZipSha256 === '904285edb5307f1426f386ef340d413c81623e41ad57a835f0ea303c778970c4', 'Windows dry-run artifact digest must match the uploaded artifact');
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
