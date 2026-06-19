import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const tauriConfigPath = path.join(repoRoot, 'desktop', 'src-tauri', 'tauri.conf.json');
const defaultWindowsTimestampUrl = 'http://timestamp.digicert.com';
const defaultWindowsDigestAlgorithm = 'sha256';

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!options.macos && !options.windows) {
  throw new Error('Choose at least one target: --macos or --windows');
}

const configText = await readFile(tauriConfigPath, 'utf8');
const config = JSON.parse(configText);
const summary = {
  dryRun: options.dryRun,
  macos: false,
  windows: false,
};

config.bundle ||= {};

if (options.macos) {
  const signingIdentity = requireEnv('APPLE_SIGNING_IDENTITY');
  config.bundle.macOS ||= {};
  config.bundle.macOS.signingIdentity = signingIdentity;
  summary.macos = true;
}

if (options.windows) {
  const certificateThumbprint = normalizeThumbprint(requireEnv('WINDOWS_CERTIFICATE_THUMBPRINT'));
  const digestAlgorithm = (process.env.WINDOWS_DIGEST_ALGORITHM || defaultWindowsDigestAlgorithm).trim();
  const timestampUrl = (process.env.WINDOWS_TIMESTAMP_URL || defaultWindowsTimestampUrl).trim();

  if (!['sha256', 'sha384', 'sha512'].includes(digestAlgorithm)) {
    throw new Error(`WINDOWS_DIGEST_ALGORITHM must be sha256, sha384, or sha512, got: ${digestAlgorithm}`);
  }
  if (!/^https?:\/\//.test(timestampUrl)) {
    throw new Error(`WINDOWS_TIMESTAMP_URL must be http(s), got: ${timestampUrl}`);
  }

  config.bundle.windows ||= {};
  config.bundle.windows.certificateThumbprint = certificateThumbprint;
  config.bundle.windows.digestAlgorithm = digestAlgorithm;
  config.bundle.windows.timestampUrl = timestampUrl;
  summary.windows = true;
  summary.windowsTimestampUrl = timestampUrl;
  summary.windowsDigestAlgorithm = digestAlgorithm;
}

if (!options.dryRun) {
  await writeFile(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

console.log(JSON.stringify(summary));

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    help: false,
    macos: false,
    windows: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--macos') {
      parsed.macos = true;
    } else if (arg === '--windows') {
      parsed.windows = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeThumbprint(value) {
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-F0-9]{40,}$/.test(normalized)) {
    throw new Error('WINDOWS_CERTIFICATE_THUMBPRINT must be at least 40 hex characters');
  }
  return normalized;
}

function printHelp() {
  console.log(`Usage: node scripts/configure-desktop-signing.mjs [--macos] [--windows] [--dry-run]

Configures Tauri signing settings in the local CI workspace only.

macOS env:
  APPLE_SIGNING_IDENTITY

Windows env:
  WINDOWS_CERTIFICATE_THUMBPRINT
  WINDOWS_DIGEST_ALGORITHM optional, default ${defaultWindowsDigestAlgorithm}
  WINDOWS_TIMESTAMP_URL optional, default ${defaultWindowsTimestampUrl}
`);
}
