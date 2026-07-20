import assert from 'node:assert/strict';
import test from 'node:test';
import type { KubeObject } from './kubernetesObject.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';
import {
  uploadWorkloadReferences,
  uploadWorkloadStatus,
  uploadWorkloadSummary,
  uploadWorkloadTemplateIsValid,
} from './workloadSchema.ts';

test('upload workload schema keeps bounded images and safe references', () => {
  const deployment = validDeployment();
  assert.equal(uploadWorkloadTemplateIsValid('Deployment', deployment), true);
  assert.equal(uploadWorkloadStatus('Deployment', deployment), 'healthy');
  assert.deepEqual(uploadWorkloadSummary('Deployment', deployment), {
    replicas: '2/2',
    availableReplicas: 2,
    containers: 1,
    initContainers: 1,
    imageCount: 2,
    images: [
      'registry.example.com/team/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'registry.example.com/team/migrate:v2',
    ],
  });
  assert.deepEqual(uploadWorkloadReferences('Deployment', deployment).map(({ kind, name, edgeType }) => ({ kind, name, edgeType })), [
    { kind: 'ServiceAccount', name: 'runtime', edgeType: 'uses-service-account' },
    { kind: 'Secret', name: 'registry', edgeType: 'env-from' },
    { kind: 'PersistentVolumeClaim', name: 'cache', edgeType: 'mounts' },
    { kind: 'ConfigMap', name: 'runtime-config', edgeType: 'env-from' },
    { kind: 'Secret', name: 'runtime-secret', edgeType: 'env-from' },
  ]);
  assert.doesNotMatch(JSON.stringify(uploadWorkloadSummary('Deployment', deployment)), /must-not-survive|password/);
});

test('upload workload schema resolves every controller Pod template path', () => {
  const podTemplate = { spec: { containers: [{ name: 'worker', image: 'worker:v1' }] } };
  const fixtures: Array<['Deployment' | 'ReplicaSet' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'CronJob', KubeObject]> = [
    ['Deployment', { kind: 'Deployment', spec: { template: podTemplate }, status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 } }],
    ['ReplicaSet', { kind: 'ReplicaSet', spec: { template: podTemplate }, status: { replicas: 1, readyReplicas: 1 } }],
    ['StatefulSet', { kind: 'StatefulSet', spec: { template: podTemplate }, status: { replicas: 1, readyReplicas: 1 } }],
    ['DaemonSet', { kind: 'DaemonSet', spec: { template: podTemplate }, status: { desiredNumberScheduled: 1, numberReady: 1 } }],
    ['Job', { kind: 'Job', spec: { completions: 1, template: podTemplate }, status: { succeeded: 1 } }],
    ['CronJob', { kind: 'CronJob', spec: { schedule: '0 * * * *', jobTemplate: { spec: { template: podTemplate } } }, status: { active: [] } }],
  ];
  fixtures.forEach(([kind, object]) => {
    assert.equal(uploadWorkloadTemplateIsValid(kind, object), true, kind);
    assert.equal(uploadWorkloadStatus(kind, object), 'healthy', kind);
    assert.equal(uploadWorkloadSummary(kind, object).imageCount, 1, kind);
  });
});

test('upload workload schema rejects malformed image, reference, count, and schedule boundaries', () => {
  assert.equal(uploadWorkloadTemplateIsValid('Deployment', workloadWithContainer({ name: 'api', image: 'secret:v1' })), true);
  const invalidTemplates: KubeObject[] = [
    { ...validDeployment(), spec: { template: { spec: { containers: [] } } } },
    workloadWithContainer({ name: 'api', image: 'https://registry.example.com/api:v1' }),
    workloadWithContainer({ name: 'api', image: 'registry.example.com/api:v1?token=fixture' }),
    workloadWithContainer({ name: 'api', image: 'image:v1', envFrom: [{ secretRef: { name: 'bad name' } }] }),
    workloadWithContainer({ name: 'api', image: 'image:v1' }, { imagePullSecrets: [{ name: 'bad name' }] }),
  ];
  invalidTemplates.forEach((deployment, index) => {
    assert.equal(uploadWorkloadTemplateIsValid('Deployment', deployment), false, `template ${index}`);
    assert.equal(uploadWorkloadStatus('Deployment', deployment), 'warning', `status ${index}`);
    assert.equal(uploadWorkloadSummary('Deployment', deployment).imageCount, 'invalid', `summary ${index}`);
    assert.deepEqual(uploadWorkloadReferences('Deployment', deployment), [], `references ${index}`);
  });

  const negative = validDeployment();
  negative.spec = { ...negative.spec, replicas: -1 };
  assert.equal(uploadWorkloadStatus('Deployment', negative), 'warning');
  assert.equal(uploadWorkloadSummary('Deployment', negative).replicas, 'invalid');

  const daemonSet: KubeObject = {
    kind: 'DaemonSet',
    spec: { template: { spec: { containers: [{ name: 'agent', image: 'agent:v1' }] } } },
    status: { desiredNumberScheduled: 1, numberReady: 2 },
  };
  assert.equal(uploadWorkloadStatus('DaemonSet', daemonSet), 'warning');
  assert.equal(uploadWorkloadSummary('DaemonSet', daemonSet).ready, 'invalid');

  const cronJob: KubeObject = {
    kind: 'CronJob',
    metadata: { name: 'task', namespace: 'app' },
    spec: { schedule: 'token=fixture', jobTemplate: { spec: { template: { spec: { containers: [{ name: 'task', image: 'task:v1' }] } } } } },
    status: { active: [] },
  };
  assert.equal(uploadWorkloadStatus('CronJob', cronJob), 'warning');
  assert.equal(uploadWorkloadSummary('CronJob', cronJob).schedule, 'invalid');
  assert.doesNotMatch(JSON.stringify(uploadWorkloadSummary('CronJob', cronJob)), /token=fixture/);
});

test('upload topology suppresses malformed workload template references', async () => {
  const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: valid
  namespace: app
spec:
  replicas: 1
  template:
    spec:
      serviceAccountName: runtime
      containers:
        - name: api
          image: registry.example.com/team/api:v1
          envFrom:
            - configMapRef:
                name: runtime-config
status:
  readyReplicas: 1
  availableReplicas: 1
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: invalid
  namespace: app
spec:
  template:
    spec:
      containers:
        - name: api
          image: image:v1?credential=fixture
          envFrom:
            - secretRef:
                name: phantom-secret
`;
  const file = { name: 'workloads.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const valid = result.snapshot.nodes.find((node) => node.kind === 'Deployment' && node.name === 'valid');
  const invalid = result.snapshot.nodes.find((node) => node.kind === 'Deployment' && node.name === 'invalid');
  assert.equal(valid?.status, 'healthy');
  assert.equal(valid?.summary.imageCount, 1);
  assert.equal(invalid?.status, 'warning');
  assert.equal(invalid?.summary.imageCount, 'invalid');
  assert.equal(result.snapshot.nodes.some((node) => node.name === 'runtime'), true);
  assert.equal(result.snapshot.nodes.some((node) => node.name === 'runtime-config'), true);
  assert.equal(result.snapshot.nodes.some((node) => node.name === 'phantom-secret'), false);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /credential=fixture/);
});

function validDeployment(): KubeObject {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'api', namespace: 'app' },
    spec: {
      replicas: 2,
      template: {
        spec: {
          serviceAccountName: 'runtime',
          imagePullSecrets: [{ name: 'registry' }],
          volumes: [{ persistentVolumeClaim: { claimName: 'cache' } }],
          initContainers: [{ name: 'migrate', image: 'registry.example.com/team/migrate:v2' }],
          containers: [{
            name: 'api',
            image: 'registry.example.com/team/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            envFrom: [{ configMapRef: { name: 'runtime-config' } }],
            env: [
              { name: 'RAW_VALUE', value: 'must-not-survive' },
              { name: 'SAFE_REF', valueFrom: { secretKeyRef: { name: 'runtime-secret', key: 'password' } } },
              { name: 'POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
            ],
          }],
        },
      },
    },
    status: { replicas: 2, readyReplicas: 2, availableReplicas: 2 },
  };
}

function workloadWithContainer(container: Record<string, unknown>, podSpec: Record<string, unknown> = {}): KubeObject {
  return {
    kind: 'Deployment',
    metadata: { name: 'api', namespace: 'app' },
    spec: { template: { spec: { ...podSpec, containers: [container] } } },
    status: { readyReplicas: 1, availableReplicas: 1 },
  };
}
