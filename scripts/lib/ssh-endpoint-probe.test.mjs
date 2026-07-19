import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  classifySshBanner,
  firstSafeLine,
  parseSshEndpointArgs,
  probeSocket,
  safeNetworkErrorCode,
  safeProbeCliError,
} from './ssh-endpoint-probe.mjs';

test('SSH endpoint args normalize valid hosts, ports, and timeouts', () => {
  assert.deepEqual(parseSshEndpointArgs(['--host', ' example.internal ', '--port', '2222', '--timeout-ms', '5000'], 'check-ssh-banner.mjs'), {
    host: 'example.internal',
    port: 2222,
    timeoutMs: 5000,
  });
  assert.deepEqual(parseSshEndpointArgs(['--host', '2001:db8::1'], 'diagnose-ssh-endpoint.mjs'), {
    host: '2001:db8::1',
    port: 22,
    timeoutMs: 10_000,
  });
});

test('SSH endpoint args reject missing, unsafe, and out-of-range values', () => {
  assert.throws(() => parseSshEndpointArgs([], 'check-ssh-banner.mjs'), /usage:/);
  assert.throws(() => parseSshEndpointArgs(['--host'], 'check-ssh-banner.mjs'), /missing value/);
  assert.throws(() => parseSshEndpointArgs(['--host', 'host name'], 'check-ssh-banner.mjs'), /hostname or IP/);
  assert.throws(() => parseSshEndpointArgs(['--host', 'example.test', '--port', '65536'], 'check-ssh-banner.mjs'), /between 1 and 65535/);
  assert.throws(() => parseSshEndpointArgs(['--host', 'example.test', '--timeout-ms', '99'], 'check-ssh-banner.mjs'), /between 1000 and 60000/);
  assert.throws(() => parseSshEndpointArgs(['--host', 'example.test', '--raw', 'value'], 'check-ssh-banner.mjs'), /unknown argument/);
});

test('network errors expose allowlisted codes only', () => {
  assert.equal(safeNetworkErrorCode({ code: 'ECONNREFUSED', message: 'connect to private-host:22' }), 'ECONNREFUSED');
  assert.equal(safeNetworkErrorCode({ code: 'UNSAFE', message: 'private-host:22 token=value' }), 'NETWORK_ERROR');
  assert.equal(safeNetworkErrorCode(new Error('private-host:22')), 'NETWORK_ERROR');
});

test('SSH banner classification emits bounded protocol metadata', () => {
  assert.deepEqual(classifySshBanner({ ok: true, event: 'data', data: 'SSH-2.0-OpenSSH_9.8\r\nprivate detail' }), {
    status: 'detected',
    protocol: 'SSH-2.0-OpenSSH_9.8',
    reason: '',
  });
  assert.equal(classifySshBanner({ ok: true, event: 'data', data: 'HTTP/1.1 200 OK' }).status, 'invalid');
  assert.equal(classifySshBanner({ ok: true, event: 'timeout', data: '' }).status, 'timeout');
  assert.equal(classifySshBanner({ ok: true, event: 'close', data: '' }).status, 'closed');
  assert.deepEqual(classifySshBanner({ ok: false, event: 'error', errorCode: 'ENOTFOUND', data: '' }), {
    status: 'unavailable',
    protocol: '',
    reason: 'ENOTFOUND',
  });
});

test('SSH output helpers strip control bytes, host details, and unexpected errors', () => {
  assert.equal(firstSafeLine('\u0000SSH-2.0-Test\u001b[31m\nsecond'), 'SSH-2.0-Test[31m');
  assert.equal(firstSafeLine(`SSH-${'x'.repeat(100)}`).length, 80);
  assert.equal(safeProbeCliError(new Error('ssh-tcp-unreachable:ECONNREFUSED')), 'ssh-tcp-unreachable:ECONNREFUSED');
  assert.equal(safeProbeCliError(new Error('connect failed for private-host:22')), 'ssh_probe_failed');
});

test('socket probe reads a local SSH banner without exposing endpoint metadata', async (t) => {
  const server = net.createServer((socket) => socket.end('SSH-2.0-TestServer\r\nprivate detail'));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('loopback sockets are unavailable in this sandbox');
      return;
    }
    throw error;
  }
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await probeSocket({ host: '127.0.0.1', port: address.port, timeoutMs: 1_000, mode: 'read' });
  assert.equal(result.connected, true);
  assert.equal(result.ok, true);
  assert.equal(classifySshBanner(result).protocol, 'SSH-2.0-TestServer');
  assert.equal(JSON.stringify(classifySshBanner(result)).includes(String(address.port)), false);
});
