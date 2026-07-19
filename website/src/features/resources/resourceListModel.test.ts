import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceExplorerItem } from '../../types/resourceExplorer.ts';
import {
  buildResourceListRequest,
  defaultResourceListColumns,
  filterResourceList,
  getResourceSelectionRange,
  normalizeResourceListColumnPreference,
  normalizeResourceListSortPreference,
  mergeResourcePages,
  normalizeResourceListRequestError,
  reconcileResourceSelection,
  resourceBulkExportCsv,
  resourceBulkExportFileName,
  resourceBulkExportJson,
  resolveResourceListKeyboardCommand,
  sortResourceList,
} from './resourceListModel.ts';

const resources = [
  resource({ id: 'pod-10', name: 'api-10', namespace: 'prod', labels: { app: 'payments' }, summary: { image: 'registry/api:v10' } }),
  resource({ id: 'pod-2', name: 'api-2', namespace: 'prod', labels: { app: 'checkout' }, summary: { image: 'registry/api:v2' } }),
  resource({ id: 'namespace-prod', kind: 'Namespace', name: 'prod', namespace: undefined, status: 'healthy' }),
];

test('resource list preferences reject malformed values and preserve explicit columns', () => {
  assert.deepEqual(normalizeResourceListSortPreference({ field: 'invalid' as never, direction: 'invalid' as never }), {
    field: 'kind',
    direction: 'asc',
  });
  assert.deepEqual(normalizeResourceListColumnPreference({ cluster: true, age: false, namespace: 'yes' }), {
    ...defaultResourceListColumns,
    cluster: true,
    age: false,
  });
});

test('resource requests normalize sort fields and page merges skip duplicate ids', () => {
  const filters = { query: 'api', cluster: 'cluster-a', namespace: 'prod', kind: 'Pod', status: 'healthy' };
  assert.deepEqual(buildResourceListRequest(filters, { field: 'invalid' as never, direction: 'invalid' as never }, 'next-cursor'), {
    ...filters,
    sort: 'kind',
    direction: 'asc',
    limit: 200,
    cursor: 'next-cursor',
  });
  assert.deepEqual(mergeResourcePages(resources.slice(0, 2), [resources[1], resources[2]]).map((item) => item.id), [
    'pod-10',
    'pod-2',
    'namespace-prod',
  ]);
});

test('resource request errors expose bounded reason codes only', () => {
  assert.equal(normalizeResourceListRequestError(new Error('resources_request_failed:403')), 'resources_request_failed:403');
  assert.equal(normalizeResourceListRequestError(new Error('raw upstream error: redacted-detail')), 'resources_request_failed');
  assert.equal(normalizeResourceListRequestError('unexpected'), 'resources_request_failed');
});

test('resource keyboard commands respect editable targets, modifiers, movement, and detail actions', () => {
  const defaults = {
    altKey: false,
    ctrlKey: false,
    hasSelectedResource: true,
    hasSelectionOrMessage: true,
    key: '',
    metaKey: false,
    resourceCount: 3,
    selectedResourceIndex: 1,
    shiftKey: false,
    shortcutTarget: false,
  };
  assert.deepEqual(resolveResourceListKeyboardCommand({ ...defaults, ctrlKey: true, key: 'a' }), { type: 'select-all' });
  assert.deepEqual(resolveResourceListKeyboardCommand({ ...defaults, key: 'Escape' }), { type: 'clear-selection' });
  assert.deepEqual(resolveResourceListKeyboardCommand({ ...defaults, key: 'ArrowDown', shiftKey: true }), { type: 'move', index: 2, range: true });
  assert.deepEqual(resolveResourceListKeyboardCommand({ ...defaults, key: 'Home' }), { type: 'move', index: 0, range: false });
  assert.deepEqual(resolveResourceListKeyboardCommand({ ...defaults, key: 'Enter' }), { type: 'focus-detail' });
  assert.deepEqual(resolveResourceListKeyboardCommand({ ...defaults, key: ' ' }), { type: 'toggle-selection' });
  assert.equal(resolveResourceListKeyboardCommand({ ...defaults, key: 'ArrowDown', shortcutTarget: true }), null);
  assert.equal(resolveResourceListKeyboardCommand({ ...defaults, altKey: true, key: 'ArrowDown' }), null);
});

test('resource filtering searches safe metadata and keeps namespace resources in namespace filters', () => {
  const defaults = { query: '', cluster: 'all', namespace: 'all', kind: 'all', status: 'all' };
  assert.deepEqual(filterResourceList(resources, { ...defaults, query: 'checkout' }).map((item) => item.id), ['pod-2']);
  assert.deepEqual(filterResourceList(resources, { ...defaults, query: 'v10' }).map((item) => item.id), ['pod-10']);
  assert.deepEqual(filterResourceList(resources, { ...defaults, namespace: 'prod' }).map((item) => item.id), [
    'pod-10',
    'pod-2',
    'namespace-prod',
  ]);
});

test('resource sorting is numeric, deterministic, and direction aware', () => {
  assert.deepEqual(sortResourceList(resources.slice(0, 2), { field: 'name', direction: 'asc' }).map((item) => item.name), ['api-2', 'api-10']);
  assert.deepEqual(sortResourceList(resources.slice(0, 2), { field: 'name', direction: 'desc' }).map((item) => item.name), ['api-10', 'api-2']);
});

test('resource selection reconciliation and range calculation drop stale ids deterministically', () => {
  const current = new Set(['pod-10', 'missing']);
  assert.deepEqual([...reconcileResourceSelection(current, resources)], ['pod-10']);
  const unchanged = new Set(['pod-10']);
  assert.equal(reconcileResourceSelection(unchanged, resources), unchanged);
  assert.deepEqual(getResourceSelectionRange(resources, 'pod-10', 'namespace-prod', 0), {
    anchorResourceId: 'pod-10',
    resourceIds: ['pod-10', 'pod-2', 'namespace-prod'],
  });
  assert.equal(getResourceSelectionRange(resources, 'pod-10', 'missing', 0), null);
});

test('resource bulk exports include safe metadata only and neutralize CSV formulas', () => {
  const unsafe = resource({
    id: 'unsafe',
    name: '=cmd()',
    labels: { token: 'sensitive-label-value' },
    annotations: { credential: 'sensitive-annotation-value' },
    summary: { password: 'sensitive-summary-value' },
  });
  const json = resourceBulkExportJson([unsafe]);
  const csv = resourceBulkExportCsv([unsafe]);
  assert.equal(json.includes('sensitive-label-value'), false);
  assert.equal(json.includes('sensitive-annotation-value'), false);
  assert.equal(json.includes('sensitive-summary-value'), false);
  assert.equal(csv.includes("'=cmd()"), true);
  assert.equal(resourceBulkExportFileName('json', new Date('2026-07-20T01:02:03.004Z')), 'kuviewer-resources-selected-2026-07-20T01-02-03-004Z.json');
});

function resource(overrides: Partial<ResourceExplorerItem>): ResourceExplorerItem {
  return {
    id: 'pod',
    clusterId: 'cluster-a',
    kind: 'Pod',
    namespace: 'default',
    name: 'pod',
    status: 'healthy',
    labels: {},
    annotations: {},
    summary: {},
    preview: {},
    related: [],
    ...overrides,
  };
}
