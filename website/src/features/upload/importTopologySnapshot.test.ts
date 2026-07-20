import assert from 'node:assert/strict';
import test from 'node:test';
import { importTopologySnapshot } from './importTopologySnapshot.ts';

function baseSnapshot() {
  return {
    clusters: [
      {
        id: ' cluster-a ',
        name: ' Cluster A ',
        provider: 'uploaded',
        version: 'v1.30',
        nodeReady: 1.9,
        nodeTotal: -3,
        podRunning: 2,
        podWarning: 0,
        namespaces: 1,
      },
    ],
    nodes: [
      {
        id: 'config-a',
        clusterId: 'cluster-a',
        kind: 'ConfigMap',
        namespace: 'default',
        name: 'app-config',
        status: 'healthy',
        labels: { app: 'web' },
        annotations: { note: 'safe', password: 'must-not-survive' },
        summary: {
          safe: 'visible',
          password: 'must-not-survive',
          source: 'token=must-not-survive',
          nested: { raw: 'ignored' },
        },
        x: 200_000,
        y: -200_000,
      },
      {
        id: 'secret-a',
        clusterId: 'cluster-a',
        kind: 'Secret',
        namespace: 'default',
        name: 'app-secret',
        status: 'unknown',
        labels: {},
        annotations: { note: 'safe' },
        summary: {
          type: 'Opaque',
          keys: 2,
          referenced: true,
          data: 'must-not-survive',
          stringData: 'must-not-survive',
        },
        x: 10,
        y: 20,
      },
    ],
    edges: [
      {
        id: 'edge-a',
        clusterId: 'cluster-a',
        source: 'config-a',
        target: 'secret-a',
        type: 'references',
        confidence: 'inferred',
        sourceField: 'spec.secretRef',
      },
    ],
  };
}

test('topology snapshot import normalizes bounded metadata and redacts sensitive values', () => {
  const snapshot = importTopologySnapshot(baseSnapshot());

  assert.equal(snapshot.clusters[0].id, 'cluster-a');
  assert.equal(snapshot.clusters[0].name, 'Cluster A');
  assert.equal(snapshot.clusters[0].nodeReady, 1);
  assert.equal(snapshot.clusters[0].nodeTotal, 0);
  assert.equal(snapshot.nodes[0].x, 100_000);
  assert.equal(snapshot.nodes[0].y, -100_000);
  assert.deepEqual(snapshot.nodes[0].annotations, { note: 'safe', password: 'redacted' });
  assert.deepEqual(snapshot.nodes[0].summary, { safe: 'visible', source: 'redacted' });
  assert.deepEqual(snapshot.nodes[1].summary, {
    values: 'hidden',
    type: 'Opaque',
    keys: 2,
    referenced: true,
  });
  assert.equal(JSON.stringify(snapshot).includes('must-not-survive'), false);
});

test('topology snapshot import rejects dangling relations and duplicate identities', () => {
  const dangling = baseSnapshot();
  dangling.edges[0].target = 'missing';
  assert.throws(() => importTopologySnapshot(dangling), /invalid_topology_json/);

  const duplicateNode = baseSnapshot();
  duplicateNode.nodes.push({ ...duplicateNode.nodes[0] });
  assert.throws(() => importTopologySnapshot(duplicateNode), /invalid_topology_json/);

  const duplicateCluster = baseSnapshot();
  duplicateCluster.clusters.push({ ...duplicateCluster.clusters[0] });
  assert.throws(() => importTopologySnapshot(duplicateCluster), /invalid_topology_json/);

  const duplicateEdge = baseSnapshot();
  duplicateEdge.edges.push({ ...duplicateEdge.edges[0] });
  assert.throws(() => importTopologySnapshot(duplicateEdge), /invalid_topology_json/);
});

test('topology snapshot import rejects unsupported schema values and oversized collections', () => {
  const unsupportedKind = baseSnapshot();
  unsupportedKind.nodes[0].kind = 'UnknownKind';
  assert.throws(() => importTopologySnapshot(unsupportedKind), /invalid_topology_json/);

  const unsupportedStatus = baseSnapshot();
  unsupportedStatus.nodes[0].status = 'ready';
  assert.throws(() => importTopologySnapshot(unsupportedStatus), /invalid_topology_json/);

  const unsupportedEdge = baseSnapshot();
  unsupportedEdge.edges[0].type = 'executes';
  assert.throws(() => importTopologySnapshot(unsupportedEdge), /invalid_topology_json/);

  const oversized = baseSnapshot();
  oversized.clusters = Array.from({ length: 101 }, (_, index) => ({
    ...oversized.clusters[0],
    id: `cluster-${index}`,
    name: `Cluster ${index}`,
  }));
  assert.throws(() => importTopologySnapshot(oversized), /invalid_topology_json/);
});
