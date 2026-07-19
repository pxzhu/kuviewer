import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
const deploy = await read('.github/workflows/deploy.yml');
const preflight = await read('.github/workflows/deploy-preflight.yml');
const knownHostsBootstrap = await read('.github/workflows/deploy-known-hosts-bootstrap.yml');
const endpointDiagnostics = await read('.github/workflows/deploy-ssh-endpoint-diagnostics.yml');
const selfHosted = await read('.github/workflows/deploy-self-hosted.yml');
const ci = await read('.github/workflows/ci.yml');
const compose = await read('deploy/standalone/docker-compose.yml');
const envExample = await read('deploy/standalone/.env.example');
const deployPolicy = JSON.parse(await read('deploy/deploy-policy.json'));

function requireIncludes(source, value, message) {
  if (!source.includes(value)) failures.push(message);
}

function requireNotIncludes(source, value, message) {
  if (source.includes(value)) failures.push(message);
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function requireOrder(source, markers) {
  let position = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, position + 1);
    if (next < 0 || next < position) {
      failures.push(`deploy workflow marker order is invalid: ${marker}`);
      return;
    }
    position = next;
  }
}

requireIncludes(deploy, '- "v[0-9]+.[0-9]+.[0-9]+"', 'deploy must run on semantic release tags');
requireNotIncludes(deploy, 'workflow_dispatch:', 'production deploy must not accept arbitrary manual refs');
requireNotIncludes(deploy, 'branches:', 'production deploy must not run on branch pushes');
requireIncludes(deploy, 'runs-on: ubuntu-latest', 'release build must use a GitHub-hosted runner');
requireIncludes(deploy, 'git merge-base --is-ancestor "$GITHUB_SHA" origin/main', 'release tag must belong to main');

for (const secret of ['NCR_REGISTRY', 'NCR_USERNAME', 'NCR_PASSWORD']) {
  requireIncludes(deploy, `secrets.${secret}`, `deploy must use ${secret}`);
}
requireIncludes(deploy, 'docker/login-action@v4', 'runner must authenticate to NasCR');
requireIncludes(deploy, 'docker/build-push-action@v7', 'runner must build the release image');
requireIncludes(deploy, '${{ secrets.NCR_REGISTRY }}/${{ env.IMAGE_NAME }}:latest', 'release must publish latest');
requireIncludes(deploy, '${{ secrets.NCR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.ref_name }}', 'release must publish the version tag');
requireIncludes(deploy, 'push: true', 'Buildx must push both release tags directly');
requireNotIncludes(deploy, 'load: true', 'release image must not be loaded into host Docker');
requireNotIncludes(deploy, 'push: false', 'release build must not defer registry upload');
requireNotIncludes(deploy, 'docker push "${IMAGE}:latest"', 'release must not repeat latest push with host Docker');
requireNotIncludes(deploy, 'docker push "${IMAGE}:${GITHUB_REF_NAME}"', 'release must not repeat version push with host Docker');
requireIncludes(deploy, 'TARGET_IMAGE=', 'server deploy must identify the immutable NasCR image');
requireIncludes(deploy, '"${DOCKER[@]}" pull "$TARGET_IMAGE"', 'server must pull the NasCR image');
requireNotIncludes(deploy, 'docker save', 'release must not create an image archive');
requireNotIncludes(deploy, 'IMAGE_TAR', 'release must not use image tar transfer');
requireNotIncludes(deploy, 'remote-build-fallback', 'server must not rebuild the image');

requireIncludes(deploy, 'SERVER_PORT must be numeric', 'deploy must validate numeric server port');
requireIncludes(deploy, 'SERVER_PORT must be between 1 and 65535', 'deploy must validate server port range');
requireIncludes(deploy, 'SERVER_SSH_KEY_VALUE: ${{ secrets.SERVER_SSH_KEY }}', 'SSH key must be passed through step env');
requireNotIncludes(deploy, 'printf \'%s\\n\' "${{ secrets.SERVER_SSH_KEY }}"', 'SSH key must not be interpolated directly');
requireIncludes(deploy, 'ssh-tcp-reachable', 'deploy must probe SSH TCP reachability');
requireIncludes(deploy, 'ssh-banner-received', 'deploy must verify the SSH banner');
requireIncludes(deploy, 'secrets.SERVER_SSH_KNOWN_HOSTS', 'deploy must support a pinned known_hosts secret');
requireIncludes(deploy, 'vars.SERVER_SSH_KNOWN_HOSTS', 'deploy must support a pinned known_hosts variable');
requireIncludes(deploy, 'SSH host key scan attempt ${attempt}/6', 'host key scan must be bounded and retried');
requireIncludes(deploy, 'for key_type in ed25519 ecdsa rsa', 'host key types must be scanned explicitly');
for (const option of ['BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=20', 'TCPKeepAlive=yes']) {
  requireIncludes(deploy, option, `deploy must use SSH option ${option}`);
}
requireNotIncludes(deploy, 'StrictHostKeyChecking=no', 'strict host checking must never be disabled');
requireIncludes(deploy, 'Remote SSH preflight', 'remote prerequisites must be checked before rollout');
requireIncludes(deploy, 'remote-preflight-ok', 'remote preflight must emit a safe marker');
requireIncludes(deploy, 'DEPLOY_PATH must be absolute', 'remote deploy path must be absolute');
requireIncludes(deploy, 'test -f "$DEPLOY_PATH/deploy/standalone/.env"', 'existing deployment env must be preserved');

requireIncludes(deploy, 'ROLLBACK_IMAGE="kuviewer:rollback-${GITHUB_RUN_ID}"', 'deploy must retain a per-run rollback image');
requireIncludes(deploy, 'deploy-rollback-image-ready', 'deploy must preserve the previous image');
requireIncludes(deploy, 'deploy-rollback-start', 'failed health checks must trigger rollback');
requireIncludes(deploy, 'deploy-rollback-ok', 'successful rollback must be reported');
requireIncludes(deploy, 'deploy-health-wait', 'health retries must be visible');
requireIncludes(deploy, 'deploy-health-failed', 'health failure must be visible');
requireIncludes(deploy, 'if: always()', 'runner cleanup must run after failures');
requireIncludes(deploy, 'rm -f ~/.ssh/deploy_key.pem', 'runner SSH material must be removed');
requireNotIncludes(deploy, 'docker compose logs', 'deploy must not dump raw logs');
requireNotIncludes(deploy, 'cat deploy/standalone/.env', 'deploy must not print deployment secrets');

requireOrder(deploy, ['Validate required secrets', 'Build release image', 'Prepare SSH key', 'Remote SSH preflight', 'Authenticate deployment host to NasCR', 'Pull from NasCR and deploy', 'Cleanup SSH material']);
requireIncludes(ci, 'node scripts/check-deploy-workflow.mjs', 'CI must execute this deploy contract');
requireIncludes(ci, '  pull_request:', 'CI must validate pull requests');
requireIncludes(ci, '  workflow_dispatch:', 'CI must retain an explicit manual fallback');
requireNotIncludes(ci, '\n  push:', 'CI must not repeat validation after a protected main merge');
requireIncludes(ci, '  validate:', 'CI required check must remain named validate');

requireIncludes(compose, 'image: ${KUVIEWER_IMAGE:-kuviewer:local}', 'compose must accept an explicit release image');
requireIncludes(envExample, 'KUVIEWER_IMAGE=registry.example.com/kuviewer:latest', 'env example must use a neutral registry host');

for (const [source, name] of [[preflight, 'deploy-preflight'], [knownHostsBootstrap, 'deploy-known-hosts-bootstrap'], [endpointDiagnostics, 'deploy-ssh-endpoint-diagnostics'], [selfHosted, 'deploy-self-hosted']]) {
  requireIncludes(source, 'workflow_dispatch:', `${name} must remain manual-only`);
}
requireNotIncludes(preflight, 'docker build', 'manual preflight must not build images');
requireNotIncludes(endpointDiagnostics, 'SERVER_SSH_KEY', 'endpoint diagnostics must not use private keys');
requireIncludes(selfHosted, 'runs-on: [self-hosted, kuviewer-deploy]', 'manual self-hosted fallback must retain its dedicated label');

const policy = deployPolicy.deployWorkflowPolicy || {};
requireCondition(policy.status === 'nascr-release-pull', 'deploy policy status must be nascr-release-pull');
requireCondition(policy.tagOnly === true, 'deploy policy must be tag-only');
requireCondition(policy.serverPullsReleaseImage === true, 'deploy policy must require server registry pull');
requireCondition(policy.noImageArchiveUpload === true, 'deploy policy must forbid image archive upload');
requireCondition(policy.noRemoteBuildFallback === true, 'deploy policy must forbid remote image builds');
for (const name of ['NCR_REGISTRY', 'NCR_USERNAME', 'NCR_PASSWORD']) {
  requireCondition(policy.registrySecretNames?.includes(name), `deploy policy must list ${name}`);
}
requireCondition(policy.rollbackOnHealthFailure === true, 'deploy policy must retain rollback');
requireCondition(policy.healthRetryAttempts === 12, 'deploy policy must document 12 health attempts');
requireCondition(policy.strictHostKeyChecking === true, 'deploy policy must require strict host checking');

const ciPolicy = deployPolicy.ciWorkflowPolicy || {};
requireCondition(ciPolicy.pullRequest === true, 'CI policy must require pull request validation');
requireCondition(ciPolicy.manualDispatch === true, 'CI policy must retain manual dispatch');
requireCondition(ciPolicy.mainPush === false, 'CI policy must disable duplicate main push validation');
requireCondition(ciPolicy.requiredCheck === 'validate', 'CI policy must keep the validate required check name');

if (failures.length) {
  console.error('deploy workflow check failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('deploy workflow check passed: NasCR release pull');
