import assert from 'node:assert/strict';
import test from 'node:test';
import { activeResourceFilterChips, defaultResourceViewFilters, resourceViewFiltersEqual } from './resourceViewState.ts';

test('active resource filter chips omit defaults and trim the search query', () => {
  assert.deepEqual(activeResourceFilterChips(defaultResourceViewFilters()), []);

  assert.deepEqual(
    activeResourceFilterChips({
      query: '  checkout  ',
      cluster: 'native',
      namespace: 'all',
      kind: 'Pod',
      status: 'warning',
    }),
    [
      { id: 'query', label: 'Search', value: 'checkout', testId: 'resource-active-filter-query' },
      { id: 'cluster', label: 'Cluster', value: 'native', testId: 'resource-active-filter-cluster' },
      { id: 'kind', label: 'Kind', value: 'Pod', testId: 'resource-active-filter-kind' },
      { id: 'status', label: 'Status', value: 'warning', testId: 'resource-active-filter-status' },
    ],
  );
});

test('resource view equality compares every filter field', () => {
  const defaults = defaultResourceViewFilters();
  assert.equal(resourceViewFiltersEqual(defaults, { ...defaults }), true);
  assert.equal(resourceViewFiltersEqual(defaults, { ...defaults, namespace: 'platform' }), false);
});
