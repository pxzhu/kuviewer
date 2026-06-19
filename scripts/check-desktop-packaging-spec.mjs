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
  ['packaging-spike', 'tauri-scaffold', 'macos-dmg-dry-run', 'windows-exe-dry-run', 'desktop-remote-profile-ux', 'desktop-release-versioning'].includes(spec.status),
  'status must be packaging-spike, tauri-scaffold, macos-dmg-dry-run, windows-exe-dry-run, desktop-remote-profile-ux, or desktop-release-versioning'
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
requireCondition(phases.includes('macos-dmg-build'), 'phaseOrder must include macos-dmg-build');
requireCondition(phases.includes('windows-exe-build'), 'phaseOrder must include windows-exe-build');

await validateBuildPrerequisites(spec);
await validateRemoteConnectionProfile(spec);
await validateReleaseVersioning(spec);
validateDryRuns(spec);

if (['tauri-scaffold', 'macos-dmg-dry-run', 'windows-exe-dry-run', 'desktop-remote-profile-ux', 'desktop-release-versioning'].includes(spec.status)) {
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

  const bundleTargets = new Set(Array.isArray(tauriConfig?.bundle?.targets) ? tauriConfig.bundle.targets : []);
  requireCondition(bundleTargets.has('dmg'), 'tauri bundle targets must include dmg');
  requireCondition(bundleTargets.has('nsis'), 'tauri bundle targets must include nsis for Windows exe installers');
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
  requireCondition(signing.status === 'ci-scaffolded', 'signing.status must be ci-scaffolded once the manual workflow exists');
  requireCondition(signing.noCertificatesInRepo === true, 'signing.noCertificatesInRepo must be true');
  requireCondition(signing.noPrivateKeysInRepo === true, 'signing.noPrivateKeysInRepo must be true');
  requireCondition(signing.workflowPath === '.github/workflows/desktop-package.yml', 'signing.workflowPath must point at desktop-package workflow');
  requireCondition(signing.manualOnly === true, 'signing.manualOnly must be true');
  requireCondition(signing.unsignedBuildDefault === true, 'signing.unsignedBuildDefault must be true');
  requireCondition(signing.signedBuildRequiresSecrets === true, 'signing.signedBuildRequiresSecrets must be true');
  requireCondition(typeof signing.macos === 'string' && signing.macos.includes('CI secrets'), 'signing.macos must reference CI secrets or local keychain handling');
  requireCondition(typeof signing.windows === 'string' && signing.windows.includes('CI secrets'), 'signing.windows must reference CI secrets handling');
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

  const app = await readTextFile('website/src/app/App.tsx', 'app shell');
  requireCondition(app.includes('handleDesktopConnectionProfileChange'), 'app shell must handle desktop profile changes');
  requireCondition(app.includes('clearAdminToken();'), 'app shell must clear the admin token when the desktop profile changes');

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
