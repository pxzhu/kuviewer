import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClusterSummary, TopologyEdge, TopologyNode, TopologySnapshot } from '../../types/topology.ts';
import { captureSnapshotBaseline, compareTopologySnapshots } from './compareSnapshots.ts';

test('captureSnapshotBaseline clones mutable topology data and normalizes its label', () => {
  const snapshot = topologySnapshot({
    nodes: [
      topologyNode({
        id: 'pod/web',
        labels: { app: 'web' },
        annotations: { checksum: 'initial' },
        owners: ['Deployment/apps/web'],
        summary: { containers: ['app'], ready: 1 },
      }),
    ],
  });
  const beforeCapture = Date.now();
  const baseline = captureSnapshotBaseline(snapshot, `  ${'checkpoint'.repeat(12)}  `);

  snapshot.clusters[0].name = 'mutated-cluster';
  snapshot.nodes[0].labels.app = 'mutated';
  snapshot.nodes[0].annotations!.checksum = 'mutated';
  snapshot.nodes[0].owners!.push('ReplicaSet/apps/web-1');
  (snapshot.nodes[0].summary.containers as string[]).push('sidecar');

  assert.ok(baseline.capturedAt >= beforeCapture);
  assert.equal(baseline.label.length, 80);
  assert.equal(baseline.snapshot.clusters[0].name, 'cluster-main');
  assert.deepEqual(baseline.snapshot.nodes[0].labels, { app: 'web' });
  assert.deepEqual(baseline.snapshot.nodes[0].annotations, { checksum: 'initial' });
  assert.deepEqual(baseline.snapshot.nodes[0].owners, ['Deployment/apps/web']);
  assert.deepEqual(baseline.snapshot.nodes[0].summary.containers, ['app']);
});

test('compareTopologySnapshots reports deterministic resource, relation, and cluster changes', () => {
  const baseline = topologySnapshot({
    clusters: [
      topologyCluster({ id: 'cluster-main', name: 'cluster-main', version: '1.30', podWarning: 0 }),
      topologyCluster({ id: 'cluster-removed', name: 'cluster-removed' }),
    ],
    nodes: [
      topologyNode({
        id: 'pod/changed',
        name: 'changed',
        labels: { app: 'before' },
        annotations: { checksum: 'before' },
        owners: ['ReplicaSet/apps/before'],
        summary: { ready: 1 },
      }),
      topologyNode({ id: 'pod/removed', name: 'removed' }),
      topologyNode({
        id: 'secret/stable',
        kind: 'Secret',
        name: 'stable',
        annotations: { checksum: 'before' },
        summary: { keyCount: 1, valuesHidden: true },
      }),
    ],
    edges: [
      topologyEdge({ id: 'edge/changed', source: 'pod/changed', target: 'secret/stable', type: 'env-from', confidence: 'inferred', sourceField: 'spec.envFrom' }),
      topologyEdge({ id: 'edge/removed', source: 'pod/removed', target: 'secret/stable', type: 'env-from' }),
    ],
  });
  const current = topologySnapshot({
    clusters: [
      topologyCluster({ id: 'cluster-main', name: 'cluster-main', version: '1.31', podWarning: 1 }),
      topologyCluster({ id: 'cluster-added', name: 'cluster-added' }),
    ],
    nodes: [
      topologyNode({
        id: 'pod/changed',
        name: 'changed',
        status: 'warning',
        labels: { app: 'after' },
        annotations: { checksum: 'after' },
        owners: ['ReplicaSet/apps/after'],
        summary: { ready: 0 },
      }),
      topologyNode({ id: 'pod/added', name: 'added' }),
      topologyNode({
        id: 'secret/stable',
        kind: 'Secret',
        name: 'stable',
        annotations: { checksum: 'after' },
        summary: { keyCount: 99, valuesHidden: false },
      }),
    ],
    edges: [
      topologyEdge({ id: 'edge/changed', source: 'pod/changed', target: 'secret/stable', type: 'env-from', confidence: 'observed', sourceField: 'spec.containers[0].envFrom' }),
      topologyEdge({ id: 'edge/added', source: 'pod/added', target: 'pod/changed', type: 'owns' }),
    ],
  });

  const comparison = compareTopologySnapshots(baseline, current);

  assert.deepEqual(comparison.counts, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(comparison.clusterCounts, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(comparison.edgeCounts, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(comparison.nodes.map((change) => [change.type, change.id]), [
    ['changed', 'pod/changed'],
    ['added', 'pod/added'],
    ['removed', 'pod/removed'],
  ]);
  assert.deepEqual(comparison.nodes[0].changedFields, ['status', 'labels', 'owners', 'summary']);
  assert.equal(comparison.nodes.some((change) => change.id === 'secret/stable'), false);
  assert.deepEqual(comparison.edges.map((change) => [change.type, change.id]), [
    ['changed', 'edge/changed'],
    ['added', 'edge/added'],
    ['removed', 'edge/removed'],
  ]);
  assert.deepEqual(comparison.edges[0].changedFields, ['confidence', 'sourceField']);
  assert.deepEqual(comparison.clusters.map((change) => [change.type, change.id]), [
    ['changed', 'cluster-main'],
    ['added', 'cluster-added'],
    ['removed', 'cluster-removed'],
  ]);
  assert.deepEqual(comparison.clusters[0].changedFields, ['version', 'podWarning']);
});

test('compareTopologySnapshots ignores metadata insertion order and uses safe unknown identities', () => {
  const baseline = topologySnapshot({
    nodes: [
      topologyNode({
        id: 'pod/stable',
        labels: { app: 'stable', tier: 'frontend' },
        annotations: { first: 'one', second: 'two' },
        owners: ['Deployment/apps/stable', 'ReplicaSet/apps/stable-1'],
        summary: { ready: 1, phase: 'Running' },
      }),
    ],
  });
  const current = topologySnapshot({
    nodes: [
      topologyNode({
        id: 'pod/stable',
        labels: { tier: 'frontend', app: 'stable' },
        annotations: { second: 'changed', first: 'changed' },
        owners: ['ReplicaSet/apps/stable-1', 'Deployment/apps/stable'],
        summary: { phase: 'Running', ready: 1 },
      }),
    ],
    edges: [topologyEdge({ id: 'edge/unknown', source: 'pod/stable', target: 'missing/resource', type: 'references' })],
  });

  const comparison = compareTopologySnapshots(baseline, current);

  assert.deepEqual(comparison.counts, { added: 0, removed: 0, changed: 0 });
  assert.equal(comparison.edges.length, 1);
  assert.deepEqual(comparison.edges[0].target, {
    id: 'missing/resource',
    kind: 'Unknown',
    namespace: '-',
    name: 'missing/resource',
  });
});

function topologySnapshot(overrides: Partial<TopologySnapshot> = {}): TopologySnapshot {
  return {
    clusters: overrides.clusters ?? [topologyCluster()],
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
  };
}

function topologyCluster(overrides: Partial<ClusterSummary> = {}): ClusterSummary {
  return {
    id: 'cluster-main',
    name: 'cluster-main',
    provider: 'test',
    version: '1.30',
    nodeReady: 1,
    nodeTotal: 1,
    podRunning: 1,
    podWarning: 0,
    namespaces: 1,
    ...overrides,
  };
}

function topologyNode(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id: 'pod/default',
    clusterId: 'cluster-main',
    kind: 'Pod',
    namespace: 'apps',
    name: 'default',
    status: 'healthy',
    labels: {},
    summary: {},
    x: 0,
    y: 0,
    ...overrides,
  };
}

function topologyEdge(overrides: Partial<TopologyEdge> = {}): TopologyEdge {
  return {
    id: 'edge/default',
    clusterId: 'cluster-main',
    source: 'pod/default',
    target: 'service/default',
    type: 'routes-to',
    confidence: 'inferred',
    sourceField: 'spec',
    ...overrides,
  };
}
