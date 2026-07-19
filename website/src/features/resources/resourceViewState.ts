const allValue = 'all';

const resourceViewParamNames = {
  query: 'resourceQuery',
  cluster: 'resourceCluster',
  namespace: 'resourceNamespace',
  kind: 'resourceKind',
  status: 'resourceStatus',
} as const;

export interface ResourceViewFilters {
  query: string;
  cluster: string;
  namespace: string;
  kind: string;
  status: string;
}

export interface ActiveResourceFilterChip {
  id: keyof ResourceViewFilters;
  label: string;
  value: string;
  testId: string;
}

export function defaultResourceViewFilters(): ResourceViewFilters {
  return {
    query: '',
    cluster: allValue,
    namespace: allValue,
    kind: allValue,
    status: allValue,
  };
}

export function readResourceViewFiltersFromSearch(search: string): ResourceViewFilters | null {
  try {
    const params = new URLSearchParams(search);
    const hasResourceViewParams =
      params.get('view') === 'resources' ||
      Object.values(resourceViewParamNames).some((paramName) => params.has(paramName));
    if (!hasResourceViewParams) {
      return null;
    }
    return {
      query: (params.get(resourceViewParamNames.query) || '').slice(0, 160),
      cluster: params.get(resourceViewParamNames.cluster) || allValue,
      namespace: params.get(resourceViewParamNames.namespace) || allValue,
      kind: params.get(resourceViewParamNames.kind) || allValue,
      status: params.get(resourceViewParamNames.status) || allValue,
    };
  } catch {
    return null;
  }
}

export function appSearchHasResourceViewState(search: string) {
  const params = new URLSearchParams(search);
  return params.get('view') === 'resources' || Object.values(resourceViewParamNames).some((paramName) => params.has(paramName));
}

export function appendResourceViewFilterSearchParams(params: URLSearchParams, filters: ResourceViewFilters) {
  const query = filters.query.trim().slice(0, 160);
  if (query) {
    params.set(resourceViewParamNames.query, query);
  }
  if (filters.cluster && filters.cluster !== allValue) {
    params.set(resourceViewParamNames.cluster, filters.cluster);
  }
  if (filters.namespace && filters.namespace !== allValue) {
    params.set(resourceViewParamNames.namespace, filters.namespace);
  }
  if (filters.kind && filters.kind !== allValue) {
    params.set(resourceViewParamNames.kind, filters.kind);
  }
  if (filters.status && filters.status !== allValue) {
    params.set(resourceViewParamNames.status, filters.status);
  }
}

export function resourceViewFiltersEqual(left: ResourceViewFilters, right: ResourceViewFilters) {
  return (
    left.query === right.query &&
    left.cluster === right.cluster &&
    left.namespace === right.namespace &&
    left.kind === right.kind &&
    left.status === right.status
  );
}

export function activeResourceFilterChips(filters: ResourceViewFilters): ActiveResourceFilterChip[] {
  const query = filters.query.trim();
  return [
    query ? { id: 'query', label: 'Search', value: query, testId: 'resource-active-filter-query' } : null,
    filters.cluster !== allValue
      ? { id: 'cluster', label: 'Cluster', value: filters.cluster, testId: 'resource-active-filter-cluster' }
      : null,
    filters.namespace !== allValue
      ? { id: 'namespace', label: 'Namespace', value: filters.namespace, testId: 'resource-active-filter-namespace' }
      : null,
    filters.kind !== allValue ? { id: 'kind', label: 'Kind', value: filters.kind, testId: 'resource-active-filter-kind' } : null,
    filters.status !== allValue
      ? { id: 'status', label: 'Status', value: filters.status, testId: 'resource-active-filter-status' }
      : null,
  ].filter((chip): chip is ActiveResourceFilterChip => chip !== null);
}
