import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotDiagnosticAffectedCount, snapshotDiagnosticReasonLabel } from './snapshotDiagnostics.ts';

test('snapshot diagnostics expose only allowlisted display labels', () => {
  assert.equal(snapshotDiagnosticReasonLabel('pagination_incomplete'), '페이지 불완전');
  assert.equal(snapshotDiagnosticReasonLabel('invalid_item'), '유효하지 않은 항목');
  assert.equal(snapshotDiagnosticReasonLabel('processing_limit'), '처리 상한');
  assert.equal(snapshotDiagnosticReasonLabel('remote body / secret'), '수집 실패');
});

test('snapshot diagnostic count treats missing or invalid counts as one affected fetch', () => {
  assert.equal(snapshotDiagnosticAffectedCount([
    { id: 'core/configmaps', resource: 'ConfigMaps', reason: 'invalid_response', count: 1 },
    { id: 'extensions/custom-resources', resource: 'Custom resources', reason: 'request_failed', count: 3 },
    { id: 'gateway/routes', resource: 'Routes', reason: 'request_failed', count: -2 },
  ]), 5);
});
