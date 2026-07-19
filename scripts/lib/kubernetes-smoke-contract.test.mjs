import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/smoke-kubernetes-api.sh');

test('Kubernetes smoke script keeps valid Bash and bounded local inputs', async () => {
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  const source = await readFile(scriptPath, 'utf8');
  assert.match(source, /KUVIEWER_SMOKE_NAMESPACE must be a DNS label/);
  assert.match(source, /KUVIEWER_SMOKE_BIND must be a loopback address/);
  assert.match(source, /KUVIEWER_ADMIN_TOKEN must be 16-512 characters/);
  assert.match(source, /KUVIEWER_SMOKE_TOKEN_DURATION must use a positive/);
});

test('Kubernetes smoke script keeps temporary credentials and cleanup bounded', async () => {
  const source = await readFile(scriptPath, 'utf8');
  assert.match(source, /KUVIEWER_KUBE_TOKEN_FILE="\$TOKEN_FILE"/);
  assert.doesNotMatch(source, /export KUVIEWER_KUBE_BEARER_TOKEN=/);
  assert.match(source, /curl -fsS --header "@\$AUTH_HEADER_FILE"/);
  assert.match(source, /app\.kubernetes\.io\/managed-by: kuviewer-smoke/);
  assert.match(source, /kuviewer\.io\/ephemeral: "true"/);
  assert.ok(source.indexOf('RESOURCES_APPLIED="1"') < source.indexOf('apply_rbac\n'));
  assert.ok(source.indexOf('LOG_CREATED="1"') < source.indexOf('(\n  cd "$ROOT_DIR/server"'));
  assert.match(source, /LOG_CREATED" == "1" && "\$KEEP_LOG" != "1"/);
  for (const cleanupTarget of ['clusterrolebinding', 'clusterrole', 'namespace']) {
    assert.match(source, new RegExp(`delete ${cleanupTarget} .*--ignore-not-found`));
  }
});

test('Kubernetes smoke script covers the current read-only API contracts', async () => {
  const source = await readFile(scriptPath, 'utf8');
  for (const marker of [
    '/api/capabilities',
    'X-Kuviewer-Snapshot-Cache',
    '/api/resources?limit=1',
    '/events',
    '/logs',
    'pods/log',
    'customresourcedefinitions',
    'policy/secret-values',
  ]) {
    assert.ok(source.includes(marker), `missing Kubernetes smoke contract: ${marker}`);
  }
  for (const secretField of ['data', 'stringData', 'value']) {
    assert.ok(source.includes(`has("${secretField}")`), `missing Secret field guard: ${secretField}`);
  }
});
