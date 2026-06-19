import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fallbackVersion = '0.1.0';
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const targets = [
  {
    id: 'desktop-package',
    path: 'desktop/package.json',
    type: 'package-json',
  },
  {
    id: 'tauri-config',
    path: 'desktop/src-tauri/tauri.conf.json',
    type: 'tauri-json',
  },
  {
    id: 'cargo-manifest',
    path: 'desktop/src-tauri/Cargo.toml',
    type: 'cargo-toml',
  },
];

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const version = resolveVersion(options.version);
validateVersion(version);

const results = [];
for (const target of targets) {
  results.push(await inspectTarget(target, version));
}

const mismatches = results.filter((result) => result.currentVersion !== version);
if (options.check && mismatches.length > 0) {
  for (const mismatch of mismatches) {
    console.error(`${mismatch.path} is ${mismatch.currentVersion}, expected ${version}`);
  }
  process.exit(1);
}

if (!options.check && !options.dryRun && !options.print) {
  for (const result of results) {
    if (result.nextText !== result.currentText) {
      await writeFile(path.join(repoRoot, result.path), result.nextText);
    }
  }
}

if (options.githubOutput) {
  await writeGithubOutput('version', version);
}

if (options.print) {
  process.stdout.write(`${version}\n`);
} else {
  const changed = results.some((result) => result.currentText !== result.nextText);
  console.log(
    JSON.stringify({
      version,
      changed,
      dryRun: options.dryRun,
      check: options.check,
      files: results.map((result) => ({
        path: result.path,
        currentVersion: result.currentVersion,
        nextVersion: version,
        changed: result.currentText !== result.nextText,
      })),
    })
  );
}

function parseArgs(args) {
  const parsed = {
    check: false,
    dryRun: false,
    githubOutput: false,
    help: false,
    print: false,
    version: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--check') {
      parsed.check = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--github-output') {
      parsed.githubOutput = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--print') {
      parsed.print = true;
    } else if (arg === '--version') {
      parsed.version = args[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--version=')) {
      parsed.version = arg.slice('--version='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function resolveVersion(cliVersion) {
  const candidates = [
    cliVersion,
    process.env.KUVIEWER_DESKTOP_VERSION,
    normalizeRefVersion(process.env.GITHUB_REF_NAME),
    fallbackVersion,
  ];

  return candidates.map((candidate) => (candidate || '').trim()).find(Boolean) || fallbackVersion;
}

function normalizeRefVersion(refName) {
  const trimmed = (refName || '').trim();
  if (trimmed.startsWith('v')) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function validateVersion(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Desktop package version must be SemVer without a leading v or build metadata, got: ${version}`);
  }
}

async function inspectTarget(target, version) {
  const targetPath = path.join(repoRoot, target.path);
  const currentText = await readFile(targetPath, 'utf8');
  let currentVersion = '';
  let nextText = '';

  if (target.type === 'package-json' || target.type === 'tauri-json') {
    const json = JSON.parse(currentText);
    currentVersion = json.version;
    nextText = updateJsonVersion(currentText, version, target.path);
  } else if (target.type === 'cargo-toml') {
    const updated = updateCargoPackageVersion(currentText, version);
    currentVersion = updated.currentVersion;
    nextText = updated.nextText;
  } else {
    throw new Error(`Unsupported target type: ${target.type}`);
  }

  validateVersion(currentVersion);

  return {
    ...target,
    currentText,
    currentVersion,
    nextText,
  };
}

function updateJsonVersion(text, version, targetPath) {
  const versionLinePattern = /("version"\s*:\s*")[^"]+(")/;
  if (!versionLinePattern.test(text)) {
    throw new Error(`${targetPath} must contain a top-level version field`);
  }
  return text.replace(versionLinePattern, `$1${version}$2`);
}

function updateCargoPackageVersion(text, version) {
  const lines = text.split('\n');
  let inPackage = false;
  let currentVersion = '';
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      return line;
    }
    if (inPackage && /^\[/.test(line)) {
      inPackage = false;
    }
    if (inPackage) {
      const match = line.match(/^version\s*=\s*"([^"]+)"\s*$/);
      if (match) {
        currentVersion = match[1];
        replaced = true;
        return `version = "${version}"`;
      }
    }
    return line;
  });

  if (!replaced) {
    throw new Error('desktop/src-tauri/Cargo.toml must contain [package] version');
  }

  return {
    currentVersion,
    nextText: nextLines.join('\n'),
  };
}

async function writeGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  await appendFile(outputPath, `${name}=${value}\n`);
}

function printHelp() {
  console.log(`Usage: node scripts/set-desktop-package-version.mjs [options]

Options:
  --version <version>   SemVer package version without a leading v.
  --check              Fail if desktop package files do not already match.
  --dry-run            Report planned changes without writing files.
  --print              Print only the resolved version.
  --github-output      Write version=<version> to GITHUB_OUTPUT when available.
  --help               Show this help.

Resolution order:
  1. --version
  2. KUVIEWER_DESKTOP_VERSION
  3. GITHUB_REF_NAME with an optional leading v stripped
  4. ${fallbackVersion}
`);
}
