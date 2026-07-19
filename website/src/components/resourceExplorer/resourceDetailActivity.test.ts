import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectKeyValueSearchMatches,
  collectLogSearchMatches,
  countEventSeverities,
  eventExportCsv,
  filterEvents,
  filterLogLines,
  filterRelatedResources,
  groupRelatedResources,
  keyValueEntries,
  parseLogLines,
  sortEventListItems,
  sortLogLines,
} from './resourceDetailActivity.ts';

test('log helpers parse, filter, search, and sort timestamped lines', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const parsed = parseLogLines([
    '2026-07-19T11:45:00Z request timeout',
    '[2026-07-19T09:00:00Z] worker ready',
    'unstructured timeout',
  ]);

  assert.equal(parsed[0].message, 'request timeout');
  assert.equal(parsed[1].message, 'worker ready');
  assert.equal(parsed[2].timestampMs, null);
  assert.deepEqual(filterLogLines(parsed, 'timeout', '1h', now).map((line) => line.index), [0]);
  assert.deepEqual(sortLogLines(parsed, 'oldest').map((line) => line.index), [1, 0, 2]);
  assert.equal(collectLogSearchMatches(parsed, 'timeout').length, 2);
});

test('event helpers combine severity, time, pinning, and safe CSV export', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const events = [
    { type: 'Warning', reason: 'BackOff', message: '=cmd', source: 'kubelet', timestamp: '2026-07-19T11:55:00Z' },
    { type: 'Normal', reason: 'Started', message: 'ready', source: 'kubelet', timestamp: '2026-07-19T08:00:00Z' },
    { type: 'Custom', reason: 'Observed', message: 'state', source: 'controller', timestamp: 'invalid' },
  ];

  const recentWarnings = filterEvents(events, '', 'warning', '1h', now);
  assert.equal(recentWarnings.length, 1);
  assert.equal(recentWarnings[0].event.reason, 'BackOff');
  assert.deepEqual(countEventSeverities(events), { warning: 1, normal: 1, other: 1 });

  const allItems = filterEvents(events, '', 'all', 'all', now);
  const pinnedNormal = allItems[1].id;
  const sorted = sortEventListItems(allItems, 'newest', new Set([pinnedNormal]));
  assert.equal(sorted[0].event.reason, 'Started');
  assert.equal(sorted[0].pinned, true);
  assert.match(eventExportCsv(recentWarnings), /'=cmd/);
});

test('relation helpers search safe metadata and preserve visible limits', () => {
  const relations = [
    { nodeId: 'service-a', kind: 'Service', namespace: 'prod', name: 'api', edgeType: 'routes-to', direction: 'outgoing', sourceField: 'spec.backendRef' },
    { nodeId: 'secret-a', kind: 'Secret', namespace: 'prod', name: 'credentials', edgeType: 'references', direction: 'outgoing', sourceField: 'spec.secretRef' },
    { nodeId: 'deployment-a', kind: 'Deployment', namespace: 'prod', name: 'owner', edgeType: 'owns', direction: 'incoming', sourceField: 'metadata.ownerReferences' },
  ] as never;

  assert.deepEqual(filterRelatedResources(relations, 'service prod').map((item) => item.nodeId), ['service-a']);
  assert.deepEqual(filterRelatedResources(relations, '나가는 관계').map((item) => item.nodeId), ['service-a', 'secret-a']);

  const groups = groupRelatedResources(relations, 2);
  assert.equal(groups.length, 2);
  assert.equal(groups.reduce((count, group) => count + group.items.length, 0), 2);
  assert.deepEqual(groups.map((group) => group.label), ['Outgoing · routes-to', 'Outgoing · references']);
});

test('safe preview helpers omit empty values and index key/value matches', () => {
  const entries = keyValueEntries({ image: 'api:v2', replicas: 3, empty: '', omitted: undefined, ports: [80, 443] });
  assert.deepEqual(entries, [
    { key: 'image', valueText: 'api:v2' },
    { key: 'replicas', valueText: '3' },
    { key: 'ports', valueText: '80, 443' },
  ]);
  assert.deepEqual(collectKeyValueSearchMatches(entries, 'api').map((match) => [match.entryIndex, match.field]), [[0, 'value']]);
});
