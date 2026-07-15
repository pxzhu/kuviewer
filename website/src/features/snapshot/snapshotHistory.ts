import type { TopologySnapshot } from '../../types/topology';
import { captureSnapshotBaseline, type SnapshotBaseline } from './compareSnapshots';

export const MAX_SNAPSHOT_HISTORY = 8;

export type SnapshotHistoryOrigin = 'capture' | 'import';

export interface SnapshotHistoryEntry extends SnapshotBaseline {
  id: string;
  origin: SnapshotHistoryOrigin;
}

let historySequence = 0;

export function createSnapshotHistoryEntry(
  snapshot: TopologySnapshot,
  label: string,
  origin: SnapshotHistoryOrigin,
): SnapshotHistoryEntry {
  const baseline = captureSnapshotBaseline(snapshot, label);
  historySequence += 1;
  return {
    ...baseline,
    id: `${baseline.capturedAt.toString(36)}-${historySequence.toString(36)}`,
    origin,
  };
}

export function addSnapshotHistoryEntry(
  history: SnapshotHistoryEntry[],
  entry: SnapshotHistoryEntry,
  protectedIds: string[] = [],
) {
  const next = [entry, ...history.filter((candidate) => candidate.id !== entry.id)];
  if (next.length <= MAX_SNAPSHOT_HISTORY) {
    return next;
  }

  const protectedSet = new Set(protectedIds.filter(Boolean));
  const keepIds = new Set<string>();
  for (const candidate of next) {
    if (protectedSet.has(candidate.id)) {
      keepIds.add(candidate.id);
    }
  }
  for (const candidate of next) {
    if (keepIds.size >= MAX_SNAPSHOT_HISTORY) {
      break;
    }
    keepIds.add(candidate.id);
  }
  return next.filter((candidate) => keepIds.has(candidate.id));
}

export function renameSnapshotHistoryEntry(history: SnapshotHistoryEntry[], id: string, label: string) {
  const normalizedLabel = label.trim().slice(0, 80);
  if (!normalizedLabel) {
    return history;
  }
  return history.map((entry) => entry.id === id ? { ...entry, label: normalizedLabel } : entry);
}

export function deleteSnapshotHistoryEntry(history: SnapshotHistoryEntry[], id: string) {
  return history.filter((entry) => entry.id !== id);
}
