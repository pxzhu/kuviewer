#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const keyTypes = ['ed25519', 'ecdsa', 'rsa'];
const secretName = 'SERVER_SSH_KNOWN_HOSTS';
const outPath = path.resolve(args.out || path.join(tmpdir(), 'kuviewer-known-hosts'));

try {
  const knownHosts = args.fromFile
    ? validateKnownHosts(await readFile(path.resolve(args.fromFile), 'utf8'))
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
  } else {
    console.log(`to store it: gh secret set ${secretName} < ${outPath}`);
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
    repo: '',
    setSecret: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--set-secret') {
      parsed.setSecret = true;
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
    else if (arg === '--repo') parsed.repo = next;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (parsed.fromFile && parsed.host) {
    throw new Error('--from-file cannot be combined with --host');
  }
  if (!parsed.fromFile && !parsed.host) {
    throw new Error('usage: node scripts/prepare-deploy-known-hosts.mjs --host <host> [--port <port>] [--out <file>] [--set-secret]');
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
  if (!['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'].includes(keyType)) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) return false;
  return true;
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
