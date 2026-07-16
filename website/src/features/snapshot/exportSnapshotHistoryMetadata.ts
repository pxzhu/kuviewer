import type { SnapshotHistoryEntry } from './snapshotHistory';

export const snapshotHistoryMetadataKind = 'kuviewer.snapshotHistoryMetadata';

export function createSnapshotHistoryMetadataJson(history: SnapshotHistoryEntry[], exportedAt = Date.now()) {
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: snapshotHistoryMetadataKind,
    exportedAt,
    count: history.length,
    items: history.map((entry) => ({
      id: entry.id.slice(0, 120),
      label: entry.label.trim().slice(0, 80),
      capturedAt: entry.capturedAt,
      origin: entry.origin,
      clusterCount: entry.snapshot.clusters.length,
      resourceCount: entry.snapshot.nodes.length,
      relationCount: entry.snapshot.edges.length,
    })),
  }, null, 2)}\n`;
}

export function downloadSnapshotHistoryMetadata(history: SnapshotHistoryEntry[], exportedAt = Date.now()) {
  if (history.length === 0) {
    return;
  }
  const blob = new Blob([createSnapshotHistoryMetadataJson(history, exportedAt)], { type: 'application/json;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `kuviewer-snapshot-history-${new Date(exportedAt).toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
