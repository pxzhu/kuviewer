import net from 'node:net';
import tls from 'node:tls';

const safeNetworkErrorCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPROTO',
  'ETIMEDOUT',
]);

export function parseSshEndpointArgs(argv, commandName) {
  const parsed = { host: '', port: 22, timeoutMs: 10_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${argument}`);
    index += 1;
    if (argument === '--host') parsed.host = value.trim();
    else if (argument === '--port') parsed.port = Number(value);
    else if (argument === '--timeout-ms') parsed.timeoutMs = Number(value);
    else throw new Error(`unknown argument: ${argument}`);
  }

  if (!parsed.host) throw new Error(`usage: node scripts/${commandName} --host <host> [--port <port>] [--timeout-ms <ms>]`);
  if (parsed.host.length > 253 || parsed.host.startsWith('-') || !/^[A-Za-z0-9._:%-]+$/.test(parsed.host)) {
    throw new Error('--host must be a hostname or IP address without whitespace');
  }
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65_535) {
    throw new Error('--port must be a number between 1 and 65535');
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 1_000 || parsed.timeoutMs > 60_000) {
    throw new Error('--timeout-ms must be an integer between 1000 and 60000');
  }
  return parsed;
}

export async function probeSocket({ host, port, timeoutMs, mode = 'connect', writePayload = '' }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setEncoding('utf8');
    let connected = false;
    let data = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ connected, data, ...result });
    };

    socket.setTimeout(timeoutMs, () => finish({ event: 'timeout', ok: connected }));
    socket.once('connect', () => {
      connected = true;
      if (mode === 'connect') finish({ event: 'connect', ok: true });
      else if (mode === 'write' && writePayload) socket.write(writePayload);
    });
    socket.on('data', (chunk) => {
      data = `${data}${chunk}`.slice(0, 4_096);
      finish({ event: 'data', ok: true });
    });
    socket.once('error', (error) => finish({ errorCode: safeNetworkErrorCode(error), event: 'error', ok: false }));
    socket.once('close', () => finish({ event: 'close', ok: connected }));
  });
}

export async function probeTls({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    const options = { host, port, rejectUnauthorized: false };
    if (net.isIP(host) === 0) options.servername = host;
    const socket = tls.connect(options);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ event: 'timeout', ok: false }));
    socket.once('secureConnect', () => finish({ event: 'secure-connect', ok: true, protocol: socket.getProtocol() || 'unknown' }));
    socket.once('error', (error) => finish({ errorCode: safeNetworkErrorCode(error), event: 'error', ok: false }));
  });
}

export function classifySshBanner(result) {
  if (!result.ok) return { status: 'unavailable', protocol: '', reason: result.errorCode || 'NETWORK_ERROR' };
  const firstLine = firstSafeLine(result.data);
  if (firstLine.startsWith('SSH-')) return { status: 'detected', protocol: firstLine.split(/\s+/)[0], reason: '' };
  if (firstLine) return { status: 'invalid', protocol: '', reason: 'first-line-not-ssh' };
  if (result.event === 'close') return { status: 'closed', protocol: '', reason: 'closed-before-banner' };
  return { status: 'timeout', protocol: '', reason: 'banner-not-received' };
}

export function firstSafeLine(data) {
  return (data || '').split(/\r?\n/)[0]?.replace(/[^\x20-\x7E]/g, '').slice(0, 80) || '';
}

export function safeNetworkErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  return safeNetworkErrorCodes.has(code) ? code : 'NETWORK_ERROR';
}

export function safeProbeCliError(error) {
  const message = error instanceof Error ? error.message : '';
  if (/^(missing value for --[a-z-]+|unknown argument: --[a-z-]+|usage: node scripts\/(check-ssh-banner|diagnose-ssh-endpoint)\.mjs --host <host> \[--port <port>\] \[--timeout-ms <ms>\]|--host must be a hostname or IP address without whitespace|--port must be a number between 1 and 65535|--timeout-ms must be an integer between 1000 and 60000|ssh-(tcp-unreachable|banner-unavailable):[A-Z_]+|ssh-banner-(invalid|timeout|closed))$/.test(message)) {
    return message;
  }
  return 'ssh_probe_failed';
}
