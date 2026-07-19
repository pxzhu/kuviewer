import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSnapshotDiffReports, summarizeSnapshotDiffReport } from './compareSnapshotDiffReports.ts';
import type { ImportedSnapshotDiff } from './importSnapshotDiff.ts';

test('snapshot diff report summary compares counts without carrying item payloads', () => {
  const left = report({
    scope: 'resources',
    counts: { exported: 3, resources: 7, relations: 4, clusters: 1 },
    items: [{ change: 'added' }, { change: 'changed' }, { change: 'removed', hidden: 'do-not-copy' }],
  });
  const right = report({
    scope: 'resources',
    counts: { exported: 4, resources: 10, relations: 6, clusters: 2 },
    items: [{ change: 'added' }, { change: 'added' }, { change: 'changed' }, { change: 'changed' }],
  });

  assert.deepEqual(summarizeSnapshotDiffReport(left), {
    exported: 3, resources: 7, relations: 4, clusters: 1, added: 1, changed: 1, removed: 1,
  });
  assert.deepEqual(compareSnapshotDiffReports(left, right), {
    sameScope: true,
    left: { exported: 3, resources: 7, relations: 4, clusters: 1, added: 1, changed: 1, removed: 1 },
    right: { exported: 4, resources: 10, relations: 6, clusters: 2, added: 2, changed: 2, removed: 0 },
    delta: { exported: 1, resources: 3, relations: 2, clusters: 1, added: 1, changed: 1, removed: -1 },
  });
  assert.equal(JSON.stringify(compareSnapshotDiffReports(left, right)).includes('do-not-copy'), false);
});

test('snapshot diff report comparison flags mismatched scopes but keeps safe totals', () => {
  const comparison = compareSnapshotDiffReports(report({ scope: 'resources' }), report({ scope: 'relations' }));
  assert.equal(comparison.sameScope, false);
  assert.deepEqual(comparison.delta, { exported: 0, resources: 0, relations: 0, clusters: 0, added: 0, changed: 0, removed: 0 });
});

function report(overrides: {
  scope?: ImportedSnapshotDiff['filters']['scope'];
  counts?: ImportedSnapshotDiff['counts'];
  items?: Array<Record<string, unknown>>;
} = {}): ImportedSnapshotDiff {
  return {
    schemaVersion: 1,
    kind: 'kuviewer.snapshotDiff',
    exportedAt: 1,
    baseline: { label: 'before', clusterCount: 1, resourceCount: 1, relationCount: 1 },
    current: { label: 'after', clusterCount: 1, resourceCount: 1, relationCount: 1 },
    filters: { scope: overrides.scope || 'resources', changeType: 'all', relationTypes: [] },
    counts: overrides.counts || { exported: 0, resources: 0, relations: 0, clusters: 0 },
    items: overrides.items || [],
  };
}
