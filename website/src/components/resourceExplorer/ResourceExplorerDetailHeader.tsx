import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import { ResourceDetailOverview, ResourceDetailSectionNavigator } from './ResourceDetailPrimitives';
import { statusPillClassName } from './resourceDetailActivity';
import {
  defaultOpenDetailSections,
  detailJumpSections,
  detailKeyboardSections,
  detailNavigatorSections,
  type DetailOverviewItem,
  type DetailSectionId,
  type DetailSectionTone,
  type ResourceDetailDensity,
} from './resourceDetailTypes';

interface ResourceExplorerDetailHeaderProps {
  activeSectionId: DetailSectionId;
  density: ResourceDetailDensity;
  eventHasWarning: boolean;
  healthSectionTone: DetailSectionTone;
  onCollapseAll: () => void;
  onDensityChange: (density: ResourceDetailDensity) => void;
  onExpandAll: () => void;
  onFocusSection: (id: DetailSectionId) => void;
  onResetSections: () => void;
  openSections: Set<DetailSectionId>;
  overviewItems: DetailOverviewItem[];
  resource: ResourceExplorerItem;
  sectionSummaries: Record<DetailSectionId, string>;
  sectionTones: Record<DetailSectionId, DetailSectionTone>;
}

export function ResourceExplorerDetailHeader({
  activeSectionId,
  density,
  eventHasWarning,
  healthSectionTone,
  onCollapseAll,
  onDensityChange,
  onExpandAll,
  onFocusSection,
  onResetSections,
  openSections,
  overviewItems,
  resource,
  sectionSummaries,
  sectionTones,
}: ResourceExplorerDetailHeaderProps) {
  const openSectionCount = detailKeyboardSections.filter((id) => openSections.has(id)).length;
  const allSectionsOpen = openSectionCount === detailKeyboardSections.length;
  const noSectionsOpen = openSectionCount === 0;
  const defaultSectionsOpen =
    openSectionCount === defaultOpenDetailSections.length && defaultOpenDetailSections.every((id) => openSections.has(id));
  const activeSectionLabel = detailNavigatorSections.find((section) => section.id === activeSectionId)?.label || 'Metadata';
  const resourceIdentityName = resource.namespace ? `${resource.namespace}/${resource.name}` : resource.name;

  return (
    <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[#1d1d1f]">{resource.name}</h2>
          <p className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
            {resource.clusterId} · {resource.namespace ? `${resource.namespace} / ` : ''}
            {resource.kind}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="리소스 상세 식별 정보">
            <span className="ku-chip" data-testid="resource-detail-kind-chip">Kind {resource.kind}</span>
            <span className="ku-chip" data-testid="resource-detail-name-chip">{resourceIdentityName}</span>
            <span className="ku-chip" data-testid="resource-detail-cluster-chip">Cluster {resource.clusterId}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 상세 밀도">
            {([
              { value: 'comfortable', label: '기본' },
              { value: 'compact', label: '촘촘' },
            ] as const).map((option) => (
              <button
                key={option.value}
                className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                  density === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                }`}
                data-testid={`resource-detail-density-${option.value}`}
                type="button"
                onClick={() => onDensityChange(option.value)}
                aria-pressed={density === option.value}
                title={`리소스 상세 ${option.label} 표시`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className={statusPillClassName(resource.status)}>{resource.status}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-white/70 p-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-detail-active-section">
            현재 {activeSectionLabel}
          </span>
          <span className="ku-chip" data-testid="resource-detail-open-section-count">
            열린 섹션 {openSectionCount} / {detailKeyboardSections.length}
          </span>
          <span className="ku-chip" data-testid="resource-detail-keyboard-hint" title="상세 패널에 포커스가 있을 때만 동작합니다">
            J/K 이동 · O 열기 · E 펼치기 · C 접기 · R 기본 · 1-9 이동
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={onExpandAll}
            disabled={allSectionsOpen}
            aria-pressed={allSectionsOpen}
            aria-label="모든 리소스 상세 섹션 펼치기"
            data-testid="resource-detail-expand-all"
          >
            전체 펼치기
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={onCollapseAll}
            disabled={noSectionsOpen}
            aria-pressed={noSectionsOpen}
            aria-label="모든 리소스 상세 섹션 접기"
            data-testid="resource-detail-collapse-all"
          >
            전체 접기
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={onResetSections}
            disabled={defaultSectionsOpen}
            aria-pressed={defaultSectionsOpen}
            aria-label="리소스 상세 기본 섹션만 펼치기"
            data-testid="resource-detail-reset-sections"
          >
            기본 섹션
          </button>
        </div>
      </div>
      <ResourceDetailSectionNavigator
        activeId={activeSectionId}
        openSections={openSections}
        sections={detailNavigatorSections}
        summaries={sectionSummaries}
        tones={sectionTones}
        onFocusSection={onFocusSection}
      />
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {detailJumpSections.map((section) => {
          const jumpTone: DetailSectionTone =
            section.id === 'events' && eventHasWarning
              ? 'warning'
              : section.id === 'status'
                ? healthSectionTone
                : 'default';
          return (
            <button
              key={section.id}
              className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                activeSectionId === section.id
                  ? jumpTone === 'error'
                    ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.12)] text-[#b42318]'
                    : jumpTone === 'warning'
                      ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#9a5a00]'
                      : 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                  : jumpTone === 'error'
                    ? 'border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.08)] text-[#b42318] hover:bg-[rgba(255,59,48,0.12)]'
                    : jumpTone === 'warning'
                      ? 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#9a5a00] hover:bg-[rgba(255,149,0,0.12)]'
                      : 'border-[rgba(60,60,67,0.12)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
              }`}
              type="button"
              onClick={() => onFocusSection(section.id)}
              aria-current={activeSectionId === section.id ? 'true' : undefined}
              aria-label={`${section.label} ${sectionSummaries[section.id]} 섹션으로 이동`}
              title={`${section.label} 섹션으로 이동`}
            >
              <span>{section.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                  jumpTone === 'error'
                    ? 'bg-white/80 text-[#b42318]'
                    : jumpTone === 'warning'
                      ? 'bg-white/80 text-[#9a5a00]'
                      : 'bg-white/70 text-[rgba(60,60,67,0.54)]'
                }`}
              >
                {sectionSummaries[section.id]}
              </span>
            </button>
          );
        })}
      </div>
      <ResourceDetailOverview items={overviewItems} />
    </div>
  );
}
