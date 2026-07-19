import { useEffect, useState } from "react";
import type { ResourceExplorerItem } from "../../types/resourceExplorer";
import {
  readResourceDetailDensityPreference,
  recordFromUnknown,
  writeResourceDetailDensityPreference,
} from './resourceDetailActivity';
import {
  healthSectionSummary,
  healthSignalSectionTone,
  resourceDetailOverviewItems,
  resourceHealthSignals,
  sectionCount,
} from './resourceDetailHealth';
import {
  type DetailSectionId,
  type DetailSectionTone,
  type ResourceDetailDensity,
} from './resourceDetailTypes';
import { ResourceRelationsSection } from './ResourceRelationsSection';
import { ResourceEventsSection } from './ResourceEventsSection';
import { ResourceLogsSection } from './ResourceLogsSection';
import { ResourceExplorerDetailHeader } from './ResourceExplorerDetailHeader';
import { ResourceCoreDetailSections } from './ResourceCoreDetailSections';
import { useResourceDetailSectionsController } from './useResourceDetailSectionsController';
import { useResourceRelationsController } from './useResourceRelationsController';
import { useResourceEventsSectionController } from './useResourceEventsSectionController';
import { useResourceLogsSectionController } from './useResourceLogsSectionController';

function EmptyResourceDetail() {
  return (
    <div className="ku-panel p-6 text-center">
      <p className="text-sm font-semibold text-[#1d1d1f]">선택된 리소스가 없습니다.</p>
    </div>
  );
}

export function ResourceExplorerDetail({
  liveEnabled,
  resource,
  focusRequest,
  onOpenTopologyNode,
  onSelectNode,
}: {
  liveEnabled: boolean;
  resource?: ResourceExplorerItem;
  focusRequest: number;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  if (!resource) {
    return <EmptyResourceDetail />;
  }

  return (
    <ResourceExplorerDetailBody
      liveEnabled={liveEnabled}
      resource={resource}
      focusRequest={focusRequest}
      onOpenTopologyNode={onOpenTopologyNode}
      onSelectNode={onSelectNode}
    />
  );
}

function ResourceExplorerDetailBody({
  liveEnabled,
  resource,
  focusRequest,
  onOpenTopologyNode,
  onSelectNode,
}: {
  liveEnabled: boolean;
  resource: ResourceExplorerItem;
  focusRequest: number;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [resourceDetailDensity, setResourceDetailDensity] = useState<ResourceDetailDensity>(() => readResourceDetailDensityPreference());
  const {
    expanded: relationsExpanded,
    filter: relationFilter,
    filteredRelations,
    groups: relationGroups,
    hiddenCount: hiddenRelationCount,
    normalizedFilter: normalizedRelationFilter,
    setFilter: setRelationFilter,
    summary: relationSummary,
    toggleExpanded: toggleRelationsExpanded,
  } = useResourceRelationsController(resource);
  const {
    activateDetailPanel,
    activeDetailSectionId,
    detailPanelRef,
    focusDetailSection,
    handleCollapseAllDetailSections,
    handleExpandAllDetailSections,
    handleResetDetailSections,
    isSectionOpen,
    openSection,
    openSections,
    setActiveDetailSectionId,
    setDetailSectionRef,
    toggleSection,
  } = useResourceDetailSectionsController({ focusRequest, resourceId: resource.id });
  const eventsSection = useResourceEventsSectionController({
    active: activeDetailSectionId === 'events',
    liveEnabled,
    onEnsureOpen: () => openSection('events'),
    onFocusSection: () => setActiveDetailSectionId('events'),
    onToggleSection: () => toggleSection('events'),
    open: isSectionOpen('events'),
    resource,
    sectionRef: setDetailSectionRef('events'),
  });
  const logsSection = useResourceLogsSectionController({
    active: activeDetailSectionId === 'logs',
    liveEnabled,
    onEnsureOpen: () => openSection('logs'),
    onFocusSection: () => setActiveDetailSectionId('logs'),
    onToggleSection: () => toggleSection('logs'),
    open: isSectionOpen('logs'),
    resource,
    sectionRef: setDetailSectionRef('logs'),
  });

  useEffect(() => {
    writeResourceDetailDensityPreference(resourceDetailDensity);
  }, [resourceDetailDensity]);

  const metadataPreview = resource ? recordFromUnknown(resource.preview.metadata) : {};
  const statusPreview = resource ? recordFromUnknown(resource.preview.status) : {};
  const summaryPreview = resource
    ? {
        ...recordFromUnknown(resource.preview.summary),
        ...(resource.preview.secretValues ? { secretValues: resource.preview.secretValues } : {}),
      }
    : {};
  const yamlPreview = resource && typeof resource.preview.safeYaml === 'string' ? resource.preview.safeYaml : '';

  const healthSignals = resourceHealthSignals(resource, statusPreview, summaryPreview);
  const healthSectionTone = healthSignalSectionTone(resource, healthSignals);
  const detailSectionSummaries: Record<DetailSectionId, string> = {
    metadata: sectionCount(metadataPreview),
    status: healthSectionSummary(resource, healthSignals, statusPreview),
    safe: sectionCount(summaryPreview),
    yaml: yamlPreview ? 'available' : 'empty',
    labels: sectionCount(resource.labels),
    annotations: sectionCount(resource.annotations),
    relations: relationSummary,
    events: eventsSection.summary,
    logs: logsSection.summary,
  };
  const detailSectionTones: Record<DetailSectionId, DetailSectionTone> = {
    metadata: 'default',
    status: healthSectionTone,
    safe: 'default',
    yaml: 'default',
    labels: 'default',
    annotations: 'default',
    relations: 'default',
    events: eventsSection.navigatorTone,
    logs: logsSection.navigatorTone,
  };
  const overviewItems = resourceDetailOverviewItems({
    canFetchLogs: logsSection.canFetch,
    effectiveLogContainer: logsSection.effectiveContainer,
    eventSeverityCounts: eventsSection.severityCounts,
    eventSummary: detailSectionSummaries.events,
    logSummary: detailSectionSummaries.logs,
    labels: resource.labels,
    annotations: resource.annotations,
    healthSignals,
    metadataPreview,
    relationCount: resource.related.length,
    resource,
  });
  return (
    <div
      ref={detailPanelRef}
      className="ku-panel overflow-hidden"
      tabIndex={0}
      onFocusCapture={activateDetailPanel}
      onMouseDownCapture={activateDetailPanel}
      aria-label="리소스 상세 패널"
      data-testid="resource-detail-panel"
    >
      <ResourceExplorerDetailHeader
        activeSectionId={activeDetailSectionId}
        density={resourceDetailDensity}
        eventHasWarning={eventsSection.model.tone === 'warning'}
        healthSectionTone={healthSectionTone}
        onCollapseAll={handleCollapseAllDetailSections}
        onDensityChange={setResourceDetailDensity}
        onExpandAll={handleExpandAllDetailSections}
        onFocusSection={focusDetailSection}
        onResetSections={handleResetDetailSections}
        openSections={openSections}
        overviewItems={overviewItems}
        resource={resource}
        sectionSummaries={detailSectionSummaries}
        sectionTones={detailSectionTones}
      />

      <div className="grid gap-3 p-3">
        <ResourceCoreDetailSections
          activeSectionId={activeDetailSectionId}
          density={resourceDetailDensity}
          healthSectionTone={healthSectionTone}
          healthSignals={healthSignals}
          isSectionOpen={isSectionOpen}
          metadataPreview={metadataPreview}
          onFocusSection={setActiveDetailSectionId}
          onOpenSection={openSection}
          onToggleSection={toggleSection}
          resource={resource}
          sectionRef={setDetailSectionRef}
          sectionSummaries={detailSectionSummaries}
          statusPreview={statusPreview}
          summaryPreview={summaryPreview}
          yamlPreview={yamlPreview}
        />
        <ResourceRelationsSection
          active={activeDetailSectionId === 'relations'}
          expanded={relationsExpanded}
          filter={relationFilter}
          filteredRelations={filteredRelations}
          groups={relationGroups}
          hiddenCount={hiddenRelationCount}
          normalizedFilter={normalizedRelationFilter}
          onFilterChange={setRelationFilter}
          onFocusSection={() => setActiveDetailSectionId('relations')}
          onOpenTopologyNode={onOpenTopologyNode}
          onSelectNode={onSelectNode}
          onToggle={() => toggleSection('relations')}
          onToggleExpanded={toggleRelationsExpanded}
          open={isSectionOpen('relations')}
          resource={resource}
          sectionRef={setDetailSectionRef('relations')}
          summary={detailSectionSummaries.relations}
        />
        <ResourceEventsSection actions={eventsSection.actions} model={eventsSection.model} />
        <ResourceLogsSection actions={logsSection.actions} model={logsSection.model} />
      </div>
    </div>
  );
}
