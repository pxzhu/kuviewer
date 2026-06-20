import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const failures = [];

const deployWorkflow = await readTextFile('.github/workflows/deploy.yml');
const deployPreflightWorkflow = await readTextFile('.github/workflows/deploy-preflight.yml');
const deployKnownHostsBootstrapWorkflow = await readTextFile('.github/workflows/deploy-known-hosts-bootstrap.yml');
const ciWorkflow = await readTextFile('.github/workflows/ci.yml');
const knownHostsHelper = await readTextFile('scripts/prepare-deploy-known-hosts.mjs');
const packagingSpec = JSON.parse(await readTextFile('desktop/packaging-spec.json'));

requireIncludes(deployWorkflow, 'Validate required secrets', 'deploy workflow must validate required secrets');
requireIncludes(deployWorkflow, 'SERVER_PORT must be numeric', 'deploy workflow must validate numeric SERVER_PORT');
requireIncludes(deployWorkflow, 'SERVER_PORT must be between 1 and 65535', 'deploy workflow must validate SERVER_PORT range');
requireIncludes(deployWorkflow, 'Prepare SSH key', 'deploy workflow must prepare SSH key before preflight');
requireIncludes(deployWorkflow, 'SERVER_SSH_KEY_VALUE: ${{ secrets.SERVER_SSH_KEY }}', 'deploy workflow must pass SSH key through step env to avoid multiline command echo');
requireIncludes(deployWorkflow, 'printf \'%s\\n\' "$SERVER_SSH_KEY_VALUE"', 'deploy workflow must write SSH key from step env');
requireNotIncludes(deployWorkflow, 'printf \'%s\\n\' "${{ secrets.SERVER_SSH_KEY }}"', 'deploy workflow must not interpolate multiline SSH key directly in the shell command');
requireIncludes(deployWorkflow, 'secrets.SERVER_SSH_KNOWN_HOSTS', 'deploy workflow must support optional pinned known_hosts secret');
requireIncludes(deployWorkflow, 'vars.SERVER_SSH_KNOWN_HOSTS', 'deploy workflow must support optional pinned known_hosts repository variable');
requireIncludes(deployWorkflow, 'ssh-tcp-reachable', 'deploy workflow must report safe SSH TCP reachability');
requireIncludes(deployWorkflow, 'ssh-tcp-unreachable; verify SERVER_FHOST/SERVER_PORT firewall and SSH service', 'deploy workflow must fail fast on SSH TCP reachability errors');
requireIncludes(deployWorkflow, ':</dev/tcp/"$0"/"$1"', 'deploy workflow must use a TCP socket probe before keyscan');
requireIncludes(deployWorkflow, 'ssh-banner-received', 'deploy workflow must report safe SSH banner success');
requireIncludes(deployWorkflow, 'ssh-banner-timeout; TCP opened but SSH banner was not received', 'deploy workflow must fail fast when TCP opens but SSH banner is unavailable');
requireIncludes(deployWorkflow, 'case "$banner" in SSH-*)', 'deploy workflow must verify SSH banner before keyscan');
requireIncludes(deployWorkflow, 'SERVER_SSH_KNOWN_HOSTS variable present', 'deploy workflow must report known_hosts variable presence safely');
requireIncludes(deployWorkflow, 'KNOWN_HOSTS_PIN="${{ secrets.SERVER_SSH_KNOWN_HOSTS || vars.SERVER_SSH_KNOWN_HOSTS }}"', 'deploy workflow must prefer known_hosts secret and fall back to variable');
requireIncludes(deployWorkflow, 'Using pinned SSH known_hosts input', 'deploy workflow must report pinned known_hosts use without printing values');
requireIncludes(deployWorkflow, 'ssh-keyscan -T 10 -t "${key_type}"', 'deploy workflow must scan host keys by key type');
requireIncludes(deployWorkflow, 'SSH host key scan attempt ${attempt}/6', 'deploy workflow must retry host key scans six times');
requireIncludes(deployWorkflow, 'for key_type in ed25519 ecdsa rsa', 'deploy workflow must scan key types sequentially');
requireIncludes(deployWorkflow, 'ssh-keyscan -4 -T 10 -t "${key_type}"', 'deploy workflow must include IPv4 host key scan fallback');
requireIncludes(deployWorkflow, 'if test -s ~/.ssh/known_hosts.tmp; then', 'deploy workflow must accept non-empty keyscan output even if a scan command exits non-zero');
requireIncludes(deployWorkflow, 'SSH host key scan failed; set SERVER_SSH_KNOWN_HOSTS or verify SERVER_FHOST/SERVER_PORT reachability', 'deploy workflow must explain keyscan failures safely');
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

requireIncludes(deployPreflightWorkflow, 'name: deploy-preflight', 'deploy preflight workflow must be named deploy-preflight');
requireIncludes(deployPreflightWorkflow, 'workflow_dispatch:', 'deploy preflight workflow must be manual-only');
requireIncludes(deployPreflightWorkflow, 'deploy-preflight-only', 'deploy preflight workflow must report preflight-only scope');
requireIncludes(deployPreflightWorkflow, 'no image build, upload, compose rollout, or rollback will run', 'deploy preflight workflow must document no deploy side effects');
requireIncludes(deployPreflightWorkflow, 'SERVER_SSH_KNOWN_HOSTS secret present', 'deploy preflight workflow must report known_hosts secret presence safely');
requireIncludes(deployPreflightWorkflow, 'SERVER_SSH_KNOWN_HOSTS variable present', 'deploy preflight workflow must report known_hosts variable presence safely');
requireIncludes(deployPreflightWorkflow, 'SERVER_SSH_KNOWN_HOSTS not set; keyscan fallback will be used', 'deploy preflight workflow must report known_hosts fallback safely');
requireIncludes(deployPreflightWorkflow, 'ssh-tcp-reachable', 'deploy preflight workflow must report safe SSH TCP reachability');
requireIncludes(deployPreflightWorkflow, 'SERVER_SSH_KEY_VALUE: ${{ secrets.SERVER_SSH_KEY }}', 'deploy preflight workflow must pass SSH key through step env to avoid multiline command echo');
requireIncludes(deployPreflightWorkflow, 'printf \'%s\\n\' "$SERVER_SSH_KEY_VALUE"', 'deploy preflight workflow must write SSH key from step env');
requireNotIncludes(deployPreflightWorkflow, 'printf \'%s\\n\' "${{ secrets.SERVER_SSH_KEY }}"', 'deploy preflight workflow must not interpolate multiline SSH key directly in the shell command');
requireIncludes(deployPreflightWorkflow, 'ssh-tcp-unreachable; verify SERVER_FHOST/SERVER_PORT firewall and SSH service', 'deploy preflight workflow must fail fast on SSH TCP reachability errors');
requireIncludes(deployPreflightWorkflow, ':</dev/tcp/"$0"/"$1"', 'deploy preflight workflow must use a TCP socket probe before keyscan');
requireIncludes(deployPreflightWorkflow, 'ssh-banner-received', 'deploy preflight workflow must report safe SSH banner success');
requireIncludes(deployPreflightWorkflow, 'ssh-banner-timeout; TCP opened but SSH banner was not received', 'deploy preflight workflow must fail fast when TCP opens but SSH banner is unavailable');
requireIncludes(deployPreflightWorkflow, 'case "$banner" in SSH-*)', 'deploy preflight workflow must verify SSH banner before keyscan');
requireIncludes(deployPreflightWorkflow, 'KNOWN_HOSTS_PIN="${{ secrets.SERVER_SSH_KNOWN_HOSTS || vars.SERVER_SSH_KNOWN_HOSTS }}"', 'deploy preflight workflow must prefer known_hosts secret and fall back to variable');
requireIncludes(deployPreflightWorkflow, 'Using pinned SSH known_hosts input', 'deploy preflight workflow must use pinned known_hosts when present');
requireIncludes(deployPreflightWorkflow, 'SSH host key scan failed; set SERVER_SSH_KNOWN_HOSTS or verify SERVER_FHOST/SERVER_PORT reachability', 'deploy preflight workflow must explain keyscan failures safely');
requireIncludes(deployPreflightWorkflow, 'Remote SSH preflight', 'deploy preflight workflow must verify remote SSH prerequisites');
requireIncludes(deployPreflightWorkflow, 'remote-preflight-ok', 'deploy preflight workflow must report safe remote preflight success');
requireIncludes(deployPreflightWorkflow, 'Cleanup deploy preflight secrets', 'deploy preflight workflow must clean runner SSH material');
requireNotIncludes(deployPreflightWorkflow, 'docker build', 'deploy preflight workflow must not build images');
requireNotIncludes(deployPreflightWorkflow, 'docker save', 'deploy preflight workflow must not save images');
requireNotIncludes(deployPreflightWorkflow, 'scp ', 'deploy preflight workflow must not upload files');
requireNotIncludes(deployPreflightWorkflow, 'Deploy on server', 'deploy preflight workflow must not deploy on server');
requireNotIncludes(deployPreflightWorkflow, 'compose --env-file', 'deploy preflight workflow must not run compose rollout');
requireNotIncludes(deployPreflightWorkflow, 'docker compose logs', 'deploy preflight workflow must not dump raw compose logs');
requireNotIncludes(deployPreflightWorkflow, 'StrictHostKeyChecking=no', 'deploy preflight workflow must not disable strict host key checking');

requireIncludes(deployKnownHostsBootstrapWorkflow, 'name: deploy-known-hosts-bootstrap', 'known_hosts bootstrap workflow must be named deploy-known-hosts-bootstrap');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'workflow_dispatch:', 'known_hosts bootstrap workflow must be manual-only');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'I_UNDERSTAND_TOFU', 'known_hosts bootstrap workflow must require explicit TOFU acknowledgement');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'actions: write', 'known_hosts bootstrap workflow must be able to store repository variable');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'deploy-known-hosts-bootstrap-only', 'known_hosts bootstrap workflow must report bootstrap-only scope');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'no image build, upload, compose rollout, rollback, or server mutation will run', 'known_hosts bootstrap workflow must document no deploy side effects');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'SERVER_PORT must be numeric', 'known_hosts bootstrap workflow must validate SERVER_PORT');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'SERVER_SSH_KEY_VALUE: ${{ secrets.SERVER_SSH_KEY }}', 'known_hosts bootstrap workflow must pass SSH key through step env to avoid multiline command echo');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'printf \'%s\\n\' "$SERVER_SSH_KEY_VALUE"', 'known_hosts bootstrap workflow must write SSH key from step env');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'printf \'%s\\n\' "${{ secrets.SERVER_SSH_KEY }}"', 'known_hosts bootstrap workflow must not interpolate multiline SSH key directly in the shell command');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'ssh-tcp-reachable', 'known_hosts bootstrap workflow must probe SSH TCP reachability');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'ssh-banner-received', 'known_hosts bootstrap workflow must report safe SSH banner success');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'ssh-banner-timeout; TCP opened but SSH banner was not received', 'known_hosts bootstrap workflow must fail fast when TCP opens but SSH banner is unavailable');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'case "$banner" in SSH-*)', 'known_hosts bootstrap workflow must verify SSH banner before key capture');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'ssh-keyscan -4 -T 10 -t "${key_type}"', 'known_hosts bootstrap workflow must try IPv4 ssh-keyscan first');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'ssh-keyscan -T 10 -t "${key_type}"', 'known_hosts bootstrap workflow must try normal ssh-keyscan fallback');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'StrictHostKeyChecking=accept-new', 'known_hosts bootstrap workflow must keep TOFU fallback explicit and scoped');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'gh variable set "$KNOWN_HOSTS_VARIABLE" < ~/.ssh/known_hosts', 'known_hosts bootstrap workflow must store repository variable without printing key body');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'updated repository variable: $KNOWN_HOSTS_VARIABLE', 'known_hosts bootstrap workflow must report variable update safely');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'known-hosts-ready', 'known_hosts bootstrap workflow must report safe capture success');
requireIncludes(deployKnownHostsBootstrapWorkflow, 'Cleanup bootstrap SSH material', 'known_hosts bootstrap workflow must clean runner SSH material');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'docker build', 'known_hosts bootstrap workflow must not build images');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'docker save', 'known_hosts bootstrap workflow must not save images');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'scp ', 'known_hosts bootstrap workflow must not upload files');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'compose --env-file', 'known_hosts bootstrap workflow must not run compose');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'cat ~/.ssh/known_hosts', 'known_hosts bootstrap workflow must not print known_hosts body');
requireNotIncludes(deployKnownHostsBootstrapWorkflow, 'StrictHostKeyChecking=no', 'known_hosts bootstrap workflow must not disable strict host key checking');

requireIncludes(knownHostsHelper, 'SERVER_SSH_KNOWN_HOSTS', 'known_hosts helper must target SERVER_SSH_KNOWN_HOSTS');
requireIncludes(knownHostsHelper, 'ssh-keyscan', 'known_hosts helper must generate host keys with ssh-keyscan');
requireIncludes(knownHostsHelper, '--from-file', 'known_hosts helper must support validating an existing file');
requireIncludes(knownHostsHelper, '--from-public-key', 'known_hosts helper must support rendering known_hosts from server public host keys');
requireIncludes(knownHostsHelper, '--set-secret', 'known_hosts helper must support optional gh secret set');
requireIncludes(knownHostsHelper, '--set-variable', 'known_hosts helper must support optional gh variable set');
requireIncludes(knownHostsHelper, 'gh variable set', 'known_hosts helper must describe storing public host keys as a variable');
requireIncludes(knownHostsHelper, 'known_hosts content must not contain private key material', 'known_hosts helper must reject private key material');
requireIncludes(knownHostsHelper, 'public host key input must not contain private key material', 'known_hosts helper must reject private key material in public key mode');
requireIncludes(knownHostsHelper, 'renderKnownHostsFromPublicKeys', 'known_hosts helper must render public host key files into known_hosts lines');
requireIncludes(knownHostsHelper, 'console.log(`known_hosts entries:', 'known_hosts helper must print safe summary counts');
requireNotIncludes(knownHostsHelper, 'console.log(knownHosts', 'known_hosts helper must not print known_hosts body');

const deployWorkflowPolicy = packagingSpec.deployWorkflowPolicy || {};
requireCondition(deployWorkflowPolicy.status === 'rollback-observability-hardened', 'deployWorkflowPolicy.status must be rollback-observability-hardened');
requireCondition(deployWorkflowPolicy.workflowPath === '.github/workflows/deploy.yml', 'deployWorkflowPolicy.workflowPath must point to deploy workflow');
requireCondition(deployWorkflowPolicy.preflightWorkflowPath === '.github/workflows/deploy-preflight.yml', 'deployWorkflowPolicy.preflightWorkflowPath must point to preflight workflow');
requireCondition(deployWorkflowPolicy.knownHostsBootstrapWorkflowPath === '.github/workflows/deploy-known-hosts-bootstrap.yml', 'deployWorkflowPolicy.knownHostsBootstrapWorkflowPath must point to known_hosts bootstrap workflow');
requireCondition(deployWorkflowPolicy.staticCheck === 'scripts/check-deploy-workflow.mjs', 'deployWorkflowPolicy.staticCheck must point to this script');
requireCondition(deployWorkflowPolicy.preflightBeforeBuild === true, 'deployWorkflowPolicy.preflightBeforeBuild must be true');
requireCondition(deployWorkflowPolicy.strictHostKeyChecking === true, 'deployWorkflowPolicy.strictHostKeyChecking must be true');
requireCondition(deployWorkflowPolicy.optionalPinnedKnownHostsSecret === 'SERVER_SSH_KNOWN_HOSTS', 'deployWorkflowPolicy.optionalPinnedKnownHostsSecret must document SERVER_SSH_KNOWN_HOSTS');
requireCondition(deployWorkflowPolicy.optionalPinnedKnownHostsVariable === 'SERVER_SSH_KNOWN_HOSTS', 'deployWorkflowPolicy.optionalPinnedKnownHostsVariable must document SERVER_SSH_KNOWN_HOSTS');
requireCondition(deployWorkflowPolicy.knownHostsHelper === 'scripts/prepare-deploy-known-hosts.mjs', 'deployWorkflowPolicy.knownHostsHelper must document helper script');
requireCondition(deployWorkflowPolicy.knownHostsHelperSupportsPublicKeyFiles === true, 'deployWorkflowPolicy.knownHostsHelperSupportsPublicKeyFiles must be true');
requireCondition(deployWorkflowPolicy.sshTcpReachabilityProbe === true, 'deployWorkflowPolicy.sshTcpReachabilityProbe must be true');
requireCondition(deployWorkflowPolicy.sshBannerProbe === true, 'deployWorkflowPolicy.sshBannerProbe must be true');
requireCondition(deployWorkflowPolicy.hostKeyScanAttempts === 6, 'deployWorkflowPolicy.hostKeyScanAttempts must be 6');
requireCondition(deployWorkflowPolicy.keyscanTimeoutSeconds === 10, 'deployWorkflowPolicy.keyscanTimeoutSeconds must be 10');
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
requireCondition(deployWorkflowPolicy.noNewRequiredSecrets === true, 'deployWorkflowPolicy.noNewRequiredSecrets must be true');
requireCondition(deployWorkflowPolicy.optionalPinnedKnownHostsOnly === true, 'deployWorkflowPolicy.optionalPinnedKnownHostsOnly must be true');
requireCondition(deployWorkflowPolicy.noSecretValueLogging === true, 'deployWorkflowPolicy.noSecretValueLogging must be true');
requireCondition(deployWorkflowPolicy.sshKeyViaStepEnv === true, 'deployWorkflowPolicy.sshKeyViaStepEnv must be true');
requireCondition(deployWorkflowPolicy.knownHostsBootstrapManualOnly === true, 'deployWorkflowPolicy.knownHostsBootstrapManualOnly must be true');
requireCondition(deployWorkflowPolicy.knownHostsBootstrapTofuRequiresAcknowledgement === true, 'deployWorkflowPolicy.knownHostsBootstrapTofuRequiresAcknowledgement must be true');
const keyscanTypes = new Set(Array.isArray(deployWorkflowPolicy.keyscanTypes) ? deployWorkflowPolicy.keyscanTypes : []);
for (const keyType of ['ed25519', 'ecdsa', 'rsa']) {
  requireCondition(keyscanTypes.has(keyType), `deployWorkflowPolicy.keyscanTypes must include ${keyType}`);
}
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
