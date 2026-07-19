import type { SnapshotChangeType } from './compareSnapshots.ts';
import type { ImportedSnapshotDiff } from './importSnapshotDiff.ts';

export interface SnapshotDiffReportSummary {
  exported: number;
  resources: number;
  relations: number;
  clusters: number;
  added: number;
  changed: number;
  removed: number;
}

export interface SnapshotDiffReportComparison {
  sameScope: boolean;
  left: SnapshotDiffReportSummary;
  right: SnapshotDiffReportSummary;
  delta: SnapshotDiffReportSummary;
}

export function summarizeSnapshotDiffReport(report: ImportedSnapshotDiff): SnapshotDiffReportSummary {
  const changes: Record<SnapshotChangeType, number> = { added: 0, changed: 0, removed: 0 };
  report.items.forEach((item) => {
    const change = item.change;
    if (change === 'added' || change === 'changed' || change === 'removed') {
      changes[change] += 1;
    }
  });
  return {
    exported: report.counts.exported,
    resources: report.counts.resources,
    relations: report.counts.relations,
    clusters: report.counts.clusters,
    added: changes.added,
    changed: changes.changed,
    removed: changes.removed,
  };
}

export function compareSnapshotDiffReports(
  leftReport: ImportedSnapshotDiff,
  rightReport: ImportedSnapshotDiff,
): SnapshotDiffReportComparison {
  const left = summarizeSnapshotDiffReport(leftReport);
  const right = summarizeSnapshotDiffReport(rightReport);
  return {
    sameScope: leftReport.filters.scope === rightReport.filters.scope,
    left,
    right,
    delta: mapSummary((key) => right[key] - left[key]),
  };
}

function mapSummary(valueFor: (key: keyof SnapshotDiffReportSummary) => number): SnapshotDiffReportSummary {
  return {
    exported: valueFor('exported'),
    resources: valueFor('resources'),
    relations: valueFor('relations'),
    clusters: valueFor('clusters'),
    added: valueFor('added'),
    changed: valueFor('changed'),
    removed: valueFor('removed'),
  };
}
