import { useEffect, useMemo, useState } from 'react';
import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import { filterRelatedResources, groupRelatedResources } from './resourceDetailActivity';
import { maxCollapsedRelations } from './resourceDetailTypes';

export function useResourceRelationsController(resource: ResourceExplorerItem) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(false);
  const normalizedFilter = filter.trim();
  const filteredRelations = useMemo(
    () => filterRelatedResources(resource.related, filter),
    [filter, resource.related],
  );
  const groups = useMemo(
    () => groupRelatedResources(filteredRelations, expanded ? Number.POSITIVE_INFINITY : maxCollapsedRelations),
    [expanded, filteredRelations],
  );
  const visibleCount = groups.reduce((total, group) => total + group.items.length, 0);
  const hiddenCount = Math.max(filteredRelations.length - visibleCount, 0);
  const summary = normalizedFilter
    ? `${filteredRelations.length} / ${resource.related.length}`
    : `${resource.related.length}`;

  useEffect(() => {
    setFilter('');
    setExpanded(false);
  }, [resource.id]);

  return {
    expanded,
    filter,
    filteredRelations,
    groups,
    hiddenCount,
    normalizedFilter,
    setFilter,
    summary,
    toggleExpanded: () => setExpanded((current) => !current),
  };
}
