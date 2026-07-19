import { Activity, FileText, Tags } from 'lucide-react';
import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import { DetailSection, HealthSignalPanel, KeyValueGrid } from './ResourceDetailPrimitives';
import { ResourceSafePreviewSection } from './ResourceSafePreviewSection';
import type {
  DetailSectionId,
  HealthSignal,
  ResourceDetailDensity,
} from './resourceDetailTypes';

interface ResourceCoreDetailSectionsProps {
  activeSectionId: DetailSectionId;
  density: ResourceDetailDensity;
  healthSectionTone: 'default' | 'warning' | 'error';
  healthSignals: HealthSignal[];
  isSectionOpen: (id: DetailSectionId) => boolean;
  metadataPreview: Record<string, unknown>;
  onFocusSection: (id: DetailSectionId) => void;
  onOpenSection: (id: DetailSectionId) => void;
  onToggleSection: (id: DetailSectionId) => void;
  resource: ResourceExplorerItem;
  sectionRef: (id: DetailSectionId) => (node: HTMLElement | null) => void;
  sectionSummaries: Record<DetailSectionId, string>;
  statusPreview: Record<string, unknown>;
  summaryPreview: Record<string, unknown>;
  yamlPreview: string;
}

export function ResourceCoreDetailSections({
  activeSectionId,
  density,
  healthSectionTone,
  healthSignals,
  isSectionOpen,
  metadataPreview,
  onFocusSection,
  onOpenSection,
  onToggleSection,
  resource,
  sectionRef,
  sectionSummaries,
  statusPreview,
  summaryPreview,
  yamlPreview,
}: ResourceCoreDetailSectionsProps) {
  return (
    <>
      <DetailSection id="metadata" icon={FileText} title="Metadata" summary={sectionSummaries.metadata} open={isSectionOpen('metadata')} active={activeSectionId === 'metadata'} sectionRef={sectionRef('metadata')} onFocusSection={() => onFocusSection('metadata')} onToggle={() => onToggleSection('metadata')}>
        <KeyValueGrid density={density} testId="metadata" values={metadataPreview} />
      </DetailSection>
      <DetailSection id="status" icon={Activity} title="Status" summary={sectionSummaries.status} tone={healthSectionTone} open={isSectionOpen('status')} active={activeSectionId === 'status'} sectionRef={sectionRef('status')} onFocusSection={() => onFocusSection('status')} onToggle={() => onToggleSection('status')}>
        <HealthSignalPanel signals={healthSignals} />
        <KeyValueGrid density={density} testId="status" values={statusPreview} />
      </DetailSection>
      <ResourceSafePreviewSection
        key={resource.id}
        active={activeSectionId === 'safe'}
        density={density}
        onEnsureOpen={() => onOpenSection('safe')}
        onFocusSection={() => onFocusSection('safe')}
        onToggle={() => onToggleSection('safe')}
        open={isSectionOpen('safe')}
        sectionRef={sectionRef('safe')}
        summary={sectionSummaries.safe}
        values={summaryPreview}
      />
      <DetailSection id="yaml" icon={FileText} title="YAML Preview" summary={sectionSummaries.yaml} open={isSectionOpen('yaml')} active={activeSectionId === 'yaml'} sectionRef={sectionRef('yaml')} onFocusSection={() => onFocusSection('yaml')} onToggle={() => onToggleSection('yaml')}>
        {yamlPreview ? (
          <pre className={`max-h-[360px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] font-mono text-[#d1d5db] ${density === 'compact' ? 'p-2 text-[10px] leading-4' : 'p-3 text-[11px] leading-5'}`}>{yamlPreview}</pre>
        ) : (
          <p className="ku-meta">표시할 YAML preview가 없습니다.</p>
        )}
      </DetailSection>
      <DetailSection id="labels" icon={Tags} title="Labels" summary={sectionSummaries.labels} open={isSectionOpen('labels')} active={activeSectionId === 'labels'} sectionRef={sectionRef('labels')} onFocusSection={() => onFocusSection('labels')} onToggle={() => onToggleSection('labels')}>
        <KeyValueGrid density={density} empty="labels 없음" testId="labels" values={resource.labels} />
      </DetailSection>
      <DetailSection id="annotations" icon={Tags} title="Annotations" summary={sectionSummaries.annotations} open={isSectionOpen('annotations')} active={activeSectionId === 'annotations'} sectionRef={sectionRef('annotations')} onFocusSection={() => onFocusSection('annotations')} onToggle={() => onToggleSection('annotations')}>
        <KeyValueGrid density={density} empty="annotations 없음" testId="annotations" values={resource.annotations} />
      </DetailSection>
    </>
  );
}
