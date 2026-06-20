#!/usr/bin/env node
import net from 'node:net';
import tls from 'node:tls';

try {
  const args = parseArgs(process.argv.slice(2));
  await diagnoseEndpoint(args);
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
    throw new Error('usage: node scripts/diagnose-ssh-endpoint.mjs --host <host> [--port <port>] [--timeout-ms <ms>]');
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

async function diagnoseEndpoint(args) {
  console.log('diagnostics-scope: tcp, ssh-banner, http-head, tls-clienthello');
  console.log('diagnostics-credentials: none');
  await tcpProbe(args);
  await sshBannerProbe(args);
  await httpProbe(args);
  await tlsProbe(args);
}

async function tcpProbe({ host, port, timeoutMs }) {
  const result = await withSocket({ host, port, timeoutMs });
  console.log(result.ok ? 'tcp-reachable' : `tcp-unreachable: ${safeCode(result.error)}`);
}

async function sshBannerProbe({ host, port, timeoutMs }) {
  const result = await withSocket({ host, port, timeoutMs, readOnly: true });
  if (!result.ok) {
    console.log(`ssh-banner-unavailable: ${safeCode(result.error)}`);
    return;
  }
  const firstLine = firstSafeLine(result.data);
  if (firstLine.startsWith('SSH-')) {
    console.log(`ssh-banner-detected: ${firstLine.split(/\s+/)[0]}`);
    return;
  }
  console.log(firstLine ? 'ssh-banner-invalid: first-line-not-ssh' : 'ssh-banner-timeout');
}

async function httpProbe({ host, port, timeoutMs }) {
  const result = await withSocket({
    host,
    port,
    timeoutMs,
    writePayload: `HEAD / HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
  });
  if (!result.ok) {
    console.log(`http-probe-unavailable: ${safeCode(result.error)}`);
    return;
  }
  const status = firstSafeLine(result.data).match(/^HTTP\/[0-9.]+ [0-9]{3}/)?.[0] || '';
  console.log(status ? `http-response-detected: ${status}` : 'http-response-not-detected');
}

async function tlsProbe({ host, port, timeoutMs }) {
  await new Promise((resolve) => {
    const connectOptions = {
      host,
      port: Number(port),
      rejectUnauthorized: false,
    };
    if (net.isIP(host) === 0) {
      connectOptions.servername = host;
    }
    const socket = tls.connect(connectOptions);
    let settled = false;
    const finish = (message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      console.log(message);
      resolve();
    };
    socket.setTimeout(timeoutMs, () => finish('tls-handshake-timeout'));
    socket.once('secureConnect', () => finish(`tls-handshake-detected: ${socket.getProtocol() || 'unknown'}`));
    socket.once('error', (error) => finish(`tls-handshake-unavailable: ${safeCode(error)}`));
  });
}

async function withSocket({ host, port, timeoutMs, readOnly = false, writePayload = '' }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    socket.setEncoding('utf8');
    let settled = false;
    let data = '';

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => finish({ ok: true, data }));
    socket.once('connect', () => {
      if (!readOnly && writePayload) socket.write(writePayload);
      if (!readOnly && !writePayload) finish({ ok: true, data: '' });
    });
    socket.on('data', (chunk) => {
      data += chunk;
      finish({ ok: true, data });
    });
    socket.once('error', (error) => finish({ ok: false, error }));
    socket.once('close', () => {
      if (!settled) finish({ ok: true, data });
    });
  });
}

function firstSafeLine(data) {
  return (data || '').split(/\r?\n/)[0]?.replace(/[^\x20-\x7E]/g, '').slice(0, 80) || '';
}

function safeCode(error) {
  if (!error) return 'unknown';
  return String(error.code || error.message || 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
}
