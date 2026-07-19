#!/usr/bin/env node
import {
  classifySshBanner,
  firstSafeLine,
  parseSshEndpointArgs,
  probeSocket,
  probeTls,
  safeProbeCliError,
} from './lib/ssh-endpoint-probe.mjs';

try {
  const args = parseSshEndpointArgs(process.argv.slice(2), 'diagnose-ssh-endpoint.mjs');
  console.log('diagnostics-scope: tcp, ssh-banner, http-head, tls-clienthello');
  console.log('diagnostics-credentials: none');
  await tcpProbe(args);
  await sshBannerProbe(args);
  await httpProbe(args);
  await tlsProbe(args);
} catch (error) {
  console.error(safeProbeCliError(error));
  process.exit(1);
}

async function tcpProbe(args) {
  const result = await probeSocket({ ...args, mode: 'connect' });
  console.log(result.ok ? 'tcp-reachable' : `tcp-unreachable: ${result.errorCode || 'NETWORK_ERROR'}`);
}

async function sshBannerProbe(args) {
  const banner = classifySshBanner(await probeSocket({ ...args, mode: 'read' }));
  if (banner.status === 'detected') console.log(`ssh-banner-detected: ${banner.protocol}`);
  else if (banner.status === 'unavailable') console.log(`ssh-banner-unavailable: ${banner.reason}`);
  else if (banner.status === 'invalid') console.log('ssh-banner-invalid: first-line-not-ssh');
  else console.log(`ssh-banner-${banner.status}`);
}

async function httpProbe(args) {
  const result = await probeSocket({
    ...args,
    mode: 'write',
    writePayload: `HEAD / HTTP/1.0\r\nHost: ${args.host}\r\nConnection: close\r\n\r\n`,
  });
  if (!result.ok) {
    console.log(`http-probe-unavailable: ${result.errorCode || 'NETWORK_ERROR'}`);
    return;
  }
  const status = firstSafeLine(result.data).match(/^HTTP\/[0-9.]+ [0-9]{3}/)?.[0] || '';
  console.log(status ? `http-response-detected: ${status}` : 'http-response-not-detected');
}

async function tlsProbe(args) {
  const result = await probeTls(args);
  if (result.ok) console.log(`tls-handshake-detected: ${result.protocol}`);
  else if (result.event === 'timeout') console.log('tls-handshake-timeout');
  else console.log(`tls-handshake-unavailable: ${result.errorCode || 'NETWORK_ERROR'}`);
}
