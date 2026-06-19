import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const defaultOutDir = path.join(repoRoot, 'desktop', 'src-tauri', 'binaries');
const binaryBaseName = 'kuviewer-sidecar';
const sourcePackage = 'server/cmd/kuviewer-server';

const targetMap = new Map([
  ['aarch64-apple-darwin', { goos: 'darwin', goarch: 'arm64' }],
  ['x86_64-apple-darwin', { goos: 'darwin', goarch: 'amd64' }],
  ['x86_64-pc-windows-msvc', { goos: 'windows', goarch: 'amd64' }],
  ['aarch64-pc-windows-msvc', { goos: 'windows', goarch: 'arm64' }],
]);

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.listTargets) {
  for (const target of targetMap.keys()) {
    console.log(target);
  }
  process.exit(0);
}

const targetTriple = options.target || detectHostTriple();
const target = targetMap.get(targetTriple);
if (!target) {
  throw new Error(`Unsupported sidecar target triple: ${targetTriple}`);
}

const outputDir = path.resolve(repoRoot, options.outDir || defaultOutDir);
const outputFile = path.join(outputDir, `${binaryBaseName}-${targetTriple}${target.goos === 'windows' ? '.exe' : ''}`);
const command = {
  cwd: path.join(repoRoot, 'server'),
  env: {
    CGO_ENABLED: '0',
    GOARCH: target.goarch,
    GOOS: target.goos,
  },
  args: ['build', '-trimpath', '-ldflags=-s -w', '-o', outputFile, './cmd/kuviewer-server'],
};

const summary = {
  dryRun: options.dryRun,
  targetTriple,
  goos: target.goos,
  goarch: target.goarch,
  binaryBaseName,
  sourcePackage,
  tauriExternalBinCandidate: `binaries/${binaryBaseName}`,
  outputFile,
  command: `GOOS=${target.goos} GOARCH=${target.goarch} CGO_ENABLED=0 go ${command.args.join(' ')}`,
};

if (options.dryRun) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
await runGoBuild(command);
console.log(JSON.stringify(summary));

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    help: false,
    listTargets: false,
    outDir: '',
    target: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--list-targets') {
      parsed.listTargets = true;
    } else if (arg === '--out-dir') {
      parsed.outDir = args[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length);
    } else if (arg === '--target') {
      parsed.target = args[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--target=')) {
      parsed.target = arg.slice('--target='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function detectHostTriple() {
  const rustcHostTuple = spawnSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' });
  if (rustcHostTuple.status === 0 && rustcHostTuple.stdout.trim()) {
    return rustcHostTuple.stdout.trim();
  }

  const rustcVerbose = spawnSync('rustc', ['-Vv'], { encoding: 'utf8' });
  if (rustcVerbose.status === 0) {
    const hostLine = rustcVerbose.stdout
      .split('\n')
      .find((line) => line.startsWith('host:'));
    if (hostLine) {
      return hostLine.slice('host:'.length).trim();
    }
  }

  throw new Error('Could not detect host target triple. Pass --target explicitly.');
}

async function runGoBuild(command) {
  const env = {
    ...process.env,
    ...command.env,
  };

  await new Promise((resolve, reject) => {
    const child = spawn('go', command.args, {
      cwd: command.cwd,
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`go build exited with code ${code}`));
      }
    });
  });
}

function printHelp() {
  console.log(`Usage: node scripts/build-desktop-sidecar.mjs [options]

Builds the Kuviewer Go API server as a candidate Tauri sidecar binary.
The default output directory is ignored by git and is intended for local/CI packaging only.

Options:
  --target <triple>    Tauri/Rust target triple. Defaults to rustc host tuple.
  --out-dir <path>     Output directory. Defaults to desktop/src-tauri/binaries.
  --dry-run            Print the build plan without writing a binary.
  --list-targets       Print supported target triples.
  --help               Show this help.
`);
}
