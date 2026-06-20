import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const failures = [];

const deployWorkflow = await readTextFile('.github/workflows/deploy.yml');
const ciWorkflow = await readTextFile('.github/workflows/ci.yml');
const packagingSpec = JSON.parse(await readTextFile('desktop/packaging-spec.json'));

requireIncludes(deployWorkflow, 'Validate required secrets', 'deploy workflow must validate required secrets');
requireIncludes(deployWorkflow, 'SERVER_PORT must be numeric', 'deploy workflow must validate numeric SERVER_PORT');
requireIncludes(deployWorkflow, 'SERVER_PORT must be between 1 and 65535', 'deploy workflow must validate SERVER_PORT range');
requireIncludes(deployWorkflow, 'Prepare SSH key', 'deploy workflow must prepare SSH key before preflight');
requireIncludes(deployWorkflow, 'ssh-keyscan -T 30', 'deploy workflow must scan host keys');
requireIncludes(deployWorkflow, 'SSH host key scan attempt ${attempt}/6', 'deploy workflow must retry host key scans six times');
requireIncludes(deployWorkflow, 'ssh-keyscan -4 -T 30', 'deploy workflow must include IPv4 host key scan fallback');
requireIncludes(deployWorkflow, 'if test -s ~/.ssh/known_hosts.tmp; then', 'deploy workflow must accept non-empty keyscan output even if a scan command exits non-zero');
requireIncludes(deployWorkflow, 'Remote SSH preflight', 'deploy workflow must include remote SSH preflight');
requireIncludes(deployWorkflow, 'remote-preflight-ok', 'deploy workflow must report safe preflight success');
requireIncludes(deployWorkflow, 'compose version >/dev/null', 'deploy preflight must verify docker compose availability');
requireIncludes(deployWorkflow, 'DEPLOY_PATH must be absolute', 'deploy preflight must validate DEPLOY_PATH');
requireIncludes(deployWorkflow, 'test -f "$DEPLOY_PATH/deploy/standalone/.env"', 'deploy preflight must verify existing standalone .env');
requireIncludes(deployWorkflow, 'SCP upload attempt', 'deploy workflow must retry SCP uploads');
requireIncludes(deployWorkflow, 'ROLLBACK_IMAGE="kuviewer:rollback-${GITHUB_RUN_ID}"', 'deploy workflow must define a per-run rollback image tag');
requireIncludes(deployWorkflow, 'deploy-rollback-image-ready', 'deploy workflow must preserve the previous image for rollback');
requireIncludes(deployWorkflow, 'deploy-rollback-start', 'deploy workflow must attempt rollback after failed health checks');
requireIncludes(deployWorkflow, 'deploy-rollback-ok', 'deploy workflow must report safe rollback success');
requireIncludes(deployWorkflow, 'check_health()', 'deploy workflow must use a bounded health retry function');
requireIncludes(deployWorkflow, 'deploy-health-wait', 'deploy workflow must report safe health retry markers');
requireIncludes(deployWorkflow, 'deploy-health-failed', 'deploy workflow must report safe health failure markers');
requireIncludes(deployWorkflow, '$DEPLOY_PATH/.kuviewer/deploy-state.json', 'deploy workflow must write safe deploy-state metadata');
requireIncludes(deployWorkflow, 'deploy-state-written', 'deploy workflow must report safe deploy-state writes');
requireIncludes(deployWorkflow, 'Cleanup deploy runner secrets and artifacts', 'deploy workflow must clean runner secrets and artifacts');
requireIncludes(deployWorkflow, 'if: always()', 'deploy cleanup must run even after failures');
requireIncludes(deployWorkflow, 'rm -f "${IMAGE_TAR}" ~/.ssh/deploy_key.pem ~/.ssh/known_hosts', 'deploy cleanup must remove image tar and SSH material');
requireNotIncludes(deployWorkflow, 'docker compose logs', 'deploy workflow must not dump raw compose logs');
requireNotIncludes(deployWorkflow, 'cat deploy/standalone/.env', 'deploy workflow must not print standalone env files');
requireNotIncludes(deployWorkflow, 'cat .env', 'deploy workflow must not print env files');

for (const marker of [
  'BatchMode=yes',
  'IdentitiesOnly=yes',
  'StrictHostKeyChecking=yes',
  'UserKnownHostsFile="$HOME/.ssh/known_hosts"',
  'ConnectTimeout=20',
  'ServerAliveInterval=30',
  'ServerAliveCountMax=20',
  'TCPKeepAlive=yes',
]) {
  requireIncludes(deployWorkflow, marker, `deploy workflow must include SSH option ${marker}`);
}

requireNotIncludes(deployWorkflow, 'StrictHostKeyChecking=no', 'deploy workflow must not disable strict host key checking');
requireOrder(deployWorkflow, ['Prepare SSH key', 'Remote SSH preflight', 'Build deployment image', 'Save deployment image', 'Upload image to server', 'Deploy on server']);
requireOrder(deployWorkflow, ['Deploy on server', 'Cleanup deploy runner secrets and artifacts']);

requireIncludes(ciWorkflow, 'Deploy workflow preflight check', 'CI must run deploy workflow preflight check');
requireIncludes(ciWorkflow, 'node scripts/check-deploy-workflow.mjs', 'CI must execute deploy workflow checker');

const deployWorkflowPolicy = packagingSpec.deployWorkflowPolicy || {};
requireCondition(deployWorkflowPolicy.status === 'rollback-observability-hardened', 'deployWorkflowPolicy.status must be rollback-observability-hardened');
requireCondition(deployWorkflowPolicy.workflowPath === '.github/workflows/deploy.yml', 'deployWorkflowPolicy.workflowPath must point to deploy workflow');
requireCondition(deployWorkflowPolicy.staticCheck === 'scripts/check-deploy-workflow.mjs', 'deployWorkflowPolicy.staticCheck must point to this script');
requireCondition(deployWorkflowPolicy.preflightBeforeBuild === true, 'deployWorkflowPolicy.preflightBeforeBuild must be true');
requireCondition(deployWorkflowPolicy.strictHostKeyChecking === true, 'deployWorkflowPolicy.strictHostKeyChecking must be true');
requireCondition(deployWorkflowPolicy.hostKeyScanAttempts === 6, 'deployWorkflowPolicy.hostKeyScanAttempts must be 6');
requireCondition(deployWorkflowPolicy.acceptNonEmptyKeyscanOutput === true, 'deployWorkflowPolicy.acceptNonEmptyKeyscanOutput must be true');
requireCondition(deployWorkflowPolicy.ipv4KeyscanFallback === true, 'deployWorkflowPolicy.ipv4KeyscanFallback must be true');
requireCondition(deployWorkflowPolicy.serverPortRangeValidation === true, 'deployWorkflowPolicy.serverPortRangeValidation must be true');
requireCondition(deployWorkflowPolicy.uploadRetryAttempts === 3, 'deployWorkflowPolicy.uploadRetryAttempts must be 3');
requireCondition(deployWorkflowPolicy.rollbackImageTag === 'kuviewer:rollback-${GITHUB_RUN_ID}', 'deployWorkflowPolicy.rollbackImageTag must document the per-run rollback tag');
requireCondition(deployWorkflowPolicy.healthRetryAttempts === 12, 'deployWorkflowPolicy.healthRetryAttempts must be 12');
requireCondition(deployWorkflowPolicy.safeDeployStatePath === '$DEPLOY_PATH/.kuviewer/deploy-state.json', 'deployWorkflowPolicy.safeDeployStatePath must document the safe deploy-state path');
requireCondition(deployWorkflowPolicy.rollbackOnHealthFailure === true, 'deployWorkflowPolicy.rollbackOnHealthFailure must be true');
requireCondition(deployWorkflowPolicy.rollbackFailureKeepsWorkflowFailed === true, 'deployWorkflowPolicy.rollbackFailureKeepsWorkflowFailed must be true');
requireCondition(deployWorkflowPolicy.noRawLogDump === true, 'deployWorkflowPolicy.noRawLogDump must be true');
requireCondition(deployWorkflowPolicy.runnerCleanupAlways === true, 'deployWorkflowPolicy.runnerCleanupAlways must be true');
requireCondition(deployWorkflowPolicy.noNewSecrets === true, 'deployWorkflowPolicy.noNewSecrets must be true');
requireCondition(deployWorkflowPolicy.noSecretValueLogging === true, 'deployWorkflowPolicy.noSecretValueLogging must be true');
const remoteChecks = new Set(Array.isArray(deployWorkflowPolicy.remoteCapabilityChecks) ? deployWorkflowPolicy.remoteCapabilityChecks : []);
for (const check of ['git', 'curl', 'gzip', 'docker', 'docker-compose', 'deploy-path', 'standalone-env', 'tmp-write']) {
  requireCondition(remoteChecks.has(check), `deployWorkflowPolicy.remoteCapabilityChecks must include ${check}`);
}

if (failures.length > 0) {
  console.error('deploy workflow check failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('deploy workflow check passed: .github/workflows/deploy.yml');

async function readTextFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

function requireIncludes(text, marker, message) {
  if (!text.includes(marker)) {
    failures.push(message);
  }
}

function requireCondition(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function requireNotIncludes(text, marker, message) {
  if (text.includes(marker)) {
    failures.push(message);
  }
}

function requireOrder(text, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const nextIndex = text.indexOf(marker, cursor + 1);
    if (nextIndex === -1) {
      failures.push(`deploy workflow must include ordered marker ${marker}`);
      return;
    }
    if (nextIndex <= cursor) {
      failures.push(`deploy workflow marker ${marker} must appear after previous ordered marker`);
      return;
    }
    cursor = nextIndex;
  }
}
