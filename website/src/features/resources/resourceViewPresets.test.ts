import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResourceViewTeamComparePreview,
  defaultResourceViewGroup,
  groupResourceViewPresets,
  maxResourceViewPresets,
  mergeResourceViewPresets,
  moveResourceViewPresetsToGroup,
  readCollapsedResourceViewGroups,
  readResourceViewPresets,
  resourceViewShareUrl,
  resourceViewTeamSnapshotMetadata,
  resourceViewTeamSyncSummaryFromCompare,
  validResourceViewPreset,
  writeCollapsedResourceViewGroups,
  writeResourceViewPresets,
  type ResourceViewPreset,
} from './resourceViewPresets.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  serializedValues() {
    return [...this.values.values()].join('\n');
  }
}

function preset(name: string, overrides: Partial<ResourceViewPreset> = {}): ResourceViewPreset {
  return {
    name,
    group: defaultResourceViewGroup,
    query: '',
    cluster: 'all',
    namespace: 'all',
    kind: 'all',
    status: 'all',
    order: 1,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test('saved view validation normalizes legacy metadata and rejects malformed entries', () => {
  const [normalized] = validResourceViewPreset({
    name: '  workloads  ',
    query: 'x'.repeat(200),
    cluster: '',
    namespace: '',
    kind: '',
    status: '',
    order: -1,
    updatedAt: 123,
  }, 7);

  assert.equal(normalized.name, 'workloads');
  assert.equal(normalized.group, defaultResourceViewGroup);
  assert.equal(normalized.query.length, 160);
  assert.equal(normalized.cluster, 'all');
  assert.equal(normalized.order, 7);
  assert.deepEqual(validResourceViewPreset({ name: 'missing filters' }), []);
});

test('saved view storage caps items and persists safe fields only', () => {
  const storage = new MemoryStorage();
  const views = Array.from({ length: maxResourceViewPresets + 3 }, (_, index) => ({
    ...preset(`view-${index}`, { order: maxResourceViewPresets + 3 - index }),
    token: 'must-not-persist',
    secretData: { password: 'hidden' },
  })) as Array<ResourceViewPreset & { token: string; secretData: { password: string } }>;

  writeResourceViewPresets(views, storage);
  const serialized = storage.serializedValues();
  const restored = readResourceViewPresets(storage);

  assert.equal(restored.length, maxResourceViewPresets);
  assert.deepEqual(restored.map((view) => view.order), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(serialized.includes('must-not-persist'), false);
  assert.equal(serialized.includes('password'), false);
});

test('saved view merge preserves deterministic incoming, current, and rename policies', () => {
  const current = [preset('same', { query: 'old' })];
  const incoming = [preset('same', { query: 'new' }), preset('new-view', { order: 2 })];

  const useIncoming = mergeResourceViewPresets(current, incoming, 'incoming');
  assert.equal(useIncoming.conflicts.length, 1);
  assert.equal(useIncoming.presets.find((view) => view.name === 'same')?.query, 'new');

  const keepCurrent = mergeResourceViewPresets(current, incoming, 'current');
  assert.equal(keepCurrent.presets.find((view) => view.name === 'same')?.query, 'old');
  assert.equal(keepCurrent.presets.some((view) => view.name === 'new-view'), true);

  const renameIncoming = mergeResourceViewPresets(current, incoming, 'rename');
  assert.equal(renameIncoming.presets.some((view) => view.name === 'same copy'), true);
  assert.equal(renameIncoming.presets.some((view) => view.name === 'same'), true);
});

test('group move and grouping preserve selected relative order and General-first display', () => {
  const views = [
    preset('first', { order: 1 }),
    preset('second', { order: 2, group: 'Ops' }),
    preset('third', { order: 3 }),
  ];
  const moved = moveResourceViewPresetsToGroup(views, new Set(['first', 'third']), '  Platform  ');
  const platform = moved.filter((view) => view.group === 'Platform');

  assert.deepEqual(platform.map((view) => view.name), ['first', 'third']);
  assert.deepEqual(groupResourceViewPresets(views).map((group) => group.name), [defaultResourceViewGroup, 'Ops']);
});

test('team comparison reports safe counts and normalized snapshot metadata', () => {
  const local = [preset('same', { query: 'old' }), preset('local-only', { order: 2 })];
  const team = [preset('same', { query: 'new' }), preset('team-only', { order: 2 })];
  const metadata = resourceViewTeamSnapshotMetadata({ version: 3.8, updatedAt: 123.9, count: -1, storage: '  file-store  ' }, team.length);
  const preview = buildResourceViewTeamComparePreview('load', local, team, 2, metadata);
  const summary = resourceViewTeamSyncSummaryFromCompare(preview);

  assert.deepEqual(preview.conflictNames, ['same']);
  assert.deepEqual(preview.newNames, ['team-only']);
  assert.deepEqual(preview.localOnlyNames, ['local-only']);
  assert.deepEqual(preview.teamOnlyNames, ['team-only']);
  assert.deepEqual(metadata, { version: 3, updatedAt: 123, count: 2, storage: 'file-store' });
  assert.equal(summary.skippedCount, 2);
  assert.equal(summary.conflictCount, 1);
});

test('collapsed groups and share URLs persist only safe UI metadata', () => {
  const storage = new MemoryStorage();
  writeCollapsedResourceViewGroups(new Set([' Ops ', '', 'Platform']), storage);
  assert.deepEqual([...readCollapsedResourceViewGroups(storage)].sort(), [defaultResourceViewGroup, 'Ops', 'Platform'].sort());

  const url = resourceViewShareUrl(
    { query: 'api', cluster: 'native', namespace: 'default', kind: 'Pod', status: 'healthy' },
    'mock',
    'https://example.invalid/kuviewer/?admin_token=hidden#secret',
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('view'), 'resources');
  assert.equal(parsed.searchParams.get('source'), 'mock');
  assert.equal(parsed.searchParams.get('resourceQuery'), 'api');
  assert.equal(parsed.searchParams.get('resourceCluster'), 'native');
  assert.equal(parsed.searchParams.has('admin_token'), false);
  assert.equal(parsed.hash, '');
});
