import assert from 'node:assert/strict';
import test from 'node:test';
import {
  uploadHPAScaleTarget,
  uploadHPASpecIsValid,
  uploadHPAStatus,
  uploadHPASummary,
} from './hpaSchema.ts';
import type { KubeObject } from './kubernetesObject.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';

test('upload HPA summarizes metric markers without exposing quantities or selectors', () => {
  const hpa = validHPA();
  assert.equal(uploadHPASpecIsValid(hpa), true);
  assert.equal(uploadHPAStatus(hpa), 'healthy');
  assert.deepEqual(uploadHPAScaleTarget(hpa), { apiVersion: 'apps/v1', kind: 'Deployment', name: 'checkout' });
  assert.deepEqual(uploadHPASummary(hpa), {
    target: 'Deployment/checkout',
    range: '2-8',
    metrics: 2,
    metricTypes: 'External:1,Resource:1',
    metricTargets: 'AverageValue:1,Utilization:1',
    replicas: '3/3',
    currentMetrics: 2,
    currentTypes: 'External:1,Resource:1',
    currentValues: 'averageValue:1,utilization:1',
    conditions: 'AbleToScale=True,ScalingActive=True',
  });
  assert.doesNotMatch(JSON.stringify(uploadHPASummary(hpa)), /queue_depth|credential-value|token=remote-value|"30"|"18"/);
});

test('upload HPA rejects malformed target, metric, replica, and condition boundaries', () => {
  const fixtures: KubeObject[] = [
    { ...validHPA(), spec: { ...validHPA().spec, scaleTargetRef: { apiVersion: 'bad/value/extra', kind: 'Deployment', name: 'checkout' } } },
    { ...validHPA(), spec: { ...validHPA().spec, minReplicas: 0, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }] } },
    { ...validHPA(), spec: { ...validHPA().spec, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'AverageValue', averageValue: 'credential123' } } }] } },
    { ...validHPA(), spec: { ...validHPA().spec, metrics: [{ type: 'External', external: { metric: { name: 'queue_depth', selector: { matchLabels: { 'bad key': 'value' } } }, target: { type: 'AverageValue', averageValue: '30' } } }] } },
    { ...validHPA(), status: { currentReplicas: -1, desiredReplicas: 3 } },
    { ...validHPA(), status: { currentReplicas: 3, desiredReplicas: 3, conditions: [{ type: 'Injected', status: 'True' }] } },
  ];
  fixtures.forEach((hpa, index) => {
    assert.equal(uploadHPAStatus(hpa), 'warning', `fixture ${index}`);
    const summary = uploadHPASummary(hpa);
    assert.equal(index < 4 ? summary.target : summary.replicas, 'invalid', `fixture ${index}`);
  });
});

test('upload topology keeps malformed HPA visible without unsafe target edge', async () => {
  const manifest = `
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: invalid
  namespace: app
spec:
  minReplicas: 1
  maxReplicas: 5
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: credential-target
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: AverageValue
          averageValue: credential123
status:
  currentReplicas: 1
  desiredReplicas: 1
`;
  const file = { name: 'hpa.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const node = result.snapshot.nodes.find((candidate) => candidate.kind === 'HorizontalPodAutoscaler');
  assert.equal(node?.status, 'warning');
  assert.equal(node?.summary.target, 'invalid');
  assert.equal(result.snapshot.nodes.some((candidate) => candidate.name === 'credential-target'), false);
  assert.equal(result.snapshot.edges.some((edge) => edge.type === 'targets-scale'), false);
  assert.doesNotMatch(JSON.stringify(node?.summary), /credential-target|credential123/);
});

function validHPA(): KubeObject {
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { name: 'checkout', namespace: 'app' },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'checkout' },
      minReplicas: 2,
      maxReplicas: 8,
      metrics: [
        { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } },
        { type: 'External', external: { metric: { name: 'queue_depth', selector: { matchLabels: { queue: 'credential-value' } } }, target: { type: 'AverageValue', averageValue: '30' } } },
      ],
    },
    status: {
      currentReplicas: 3,
      desiredReplicas: 3,
      currentMetrics: [
        { type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 55 } } },
        { type: 'External', external: { metric: { name: 'queue_depth', selector: { matchLabels: { queue: 'credential-value' } } }, current: { averageValue: '18' } } },
      ],
      conditions: [
        { type: 'AbleToScale', status: 'True', message: 'token=remote-value' },
        { type: 'ScalingActive', status: 'True' },
      ],
    },
  };
}
