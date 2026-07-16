import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotHistoryMetadataJson, snapshotHistoryMetadataKind } from './exportSnapshotHistoryMetadata.ts';

test('snapshot history metadata export excludes topology payloads', () => {
  const exportedAt = 1_720_000_000_000;
  const json = createSnapshotHistoryMetadataJson([
    {
      id: 'capture-1',
      label: 'before rollout',
      capturedAt: 1_710_000_000_000,
      origin: 'capture',
      snapshot: {
        clusters: [{ id: 'cluster-a' }],
        nodes: [{ id: 'secret-node', preview: { secretValues: 'must-not-export' } }],
        edges: [{ id: 'edge-a' }, { id: 'edge-b' }],
      },
    },
  ] as never, exportedAt);
  const bundle = JSON.parse(json);

  assert.equal(bundle.kind, snapshotHistoryMetadataKind);
  assert.equal(bundle.exportedAt, exportedAt);
  assert.deepEqual(bundle.items[0], {
    id: 'capture-1',
    label: 'before rollout',
    capturedAt: 1_710_000_000_000,
    origin: 'capture',
    clusterCount: 1,
    resourceCount: 1,
    relationCount: 2,
  });
  assert.equal(json.includes('must-not-export'), false);
  assert.equal(Object.hasOwn(bundle.items[0], 'snapshot'), false);
});
