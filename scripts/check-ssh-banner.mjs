#!/usr/bin/env node
import net from 'node:net';

try {
  const args = parseArgs(process.argv.slice(2));
  await checkSshBanner(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    host: '',
    port: '22',
    timeoutMs: 10_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`missing value for ${arg}`);
    }
    index += 1;
    if (arg === '--host') parsed.host = next;
    else if (arg === '--port') parsed.port = next;
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(next);
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (!parsed.host) {
    throw new Error('usage: node scripts/check-ssh-banner.mjs --host <host> [--port <port>] [--timeout-ms <ms>]');
  }
  if (/\s/.test(parsed.host)) {
    throw new Error('--host must not contain whitespace');
  }
  if (!/^[1-9][0-9]{0,4}$/.test(String(parsed.port)) || Number(parsed.port) > 65535) {
    throw new Error('--port must be a number between 1 and 65535');
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 1_000 || parsed.timeoutMs > 60_000) {
    throw new Error('--timeout-ms must be an integer between 1000 and 60000');
  }

  return parsed;
}

async function checkSshBanner({ host, port, timeoutMs }) {
  const startedAt = Date.now();
  const socket = net.createConnection({ host, port: Number(port) });
  socket.setEncoding('utf8');
  socket.setTimeout(timeoutMs);

  await new Promise((resolve, reject) => {
    socket.once('connect', () => {
      console.log(`ssh-tcp-reachable: ${host}:${port}`);
    });
    socket.once('data', (chunk) => {
      const firstLine = chunk.split(/\r?\n/)[0] || '';
      socket.destroy();
      if (firstLine.startsWith('SSH-')) {
        console.log(`ssh-banner-received: ${firstLine.split(/\s+/)[0]}`);
        console.log(`elapsed-ms: ${Date.now() - startedAt}`);
        resolve();
        return;
      }
      reject(new Error('ssh-banner-invalid; TCP opened but the first line was not an SSH banner'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('ssh-banner-timeout; TCP opened but SSH banner was not received'));
    });
    socket.once('error', (error) => {
      reject(new Error(`ssh-tcp-unreachable; ${error.code || error.message}`));
    });
    socket.once('close', () => {
      reject(new Error('ssh-banner-closed; TCP opened then closed before an SSH banner was received'));
    });
  });
}
