import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForHttpReady } from './http-ready.mjs';

test('http readiness accepts bounded HTTP URLs and retries without exposing response bodies', async () => {
  let attempts = 0;
  await waitForHttpReady('http://127.0.0.1:4174/kuviewer/#ignored', {
    timeoutMs: 1_000,
    intervalMs: 25,
    fetchImpl: async (url, init) => {
      attempts += 1;
      assert.equal(url, 'http://127.0.0.1:4174/kuviewer/');
      assert.equal(init.method, 'HEAD');
      return { ok: attempts >= 2 };
    },
  });
  assert.equal(attempts, 2);
});

test('http readiness rejects non-http URLs with bounded reason codes', async () => {
  await assert.rejects(() => waitForHttpReady('file:///private/key'), { message: 'http_ready_invalid_url' });
  await assert.rejects(() => waitForHttpReady('not a url'), { message: 'http_ready_invalid_url' });
});
