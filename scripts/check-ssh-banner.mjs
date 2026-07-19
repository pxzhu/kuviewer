#!/usr/bin/env node
import {
  classifySshBanner,
  parseSshEndpointArgs,
  probeSocket,
  safeProbeCliError,
} from './lib/ssh-endpoint-probe.mjs';

try {
  const args = parseSshEndpointArgs(process.argv.slice(2), 'check-ssh-banner.mjs');
  const startedAt = Date.now();
  const result = await probeSocket({ ...args, mode: 'read' });
  if (!result.connected) throw new Error(`ssh-tcp-unreachable:${result.errorCode || 'NETWORK_ERROR'}`);
  console.log('ssh-tcp-reachable');

  const banner = classifySshBanner(result);
  if (banner.status === 'detected') {
    console.log(`ssh-banner-received: ${banner.protocol}`);
    console.log(`elapsed-ms: ${Date.now() - startedAt}`);
  } else if (banner.status === 'unavailable') {
    throw new Error(`ssh-banner-unavailable:${banner.reason}`);
  } else {
    throw new Error(`ssh-banner-${banner.status}`);
  }
} catch (error) {
  console.error(safeProbeCliError(error));
  process.exit(1);
}
