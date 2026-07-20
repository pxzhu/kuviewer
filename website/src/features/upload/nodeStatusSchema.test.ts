import assert from 'node:assert/strict';
import test from 'node:test';
import type { KubeObject } from './kubernetesObject.ts';
import { uploadNodeStatus, uploadNodeStatusIsValid, uploadNodeSummary } from './nodeStatusSchema.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';

test('upload Node summary keeps safe bounded capacity, allocatable, and runtime metadata', () => {
  const node = validNode();
  assert.equal(uploadNodeStatusIsValid(node), true);
  assert.equal(uploadNodeStatus(node), 'healthy');
  assert.deepEqual(uploadNodeSummary(node), {
    capacityCpu: '8',
    allocatableCpu: '7800m',
    capacityMemory: '32Gi',
    allocatableMemory: '30Gi',
    capacityPods: 110,
    allocatablePods: 100,
    capacityEphemeralStorage: '100Gi',
    allocatableEphemeralStorage: '90Gi',
    capacityResourceCount: 5,
    allocatableResourceCount: 5,
    kubeletVersion: 'v1.30.4',
    containerRuntime: 'containerd://1.7.27',
    operatingSystem: 'linux',
    architecture: 'amd64',
    conditions: 'MemoryPressure=False, Ready=True',
  });
  assert.doesNotMatch(JSON.stringify(uploadNodeSummary(node)), /must-not-survive|machineID|systemUUID|bootID|addresses|message/);
});

test('upload Node status distinguishes unobserved, ready, and not-ready state', () => {
  const unobserved: KubeObject = { kind: 'Node', metadata: { name: 'worker-a' } };
  assert.equal(uploadNodeStatusIsValid(unobserved), true);
  assert.equal(uploadNodeStatus(unobserved), 'unknown');
  assert.equal(uploadNodeSummary(unobserved).capacityCpu, 'unknown');
  assert.equal(uploadNodeSummary(unobserved).conditions, 'unknown');

  const notReady = validNode();
  notReady.status = { ...notReady.status, conditions: [{ type: 'Ready', status: 'False' }] };
  assert.equal(uploadNodeStatus(notReady), 'warning');
});

test('upload Node schema rejects malformed status fields fail closed', () => {
  const oversizedResources = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`example.com/resource-${index}`, '1']));
  const malformed: KubeObject[] = [
    withStatus({ conditions: [{ type: 'Ready', status: 'True' }, { type: 'Ready', status: 'False' }] }),
    withStatus({ conditions: [{ type: 'Ready=token', status: 'True' }] }),
    withStatus({ capacity: { cpu: '8?token=fixture' } }),
    withStatus({ capacity: { pods: '110' }, allocatable: { pods: '111' } }),
    withStatus({ nodeInfo: { kubeletVersion: 'token=fixture' } }),
    withStatus({ nodeInfo: { containerRuntimeVersion: 'containerd://1.7.27?token' } }),
    withStatus({ nodeInfo: { operatingSystem: 'darwin' } }),
    withStatus({ nodeInfo: { architecture: 'amd64?token' } }),
    withStatus({ capacity: oversizedResources }),
  ];
  malformed.forEach((node, index) => {
    assert.equal(uploadNodeStatusIsValid(node), false, `valid ${index}`);
    assert.equal(uploadNodeStatus(node), 'warning', `status ${index}`);
    const summary = uploadNodeSummary(node);
    assert.equal(summary.capacityCpu, 'invalid', `summary ${index}`);
    assert.doesNotMatch(JSON.stringify(summary), /fixture|\?token/, `leak ${index}`);
  });
});

test('upload topology counts only valid ready Nodes and drops raw host identity fields', async () => {
  const manifest = `
apiVersion: v1
kind: Node
metadata:
  name: worker-a
status:
  conditions:
    - type: Ready
      status: "True"
      message: token=must-not-survive
  capacity:
    cpu: 8
    memory: 32Gi
    pods: 110
  allocatable:
    cpu: 7800m
    memory: 30Gi
    pods: 100
  addresses:
    - type: InternalIP
      address: must-not-survive
  nodeInfo:
    kubeletVersion: v1.30.4
    containerRuntimeVersion: containerd://1.7.27
    operatingSystem: linux
    architecture: amd64
    machineID: must-not-survive
---
apiVersion: v1
kind: Node
metadata:
  name: worker-b
status:
  conditions:
    - type: Ready
      status: "True"
  capacity:
    memory: 32Gi?credential=fixture
`;
  const file = { name: 'nodes.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  assert.equal(result.snapshot.clusters[0].nodeTotal, 2);
  assert.equal(result.snapshot.clusters[0].nodeReady, 1);
  const valid = result.snapshot.nodes.find((node) => node.kind === 'Node' && node.name === 'worker-a');
  const invalid = result.snapshot.nodes.find((node) => node.kind === 'Node' && node.name === 'worker-b');
  assert.equal(valid?.status, 'healthy');
  assert.equal(valid?.summary.allocatablePods, 100);
  assert.equal(invalid?.status, 'warning');
  assert.equal(invalid?.summary.capacityMemory, 'invalid');
  assert.doesNotMatch(JSON.stringify(result.snapshot), /fixture|must-not-survive/);
});

function validNode(): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name: 'worker-a' },
    status: {
      conditions: [
        { type: 'Ready', status: 'True', message: 'token=must-not-survive' },
        { type: 'MemoryPressure', status: 'False' },
      ],
      capacity: { cpu: '8', memory: '32Gi', pods: '110', 'ephemeral-storage': '100Gi', 'example.com/gpu': '1' },
      allocatable: { cpu: '7800m', memory: '30Gi', pods: '100', 'ephemeral-storage': '90Gi', 'example.com/gpu': '1' },
      addresses: [{ type: 'InternalIP', address: 'must-not-survive' }],
      nodeInfo: {
        kubeletVersion: 'v1.30.4',
        containerRuntimeVersion: 'containerd://1.7.27',
        operatingSystem: 'linux',
        architecture: 'amd64',
        machineID: 'must-not-survive',
        systemUUID: 'must-not-survive',
        bootID: 'must-not-survive',
      },
    },
  };
}

function withStatus(status: Record<string, unknown>): KubeObject {
  return { apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-a' }, status };
}
