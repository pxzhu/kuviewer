import assert from 'node:assert/strict';
import test from 'node:test';
import type { SnapshotComparison } from './compareSnapshots.ts';
import {
  filterSnapshotComparison,
  filterSnapshotRelationsByTypes,
  relationTypeCounts,
  retainAvailableRelationTypes,
  snapshotScopeSearchPlaceholder,
  snapshotScopeTotalCount,
  snapshotVisibleChangeCount,
  toggleRelationTypeSelection,
} from './snapshotComparisonView.ts';

const comparison: SnapshotComparison = {
  nodes: [
    { id: 'pod/web', type: 'changed', clusterId: 'main', kind: 'Pod', namespace: 'apps', name: 'web', changedFields: ['status'] },
    { id: 'service/api', type: 'added', clusterId: 'main', kind: 'Service', namespace: 'apps', name: 'api', changedFields: [] },
  ],
  edges: [
    {
      id: 'edge/routes', type: 'added', clusterId: 'main', relation: 'routes-to',
      source: { id: 'service/api', kind: 'Service', namespace: 'apps', name: 'api' },
      target: { id: 'pod/web', kind: 'Pod', namespace: 'apps', name: 'web' },
      confidence: 'inferred', sourceField: 'spec.selector', changedFields: [],
    },
    {
      id: 'edge/owns', type: 'changed', clusterId: 'main', relation: 'owns',
      source: { id: 'deployment/web', kind: 'Deployment', namespace: 'apps', name: 'web' },
      target: { id: 'pod/web', kind: 'Pod', namespace: 'apps', name: 'web' },
      confidence: 'observed', sourceField: 'metadata.ownerReferences', changedFields: ['confidence'],
    },
  ],
  clusters: [
    { id: 'main', type: 'changed', name: 'primary', before: { id: 'main', name: 'primary', provider: 'k3s', version: '1.30', nodeReady: 1, nodeTotal: 1, podRunning: 1, podWarning: 0, namespaces: 1 }, after: { id: 'main', name: 'primary', provider: 'k3s', version: '1.31', nodeReady: 1, nodeTotal: 1, podRunning: 1, podWarning: 0, namespaces: 1 }, changedFields: ['version'] },
  ],
  counts: { added: 1, removed: 0, changed: 1 },
  edgeCounts: { added: 1, removed: 0, changed: 1 },
  clusterCounts: { added: 0, removed: 0, changed: 1 },
};

test('filters snapshot scopes by safe identity, field, and change type text', () => {
  assert.deepEqual(filterSnapshotComparison(comparison, 'all', 'status').nodes.map((item) => item.id), ['pod/web']);
  assert.deepEqual(filterSnapshotComparison(comparison, 'added', 'selector').edges.map((item) => item.id), ['edge/routes']);
  assert.deepEqual(filterSnapshotComparison(comparison, 'changed', '1.31').clusters.map((item) => item.id), ['main']);
  assert.deepEqual(filterSnapshotComparison(comparison, 'removed', ''), { nodes: [], edges: [], clusters: [] });
});

test('counts, selects, and prunes relation types deterministically', () => {
  const duplicateRoutes = [...comparison.edges, { ...comparison.edges[0], id: 'edge/routes-2' }];
  const options = relationTypeCounts(duplicateRoutes);
  assert.deepEqual(options, [{ relation: 'owns', count: 1 }, { relation: 'routes-to', count: 2 }]);

  const selected = toggleRelationTypeSelection(new Set<string>(), 'routes-to');
  assert.deepEqual(filterSnapshotRelationsByTypes(duplicateRoutes, selected).map((item) => item.id), ['edge/routes', 'edge/routes-2']);
  assert.deepEqual([...toggleRelationTypeSelection(selected, 'routes-to')], []);
  assert.strictEqual(retainAvailableRelationTypes(selected, options), selected);
  assert.deepEqual([...retainAvailableRelationTypes(new Set(['routes-to', 'missing']), options)], ['routes-to']);
});

test('reports scope labels, counts, and placeholders without UI state', () => {
  const visible = filterSnapshotComparison(comparison, 'all', '');
  assert.equal(snapshotScopeTotalCount('relations', comparison), 2);
  assert.equal(snapshotScopeTotalCount('resources', comparison), 2);
  assert.equal(snapshotVisibleChangeCount('clusters', visible), 1);
  assert.equal(snapshotScopeSearchPlaceholder('clusters'), 'cluster, provider, version 검색');
});
