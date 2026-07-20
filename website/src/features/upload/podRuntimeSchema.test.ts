import assert from 'node:assert/strict';
import test from 'node:test';
import type { KubeObject } from './kubernetesObject.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';
import { uploadPodRuntimeIsValid, uploadPodRuntimeStatus, uploadPodRuntimeSummary } from './podRuntimeSchema.ts';

test('upload Pod runtime summary keeps safe bounded state, reason, restart, and image metadata', () => {
  const pod = validPod();
  assert.equal(uploadPodRuntimeIsValid(pod), true);
  assert.equal(uploadPodRuntimeStatus(pod), 'warning');
  assert.deepEqual(uploadPodRuntimeSummary(pod), {
    phase: 'Running',
    ready: '1/2',
    restarts: 6,
    runtimeStates: ['running:2', 'waiting:1', 'terminated:1'],
    runtimeReasonCount: 3,
    runtimeReasons: ['last:Error', 'terminated:Completed', 'waiting:CrashLoopBackOff'],
    runtimeImageCount: 4,
    runtimeImages: [
      'registry.example.com/api:v1',
      'registry.example.com/debug:v1',
      'registry.example.com/migrate:v1',
      'registry.example.com/sidecar:v1',
    ],
  });
  assert.doesNotMatch(JSON.stringify(uploadPodRuntimeSummary(pod)), /must-not-survive|imageID|containerID|message/);
});

test('upload Pod runtime status requires running and ready regular containers', () => {
  const pod: KubeObject = {
    kind: 'Pod',
    status: {
      phase: 'Running',
      containerStatuses: [{ name: 'api', ready: true, restartCount: 0, image: 'api:v1', state: { running: {} } }],
    },
  };
  assert.equal(uploadPodRuntimeStatus(pod), 'healthy');
  pod.status = { phase: 'Running', containerStatuses: [{ name: 'api', ready: true, restartCount: 0, state: { terminated: { exitCode: 0, reason: 'Completed' } } }] };
  assert.equal(uploadPodRuntimeStatus(pod), 'warning');
  assert.equal(uploadPodRuntimeStatus({ kind: 'Pod', status: { phase: 'Succeeded' } }), 'healthy');
  assert.equal(uploadPodRuntimeStatus({ kind: 'Pod', status: { phase: 'Failed' } }), 'error');
  assert.equal(uploadPodRuntimeStatus({ kind: 'Pod' }), 'unknown');
});

test('upload Pod runtime schema rejects malformed remote status fail closed', () => {
  const validStatus = { name: 'api', ready: true, restartCount: 0, image: 'secret:v1', state: { running: {} } };
  const malformed: KubeObject[] = [
    { kind: 'Pod', status: { phase: 'Injected', containerStatuses: [validStatus] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [{ ...validStatus, name: 'bad name' }] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [validStatus, validStatus] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [{ ...validStatus, restartCount: -1 }] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [{ ...validStatus, image: 'image:v1?token=fixture' }] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [{ ...validStatus, state: { running: {}, waiting: { reason: 'Starting' } } }] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [{ ...validStatus, state: { waiting: { reason: 'password=fixture' } } }] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: [{ ...validStatus, state: { terminated: { reason: 'Error' } } }] } },
    { kind: 'Pod', status: { phase: 'Running', containerStatuses: Array.from({ length: 65 }, (_, index) => ({ ...validStatus, name: `api-${index}` })) } },
    {
      kind: 'Pod',
      status: {
        phase: 'Running',
        containerStatuses: Array.from({ length: 33 }, (_, index) => ({ ...validStatus, name: `app-${index}` })),
        initContainerStatuses: Array.from({ length: 32 }, (_, index) => ({ ...validStatus, name: `init-${index}` })),
      },
    },
  ];
  malformed.forEach((pod, index) => {
    assert.equal(uploadPodRuntimeIsValid(pod), false, `valid ${index}`);
    assert.equal(uploadPodRuntimeStatus(pod), 'warning', `status ${index}`);
    const summary = uploadPodRuntimeSummary(pod);
    assert.equal(summary.ready, 'invalid', `summary ${index}`);
    assert.doesNotMatch(JSON.stringify(summary), /fixture/, `leak ${index}`);
  });
});

test('upload topology exposes safe Pod runtime summary without raw runtime detail', async () => {
  const manifest = `
apiVersion: v1
kind: Pod
metadata:
  name: valid
  namespace: app
spec:
  containers:
    - name: api
      image: api:v1
status:
  phase: Running
  containerStatuses:
    - name: api
      ready: true
      restartCount: 1
      image: api:v1
      imageID: docker-pullable://must-not-survive
      containerID: containerd://must-not-survive
      state:
        running: {}
---
apiVersion: v1
kind: Pod
metadata:
  name: invalid
  namespace: app
spec:
  containers:
    - name: api
      image: api:v1
status:
  phase: Running
  containerStatuses:
    - name: api
      ready: false
      restartCount: 0
      image: api:v1?credential=fixture
      state:
        waiting:
          reason: token=fixture
          message: must-not-survive
`;
  const file = { name: 'pods.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const valid = result.snapshot.nodes.find((node) => node.kind === 'Pod' && node.name === 'valid');
  const invalid = result.snapshot.nodes.find((node) => node.kind === 'Pod' && node.name === 'invalid');
  assert.equal(valid?.status, 'healthy');
  assert.equal(valid?.summary.ready, '1/1');
  assert.equal(valid?.summary.runtimeImageCount, 1);
  assert.equal(invalid?.status, 'warning');
  assert.equal(invalid?.summary.ready, 'invalid');
  assert.doesNotMatch(JSON.stringify(result.snapshot), /fixture|must-not-survive/);
});

function validPod(): KubeObject {
  return {
    kind: 'Pod',
    metadata: { name: 'api', namespace: 'app' },
    status: {
      phase: 'Running',
      containerStatuses: [
        {
          name: 'api',
          ready: true,
          restartCount: 2,
          image: 'registry.example.com/api:v1',
          imageID: 'docker-pullable://must-not-survive',
          containerID: 'containerd://must-not-survive',
          state: { running: { startedAt: '2026-01-01T00:00:00Z' } },
          lastState: { terminated: { exitCode: 1, reason: 'Error', message: 'must-not-survive' } },
        },
        {
          name: 'sidecar',
          ready: false,
          restartCount: 4,
          image: 'registry.example.com/sidecar:v1',
          state: { waiting: { reason: 'CrashLoopBackOff', message: 'must-not-survive' } },
        },
      ],
      initContainerStatuses: [{ name: 'migrate', ready: true, restartCount: 0, image: 'registry.example.com/migrate:v1', state: { terminated: { exitCode: 0, reason: 'Completed' } } }],
      ephemeralContainerStatuses: [{ name: 'debug', ready: false, restartCount: 0, image: 'registry.example.com/debug:v1', state: { running: {} } }],
    },
  };
}
