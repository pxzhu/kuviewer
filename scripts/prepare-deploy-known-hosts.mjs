#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const keyTypes = ['ed25519', 'ecdsa', 'rsa'];
const secretName = 'SERVER_SSH_KNOWN_HOSTS';
const variableName = 'SERVER_SSH_KNOWN_HOSTS';

try {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(args.out || path.join(tmpdir(), 'kuviewer-known-hosts'));
  const knownHosts = args.fromFile
    ? validateKnownHosts(await readFile(path.resolve(args.fromFile), 'utf8'))
    : args.publicKeyFiles.length > 0
      ? await renderKnownHostsFromPublicKeys(args)
    : await scanKnownHosts(args);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, knownHosts, { mode: 0o600 });

  const summary = summarizeKnownHosts(knownHosts);
  console.log(`known_hosts entries: ${summary.entries}`);
  console.log(`key types: ${summary.keyTypes.join(', ')}`);
  console.log(`wrote: ${outPath}`);

  if (args.setSecret) {
    setGithubSecret(knownHosts, args.repo);
    console.log(`updated GitHub Actions secret: ${secretName}`);
  } else if (args.setVariable) {
    setGithubVariable(knownHosts, args.repo);
    console.log(`updated GitHub Actions variable: ${variableName}`);
  } else {
    console.log(`to store it: gh secret set ${secretName} < ${outPath}`);
    console.log(`or as a public host-key variable: gh variable set ${variableName} < ${outPath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    host: '',
    port: '22',
    out: '',
    fromFile: '',
    publicKeyFiles: [],
    repo: '',
    setSecret: false,
    setVariable: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--set-secret') {
      parsed.setSecret = true;
      continue;
    }
    if (arg === '--set-variable') {
      parsed.setVariable = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`missing value for ${arg}`);
    }
    index += 1;
    if (arg === '--host') parsed.host = next;
    else if (arg === '--port') parsed.port = next;
    else if (arg === '--out') parsed.out = next;
    else if (arg === '--from-file') parsed.fromFile = next;
    else if (arg === '--from-public-key') parsed.publicKeyFiles.push(next);
    else if (arg === '--repo') parsed.repo = next;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (parsed.fromFile && (parsed.host || parsed.publicKeyFiles.length > 0)) {
    throw new Error('--from-file cannot be combined with --host or --from-public-key');
  }
  if (!parsed.fromFile && !parsed.host) {
    throw new Error('usage: node scripts/prepare-deploy-known-hosts.mjs --host <host> [--port <port>] [--from-public-key <file>...] [--out <file>] [--set-secret|--set-variable]');
  }
  if (parsed.setSecret && parsed.setVariable) {
    throw new Error('--set-secret and --set-variable cannot be combined');
  }
  if (!/^[1-9][0-9]{0,4}$/.test(parsed.port) || Number(parsed.port) > 65535) {
    throw new Error('--port must be a number between 1 and 65535');
  }
  if (/\s/.test(parsed.host)) {
    throw new Error('--host must not contain whitespace');
  }
  return parsed;
}

async function scanKnownHosts({ host, port }) {
  const lines = [];
  for (const addressMode of ['-4', '']) {
    for (const keyType of keyTypes) {
      const scanArgs = addressMode
        ? [addressMode, '-T', '10', '-t', keyType, '-p', port, host]
        : ['-T', '10', '-t', keyType, '-p', port, host];
      const result = spawnSync('ssh-keyscan', scanArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (result.stdout) {
        lines.push(...result.stdout.split('\n'));
      }
    }
    if (lines.some((line) => line.trim() && !line.trim().startsWith('#'))) {
      break;
    }
  }

  return validateKnownHosts(lines.join('\n'));
}

async function renderKnownHostsFromPublicKeys({ host, port, publicKeyFiles }) {
  const hostMarker = port === '22' ? host : `[${host}]:${port}`;
  const lines = [];
  for (const publicKeyFile of publicKeyFiles) {
    const raw = await readFile(path.resolve(publicKeyFile), 'utf8');
    if (/BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY/.test(raw)) {
      throw new Error('public host key input must not contain private key material');
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const publicKey = parsePublicKeyLine(trimmed);
      lines.push(`${hostMarker} ${publicKey.keyType} ${publicKey.key}`);
    }
  }

  return validateKnownHosts(lines.join('\n'));
}

function parsePublicKeyLine(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 2) {
    throw new Error('public host key input has an unsupported line format');
  }
  const [keyType, key] = parts;
  if (!isSupportedKeyType(keyType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) {
    throw new Error('public host key input has an unsupported line format');
  }
  return { keyType, key };
}

function validateKnownHosts(raw) {
  if (raw.length > 16_384) {
    throw new Error('known_hosts content is unexpectedly large');
  }
  if (/BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY/.test(raw)) {
    throw new Error('known_hosts content must not contain private key material');
  }

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const uniqueLines = [...new Set(lines)];
  if (uniqueLines.length === 0) {
    throw new Error('no SSH host keys were found');
  }

  for (const line of uniqueLines) {
    if (!isKnownHostLine(line)) {
      throw new Error('known_hosts content has an unsupported line format');
    }
  }

  return `${uniqueLines.sort().join('\n')}\n`;
}

function isKnownHostLine(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 3) return false;
  const [hosts, keyType, key] = parts;
  if (!hosts || hosts.includes('=') || hosts.startsWith('@')) return false;
  if (!isSupportedKeyType(keyType)) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) return false;
  return true;
}

function isSupportedKeyType(keyType) {
  return ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'].includes(keyType);
}

function summarizeKnownHosts(knownHosts) {
  const lines = knownHosts.trim().split('\n').filter(Boolean);
  const keyTypeLabels = new Set(lines.map((line) => line.split(/\s+/)[1]));
  return {
    entries: lines.length,
    keyTypes: [...keyTypeLabels].sort(),
  };
}

function setGithubSecret(knownHosts, repo) {
  const args = ['secret', 'set', secretName];
  if (repo) {
    args.push('-R', repo);
  }
  const result = spawnSync('gh', args, {
    input: knownHosts,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`gh secret set ${secretName} failed`);
  }
}

function setGithubVariable(knownHosts, repo) {
  const args = ['variable', 'set', variableName];
  if (repo) {
    args.push('-R', repo);
  }
  const result = spawnSync('gh', args, {
    input: knownHosts,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`gh variable set ${variableName} failed`);
  }
}
